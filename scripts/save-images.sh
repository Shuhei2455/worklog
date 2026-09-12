#!/usr/bin/env bash
# 職場VMへ持ち込むイメージを1つのtarに固める。
#
# 外に出られないVMでも `docker load` だけで全部そろうようにする。
# イメージを別々のtarにすると、版がずれたものを混ぜて持ち込む事故が起きるので
# 1ファイルにまとめる。
#
# 使い方:
#   scripts/save-images.sh                 # .env の APP_IMAGE_TAG を使う
#   APP_IMAGE_TAG=0.3.0 scripts/save-images.sh
#   OUT_DIR=/media/usb scripts/save-images.sh
#
# 出力:
#   backlog-clone-images-<タグ>.tar.gz      イメージ一式
#   backlog-clone-images-<タグ>.tar.gz.sha256  壊れていないかの確認用

set -euo pipefail
cd "$(dirname "$0")/.."

# .env から読む。無ければ .env.production.example の既定値
if [ -z "${APP_IMAGE_TAG:-}" ] && [ -f .env ]; then
  APP_IMAGE_TAG=$(grep -E '^APP_IMAGE_TAG=' .env | cut -d= -f2- || true)
fi
APP_IMAGE_TAG="${APP_IMAGE_TAG:-}"
if [ -z "$APP_IMAGE_TAG" ]; then
  echo "APP_IMAGE_TAG が決まりません。環境変数か .env で指定してください" >&2
  exit 1
fi

OUT_DIR="${OUT_DIR:-./dist}"
mkdir -p "$OUT_DIR"

# docker-compose.prod.yml が使うイメージと必ず一致させる。
# ここを直したら向こうも直す
IMAGES=(
  "backlog-clone-app:${APP_IMAGE_TAG}"
  "caddy:2-alpine"
  "postgres:16-alpine"
  "redis:7-alpine"
  "getmeili/meilisearch:v1.11"
  "gitea/gitea:1.22"
)

echo "== 手元にイメージがあるか確認 =="
# 表示する大きさは image inspect が返す値。containerd のイメージストアでは
# 圧縮後の大きさが返るため `docker images` の表示とは一致しない。
# 実際に持ち込むファイルの大きさは最後に出る tar.gz を見る
missing=0
for img in "${IMAGES[@]}"; do
  if docker image inspect "$img" >/dev/null 2>&1; then
    size=$(docker image inspect "$img" --format '{{.Size}}')
    printf '  %-38s %6d MB（目安）\n' "$img" "$((size / 1024 / 1024))"
  else
    printf '  %-38s 見つかりません\n' "$img"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  echo
  echo "アプリのイメージが無いなら、先にビルドする:" >&2
  echo "  docker build -f docker/app.prod.Dockerfile -t backlog-clone-app:${APP_IMAGE_TAG} ." >&2
  echo "公式イメージが無いなら、外に出られる環境で docker pull しておく" >&2
  exit 1
fi

OUT="${OUT_DIR}/backlog-clone-images-${APP_IMAGE_TAG}.tar.gz"
echo
echo "== 固めています（数分かかります） =="
docker save "${IMAGES[@]}" | gzip -1 > "$OUT"

( cd "$(dirname "$OUT")" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )

echo
echo "できました:"
ls -lh "$OUT" "$OUT.sha256" | sed 's/^/  /'
echo
echo "職場VMへ持ち込むもの（この3つで足ります）:"
echo "  1. $OUT と同 .sha256"
echo "  2. このリポジトリのうち docker-compose.prod.yml / caddy/ / docker/postgres-init/ / scripts/"
echo "  3. .env（.env.production.example を埋めたもの。秘密を含むので扱いに注意）"
