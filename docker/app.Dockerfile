# 開発用。ソースはバインドマウントし、node_modules だけ名前付きボリュームに置く
# (ホストにNodeを入れずに済ませるため。ホスト側の node_modules と混ざると壊れる)。
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
# Prisma が必要とする
RUN apk add --no-cache openssl

WORKDIR /work

# 依存だけ先に入れてレイヤを効かせる
# pnpm-workspace.yaml も先に入れる。allowBuilds がここにあり、
# 無いと Prisma のクエリエンジンと esbuild のバイナリが入らない
COPY app/package.json app/pnpm-lock.yaml* app/pnpm-workspace.yaml ./
# prisma/ も install より先。package.json の postinstall が
# `prisma generate` を走らせるので、スキーマが無いとインストールが失敗する
COPY app/prisma ./prisma
RUN pnpm install --no-frozen-lockfile

COPY app/ ./

EXPOSE 3000
CMD ["pnpm", "dev"]
