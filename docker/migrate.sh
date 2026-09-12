#!/bin/sh
# マイグレーションを適用する。`prisma migrate deploy` は未適用のものだけを
# 順に当て、スキーマの差分から勝手にSQLを作ることはしない（db push と違う点）。
#
# 使い方: docker compose -f docker-compose.prod.yml run --rm migrate
set -e
cd /worker
exec /opt/tools/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
