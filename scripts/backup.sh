#!/usr/bin/env bash
# データを取り出す。移設のときと、職場での日々のバックアップに使う。
#
# 守るべきデータは2つだけ（01-design.md 1.B の設計方針）:
#   1. PostgreSQL     課題・Wiki・ユーザー・活動履歴のすべて
#   2. files ボリューム  添付ファイルと共有ファイルの実体
#
# Redis は通知キューの一時置き場、Meilisearch は検索インデックスなので
# 取らない。どちらもDBから作り直せる（復元後に再インデックスする）。
# Gitea のデータは M4 でリポジトリを置き始めてから対象に加える。
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
