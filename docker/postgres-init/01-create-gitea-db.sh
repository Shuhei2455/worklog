#!/bin/sh
# Gitea は自前のDBを要求する。postgres コンテナを1つで済ませるため、
# 初回起動時に gitea データベースだけ追加で作る。
# (バックアップ対象を増やさないのが 01-design.md 1.B の方針)
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	SELECT 'CREATE DATABASE gitea'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gitea')\gexec
EOSQL
