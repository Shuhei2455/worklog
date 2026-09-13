#!/usr/bin/env bash
# データを取り出す。移設のときと、職場での日々のバックアップに使う。
#
# 守るべきデータは4つ:
#   1. PostgreSQL の backlog  課題・Wiki・ユーザー・活動履歴・監査ログ
#   2. files ボリューム        添付ファイルと共有ファイルの実体
#   3. PostgreSQL の gitea     リポジトリのメタデータ・Giteaのユーザー
#   4. giteadata ボリューム    **リポジトリの実体（コード）**と app.ini
#
# 3と4は M4 でリポジトリを置き始めたので対象に加えた。
# **app.ini を含めるのが重要。** SECRET_KEY と INTERNAL_TOKEN が
# 入っており、これが変わると既存のアクセストークンが無効になる。
#
# Redis は通知キューの一時置き場、Meilisearch は検索インデックスなので
# 取らない。どちらもDBから作り直せる（復元後に再インデックスする）。
#
# 使い方:
#   scripts/backup.sh                                         # 開発スタック
#   COMPOSE_FILE=docker-compose.prod.yml scripts/backup.sh     # 本番スタック
#   OUT_DIR=/mnt/backup scripts/backup.sh

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
OUT_DIR="${OUT_DIR:-./dist/backup}"
STAMP=$(date +%Y%m%d-%H%M%S)

compose() {
  if [ -n "${PROJECT:-}" ]; then
    docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

mkdir -p "$OUT_DIR"
DEST="${OUT_DIR}/backlog-clone-${STAMP}"
mkdir -p "$DEST"

echo "== PostgreSQL =="
# --clean --if-exists を付けておくと、既存のDBへそのまま流し込める。
# -Fc（独自形式）ではなく平文にしているのは、中身を目で確認できるようにするため
compose exec -T postgres pg_dump \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges \
  > "${DEST}/postgres.sql"
gzip "${DEST}/postgres.sql"
echo "  ${DEST}/postgres.sql.gz ($(du -h "${DEST}/postgres.sql.gz" | cut -f1))"

echo "== 添付ファイル（files ボリューム） =="
# app コンテナのマウントをそのまま借りる（--volumes-from）。
# ボリューム名はプロジェクト名で変わるので、名前を当てにしない。
# -C /data/files にしているのは、復元時に階層がずれないようにするため
APP_CID=$(compose ps -q app | head -1)
if [ -z "$APP_CID" ]; then
  echo "  app コンテナが起動していません。先に起動してください" >&2
  exit 1
fi
docker run --rm \
  --volumes-from "$APP_CID" \
  -v "$(cd "$DEST" && pwd):/out" \
  postgres:16-alpine \
  tar czf /out/files.tar.gz -C /data/files .
echo "  ${DEST}/files.tar.gz ($(du -h "${DEST}/files.tar.gz" | cut -f1))"

echo "== Gitea のデータベース =="
# Gitea は同じ postgres の別データベースを使う（docker/postgres-init/）。
# リポジトリのメタデータとGitea側のユーザーがここにある
if compose exec -T postgres psql -U "$POSTGRES_USER" -lqt | cut -d'|' -f1 | grep -qw gitea; then
  compose exec -T postgres pg_dump \
    -U "$POSTGRES_USER" -d gitea \
    --clean --if-exists --no-owner --no-privileges \
    > "${DEST}/gitea.sql"
  gzip "${DEST}/gitea.sql"
  echo "  ${DEST}/gitea.sql.gz ($(du -h "${DEST}/gitea.sql.gz" | cut -f1))"
else
  echo "  gitea データベースがありません（Gitを使っていない）"
fi

echo "== Gitea のリポジトリ本体 =="
# **ここにコードの実体がある。** app.ini も含める（SECRET_KEY が入っている）
GITEA_CID=$(compose ps -q gitea | head -1)
if [ -n "$GITEA_CID" ]; then
  docker run --rm \
    --volumes-from "$GITEA_CID" \
    -v "$(cd "$DEST" && pwd):/out" \
    postgres:16-alpine \
    tar czf /out/giteadata.tar.gz -C /data .
  echo "  ${DEST}/giteadata.tar.gz ($(du -h "${DEST}/giteadata.tar.gz" | cut -f1))"
else
  echo "  gitea コンテナが起動していないため取得しません"
fi

echo "== 付属情報 =="
# どの版のイメージで取ったかを残す。復元時に版違いで詰まるのを防ぐ
{
  echo "取得日時: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "compose:  $COMPOSE_FILE"
  echo "イメージ: ${APP_IMAGE_TAG:-(開発スタックのためタグなし)}"
  echo "DB:       ${POSTGRES_DB} / ユーザー ${POSTGRES_USER}"
  echo
  echo "適用済みマイグレーション:"
  compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At \
    -c "select migration_name from _prisma_migrations order by finished_at;" 2>/dev/null | sed 's/^/  /'
} > "${DEST}/MANIFEST.txt"
cat "${DEST}/MANIFEST.txt" | sed 's/^/  /'

echo
echo "できました: ${DEST}"
echo "復元は scripts/restore.sh ${DEST}"
