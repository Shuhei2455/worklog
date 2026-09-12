#!/bin/sh
# 初期データ（管理者ユーザーと既定のマスタ）を入れる。新規構築のときだけ。
# 既存データがある環境で流すと重複やキーの衝突で失敗する。
#
# 使い方: docker compose -f docker-compose.prod.yml run --rm seed
set -e
cd /worker
exec node /opt/tools/node_modules/tsx/dist/cli.mjs prisma/seed.ts
