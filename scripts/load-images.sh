#!/usr/bin/env bash
#
# **いまは使っていない**（2026-09-14 に展開方法を GitHub のクローンへ変更）。
# 展開は `git clone` ＋ ghcr.io からの `pull`。scripts/push-images.sh を使う。
#
# このスクリプトは、VMが ghcr.io にも出られない環境に移ったときのために残してある。
# その場合は docs/04-deploy.md の履歴（1章の旧版）を参照。
# 持ち込んだtarからイメージを取り込む（職場VM側で実行する）。
#
# 使い方:
#   scripts/load-images.sh backlog-clone-images-0.3.0.tar.gz

set -euo pipefail

TAR="${1:-}"
if [ -z "$TAR" ] || [ ! -f "$TAR" ]; then
  echo "使い方: $0 <backlog-clone-images-*.tar.gz>" >&2
  exit 1
fi

if [ -f "${TAR}.sha256" ]; then
  echo "== 壊れていないか確認 =="
  ( cd "$(dirname "$TAR")" && sha256sum -c "$(basename "$TAR").sha256" ) | sed 's/^/  /'
else
  echo "== .sha256 が無いので確認を飛ばします =="
fi

echo
echo "== 取り込み（数分かかります） =="
gunzip -c "$TAR" | docker load | sed 's/^/  /'

echo
echo "== 入ったイメージ =="
docker images --format '  {{.Repository}}:{{.Tag}}\t{{.Size}}' \
  | grep -E "backlog-clone-app|caddy|postgres|redis|meilisearch|gitea/gitea"
