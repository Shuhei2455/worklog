#!/bin/sh
# ユーザーのパスワードを設定し直す。
#
# 職場VMには pnpm もソースも無いので、これが唯一の復旧手段になる
# （管理者のパスワードが分からなくなったとき）。
#
# 使い方:
#   docker compose -f docker-compose.prod.yml run --rm set-password <ログインID> <新しいパスワード>
set -e
cd /worker
exec node /opt/tools/node_modules/tsx/dist/cli.mjs prisma/set-password.ts "$@"
