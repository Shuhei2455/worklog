#!/usr/bin/env bash
# 外部ネットワークへ出ていないかを実測で確かめる。
#
# 設定を読むだけでは「切れているつもり」を検出できないので、
# 各コンテナの /proc/net/tcp を直接読み、プライベートアドレス以外と
# 繋がっている（または繋ごうとしている）接続があれば印を付ける。
#
# 使い方:
#   scripts/egress-check.sh                                       # 開発スタック
#   COMPOSE_FILE=docker-compose.prod.yml scripts/egress-check.sh   # 本番スタック
#   PROJECT=backlog-prodtest scripts/egress-check.sh               # 別名で起動中のもの
#
# 注意: ある瞬間の状態を見るだけなので、アプリを一通り操作した直後に実行する。
# webhook の送信先に社外のURLを登録した場合はここに出る（設計どおりの通信）。

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

# /proc/net/tcp のアドレスは16進・リトルエンディアン
hex_ipv4() {
  local h=$1
  printf '%d.%d.%d.%d' "0x${h:6:2}" "0x${h:4:2}" "0x${h:2:2}" "0x${h:0:2}"
}

is_private() {
  case "$1" in
    10.*|127.*|169.254.*|192.168.*|0.0.0.0) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

found=0
ids=$(compose ps -q)
if [ -z "$ids" ]; then
  echo "起動中のコンテナがありません（$COMPOSE_FILE）"
  exit 1
fi

for id in $ids; do
  name=$(docker inspect --format '{{.Name}}' "$id" | sed 's|^/||')

  # 状態 01=ESTABLISHED、02=SYN_SENT（出ようとして失敗し続けているもの）
  while read -r _ _ rem st _; do
    { [ "$st" = "01" ] || [ "$st" = "02" ]; } || continue
    ip=$(hex_ipv4 "${rem%%:*}")
    port=$((16#${rem##*:}))
    if ! is_private "$ip"; then
      printf '  %-40s -> %s:%s (state=%s)\n' "$name" "$ip" "$port" "$st"
      found=1
    fi
  done < <(docker exec "$id" cat /proc/net/tcp 2>/dev/null | tail -n +2)

  # IPv6。::ffff: でくるまれたIPv4もここに出る。下位32ビットだけ見る
  while read -r _ _ rem st _; do
    { [ "$st" = "01" ] || [ "$st" = "02" ]; } || continue
    h=${rem%%:*}
    ip=$(hex_ipv4 "${h:24:8}")
    port=$((16#${rem##*:}))
    if ! is_private "$ip" && [ "$ip" != "0.0.0.1" ]; then
      printf '  %-40s -> [v6]%s:%s (state=%s)\n' "$name" "$ip" "$port" "$st"
      found=1
    fi
  done < <(docker exec "$id" cat /proc/net/tcp6 2>/dev/null | tail -n +2)
done

echo
if [ "$found" -eq 0 ]; then
  echo "外部アドレスへの接続は見つかりませんでした（$(echo "$ids" | wc -w) コンテナ）"
else
  echo "上の接続先を確認すること。webhook の送信先以外が出ているなら設定漏れ。"
  exit 2
fi
