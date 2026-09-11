> [!DANGER] このファイルは破棄済み。参照してはいけない
>
> これは設計書の**v1**であり、本家仕様と突き合わせた結果 **7箇所の誤り**が見つかっている。
> 正は `docs/01-design.md`(v2)。実装の判断に使うのは v2 と `docs/00-spec-verified.md` だけ。
>
> v1 に残っている誤記述(v2 のレビュー履歴と同じもの):
> 1. 優先度を `priority (1..4)` の4段階としている → 正しくは3段階(2=高/3=中/4=低、1は欠番)
> 2. マイルストーンとバージョンを別テーブルにしている → 同一エンティティ(`versions`)
> 3. 状態の並べ替え制約が書かれていない → 標準4状態は削除・並べ替え不可
> 4. ガントを「開始日と期限日が入っている課題」としている → 表示条件は4パターン
> 5. `#fix` による状態変更をフェーズ4で実装するとしている → 本家が2019年に廃止。実装しない
> 6. 通知をメンション・ウォッチ・担当の3種としている → 「お知らせ」経路と参加者の概念が欠落
> 7. ロールを `admin/member/reporter/guest` の4値としている → 種別×制限×プロジェクト管理者の3軸
>
> 履歴として残しているだけ。**v1にしか無かった有用な記述(インデックス指定)は v2 の 4.3 へ移した。**

---

# Backlogクローン 設計書

対象: 職場チーム 5〜20人 / 自宅サーバ(Docker)で開発・検証 → 職場VMへ移設 / Git連携まで含むフル機能

---

## 1. 最初に決めた3つの方針

### 方針A: Gitホスティングは自作しない

Git over HTTP(smart protocol)、SSH鍵管理、pack転送、権限フックを自前実装するのは、課題管理本体より重い。**Giteaをバックエンドに置き、自作アプリはGiteaのAPIとwebhookを使う**。UIは自作アプリ側に埋め込み、ユーザーからは1つのアプリに見える。

- コミットログ・ファイルツリー・差分表示 → Gitea API を叩いて自前UIで描画
- 課題キー連携（`PROJ-12 を修正` でコミットが課題に紐づく）→ webhookで受けてリンクテーブルに保存
- プルリクエスト → 初版はGiteaのPR一覧をAPIで取得して表示。レビューUIまで作り込むのはフェーズ5以降

将来「やっぱり完全自作」に振る場合に備え、Git操作は `GitProvider` インタフェース1枚に閉じ込める。

### 方針B: 自宅↔職場の可搬性を最優先

職場VMは外部ネットワークが制限されている前提で設計する。

- 外部SaaSに依存しない（認証・メール・ストレージ・検索すべて自前コンテナ）
- 設定は全て環境変数、`docker compose` 1ファイルで起動
- データは PostgreSQL + 添付ファイル用ボリュームの2箇所だけ。バックアップ対象がこれだけで済む形にする
- コンテナイメージは自宅でビルドして tar で持ち込めるようにする（`docker save/load`）

### 方針C: 認証は最初から差し替え可能にする

自宅ではローカルID/パスワード、職場では会社のAD/OIDCに繋ぐ可能性が高い。ユーザーテーブルに `auth_provider` / `external_id` を最初から持たせ、認証部分を Auth.js のプロバイダ差し替えで吸収する。後付けだとユーザーの名寄せで必ず詰まる。

---

## 2. 全体構成

```
                    [ Caddy ]  ← リバースプロキシ / TLS
                        |
        +---------------+----------------+
        |                                |
   [ app ]  Next.js (UI + API)      [ gitea ]  Git本体
        |        |                       |
        |        +--- webhook ←----------+
        |
   [ worker ]  通知・メール・全文検索インデックス
        |
   +----+-----+--------+-----------+
   |          |        |           |
[postgres] [redis] [meilisearch] [files volume]
```

コンテナ6つ。職場VMなら 4vCPU / 8GB / SSD 100GB もあれば20人規模で余裕。

---

## 3. 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| フロント+API | Next.js (App Router) + TypeScript | 1言語で完結。AIエージェントに書かせる時に文脈が分断されない |
| DB | PostgreSQL 16 | JSONB（カスタム属性・変更差分）と再帰CTE（親子課題）が要る |
| ORM | Prisma | スキーマ定義が仕様書を兼ねる。マイグレーションが職場移設時に効く |
| 非同期処理 | BullMQ + Redis | メール送信・webhook配信・検索インデックス更新 |
| 全文検索 | Meilisearch | 日本語をゼロ設定で分かち書きできる。PostgreSQLのpg_bigmでも可だが運用が楽な方を選ぶ |
| Git | Gitea | 単一バイナリ、軽量、API充実 |
| 添付 | ローカルボリューム | S3互換(MinIO)は職場移設時に足せばよい。抽象化だけしておく |
| UI | Tailwind + shadcn/ui + TanStack Table | 一覧・ボード・ガントを素早く作る |
| ガント | 自作SVG | 既存ライブラリは日本語カレンダーと祝日で結局手を入れる。Backlogのガントは依存線がないので自作が現実的 |

**Python(FastAPI)で作りたい場合**: DB設計・API設計はそのまま流用でき、フロントを別リポジトリのReactに分けるだけ。判断材料は「自分が普段どちらでレビューしやすいか」。

---

## 4. データモデル

### 4.1 コア

```
users
  id, email, name, icon_url, locale, timezone
  auth_provider ('local'|'oidc'|'ldap'), external_id, password_hash
  is_admin, disabled_at

projects
  id, key ('PROJ' 大文字英数), name, description
  is_archived, use_wiki, use_file_sharing, use_git
  last_issue_no   -- 課題キー採番カウンタ
  text_formatting ('markdown'|'backlog')

project_members
  project_id, user_id
  role ('admin'|'member'|'reporter'|'guest')
```

Backlogのロール定義に合わせる。reporterは課題作成と自分の課題の編集のみ、guestは他人の課題を見られない。

### 4.2 課題

```
issues
  id, project_id, issue_no        -- 表示は project.key + '-' + issue_no
  issue_type_id, summary, description
  status_id, priority (1..4), resolution_id
  assignee_id, created_by, updated_by
  start_date, due_date, estimated_hours, actual_hours
  parent_id                        -- 親子課題（1階層のみ）
  category_ids[], milestone_ids[], version_ids[]   -- 多対多（中間テーブル）
  custom_fields jsonb
  created_at, updated_at
```

**マスタはプロジェクト単位で持つ**（Backlogと同じ）。`issue_types` / `categories` / `milestones` / `statuses` は全て `project_id` を持つ。statusは「未対応・処理中・処理済み・完了」の4つを初期投入し、追加可能にする。

**インデックス**: `(project_id, issue_no) unique`、`(project_id, status_id, assignee_id)`、`(assignee_id, due_date)`、`(project_id, updated_at desc)`。一覧のデフォルトソートと「自分の課題」ダッシュボードがここに乗る。

### 4.3 活動履歴とコメント

コメントと変更履歴を**1つのテーブルに統合する**。Backlogの課題画面は両者が時系列で混ざるので、分けると必ず結合して並べ直す羽目になる。

```
activities
  id, project_id, issue_id (nullable), wiki_page_id (nullable)
  type ('issue_created'|'issue_updated'|'comment'|'git_push'|'wiki_updated'...)
  user_id, content (コメント本文)
  changes jsonb        -- [{field:'status', from:'2', to:'3'}, ...]
  created_at
```

`changes` をJSONBにすることで、フィールド追加のたびにスキーマを触らずに済む。表示側は field 名から日本語ラベルと値の解決を行う共通関数を1つ用意する。

### 4.4 その他

```
attachments        id, project_id, issue_id/wiki_page_id/comment_id, name, size, mime, storage_key
watchers           user_id, issue_id, created_at
notifications      user_id, activity_id, read_at, reason ('assigned'|'mentioned'|'watching')
wiki_pages         project_id, name, content, created_by, updated_by
wiki_revisions     wiki_page_id, content, user_id, created_at   -- 全文スナップショット方式で十分
shared_files       project_id, dir, name, storage_key           -- 単純な階層ファイル置き場
repositories       project_id, gitea_repo_id, name, default_branch
commit_issue_links commit_sha, issue_id, repository_id, message
```

---

## 5. 実装の勘所

### 課題キーの採番

`PROJ-1, PROJ-2...` の連番は同時作成で衝突する。アプリ側でMAX+1を取ってはいけない。

```sql
UPDATE projects SET last_issue_no = last_issue_no + 1
WHERE id = $1 RETURNING last_issue_no;
```

これを課題INSERTと同一トランザクションで行う。欠番は許容する（Backlogも削除で欠番が出る）。

### 課題一覧のフィルタ

Backlogの検索条件（種別・カテゴリ・マイルストーン・担当・状態・キーワード・期限範囲）は組み合わせ爆発する。**条件オブジェクトをURLクエリとして正規化し、Prismaの`where`をビルドする関数を1本に集約する**。ここを分散させると一覧・ボード・ガント・API・エクスポートで4回同じバグを踏む。

キーワード検索だけMeilisearchに投げ、返ったIDでDBを絞る二段構えにする。

### 権限チェック

`can(user, action, resource)` を1関数に集約し、APIルートの入口で必ず通す。guestロールが他人の課題を見られない仕様があるため、**一覧クエリ自体に権限条件を注入する**設計にしておく（取得後にフィルタすると件数とページングが壊れる）。

### ガントチャート

- 描画対象: `start_date` と `due_date` が入っている課題 + マイルストーン
- 親課題の帯は子の期間から自動計算（親自身に日付があればそちらを優先）
- 依存関係の線は**作らない**。Backlogにも無く、入れると自動スケジューリングの期待が発生して沼になる
- ドラッグでの日付変更は初版では入れず、まず読み取り専用で出す

### ボード（カンバン）

状態を列とし、ドラッグで `status_id` を更新するだけ。並び順を保持するなら `board_order` を float で持ち、隣接2件の中間値を入れる方式にする（全件再採番を避ける）。

---

## 6. Git連携の設計

### 3つの連携経路

1. **ユーザー作成の同期**: 自作アプリでユーザーを作ったら Gitea API でも作成し、`users.gitea_user_id` を保持。パスワードは持たせず、GiteaはOIDC/トークン経由で認証させる
2. **リポジトリ作成**: プロジェクトに紐づく Gitea リポジトリを API で作成。作成時に webhook を自動登録する
3. **push webhook**: コミットメッセージを正規表現 `\b([A-Z][A-Z0-9]*-\d+)\b` で走査し、該当課題があれば `commit_issue_links` に保存 + `activities` に `git_push` を積む

### コミットメッセージによる状態変更

Backlogの `#fix` `#close` 相当。`PROJ-12 #fix` で課題を「処理済み」にする。実装は webhook ハンドラ内で権限チェックを通した上で状態更新 + 活動記録。**この機能はフェーズ4以降に回す**。誤操作で状態が飛ぶと信頼を失うので、リンク表示だけ先に安定させる。

### UI

リポジトリ閲覧（ファイルツリー・ファイル内容・コミット一覧・差分）は Gitea API のレスポンスを自作UIで描画。ここが一番「そっくり」に効く割に実装は薄い。

---

## 7. 通知

| 経路 | 内容 |
|---|---|
| アプリ内 | 担当に指定された / メンションされた / ウォッチ中の課題が更新された |
| メール | 上記と同じ。ユーザー単位でON/OFF |
| webhook送信 | 課題の追加・更新・コメントを外部へ（Slack/Teams連携用） |

すべて worker 経由の非同期。**職場VMではSMTPリレーが使えない可能性が高い**ので、メールを止めてもアプリ内通知だけで回る設計にしておく。設定は `MAIL_ENABLED=false` で丸ごと落とせるように。

---

## 8. API設計

`/api/v2/...` を **Backlog公式APIのパス・パラメータ名に寄せる**。

- `GET /api/v2/projects/:projectIdOrKey/issues`
- `POST /api/v2/issues`
- `GET /api/v2/issues/:issueIdOrKey/comments`

理由: 既存のBacklog向けCLIやスクリプトの資産が流用でき、自分でクライアントを書くときも公式ドキュメントがそのまま設計書になる。認証はAPIキー（`users` に紐づくトークンテーブル）。

---

## 9. 開発フェーズ

| # | 内容 | 完了の判定 |
|---|---|---|
| 0 | docker compose 骨組み、Prismaスキーマ、認証、プロジェクト/メンバーCRUD | 自宅でログインしてプロジェクトが作れる |
| 1 | 課題のCRUD、コメント、活動履歴、添付、一覧とフィルタ | 自分1人で実務メモを課題として運用できる |
| 2 | ボード、ガント、ダッシュボード、通知（アプリ内） | 週次の進捗確認をこれ1つで済ませられる |
| 3 | Wiki、ファイル共有、全文検索、メール通知、API v2 | 職場VMへ試験移設 |
| 4 | Gitea連携（リポジトリ表示・コミットリンク・PR一覧） | Git履歴と課題が相互に辿れる |
| 5 | カスタム属性、状態カスタマイズ、CSVインポート/エクスポート、監査ログ | チーム展開 |

フェーズ1が終わった時点で**自分で毎日使い始める**こと。使わずに機能を積むと、一覧のデフォルト表示やソート順といった体感を左右する部分の判断を全部間違える。

---

## 10. 職場移設時に効いてくる項目

- **バックアップ**: `pg_dump` + 添付ボリュームの tar を日次。復元手順を自宅で1回実演しておく
- **監査ログ**: 誰が何をいつ見た/変えたか。`activities` で変更は追えるので、閲覧ログを足すかは職場のルール次第
- **SSO**: OIDCが使えるなら Auth.js の Provider 追加のみ。LDAPしか無い場合は worker に同期ジョブを1本足す
- **データ移行**: 既存のExcel課題表を取り込む CSV インポータをフェーズ5に置いているが、職場展開の直前に必ず要求される。前倒しの可能性を見ておく
- **ライセンス**: Gitea は MIT、その他も全て許容的なライセンス。社内利用の確認が必要なのはこの点くらい

---

## 11. あえて作らないもの

- Git のホスティング実装本体（Gitea に任せる）
- SVN 対応（新規に必要とする人はいない）
- ガントの依存関係と自動スケジューリング
- リアルタイム共同編集（Wikiは楽観ロック＋競合警告で十分）
- モバイルアプリ（レスポンシブWebで賄う）
