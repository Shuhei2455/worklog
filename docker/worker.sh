#!/bin/sh
# ワーカーを本番で起動する。開発の `tsx watch` と違い監視はしない。
# tsx は /opt/tools に平坦に入れてある（pnpm のシンボリックリンクを
# イメージへ COPY できないため。app.prod.Dockerfile 参照）
set -e
cd /worker
exec node /opt/tools/node_modules/tsx/dist/cli.mjs src/worker/index.ts
