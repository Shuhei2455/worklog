# Worklog（backlog-clone）

Backlog 相当の自己ホスト型プロジェクト管理アプリ。職場チーム5〜20人向け。
自宅サーバの Docker で開発・検証し、動いたら職場VMへ移設する。

**作業を始める前に `CLAUDE.md` と `docs/` を読むこと。**
特に `docs/00-spec-verified.md` が仕様の正解データで、ここに無い項目は憶測で埋めない。

## 起動

```bash
cp .env.example .env      # パスワード類を書き換える
docker compose up -d
```

| | URL | 備考 |
|---|---|---|
| アプリ | http://localhost:8088 | Caddy 経由。これが入口 |
| Gitea | http://localhost:8088/git/ | |
| app 直 | http://localhost:3100 | 開発時のみ |
| Meilisearch | http://localhost:7701 | |
| PostgreSQL | localhost:5433 | |
| Redis | localhost:6380 | |

ポートは自宅サーバの既存サービス（Jellyfin 8096 / Home Assistant 8123 / VOICEVOX 50021 など）と
衝突しない値を選んである。変更するなら `.env` で行う。

## よく使うコマンド

ホストに Node は要らない。すべてコンテナ内で実行する。

```bash
docker compose exec app pnpm test        # 単体テスト
docker compose exec app pnpm db:migrate  # マイグレーション
docker compose exec app pnpm db:seed     # シード投入
docker compose logs -f app worker
```

## 注意

- `docker compose down -v` は実行しない。永続データ（PostgreSQL と添付ファイル）が消える
- スキーマ変更は必ず Prisma のマイグレーションファイルとして残す。`prisma db push` で済ませない

## ドキュメント

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | 作業ルール。**絶対に守る2つのルール**を含む |
| `docs/00-spec-verified.md` | 本家仕様の確認結果。**実装の正解データ** |
| `docs/01-design.md` | アーキテクチャとデータモデル |
| `docs/02-roadmap.md` | フェーズと受け入れ条件 |
| `docs/03-milestones-and-prompts.md` | マイルストーンとプロンプト集 |
| `docs/PROGRESS.md` | どこまで終わっているか |
| `docs/archive/` | **破棄済み。参照しない** |
