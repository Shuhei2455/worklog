#!/bin/sh
# 添付ファイル用ボリュームの所有者を直す。
#
# app / worker は user: "1000:1000" で動かしている(root所有の生成物を
# ホストから触れなくなるのを避けるため)。一方 docker が作る名前付き
# ボリュームは root 所有で初期化されるので、そのままだと添付の保存が
# EACCES で失敗する。
#
# 初回セットアップ時と、ボリュームを作り直したときに1度だけ実行する。
set -e
docker run --rm -v backlog-clone_files:/data alpine chown -R 1000:1000 /data
echo "files ボリュームの所有者を 1000:1000 にしました"
