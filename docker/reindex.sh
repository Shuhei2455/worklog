#!/bin/sh
# 検索インデックスを作り直す。移設・復元の後に1回流す。
# Meilisearch のデータはバックアップに含めていない（DBから作り直せるため）。
#
# 使い方: docker compose -f docker-compose.prod.yml run --rm reindex
set -e
cd /worker
exec node /opt/tools/node_modules/tsx/dist/cli.mjs src/scripts/reindex.ts
