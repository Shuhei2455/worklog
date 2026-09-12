#!/usr/bin/env bash
# Gitea の初期設定。**インストールウィザードは使わない。**
#
# 設定は compose の GITEA__* 環境変数に書いてあり、`INSTALL_LOCK=true` なので
# 起動時にDBのマイグレーションまで自動で走る。このスクリプトがやるのは
# 人手でしかできない残り2つだけ:
#
#   1. 管理者ユーザーを作る
#   2. アプリがAPIを叩くためのアクセストークンを作る
#
# 冪等。すでにある場合は作り直さない（トークンは作り直せないので、
# 無くした場合は名前を変えて作る）。
#
# 使い方:
#   scripts/gitea-setup.sh                                   # 開発スタック
#   COMPOSE_FILE=docker-compose.prod.yml scripts/gitea-setup.sh
#
# 実行後、出力されたトークンを .env の GITEA_ADMIN_TOKEN に入れて
# app と worker を再起動する。

set -uo pipefail
cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"

compose() {
  if [ -n "${PROJECT:-}" ]; then
    docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

GITEA_ADMIN_USER="${GITEA_ADMIN_USER:-kadai-admin}"
GITEA_ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-${SEED_ADMIN_EMAIL:-admin@example.local}}"
# 人がこのアカウントでログインすることは想定していない（APIのための管理者）。
# パスワードは指定が無ければその場で作る
GITEA_ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-$(openssl rand -base64 24)}"
TOKEN_NAME="${TOKEN_NAME:-kadai-app}"

echo "== Gitea が起きているか =="
if ! compose exec -T gitea sh -c 'wget -qO- --timeout=5 http://127.0.0.1:3000/api/v1/version' 2>/dev/null; then
  echo "  Gitea に繋がりません。先に起動してください" >&2
  exit 1
fi
echo

echo "== 管理者ユーザー =="
if compose exec -T --user git gitea gitea admin user list 2>/dev/null | awk 'NR>1{print $2}' \
     | grep -qx "$GITEA_ADMIN_USER"; then
  echo "  $GITEA_ADMIN_USER は既にあります"
else
  compose exec -T --user git gitea gitea admin user create \
    --username "$GITEA_ADMIN_USER" \
    --password "$GITEA_ADMIN_PASSWORD" \
    --email "$GITEA_ADMIN_EMAIL" \
    --admin --must-change-password=false 2>&1 | sed 's/^/  /'
  echo "  作成しました: $GITEA_ADMIN_USER"
  echo "  パスワードは .env には書きません（アプリはトークンしか使わないため）。"
  echo "  Gitea の画面に入る必要が出たら、このスクリプトの GITEA_ADMIN_PASSWORD を"
  echo "  指定して作り直すか、gitea admin user change-password を使ってください。"
fi
echo

echo "== アクセストークン =="
# スコープは必要な範囲だけ。ユーザー作成に admin が要る
OUT=$(compose exec -T --user git gitea gitea admin user generate-access-token \
        --username "$GITEA_ADMIN_USER" \
        --token-name "$TOKEN_NAME" \
        --scopes "write:admin,write:repository,write:user,write:organization" 2>&1)
# 1.22 の出力は
#   Access token was successfully created: <トークン>
# の1行。大文字で始まるので -i で拾う
if echo "$OUT" | grep -qi "access token was successfully created"; then
  TOKEN=$(echo "$OUT" | sed -n 's/.*successfully created: *//Ip' | tr -d '\r' | tr -d ' ')
  echo "  作成しました（表示はこの1回だけ）"
  echo
  echo "  .env に次の行を反映してください:"
  echo "    GITEA_ADMIN_TOKEN=$TOKEN"
  echo
  echo "  反映後: docker compose -f $COMPOSE_FILE up -d app worker"
else
  echo "$OUT" | sed 's/^/  /'
  echo
  echo "  同じ名前のトークンが既にある場合は作れません（値は再表示できない）。"
  echo "  作り直すなら TOKEN_NAME=別名 を指定して実行してください。"
fi
