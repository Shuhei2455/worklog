# 職場VMへの移設手順書

自宅サーバ(G5)で作ったものを職場のVMで動かすための手順。
**外部ネットワークに出られないVMでも成立する**ことを前提に組んである。

この文書の手順は 2026-09-13 に自宅サーバ上で一度通して確認した
（本番イメージのビルド → 新規構築 → バックアップ → 別スタックへ復元 → 動作確認）。
確認の詳細は末尾の「検証の記録」にある。

---

## 0. 全体像

| | 開発（自宅） | 本番（職場VM） |
|---|---|---|
| compose ファイル | `docker-compose.yml` | `docker-compose.prod.yml` |
| 環境変数のひな形 | `.env.example` | `.env.production.example` |
| アプリの動かし方 | `pnpm dev`（ソースをバインドマウント） | ビルド済み standalone |
| ソースコード | 必要 | **不要** |
| Node / pnpm | 不要（コンテナ内） | 不要 |
| 公開ポート | 7つ（デバッグ用に全部出している） | 2つ（HTTPとGitのSSHだけ） |

職場VMに要るのは **Docker と Docker Compose だけ**。

---

## 1. 持ち込むものを作る（自宅側）

### 1-1. 本番イメージをビルドする

```bash
cd ~/docker/backlog-clone
docker build -f docker/app.prod.Dockerfile -t backlog-clone-app:0.3.0 .
```

タグは `.env` の `APP_IMAGE_TAG` と必ず合わせる。`latest` は使わない
（どの版が動いているか分からなくなる）。

### 1-2. イメージを1つのtarに固める

```bash
APP_IMAGE_TAG=0.3.0 scripts/save-images.sh
# → dist/backlog-clone-images-0.3.0.tar.gz （約420MB）と .sha256
```

アプリ・Caddy・PostgreSQL・Redis・Meilisearch・Gitea の6イメージが入る。
別々のtarにしないのは、版がずれたものを混ぜて持ち込む事故を防ぐため。

### 1-3. 自宅のデータも持っていく場合

検証用のデータを職場へ持ち込む必要がなければ、この手順は飛ばして
「新規構築」で進める。

```bash
scripts/backup.sh
# → dist/backup/backlog-clone-<日時>/ に postgres.sql.gz と files.tar.gz
```

### 1-4. 持ち込む荷物

| 持ち込むもの | 中身 |
|---|---|
| `dist/backlog-clone-images-0.3.0.tar.gz` と `.sha256` | イメージ一式 |
| `docker-compose.prod.yml` | 本番のスタック定義 |
| `caddy/Caddyfile` | リバースプロキシの設定 |
| `docker/postgres-init/` | DB初期化SQL（Gitea用DBを作る） |
| `docker/fix-volume-perms.sh` | ボリュームの所有者直し |
| `scripts/` | backup / restore / egress-check / gitea-setup |
| `.env.production.example` | 環境変数のひな形 |
| `docs/04-deploy.md` | この文書 |
| （任意）`dist/backup/…` | 自宅のデータ |

> [!warning]
> **`.env` をそのまま持ち込まない。** 自宅のパスワードが入っている。
> 職場では `.env.production.example` を写して、職場用の値を入れ直す。

---

## 2. 職場VMで構築する

### 2-1. 置き場所を作る

```bash
mkdir -p ~/backlog-clone && cd ~/backlog-clone
# 持ち込んだ docker-compose.prod.yml / caddy/ / docker/ / scripts/ をここに展開する
```

### 2-2. イメージを取り込む

```bash
scripts/load-images.sh backlog-clone-images-0.3.0.tar.gz
```

sha256 が合わなければ転送中に壊れている。持ち込み直す。

### 2-3. `.env` を作る

```bash
cp .env.production.example .env
id -u; id -g          # RUN_UID / RUN_GID に入れる値
openssl rand -base64 32   # AUTH_SECRET と MEILI_MASTER_KEY に別々の値を
openssl rand -base64 24   # POSTGRES_PASSWORD
```

`CHANGE_ME` が残っていないか必ず確認する:

```bash
grep -n CHANGE_ME .env   # 何も出なければOK
```

変えるところ:

| 変数 | 注意 |
|---|---|
| `APP_URL` | 職場のホスト名かIP。**末尾にスラッシュを付けない**。メールと通知のリンクがこの値で組まれる |
| `CADDY_HTTP_PORT` | 80 が空いていなければ変える |
| `POSTGRES_PASSWORD` | `DATABASE_URL` の中にも同じ値が入っている（**2か所**） |
| `MEILI_MASTER_KEY` | `MEILI_ENV=production` では16バイト以上が必須 |
| `AUTH_SECRET` | 変えると全員のセッションが切れる（パスワードは無効にならない） |
| `RUN_UID` / `RUN_GID` | VMのログインユーザーのもの。添付ファイルの所有者になる |
| `APP_IMAGE_TAG` | `docker load` したタグと一致させる |

### 2-4. 起動する

```bash
# 1. データ層を先に上げる
docker compose -f docker-compose.prod.yml up -d postgres redis meilisearch
docker compose -f docker-compose.prod.yml ps   # 3つとも healthy になるまで待つ

# 2. テーブルを作る
docker compose -f docker-compose.prod.yml run --rm migrate

# 3-a. 新規構築なら初期データを入れる
docker compose -f docker-compose.prod.yml run --rm seed

# 3-b. 自宅のデータを持ち込むなら、代わりに復元する（3-a はやらない）
#      復元スクリプトが app を止めて流し込み、再インデックスまでやる
COMPOSE_FILE=docker-compose.prod.yml scripts/restore.sh <バックアップのディレクトリ>

# 4. 残りを上げる
docker compose -f docker-compose.prod.yml up -d

# 5. 添付ファイル用ボリュームの所有者を直す（初回だけ）
VOLUME=backlog-clone_files RUN_UID=$(id -u) RUN_GID=$(id -g) docker/fix-volume-perms.sh
docker compose -f docker-compose.prod.yml restart app worker
```

> [!warning]
> 手順5を飛ばすと、添付ファイルの保存が `EACCES` で失敗する。
> ボリュームは root 所有で作られるのに、コンテナは `RUN_UID` で動くため。

### 2-5. 動いているか確認する

```bash
docker compose -f docker-compose.prod.yml ps
# app が healthy、worker が Up、postgres/redis/meilisearch が healthy
docker compose -f docker-compose.prod.yml logs worker --tail 5
# 「検索インデックスと webhook の配信を待機します」が出ていること
```

---

## 3. 疎通確認（この順にやる）

ブラウザで `http://<APP_URL>/` を開いて、上から順に確かめる。
**失敗したものがあれば、その場で止めて原因を潰す。**先に進めると切り分けが難しくなる。

| # | 確認すること | 期待する結果 | 転ぶときの原因 |
|---|---|---|---|
| 1 | ログイン画面が出る | ID/パスワードの入力欄 | Caddy → app の経路。`logs caddy` を見る |
| 2 | 管理者でログインできる | ダッシュボードへ | `SEED_ADMIN_PASSWORD` の値。復元した場合は**移設元のパスワード** |
| 3 | ログイン後に `0.0.0.0:3000` へ飛ばされない | 正しいホストのまま | `caddy/Caddyfile` の `header_down Location`。2-3 の `APP_URL` |
| 4 | プロジェクトを作る | プロジェクト設定画面へ | — |
| 5 | 課題を作る | `KEY-1` が振られる | `keyId` の採番。DBのトランザクション |
| 6 | 課題一覧・ボード・ガント・Wiki・ファイルが開く | いずれも表示される | — |
| 7 | 検索で課題が出る | 1〜2秒後にヒット | worker か Meilisearch。`logs worker` |
| 8 | 添付ファイルを付けて、開き直す | 中身が落ちてくる | 手順5の所有者直し |
| 9 | 別のブラウザで同じ課題を開き、片方でコメント | もう片方に即座に出る（SSE） | 職場のプロキシが `text/event-stream` を切っていないか |
| 10 | 通知欄に件数が出る | 担当・メンションで増える | — |
| 11 | APIが叩ける | 下の例で課題一覧が返る | — |
| 12 | Gitのリポジトリを作れる | プロジェクト設定から作成でき、クローンURLが出る | `GITEA_ADMIN_TOKEN`。`scripts/gitea-setup.sh` を流したか |
| 13 | push すると課題にコメントが付く | `AA-1 修正` のようなコミットで課題に履歴が残る | `GITEA_WEBHOOK_SECRET`。`logs app` に「署名が合わない」が出ていないか |
| 14 | CSVを取り込める | 確認画面で件数が出て、エラー0なら取り込める | 文字コード。Excelの既定(Shift_JIS)でも読めるはず |
| 15 | バーンダウンが出る | マイルストーンに開始日と終了日が要る | 期間未設定だと警告が出る |

APIの確認:

```bash
# 画面の「個人設定 → API」でキーを作ってから
curl -s "http://<ホスト>/api/v2/issues?apiKey=<キー>&count=3" | head -c 300
```

SSE（手順9）が通らない場合、職場のプロキシが握っている可能性がある。
設計上 WebSocket を避けて SSE にしてあるが、それでも切られるときは
プロキシ側で `/api/projects/*/events` のバッファリングを無効にする。

---

## 4. メール通知

`MAIL_ENABLED=false` のままでも**アプリ内通知だけで運用が回る**ように作ってある。
職場のSMTPリレーが使えるか分かるまでは false のままにする。

使えるようになったら:

```bash
# .env を編集
MAIL_ENABLED=true
SMTP_HOST=<社内リレーのホスト>
SMTP_PORT=25          # 認証なしの社内リレーなら25、STARTTLSなら587
MAIL_FROM=kadai@<社内ドメイン>

docker compose -f docker-compose.prod.yml up -d worker
docker compose -f docker-compose.prod.yml logs worker --tail 3
# 「メール送信も待機します」が出れば有効になっている
```

`false` のときは**メール用のワーカーごと起動しない**ので、キューに溜まることもない。

---

## 5. 運用

### 日々のバックアップ

```bash
COMPOSE_FILE=docker-compose.prod.yml OUT_DIR=/mnt/backup scripts/backup.sh
```

取るのは4つ:

| 対象 | 中身 |
|---|---|
| PostgreSQL の `backlog` | 課題・Wiki・ユーザー・活動履歴・監査ログ |
| `files` ボリューム | 添付ファイルと共有ファイルの実体 |
| PostgreSQL の `gitea` | リポジトリのメタデータと Gitea のユーザー |
| `giteadata` ボリューム | **リポジトリの実体（コード）**と `app.ini` |

> [!warning]
> `app.ini` を外さないこと。`SECRET_KEY` と `INTERNAL_TOKEN` が入っており、
> これが変わると既存のアクセストークンが無効になる。

Redis（通知キューの一時置き場）と Meilisearch（検索インデックス）は
DBから作り直せるので取らない（復元スクリプトが再インデックスまでやる）。
cron に入れるなら1日1回で足りる。

> [!warning]
> `docker compose down -v` は実行しない。ボリュームごとデータが消える。
> コンテナを作り直すだけなら `down` のあとに `up -d` でよい（ボリュームは残る）。

### 版を上げるとき

```bash
# 自宅側: 新しいタグでビルドして固める
docker build -f docker/app.prod.Dockerfile -t backlog-clone-app:0.4.0 .
APP_IMAGE_TAG=0.4.0 scripts/save-images.sh

# 職場側:
scripts/backup.sh                                   # 先にバックアップ
scripts/load-images.sh backlog-clone-images-0.4.0.tar.gz
sed -i 's/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=0.4.0/' .env
docker compose -f docker-compose.prod.yml run --rm migrate   # スキーマ変更があれば当たる
docker compose -f docker-compose.prod.yml up -d
```

前の版のイメージは消さずに残しておく。戻すときは `APP_IMAGE_TAG` を
戻して `up -d` するだけで済む（**ただしマイグレーションは戻らない**ので、
スキーマ変更を含む版から戻すときはバックアップからの復元になる）。

### 検索がおかしいとき

```bash
docker compose -f docker-compose.prod.yml run --rm reindex
```

---

## 6. 外部ネットワークに出ないことの検証

### 出る可能性があったもの（全部止めてある）

| 出どころ | 行き先 | 止め方 | 確認方法 |
|---|---|---|---|
| Next.js のテレメトリ | telemetry.nextjs.org | `NEXT_TELEMETRY_DISABLED=1`（イメージに焼き込み） | `docker run --rm --entrypoint env backlog-clone-app:0.3.0 \| grep TELEMETRY` |
| Prisma の版確認 | checkpoint.prisma.io | `CHECKPOINT_DISABLE=1`（同上） | 同様に `grep CHECKPOINT` |
| Meilisearch の利用統計 | meilisearch.com | `MEILI_NO_ANALYTICS=true` | 起動ログに `Anonymous telemetry: "Disabled"` |
| Gitea の新版確認 | dl.gitea.com | `GITEA__cron_0X2E_update_checker__ENABLED=false` | `exec gitea grep -A2 update_checker /data/gitea/conf/app.ini` |
| イメージの取得 | Docker Hub | `pull_policy: never` | イメージが無ければ即座に失敗する（黙って固まらない） |
| 依存のインストール | npm レジストリ | 本番イメージは実行時に `pnpm install` しない | — |
| Webフォント | Google Fonts 等 | 使っていない（`next/font` も未使用） | `grep -rn "next/font\|fonts.googleapis" app/src` が空 |

### 設計上、外に出る通信（これだけ）

- **webhook**: プロジェクト設定で登録したURLへPOSTする。登録しなければ出ない。
  社外のURLを登録すれば当然社外へ出るので、登録先は運用で決める。
- **SMTP**: `MAIL_ENABLED=true` のときだけ。宛先は `SMTP_HOST` に書いたホスト。

### 実測で確かめる

```bash
COMPOSE_FILE=docker-compose.prod.yml scripts/egress-check.sh
```

各コンテナの `/proc/net/tcp` を直接読み、プライベートアドレス以外への接続
（確立済み・接続試行中の両方）を挙げる。設定を読むだけでは
「切れているつもり」を検出できないのでこの形にした。

アプリを一通り操作した直後に実行する。一瞬の状態しか見えないため、
気になるときは間隔を置いて何度か実行する。

---

## 7. 困ったときに見るところ

| 症状 | 見るところ |
|---|---|
| 画面が出ない（502） | `logs caddy` → `logs app`。app が healthy か |
| ログイン後に変なURLへ飛ぶ | `.env` の `APP_URL`、`caddy/Caddyfile` の `header_down Location` |
| 「ログインIDまたはパスワードが違います」 | 復元した場合は**移設元**のパスワード。分からなくなったら下のコマンドで再設定する |
| 添付の保存に失敗する | 2-4 の手順5（ボリュームの所有者） |
| 検索が何も返さない | `run --rm reindex`。`logs worker`、Meilisearch が healthy か |
| 通知が来ない | `logs worker`。Redis が healthy か |
| メールが来ない | `logs worker` に「メールは無効です」と出ていないか。`SMTP_HOST` |
| 起動時に `pull access denied` | `APP_IMAGE_TAG` と `docker load` したタグの不一致 |

### パスワードが分からなくなったとき

職場VMには pnpm もソースも無いので、これが唯一の復旧手段。

```bash
docker compose -f docker-compose.prod.yml run --rm set-password admin <新しいパスワード>
```

ログインIDを指定するので、管理者以外のユーザーにも使える。

---

## 検証の記録（2026-09-13・自宅サーバ）

この手順書は、書いたあとに実際に通して確かめた。

- 本番イメージをビルド: 519MB（開発用は 1.51GB）。tar.gz にして **424MB**、固めるのに34秒
- `docker-compose.prod.yml` を別プロジェクト名で起動し、7サービスすべてが healthy / Up
- `migrate` で新品のDBにテーブルを作成。**45テーブルが開発スタックと完全一致**
  （`prisma migrate diff` も `No difference detected`。開発中のスキーマのずれが無いことを確認）
- `seed` → ログイン → プロジェクト作成 → 課題作成(`PRD-1`) → 検索でヒット →
  ボード・ガント・Wiki・ファイル・通知・API設定・SSE がすべて200
- 開発スタックを `backup.sh` で取り、本番スタックへ `restore.sh` で復元。
  件数が完全一致（users=2 / projects=1 / issues=18 / activities=26 / wiki=1 / attachments=1）。
  添付ファイル2件の中身も取り出せ、再インデックス後に検索もヒット
- `load-images.sh`: sha256 照合 → 6イメージの取り込みを確認
- `egress-check.sh`: 操作中を含む **180秒・90回のサンプリングで外部接続ゼロ**
- `set-password` でパスワードを変え、旧パスワードが弾かれ新パスワードで入れることを確認
  （管理者が入れなくなったときの復旧手段として）

### このとき直した不具合

| 症状 | 原因 |
|---|---|
| `next build` が4件の型エラーで失敗（dev では出ない） | ルートハンドラの第2引数、`PRIORITY_LABEL` のキーの絞り込み、`back()` の戻り値型、`session.user.id` への数値代入 |
| 本番イメージのワーカーが `ERR_MODULE_NOT_FOUND` | standalone の `node_modules` には next と react しか無く、bullmq 等は webpack のチャンクに取り込まれている。`/worker` に独立した依存ツリーを作って解決 |
| `pnpm install` が Prisma のクエリエンジンを入れない | `allowBuilds` は `pnpm-workspace.yaml` にある（`package.json` の `pnpm` フィールドは pnpm 10 以降読まれない） |
| `reindex` が Redis に繋がらず落ちる | 接続が `enableOfflineQueue: false`。起動直後にコマンドを投げると即失敗する。ready を待つようにした |
| `set-password` が「Top-level await is ... cjs」で落ちる | イメージの `/worker` に package.json が無く CJS 扱いだった。`{"type":"module"}` を置いて開発時と揃えた |
| `restore.sh` が別スタックのボリュームを触る | `fix-volume-perms.sh` の既定のボリューム名が固定だった。展開と所有者直しを同じコンテナでやるように変更 |
| Gitea の更新確認が切れない書き方だった | セクション名のドットは `_0X2E_`。`_2E_` だと別セクションが生まれて黙って無視される（実測で確認） |

### 2026-09-13（M5完了時）に再確認したこと

M4 でリポジトリを Gitea に置き始め、M5 でカスタム属性・チーム・監査ログが
増えたので、バックアップと復元をもう一度通した。

- **バックアップの対象に Gitea を追加した。** それまでは `backlog` データベースと
  添付だけで、**リポジトリの実体が入っていなかった**（M3-e の時点では
  リポジトリが存在しなかったため）
- 本番イメージ 0.5.0 をビルドし、検証用ボリュームを消して**空の別環境**を作成。
  マイグレーション5本が順に当たることを確認
- 復元後、**16項目の件数が完全一致**:
  users=2 / projects=2 / issues=22 / activities=53 / wiki=1 / attachments=1 /
  customFields=3 / cfValues=7 / teams=1 / teamMembers=1 / repos=2 / pulls=1 /
  commitLinks=4 / auditLogs=3 / giteaUsers=5 / giteaRepos=2
- 復元先で課題一覧・カスタム属性・チーム・監査ログ・Git・バーンダウンが開き、
  添付も取り出せた
- **復元先からリポジトリをクローンできた**（6コミットすべて）。
  Gitea のパスワードもそのまま通ったので `app.ini` も正しく戻っている

### まだ確かめていないこと

- **職場VMの実機での疎通**（手順3）。ここは環境に依存するため、実行はユーザーが行う
- 職場のプロキシが SSE を通すか（手順3の#9）
- 職場のSMTPリレーが使えるか（4章）
- 同時利用が5〜20人に増えたときの応答。いまは1人での確認しかしていない
