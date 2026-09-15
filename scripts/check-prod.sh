#!/usr/bin/env bash
# 本番構成でしか起きない種類の問題を潰す検査。
#
# 開発環境では再現しないものがある（docs/06-verification-plan.md の C）:
#   - worker の依存漏れ（`zod` が無く起動できなかった。画面は動くので気づきにくい）
#   - IPアドレス宛にはSNIが来ないためTLSが成立しない（ブラウザが全部繋がらない）
#   - standalone ビルドでしか出ない型エラー
#
# **開発スタックには触らない。** 別のプロジェクト名・別のポート・別のボリュームで動かす。
# `docker compose down -v` は使わない（CLAUDE.md）。
#
# 使い方:
#   scripts/check-prod.sh              # ビルドから通す
#   SKIP_BUILD=1 scripts/check-prod.sh # 既存イメージで確かめるだけ
#   KEEP=1 scripts/check-prod.sh       # 終わっても落とさない（画面を見たいとき）

set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT=backlog-check
TAG="${APP_IMAGE_TAG:-check}"
# 空いているポートを選ぶ。
# **決め打ちにすると他のものと衝突して、その失敗を「アプリの不具合」と誤認する。**
# 実際に 8097 が既に使われていて、Caddy が起動できずTLSの検査が全部落ちた
free_port() {
  local p
  for p in $(seq "$1" "$(($1 + 40))"); do
    if ! ss -lnt 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$"; then
      echo "$p"; return
    fi
  done
  echo "$1"
}
ENV_FILE_EARLY="${CHECK_ENV_FILE:-.check-prod.env}"
# **.env を使い回すならポートもそこから読む。**
# 空きポートを選び直すと、Caddy は .env のポートで待ち受けるのに
# 検査は新しいポートへ繋ぎに行き、TLSが全部落ちる（実際に踏んだ）
if [ -f "$ENV_FILE_EARLY" ]; then
  HTTP_PORT="${CHECK_HTTP_PORT:-$(grep '^CADDY_HTTP_PORT=' "$ENV_FILE_EARLY" | cut -d= -f2)}"
  HTTPS_PORT="${CHECK_HTTPS_PORT:-$(grep '^CADDY_HTTPS_PORT=' "$ENV_FILE_EARLY" | cut -d= -f2)}"
else
  HTTP_PORT="${CHECK_HTTP_PORT:-$(free_port 8097)}"
  HTTPS_PORT="${CHECK_HTTPS_PORT:-$(free_port 8447)}"
fi
# TLSはIP宛に出すので、実際に外から見えるアドレスを使う
HOST_IP="${CHECK_HOST_IP:-$(hostname -I | awk '{print $1}')}"
ENV_FILE="${CHECK_ENV_FILE:-.check-prod.env}"
BASE="https://${HOST_IP}:${HTTPS_PORT}"

FAILED=0

# URLエンコード。
# **日本語をそのままクエリに載せない。**
# 最初これを忘れて、検索が壊れていると誤報した（実際はアプリ側は正しかった）。
urlenc() {
  local s="$1" out="" c
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c" 2>/dev/null || printf '%s' "$c" | xxd -p -c1 | sed 's/^/%/' | tr -d '\n') ;;
    esac
  done
  printf '%s' "$out"
}

ok()   { printf "  OK    %s\n" "$1"; }
ng()   { printf "  **NG**  %s\n" "$1"; FAILED=$((FAILED+1)); }
info() { printf "        %s\n" "$1"; }

COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE")
export RUN_UID="$(id -u)" RUN_GID="$(id -g)"

cleanup() {
  if [ "${KEEP:-}" = "1" ]; then
    echo ""
    echo "KEEP=1 なので起動したままにします: ${BASE}"
    return
  fi
  echo ""
  echo "-- 片づけ（ボリュームは消しません） --"
  "${COMPOSE[@]}" down >/dev/null 2>&1
}
trap cleanup EXIT

# 前回の検査スタックが残っているとポートを掴んだままになる
"${COMPOSE[@]}" down >/dev/null 2>&1

echo "== 本番構成の検査 =="
echo "  イメージ: backlog-clone-app:${TAG}"
echo "  入口: ${BASE}"
echo ""

# ---- 1. .env を用意する ----------------------------------------------------
#
# **毎回作り直さない。** PostgreSQL のパスワードはボリュームの初期化時にしか
# 効かないので、作り直すと2回目から認証に失敗する（実際に踏んだ）。
if [ ! -f "$ENV_FILE" ]; then
  echo "-- 検査用の .env を作る（$ENV_FILE） --"
  PG_PW=$(openssl rand -base64 24 | tr -d '/+=')
  sed \
    -e "s|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=${TAG}|" \
    -e "s|^APP_HOST=.*|APP_HOST=${HOST_IP}|" \
    -e "s|^APP_URL=.*|APP_URL=${BASE}|" \
    -e "s|^CADDY_TLS=.*|CADDY_TLS=internal|" \
    -e "s|^CADDY_HTTP_PORT=.*|CADDY_HTTP_PORT=${HTTP_PORT}|" \
    -e "s|^CADDY_HTTPS_PORT=.*|CADDY_HTTPS_PORT=${HTTPS_PORT}|" \
    -e "s|^GITEA_DOMAIN=.*|GITEA_DOMAIN=${HOST_IP}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" \
    -e "s|postgresql://backlog:CHANGE_ME@|postgresql://backlog:${PG_PW}@|" \
    -e "s|^MEILI_MASTER_KEY=.*|MEILI_MASTER_KEY=$(openssl rand -base64 24 | tr -d '/+=')|" \
    -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" \
    -e "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=kadai-demo-2026|" \
    -e "s|^GITEA_WEBHOOK_SECRET=.*|GITEA_WEBHOOK_SECRET=$(openssl rand -base64 24 | tr -d '/+=')|" \
    -e "s|^IMAGE_PREFIX=.*|IMAGE_PREFIX=|" \
    -e "s|^IMAGE_PULL_POLICY=.*|IMAGE_PULL_POLICY=never|" \
    -e "s|^CADDY_IMAGE=.*|CADDY_IMAGE=caddy:2-alpine|" \
    -e "s|^POSTGRES_IMAGE=.*|POSTGRES_IMAGE=postgres:16-alpine|" \
    -e "s|^REDIS_IMAGE=.*|REDIS_IMAGE=redis:7-alpine|" \
    -e "s|^MEILI_IMAGE=.*|MEILI_IMAGE=getmeili/meilisearch:v1.11|" \
    -e "s|^GITEA_IMAGE=.*|GITEA_IMAGE=gitea/gitea:1.22|" \
    .env.production.example > "$ENV_FILE"
  if grep -q CHANGE_ME "$ENV_FILE"; then
    ng "CHANGE_ME が残っている: $(grep -c CHANGE_ME "$ENV_FILE") 箇所"
    grep -n CHANGE_ME "$ENV_FILE" | sed 's/^/        /'
  fi
else
  info ".env は既にあるので使い回します（PostgreSQLのパスワードを変えないため）"
  sed -i "s|^APP_IMAGE_TAG=.*|APP_IMAGE_TAG=${TAG}|" "$ENV_FILE"
fi

# ---- 2. ビルド（worker の依存の検算がここで走る） ---------------------------
if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo ""
  echo "-- 本番イメージをビルド --"
  if out=$(docker build -f docker/app.prod.Dockerfile -t "backlog-clone-app:${TAG}" . 2>&1); then
    ok "ビルドが通る（型エラーなし）"
    if grep -q "worker-deps.*すべて解決できた" <<<"$out"; then
      ok "ワーカーの依存の検算が通る"
    else
      ng "ワーカーの依存の検算が出力に無い"
    fi
  else
    ng "ビルドに失敗"
    tail -20 <<<"$out" | sed 's/^/        /'
    exit 1
  fi
fi

# ---- 3. 起動 ----------------------------------------------------------------
echo ""
echo "-- 起動 --"
"${COMPOSE[@]}" up -d postgres redis meilisearch >/dev/null 2>&1
for _ in $(seq 1 60); do
  n=$("${COMPOSE[@]}" ps --format '{{.Health}}' 2>/dev/null | grep -c healthy)
  [ "${n:-0}" -ge 3 ] && break
  sleep 2
done
[ "${n:-0}" -ge 3 ] && ok "データ層が healthy" || ng "データ層が healthy にならない"

if mig=$("${COMPOSE[@]}" run --rm migrate 2>&1); then
  ok "マイグレーションが当たる"
else
  ng "マイグレーションに失敗"
  # **原因を言わずに落ちると、アプリの不具合と取り違える。**
  # PostgreSQL のパスワードはボリュームの初期化時にしか効かないので、
  # .env を作り直すと既存のボリュームとは合わなくなる
  if grep -q "Authentication failed" <<<"$mig"; then
    info "既存のボリュームと ${ENV_FILE} のパスワードが食い違っています。"
    info "${ENV_FILE} を作り直した場合はこうなります。次のどちらかで解消します:"
    info "  ・以前の ${ENV_FILE} を戻す"
    info "  ・検査用のボリュームを削除してから再実行する（検査専用なので消して構いません）"
    info "     docker volume rm ${PROJECT}_pgdata ${PROJECT}_meilidata ${PROJECT}_giteadata"
    info "     ※ 開発スタックの backlog-clone_* とは別物です。消さないよう注意"
  else
    tail -6 <<<"$mig" | sed 's/^/        /'
  fi
  exit 1
fi
# **plain な seed ではなく demo:seed を使う。**
# seed は管理者を1人作るだけでプロジェクトが無く、
# 課題の作成や検索の往復を確かめられない（最初それで「APIで引けない」と誤報した）。
if "${COMPOSE[@]}" run --rm --entrypoint sh worker \
     -c 'cd /worker && node /opt/tools/node_modules/tsx/dist/cli.mjs prisma/demo-seed.ts' \
     >/dev/null 2>&1; then
  ok "動作確認用データを入れられる（10人・5プロジェクト・33課題）"
else
  ng "demo:seed に失敗"
fi
if ! up_out=$("${COMPOSE[@]}" up -d 2>&1); then
  ng "起動に失敗した"
  tail -6 <<<"$up_out" | sed 's/^/        /'
fi

# 起動直後は不安定なので少し待つ
sleep 12

# ---- 4. サービスが「留まっている」か ----------------------------------------
#
# **healthy の数だけで判定しない。** worker には healthcheck が無く、
# restarting を繰り返していても数に出てこない（zod 欠落のときに見落とした）。
echo ""
echo "-- サービスの状態 --"
states=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.State}}' 2>/dev/null)
echo "$states" | sed 's/^/        /'
if grep -q "restarting" <<<"$states"; then
  ng "restarting のサービスがある（起動に失敗して再試行している）"
else
  ok "全サービスが running のまま"
fi
# **数えるだけにしない。** 名前で確かめる。
# Caddy が作られもしなかったのに「全サービス running」と報告したことがある
for svc in caddy app worker postgres redis meilisearch gitea; do
  if ! grep -qE "^${svc} running" <<<"$states"; then
    ng "${svc} が起動していない"
    docker compose -p "$PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" \
      logs "$svc" 2>&1 | tail -5 | sed 's/^/        /'
  fi
done

# worker が仕事を待てているか
if "${COMPOSE[@]}" logs worker 2>&1 | grep -q "配信を待機します"; then
  ok "worker が待機に入っている"
else
  ng "worker が待機に入っていない"
  "${COMPOSE[@]}" logs worker 2>&1 | tail -8 | sed 's/^/        /'
fi

# ---- 5. TLS（IP直打ち） -----------------------------------------------------
echo ""
echo "-- TLS --"
san=$(echo | openssl s_client -connect "${HOST_IP}:${HTTPS_PORT}" 2>/dev/null \
      | openssl x509 -noout -ext subjectAltName 2>/dev/null)
if grep -q "IP Address:${HOST_IP}" <<<"$san"; then
  ok "証明書の subjectAltName に IP が入っている"
else
  ng "証明書に IP の SAN が無い（今のブラウザは CN だけの証明書を受け付けない）"
  info "${san:-取得できず}"
fi

# **SNI を送らずに繋ぐ。** IPアドレス宛にはブラウザもSNIを送らないので、
# ここが通らないと職場では誰も繋がらない（default_sni の件）
code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 20 "${BASE}/login")
if [ "$code" = "200" ]; then
  ok "SNI無しのHTTPSで /login が 200"
else
  ng "SNI無しのHTTPSで /login が ${code}（default_sni を確認する）"
fi

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "http://${HOST_IP}:${HTTP_PORT}/")
[ "$code" = "301" ] && ok "80番から HTTPS へ転送" || ng "80番からの転送が ${code}"

# ---- 6. 機能の往復 ----------------------------------------------------------
echo ""
echo "-- 機能の往復 --"
CJ=$(mktemp)
csrf=$(curl -sk -c "$CJ" "${BASE}/api/auth/csrf" | sed -n 's/.*"csrfToken":"\([^"]*\)".*/\1/p')
curl -sk -b "$CJ" -c "$CJ" -o /dev/null -X POST "${BASE}/api/auth/callback/credentials" \
  -d "csrfToken=${csrf}" -d "userId=admin" -d "password=kadai-demo-2026"
who=$(curl -sk -b "$CJ" "${BASE}/api/auth/session" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')
[ -n "$who" ] && ok "ログインできる（${who}）" || ng "ログインできない"

# APIキーを直接作って往復を見る（画面操作より壊れにくい）
RAW=$(openssl rand -hex 24)
HASH=$(printf '%s' "$RAW" | sha256sum | cut -d' ' -f1)
"${COMPOSE[@]}" exec -T postgres psql -U backlog -d backlog -tAc \
  "insert into api_tokens (user_id, name, token_hash) values (1,'検査','${HASH}')" >/dev/null 2>&1

proj=$(curl -sk "${BASE}/api/v2/projects?apiKey=${RAW}" | sed -n 's/.*"id":\([0-9]*\).*/\1/p' | head -1)
if [ -n "$proj" ]; then
  ok "API でプロジェクトを引ける"
  created=$(curl -sk -X POST "${BASE}/api/v2/issues?apiKey=${RAW}" \
    -d "projectId=${proj}" -d "summary=本番構成の検査" -d "issueTypeId=1" -d "priorityId=3")
  key=$(sed -n 's/.*"issueKey":"\([^"]*\)".*/\1/p' <<<"$created")
  [ -n "$key" ] && ok "API で課題を作れる（${key}）" || { ng "API で課題を作れない"; info "${created:0:200}"; }

  # 検索は worker が索引を作ってから効く
  hit=""
  for _ in $(seq 1 15); do
    sleep 2
    hit=$(curl -sk "${BASE}/api/v2/issues?apiKey=${RAW}&keyword=$(urlenc '本番構成の検査')" \
          | grep -o '"issueKey"' | head -1)
    [ -n "$hit" ] && break
  done
  [ -n "$hit" ] && ok "作った課題が検索に出る（worker と Meilisearch が動いている）" \
                || ng "作った課題が検索に出ない"
else
  ng "API でプロジェクトを引けない"
fi
rm -f "$CJ"

# ---- 7. 外へ出ていないか ----------------------------------------------------
echo ""
echo "-- 外部通信 --"
if [ -x scripts/egress-check.sh ]; then
  if PROJECT="$PROJECT" COMPOSE_FILE=docker-compose.prod.yml \
     timeout 60 scripts/egress-check.sh 2>&1 | grep -qiE "0 件|接続はありません|なし"; then
    ok "github.com / ghcr.io 以外への接続なし"
  else
    info "egress-check.sh の結果を目で確かめてください（pull 直後は出ます）"
  fi
fi

# ---- まとめ -----------------------------------------------------------------
echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "== 本番構成の検査: 問題なし =="
  echo "   （職場のネットワーク・社内CA・SMTP は、実機でしか確かめられません）"
else
  echo "== 本番構成の検査: ${FAILED} 件の問題 =="
fi
exit "$FAILED"
