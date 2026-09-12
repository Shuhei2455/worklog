# 本番用（職場VM向け）。
#
# 開発用(app.Dockerfile)との違い:
#   - ソースをバインドマウントしない。成果物をイメージに焼き込む
#     → `docker save` したtarだけで動く。職場VMにソースを置かなくてよい
#   - `pnpm dev` ではなく、ビルド済みの standalone サーバを起動する
#   - 実行時にネットワークへ出ない（pnpm install も prisma のDLも起きない）
#
# 1つのイメージで4つの役目を果たす。用途ごとにイメージを分けると
# 持ち込むtarが増え、版ずれの事故が起きるため:
#   1. アプリ            : node server.js   （作業ディレクトリ /app）
#   2. ワーカー          : worker.sh        （作業ディレクトリ /worker）
#   3. マイグレーション  : migrate.sh
#   4. 初期データ        : seed.sh
#   5. 再インデックス    : reindex.sh
#   6. パスワード再設定  : set-password.sh
#
# イメージ内の構成:
#   /app        Next.js の standalone 出力。アプリだけが使う
#   /worker     ワーカーとPrisma用。src・prisma・平坦な node_modules
#   /opt/tools  tsx（TSをそのまま実行）と prisma CLI
#
# /app と /worker で node_modules を分けているのは、standalone の
# node_modules には next と react しか入っておらず、bullmq などは
# webpack のチャンクに取り込まれていて**パッケージとして解決できない**ため。
# ワーカーを /app から起動すると ERR_MODULE_NOT_FOUND で落ちる（実測した）。

# ---- ビルド段 --------------------------------------------------------
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
RUN apk add --no-cache openssl

WORKDIR /work

# pnpm-workspace.yaml も先に入れる。allowBuilds がここにあり、
# 無いと Prisma のクエリエンジンと esbuild のバイナリが入らない
COPY app/package.json app/pnpm-lock.yaml* app/pnpm-workspace.yaml ./
# prisma/ も install より先。package.json の postinstall が
# `prisma generate` を走らせるので、スキーマが無いとインストールが失敗する
COPY app/prisma ./prisma
RUN pnpm install --no-frozen-lockfile

COPY app/ ./

# Prismaクライアントを生成してから next build。
# DATABASE_URL はPrismaのスキーマ検証のために形だけ必要。
# 全ページが動的レンダリング(ƒ)なのでビルド中にDBへは繋がない
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
ENV CHECKPOINT_DISABLE=1
RUN pnpm prisma generate && pnpm build

# ---- ワーカー用の依存を平坦に作る ------------------------------------
# pnpm の node_modules はシンボリックリンクの塊で、COPY すると壊れる。
# npm で入れ直す。版は**ビルドに使った実物から読む**ので lockfile と
# 一致し、イメージを作り直しても同じ版になる
RUN node -e "const n=['@prisma/client','bullmq','ioredis','meilisearch','nodemailer'];\
console.log(n.map(m=>m+'@'+require('/work/node_modules/'+m+'/package.json').version).join(' '))" \
      > /tmp/worker-deps.txt \
 && cat /tmp/worker-deps.txt \
 && npm install --prefix /worker --no-save --no-audit --no-fund $(cat /tmp/worker-deps.txt)

# tsx（ワーカーのTSを実行）と prisma CLI（migrate deploy）。
# どちらも devDependency なので上の組には入らない。版は固定する
RUN npm install --prefix /opt/tools --no-save --no-audit --no-fund \
      tsx@4.19.2 prisma@5.22.0

# ワーカーはTypeScriptのまま tsx で動かす。
# tsconfig.json は `@/` のパスエイリアスを解決するために必要
COPY app/prisma /worker/prisma
COPY app/src /worker/src
COPY app/tsconfig.json /worker/
# 開発時と同じ ESM として扱わせる。これが無いと Node の既定で CJS になり、
# トップレベル await を使ったスクリプトが
# 「Top-level await is currently not supported with the "cjs" output format」
# で落ちる（app/package.json には "type": "module" がある）
RUN echo '{ "type": "module" }' > /worker/package.json
# /app 側(standalone)のPrismaクライアントとは別物なので、ここでも生成する
RUN cd /worker && /opt/tools/node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ---- 実行段 ----------------------------------------------------------
FROM node:22-alpine AS runtime

# Prisma のクエリエンジンが要求する
RUN apk add --no-cache openssl

ENV NODE_ENV=production
# テレメトリを止める。外に出られないVMで、出ようとして待たされるのも避ける
ENV NEXT_TELEMETRY_DISABLED=1
ENV CHECKPOINT_DISABLE=1
# standalone の server.js は HOSTNAME を見る。既定は localhost で、
# コンテナ外（Caddy）から繋がらない
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

# standalone には app が実際に使う依存だけが入っている（81MB）。
# 依存一式(550MB)を持ち込まずに済む
COPY --from=builder /work/.next/standalone ./
COPY --from=builder /work/.next/static ./.next/static
COPY --from=builder /work/public ./public

COPY --from=builder /worker /worker
COPY --from=builder /opt/tools /opt/tools

COPY docker/worker.sh docker/migrate.sh docker/seed.sh docker/reindex.sh \
     docker/set-password.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/worker.sh /usr/local/bin/migrate.sh \
      /usr/local/bin/seed.sh /usr/local/bin/reindex.sh /usr/local/bin/set-password.sh

EXPOSE 3000
CMD ["node", "server.js"]
