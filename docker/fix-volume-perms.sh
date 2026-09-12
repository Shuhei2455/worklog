#!/bin/sh
# 添付ファイル用ボリュームの所有者を直す。
#
# app / worker は user: "1000:1000" で動かしている(root所有の生成物を
# ホストから触れなくなるのを避けるため)。一方 docker が作る名前付き
# ボリュームは root 所有で初期化されるので、そのままだと添付の保存が
# EACCES で失敗する。
#
# 初回セットアップ時と、ボリュームを作り直したときに1度だけ実行する。
#
# 使い方:
#   docker/fix-volume-perms.sh                    # backlog-clone_files を 1000:1000 に
#   RUN_UID=1001 RUN_GID=1001 docker/fix-volume-perms.sh
#   VOLUME=myproject_files docker/fix-volume-perms.sh
set -e

VOLUME="${VOLUME:-backlog-clone_files}"
RUN_UID="${RUN_UID:-1000}"
RUN_GID="${RUN_GID:-1000}"

# 作業に使うイメージは postgres:16-alpine。
# alpine:latest ではなく、これを使うのは移設先に持ち込むイメージの1つで、
# 外に出られないVMでも確実に手元にあるため（scripts/save-images.sh 参照）
docker run --rm -v "${VOLUME}:/data" postgres:16-alpine \
  chown -R "${RUN_UID}:${RUN_GID}" /data

echo "${VOLUME} の所有者を ${RUN_UID}:${RUN_GID} にしました"
