# 開発用。ソースはバインドマウントし、node_modules だけ名前付きボリュームに置く
# (ホストにNodeを入れずに済ませるため。ホスト側の node_modules と混ざると壊れる)。
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
# Prisma が必要とする
RUN apk add --no-cache openssl

WORKDIR /work

# 依存だけ先に入れてレイヤを効かせる
COPY app/package.json app/pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

COPY app/ ./

EXPOSE 3000
CMD ["pnpm", "dev"]
