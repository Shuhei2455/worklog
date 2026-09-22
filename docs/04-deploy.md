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
| Caddy の設定 | `caddy/Caddyfile`（:80のみ） | `caddy/Caddyfile.prod`（TLS終端） |
| 環境変数のひな形 | `.env.example` | `.env.production.example` |
| アプリの動かし方 | `pnpm dev`（ソースをバインドマウント） | ビルド済み standalone |
| イメージの入手 | 手元でビルド | **ghcr.io から pull** |
| 配布 | — | **GitHub のクローン** |
| Node / pnpm | 不要（コンテナ内） | 不要 |
| 公開ポート | 7つ（デバッグ用に全部出している） | 2つ（HTTP と HTTPS） |
| 入口 | HTTP | **HTTPS（IP直打ち）** |
| Git over SSH | 使える（2222） | **使えない**（HTTPSクローンのみ） |
| メール通知 | Mailpit | **使わない** |

職場VMに要るのは **Docker と Docker Compose だけ**。
出られる先は **github.com と ghcr.io だけ**でよい。

---

## 1. 配る物を作る（自宅側）

**展開は GitHub のクローン**でやる（2026-09-14 にユーザーが決定）。
職場VMは **github.com と ghcr.io にしか出られない**ので:

- **ソースと設定**は GitHub の public リポジトリから `git clone`
- **イメージ**は自宅でビルドして **ghcr.io** に上げ、VMは `pull` するだけ

VMでビルドしない。ビルドは Docker Hub・npm・Alpine・Prisma へ出るので、
その4つに出られないVMでは成立しない。

### 1-1. イメージ一式を ghcr.io に上げる

```bash
cd ~/docker/backlog-clone

# 1回だけ: ghcr.io にログインする（PATに write:packages を付ける）
echo <PAT> | docker login ghcr.io -u <GitHubのユーザー名> --password-stdin

# ビルドして上げる
GHCR_OWNER=<GitHubのユーザー名> APP_IMAGE_TAG=0.8.3 scripts/push-images.sh
```

このスクリプトは**アプリだけでなく、postgres / redis / meilisearch /
caddy / gitea も ghcr.io に複製する。**
VMは Docker Hub に出られないので、アプリだけ上げても起動しない。

複製するイメージと版は **`docker-compose.prod.yml` から読む**。
手で並べると版がずれ、職場で「そのイメージは無い」と言われる形で気づくことになる。

最後に、職場の `.env` に貼る行をそのまま出力する:

```
IMAGE_PREFIX=ghcr.io/<ユーザー名>/
APP_IMAGE_TAG=0.8.3
IMAGE_PULL_POLICY=missing
CADDY_IMAGE=ghcr.io/<ユーザー名>/caddy:2-alpine
POSTGRES_IMAGE=ghcr.io/<ユーザー名>/postgres:16-alpine
REDIS_IMAGE=ghcr.io/<ユーザー名>/redis:7-alpine
MEILI_IMAGE=ghcr.io/<ユーザー名>/meilisearch:v1.11
GITEA_IMAGE=ghcr.io/<ユーザー名>/gitea:1.22
```

`DRY_RUN=1` を付けると、何をするかだけ出して実行しない。

### 1-2. パッケージを public にする

上げたあと、**GitHubで各パッケージを public にする。**

```
https://github.com/<ユーザー名>?tab=packages
  → 各パッケージ → Package settings → Change visibility → Public
```

> [!warning] private のままだとVMで `docker login` が必要になる
> 職場VMに PAT を置くことになり、失効の管理も増える。
> リポジトリを public にしたので、パッケージも public に揃えるのが素直。

### 1-3. GitHub へ push する

```bash
git remote add origin https://github.com/<ユーザー名>/backlog-clone.git
git push -u origin main --tags
```

> [!warning] `.env` は追跡していない（履歴にも一度も入っていない）
> 確認済み。職場では `.env.production.example` を写して値を入れ直す。
>
> **TLSの鍵と証明書もコミットしない。** `caddy/certs/*` は `.gitignore` 済み。

### 1-4. 自宅のデータを持っていく場合

**新規で始める方針なので、通常この手順は不要**（2026-09-14 に決定）。
将来必要になったときのために残してある。

```bash
scripts/backup.sh
# → dist/backup/backlog-clone-<日時>/ に postgres.sql.gz と files.tar.gz
```

`dist/` は `.gitignore` 済みなので、GitHub 経由では運べない。
ファイル共有などで別に運ぶ。

---

## 2. 職場VMで構築する

### 2-1. クローンする

```bash
cd ~
git clone https://github.com/<ユーザー名>/backlog-clone.git
cd backlog-clone
```

public リポジトリなので認証は要らない。

> [!info] ソースも一緒に来るが、VMでビルドはしない
> `app/` の中身も落ちてくるが、使うのは
> `docker-compose.prod.yml` / `caddy/` / `docker/` / `scripts/` /
> `.env.production.example` / `docs/` だけ。
> VMに Node も pnpm も要らない（**Docker だけ**）。
>
> 版を上げるときも `git pull` で済む。

### 2-2. イメージを取り込む

`docker compose` が ghcr.io から自動で取ってくるので、
**明示的な取り込みは要らない**（`IMAGE_PULL_POLICY=missing`）。

先に落としておきたい場合:

```bash
docker compose -f docker-compose.prod.yml pull
```

取れないときに見るところ:

| 症状 | 原因 |
|---|---|
| `denied` / `unauthorized` | パッケージが private のまま。GitHubで public にする（1-2） |
| `no such host` | VMから ghcr.io に出られていない。許可されたホストを確認する |
| `manifest unknown` | `APP_IMAGE_TAG` が ghcr.io に上げたタグと違う |

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
# --- 自宅側: ビルドして ghcr.io に上げ、GitHub に push する ---
GHCR_OWNER=<ユーザー名> APP_IMAGE_TAG=0.9.0 scripts/push-images.sh
git push origin main --tags

# --- 職場側 ---
scripts/backup.sh                    # 先にバックアップ。**これを飛ばさない**
git pull                             # compose や Caddyfile の変更も入る
sed -i 's/^APP_IMAGE_TAG=.*/APP_IMAGE_TAG=0.9.0/' .env
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm migrate   # スキーマ変更があれば当たる
docker compose -f docker-compose.prod.yml up -d
```

> [!warning] `git pull` は `.env` を上書きしない（追跡していないので）
> ただし **`.env.production.example` に新しい変数が増えている**ことがある。
> 版を上げたら差分を見る:
>
> ```bash
> git diff HEAD@{1} HEAD -- .env.production.example
> ```

前の版のイメージは消さずに残しておく。戻すときは `APP_IMAGE_TAG` を
戻して `up -d` するだけで済む（**ただしマイグレーションは戻らない**ので、
スキーマ変更を含む版から戻すときはバックアップからの復元になる）。

### 検索がおかしいとき

```bash
docker compose -f docker-compose.prod.yml run --rm reindex
```

---

## 6. 外部ネットワークに出ないことの検証

> [!important] 前提が変わった（2026-09-14）
> 展開を GitHub のクローンに変えたので、**VMは完全なオフラインではない**。
> 許可されているのは **github.com と ghcr.io の2つだけ**。
>
> したがってこの章の目的は「一切出ない」の確認から、
> **「その2つ以外へ出ていない」の確認**に変わった。
>
> `git pull` と `docker compose pull` のときは当然 github.com / ghcr.io へ出る。
> `egress-check.sh` はそれらも外部接続として挙げるので、
> **pull していない状態で実行する**こと。

### 出る可能性があったもの（全部止めてある）

| 出どころ | 行き先 | 止め方 | 確認方法 |
|---|---|---|---|
| Next.js のテレメトリ | telemetry.nextjs.org | `NEXT_TELEMETRY_DISABLED=1`（イメージに焼き込み） | `docker run --rm --entrypoint env backlog-clone-app:0.3.0 \| grep TELEMETRY` |
| Prisma の版確認 | checkpoint.prisma.io | `CHECKPOINT_DISABLE=1`（同上） | 同様に `grep CHECKPOINT` |
| Meilisearch の利用統計 | meilisearch.com | `MEILI_NO_ANALYTICS=true` | 起動ログに `Anonymous telemetry: "Disabled"` |
| Gitea の新版確認 | dl.gitea.com | `GITEA__cron_0X2E_update_checker__ENABLED=false` | `exec gitea grep -A2 update_checker /data/gitea/conf/app.ini` |
| イメージの取得 | Docker Hub | **ghcr.io に複製して参照先を変えた**（`*_IMAGE` 変数）。Docker Hub は参照しない | `docker compose -f docker-compose.prod.yml config \| grep image:` が全部 ghcr.io になっている |
| 依存のインストール | npm レジストリ | 本番イメージは実行時に `pnpm install` しない | — |
| Webフォント | Google Fonts 等 | 使っていない（`next/font` も未使用） | `grep -rn "next/font\|fonts.googleapis" app/src` が空 |

### 設計上、外に出る通信

| 何 | 行き先 | いつ |
|---|---|---|
| `git pull` | github.com | 版を上げるときだけ（手で実行） |
| `docker compose pull` | ghcr.io | 同上 |
| webhook | 登録したURL | プロジェクト設定で登録したときだけ。社外URLを登録すれば社外へ出るので、登録先は運用で決める |
| SMTP | `SMTP_HOST` | `MAIL_ENABLED=true` のときだけ。**いまは false なので出ない** |

つまり**定常運転では1つも外に出ない。** 出るのは人が版を上げるときだけ。

### 実測で確かめる

```bash
COMPOSE_FILE=docker-compose.prod.yml scripts/egress-check.sh
```

各コンテナの `/proc/net/tcp` を直接読み、プライベートアドレス以外への接続
（確立済み・接続試行中の両方）を挙げる。設定を読むだけでは
「切れているつもり」を検出できないのでこの形にした。

アプリを一通り操作した直後に実行する。一瞬の状態しか見えないため、
気になるときは間隔を置いて何度か実行する。

**期待する結果は「0件」。** github.com / ghcr.io が挙がったら、
それは `pull` が走っている最中か、`IMAGE_PULL_POLICY=always` になっている。
`missing` にすれば起動のたびには問い合わせない。

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

### 2026-09-14 に測ったこと（VMの要件を実測で出した）

移設のマイルストーンを立てるにあたり、**本番構成の資源使用量を測った**。
詳細は `docs/05-migration-milestones.md` の M7 にある。

本番イメージ `0.8.1` を別スタックで起動し、課題1533件・ユーザー10人・
プロジェクト5つを入れて測定:

- メモリ: **アイドル 344MiB / 20並列の負荷中 442MiB**（7サービス合計）
- CPU: 20並列で app が **117%**（1コアを超える）。postgres 24%
- 応答: 単発 15〜85ms、20並列で中央値 207ms / p95 1518ms
- ディスク: イメージ計 **1.6GB**、課題1533件でDB **84MB**
- → VM要件は **2コア / 2GB / 10GB** が下限、**4コア / 4GB / 20GB** が推奨

**開発コンテナの app は 7.1GiB 使うが、本番は 110MiB**（65分の1）。
`next dev` がモジュールを抱えるためで、開発時の数字をVM要件にしてはいけない。

### 2026-09-14 に見つけた不具合（本番の worker が起動しなかった）

| 症状 | 原因 |
|---|---|
| 本番の worker が `ERR_MODULE_NOT_FOUND: zod` で再起動を繰り返す | `/worker` の依存を手で並べたリストに `zod` が無かった。M5 でカスタム属性（`src/lib/custom-field.ts`）を入れたときから壊れていた |

影響していたのは**検索インデックスの更新・webhook の配信・メール送信**。
画面は動くので気づきにくい。M5 の検証で worker の状態まで見ていなかった。

同じ種類の漏れは M3-e の `bullmq` に続いて2回目なので、
`docker/check-worker-deps.mjs` を追加した。ビルド段で**入口から import を
実際に辿り**、外部パッケージが `/worker` から解決できるかを検算する。
欠けていればビルドが落ちる。

**`docker compose ps` の healthy の数だけで「起動した」と判定しない。**
worker には healthcheck が無く、restarting でも数に出てこない。

### まだ確かめていないこと

- **職場VMの実機での疎通**（手順3）。ここは環境に依存するため、実行はユーザーが行う
- 職場のSMTPリレーが使えるか（4章）
- 同時利用が5〜20人に増えたときの**実機での体感**。
  上の測定は自宅サーバでの上限の目安

### 確かめて、リスクが下がったこと

- **SSE が通らなくても移設は止まらない**（2026-09-14 に実装を確認）。
  `EventSource` の利用は `BoardClient.tsx` の1箇所だけで、用途はボードの
  `issue.moved` のみ。`es.onerror` で `live=false` に落ちる作りなので、
  プロキシに切られてもボードは通常どおり動く（ライブ更新が止まるだけ）。
  代替はポーリングの追加で10行程度

---

## Webhook の登録（2026-09-22）

提供元（GitHub / 将来 Bitbucket）から push 通知を受けるための設定。

```bash
docker compose exec -T app pnpm tsx scripts/git-webhook-setup.ts <owner/repo> <URL>
```

`GITHUB_WEBHOOK_SECRET` を `.env` に入れてから実行する。
**秘密が未設定だと受け口は全ての通知を 401 で落とす。**
素通りさせると、この受け口に届く誰もがタスクへコメントを書けてしまうため。

### 自宅で GitHub を相手に試すときだけ必要なこと

GitHub はクラウド側にあるので、自宅の開発機へ届く経路が要る。Tailscale Funnel で
**受け口のパスだけ**を公開する（アプリ全体を公開するとデモデータも
`admin` のパスワードも外から触れる）。

```bash
sudo tailscale funnel --bg --set-path /api/git/webhook http://localhost:8088/api/git/webhook
```

**本番では不要。** 社内 Bitbucket と社内VMは同じネットワークなので、
アプリのURLをそのまま登録すればよい。

### 開発サーバだと最初の1回が失敗する

`next dev` はルートを初回アクセス時にコンパイルする。app を再起動した直後の
1通目は **8〜9秒**かかり、**GitHub の 10 秒でタイムアウトする**。
配信履歴には `EOF` と出て原因が分かりにくい。

暖まれば 0.1 秒台になる。再送すれば通るので、失敗したら
Recent Deliveries から Redeliver すればよい。本番はビルド済みなので起きない。
