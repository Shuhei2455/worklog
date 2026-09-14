#!/usr/bin/env bash
# 職場VMが取りに行けるように、イメージ一式を ghcr.io へ上げる。
#
# 職場VMは **github.com と ghcr.io にしか出られない**（2026-09-14 にユーザーが確認）。
# Docker Hub に出られないので、postgres や redis のようなサードパーティの
# イメージも**こちらの ghcr.io に複製して**置く必要がある。
# **アプリのイメージだけ上げても、VMでは起動しない。**
#
# 使い方:
#   GHCR_OWNER=<GitHubのユーザー名かorg> scripts/push-images.sh
#   GHCR_OWNER=foo APP_IMAGE_TAG=0.9.0 scripts/push-images.sh
#   GHCR_OWNER=foo SKIP_BUILD=1 scripts/push-images.sh   # ビルド済みを上げるだけ
#   GHCR_OWNER=foo DRY_RUN=1 scripts/push-images.sh      # 何をするかだけ見る
#
# 事前に1回だけ:
#   echo <PAT> | docker login ghcr.io -u <GitHubのユーザー名> --password-stdin
#   PATに要る権限: write:packages
#
# 上げたあと、**GitHubのパッケージ設定で public にする**こと。
# private のままだと職場VMでも docker login が必要になる。

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=docker-compose.prod.yml

if [ -z "${GHCR_OWNER:-}" ]; then
  echo "GHCR_OWNER を指定してください（GitHubのユーザー名か organization 名）" >&2
  echo "  例: GHCR_OWNER=myname scripts/push-images.sh" >&2
  exit 1
fi

# ghcr.io は所有者名を小文字しか受け付けない
OWNER_LC=$(printf '%s' "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]')
PREFIX="ghcr.io/${OWNER_LC}/"

# アプリのタグ。.env にあれば拾う
if [ -z "${APP_IMAGE_TAG:-}" ] && [ -f .env ]; then
  APP_IMAGE_TAG=$(grep -E '^APP_IMAGE_TAG=' .env | cut -d= -f2- || true)
fi
APP_IMAGE_TAG="${APP_IMAGE_TAG:-}"
if [ -z "$APP_IMAGE_TAG" ]; then
  echo "APP_IMAGE_TAG が決まりません。環境変数か .env で指定してください" >&2
  exit 1
fi

# ---- 複製するイメージを compose から読む ---------------------------------
#
# **手で並べない。** 並べると版がずれ、職場で「そのイメージは無い」と
# 言われる形で初めて気づくことになる。
#
# compose 側の書き方:  image: ${<変数名>:-<DockerHubの名前>:<タグ>}
# ここから「変数名」と「既定のイメージ名」を1度に取り出す。
#
# 出力は "VAR_NAME<TAB>dockerhub/name:tag" の行。
MAP=$(awk '
  match($0, /image: \$\{[A-Z_]+:-[^}]+\}/) {
    s = substr($0, RSTART, RLENGTH)
    sub(/^image: \$\{/, "", s)
    sub(/\}$/, "", s)
    i = index(s, ":-")
    if (i > 0) printf "%s\t%s\n", substr(s, 1, i-1), substr(s, i+2)
  }
' "$COMPOSE" | sort -u)

if [ -z "$MAP" ]; then
  echo "$COMPOSE からイメージを読めませんでした。" >&2
  echo '  image: ${<変数名>:-<名前>:<タグ>} の形になっているか確認してください' >&2
  exit 1
fi

# ghcr.io 上の名前は**平坦にする**。
#   gitea/gitea:1.22           → ghcr.io/owner/gitea:1.22
#   getmeili/meilisearch:v1.11 → ghcr.io/owner/meilisearch:v1.11
# 階層のまま上げると ghcr.io/owner/gitea/gitea になり、
# パッケージ一覧で何なのか分からなくなる
flatten() { printf '%s' "${1##*/}"; }

run() {
  if [ "${DRY_RUN:-}" = "1" ]; then
    echo "    [dry-run] $*"
  else
    "$@"
  fi
}

echo "== ghcr.io へイメージを上げる =="
echo "  所有者: ${OWNER_LC}"
echo "  アプリのタグ: ${APP_IMAGE_TAG}"
echo "  複製するサードパーティ: $(echo "$MAP" | wc -l) 件"
[ "${DRY_RUN:-}" = "1" ] && echo "  （DRY_RUN=1 なので実際には何もしません）"
echo ""

# ---- ログインの確認 -------------------------------------------------------
# 全部ビルドしてから権限で落ちると時間の無駄になるので先に見る
CFG="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
if [ ! -f "$CFG" ] || ! grep -q "ghcr.io" "$CFG" 2>/dev/null; then
  echo "  注意: ghcr.io にログインしていないようです。先にこれを実行してください:" >&2
  echo "    echo <PAT> | docker login ghcr.io -u <GitHubのユーザー名> --password-stdin" >&2
  echo "" >&2
fi

# ---- アプリのイメージ -----------------------------------------------------
APP_LOCAL="backlog-clone-app:${APP_IMAGE_TAG}"
APP_REMOTE="${PREFIX}backlog-clone-app:${APP_IMAGE_TAG}"

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "-- アプリのイメージをビルド --"
  # ローカルのタグも付ける。開発機で動作確認するときに使える
  run docker build -f docker/app.prod.Dockerfile -t "$APP_LOCAL" -t "$APP_REMOTE" .
else
  echo "-- ビルドを飛ばして、既存のタグを付け替える --"
  run docker tag "$APP_LOCAL" "$APP_REMOTE"
fi

# ---- サードパーティのイメージ ---------------------------------------------
echo ""
echo "-- サードパーティのイメージを複製 --"
ENV_LINES=""
PUSH_LIST=("$APP_REMOTE")

while IFS=$'\t' read -r var img; do
  [ -z "$var" ] && continue
  remote="${PREFIX}$(flatten "$img")"
  echo "  ${img}  →  ${remote}"
  run docker pull -q "$img"
  run docker tag "$img" "$remote"
  PUSH_LIST+=("$remote")
  ENV_LINES+="${var}=${remote}"$'\n'
done <<< "$MAP"

# ---- 上げる ---------------------------------------------------------------
echo ""
echo "-- push --"
for img in "${PUSH_LIST[@]}"; do
  echo "  ${img}"
  run docker push -q "$img"
done

# ---- 職場の .env に書く行をそのまま出す -----------------------------------
echo ""
echo "== 終わりました =="
echo ""
echo "職場VMの .env にこの行を書いてください（コピーして貼れます）:"
echo ""
echo "IMAGE_PREFIX=${PREFIX}"
echo "APP_IMAGE_TAG=${APP_IMAGE_TAG}"
echo "IMAGE_PULL_POLICY=missing"
printf '%s' "$ENV_LINES"
echo ""
echo "**GitHubのパッケージ設定で public にすること。**"
echo "  https://github.com/${GHCR_OWNER}?tab=packages"
echo "  各パッケージ → Package settings → Change visibility → Public"
echo "  private のままだと職場VMでも docker login が必要になります。"
