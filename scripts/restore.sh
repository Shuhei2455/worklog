#!/usr/bin/env bash
# backup.sh で取ったものを戻す。移設先での初回投入にも使う。
#
# **既存データを上書きする。** pg_dump に --clean を付けているので、
# 同名のテーブルは落としてから作り直される。
# 移設先が新規なら問題ないが、運用中の環境へ流すと元のデータは消える。
#
# 使い方:
#   COMPOSE_FILE=docker-compose.prod.yml scripts/restore.sh dist/backup/backlog-clone-20260913-150000

set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-}"
if [ -z "$SRC" ] || [ ! -f "${SRC}/postgres.sql.gz" ]; then
  echo "使い方: $0 <backup.sh が作ったディレクトリ>" >&2
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"

compose() {
  if [ -n "${PROJECT:-}" ]; then
    docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

echo "== 戻すもの =="
[ -f "${SRC}/MANIFEST.txt" ] && sed 's/^/  /' "${SRC}/MANIFEST.txt"
echo
echo "== 戻す先 =="
echo "  compose: $COMPOSE_FILE"
echo "  DB:      ${POSTGRES_DB}"
echo
echo "既存のテーブルは削除して作り直されます。"
printf "続けますか？ [yes/no]: "
read -r ans
[ "$ans" = "yes" ] || { echo "やめました"; exit 1; }

echo
echo "== アプリとワーカーを止める（書き込みを止めてから戻す） =="
compose stop app worker 2>&1 | sed 's/^/  /'

echo "== PostgreSQL =="
gunzip -c "${SRC}/postgres.sql.gz" \
  | compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q 2>&1 \
  | grep -viE "^(NOTICE|SET|DROP|CREATE|ALTER|COPY|GRANT|REVOKE)" | head -20 | sed 's/^/  /' || true
echo "  流し込み完了"

if [ -f "${SRC}/gitea.sql.gz" ]; then
  echo "== Gitea のデータベース =="
  compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c \
    "SELECT 'CREATE DATABASE gitea' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='gitea')\gexec" \
    >/dev/null 2>&1 || true
  gunzip -c "${SRC}/gitea.sql.gz" \
    | compose exec -T postgres psql -U "$POSTGRES_USER" -d gitea -q 2>&1 \
    | grep -viE "^(NOTICE|SET|DROP|CREATE|ALTER|COPY|GRANT|REVOKE)" | head -10 | sed 's/^/  /' || true
  echo "  流し込み完了"
fi

if [ -f "${SRC}/giteadata.tar.gz" ]; then
  echo "== Gitea のリポジトリ本体 =="
  # gitea を止めてから入れる。動いている最中に差し替えるとインデックスが壊れる
  compose stop gitea 2>&1 | sed 's/^/  /'
  GITEA_CID=$(compose ps -aq gitea | head -1)
  docker run --rm \
    --volumes-from "$GITEA_CID" \
    -v "$(cd "$SRC" && pwd):/in:ro" \
    postgres:16-alpine \
    sh -c "rm -rf /data/git /data/gitea && tar xzf /in/giteadata.tar.gz -C /data \
           && chown -R ${RUN_UID:-1000}:${RUN_GID:-1000} /data"
  echo "  展開完了（app.ini も戻しました）"
fi

if [ -f "${SRC}/files.tar.gz" ]; then
  echo "== 添付ファイル =="
  # app は止めているので、ボリュームは別コンテナから書く
  APP_CID=$(compose ps -aq app | head -1)
  # 展開と所有者直しを同じコンテナで済ませる。
  # docker/fix-volume-perms.sh を呼ぶとボリューム名を取り違える
  # （あちらの既定は backlog-clone_files 固定で、プロジェクト名が違うと別物を触る）
  docker run --rm \
    --volumes-from "$APP_CID" \
    -v "$(cd "$SRC" && pwd):/in:ro" \
    postgres:16-alpine \
    sh -c "tar xzf /in/files.tar.gz -C /data/files \
           && chown -R ${RUN_UID:-1000}:${RUN_GID:-1000} /data/files"
  echo "  展開と所有者の修正が完了（${RUN_UID:-1000}:${RUN_GID:-1000}）"
fi

echo "== 起動し直す =="
compose up -d 2>&1 | tail -5 | sed 's/^/  /'

echo
echo "== 検索インデックスを作り直す =="
# Meilisearch はバックアップに含めていない（DBから作り直せるため）。
# 復元直後は検索が何も返さないので、ここで必ず流す
if [ "$COMPOSE_FILE" = "docker-compose.prod.yml" ]; then
  compose run --rm reindex 2>&1 | grep -v "Container" | sed 's/^/  /'
else
  compose exec -T app pnpm reindex 2>&1 | tail -5 | sed 's/^/  /'
fi

echo
echo "確認すること:"
echo "  1. ログインできる"
echo "  2. 課題が全部見える（件数を移設前と比べる）"
echo "  3. 添付ファイルが開ける"
echo "  4. 検索が効く（再インデックス後）"
echo "  5. Gitのリポジトリが開け、クローンできる"
