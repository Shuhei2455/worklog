# 設計書 v2（仕様確認反映版）

対象: 職場チーム 5〜20人 / 自宅サーバ(Docker)で開発 → 職場VMへ移設 / Git連携まで含むフル機能

v1 からの変更点は末尾の「レビュー履歴」を参照。数値・挙動の根拠は `00-spec-verified.md`。

---

## 1. 基本方針

### A. Gitホスティングは自作しない

Git over HTTP(smart protocol)、SSH鍵管理、pack転送、権限フックの自前実装は課題管理本体より重い。**Giteaをバックエンドに置き、APIとwebhookで連携する。** UIは自作側に持ち、ユーザーからは1つのアプリに見えるようにする。

Git操作は `GitProvider` インタフェース1枚に閉じ込め、将来の差し替え余地を残す。

### B. 自宅↔職場の可搬性を最優先

職場VMは外部ネットワークが制限されている前提。

- 外部SaaSに依存しない（認証・メール・ストレージ・検索すべて自前コンテナ）
- 設定は全て環境変数、`docker compose` 1ファイルで起動
- 永続データは PostgreSQL と添付ファイルボリュームの2箇所のみ
- イメージは自宅でビルドして `docker save` / `load` で持ち込める

### C. 認証は最初から差し替え可能にする

`users` に `auth_provider` / `external_id` を最初から持たせ、Auth.js のプロバイダ差し替えで吸収する。後付けだとユーザーの名寄せで詰まる。

### D. 名称・意匠は本家を模倣しない

機能とデータモデルは本家に揃えるが、**アプリ名・ロゴ・配色・アイコンは独自にする。** 職場導入時に商標や意匠の話が出ると止まる。API のパス設計とフィールド名を本家互換にするのは相互運用のためであり、これは問題にならない。Backlog記法（独自記法）も実装しない。

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
   [ worker ]  通知・メール・検索インデックス
        |
   +----+-----+--------+-----------+
   |          |        |           |
[postgres] [redis] [meilisearch] [files volume]
```

コンテナ6つ。職場VMは 4vCPU / 8GB / SSD 100GB で20人規模なら余裕。

---

## 3. 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| フロント+API | Next.js (App Router) + TypeScript | 1言語で完結し、AIエージェントに書かせる際に文脈が分断されない |
| DB | PostgreSQL 16 | JSONB（変更差分・カスタム属性）と再帰CTEが必要 |
| ORM | Prisma | スキーマ定義が仕様書を兼ね、職場移設時にマイグレーションが効く |
| 非同期処理 | BullMQ + Redis | メール・webhook配信・検索インデックス更新 |
| 全文検索 | Meilisearch | 日本語をゼロ設定で分かち書きできる |
| リアルタイム | Server-Sent Events | ボードの同時編集反映。WebSocketは職場のプロキシで詰まる可能性がある |
| Git | Gitea | 単一バイナリ、軽量、API充実、MITライセンス |
| 添付 | ローカルボリューム | ストレージ抽象化だけしておき、S3互換は必要になったら足す |
| UI | Tailwind + shadcn/ui + TanStack Table | 一覧・ボード・ガントを素早く作る |
| ボードDnD | dnd-kit | |
| ガント | 自作SVG | 本家に依存線が無いため自作が現実的。既存ライブラリは日本語カレンダーで結局手を入れる |
| Markdown | remark/rehype (GFM) | 本家も2025年10月からGFM準拠 |

---

## 4. データモデル

Prismaのモデル名はPascalCase、DBの物理名はsnake_case（`@@map`）。

### 4.1 ユーザーと権限

```
users
  id, user_id (ログインID), name, email, icon_url, lang, timezone
  role_type      1=管理者 / 2=一般ユーザー / 3=ゲスト
  restriction    'none' | 'issue_create_only' | 'issue_view_only'
  auth_provider  'local' | 'oidc' | 'ldap'
  external_id, password_hash
  last_login_at, disabled_at

teams              id, name, icon_url
team_members       team_id, user_id

projects
  id, key, name, description
  archived
  chart_enabled          -- ONのときだけ課題に開始日・期限日を入力できる
  subtasking_enabled     -- 親子課題
  wiki_enabled, file_sharing_enabled, git_enabled
  project_leader_can_edit_project_leader
  text_formatting_rule   -- 'markdown' 固定（設定項目としては保持）
  last_issue_no          -- keyId 採番カウンタ

project_members    project_id, user_id, is_project_admin
project_teams      project_id, team_id
```

権限は「種別 × 制限 × プロジェクト管理者フラグ」の3軸。単一のロール列挙にしない（本家がそうなっていないため、後で必ず破綻する）。

### 4.2 マスタ（すべてプロジェクト単位）

```
issue_types    id, project_id, name, color, display_order
categories     id, project_id, name, display_order
versions       id, project_id, name, description,
               start_date, release_due_date, archived, display_order
statuses       id, project_id, name, color, display_order, is_default
```

**`versions` はマイルストーンと発生バージョンの両方を兼ねる。** 本家が同一エンティティなので分けてはいけない。

優先度と完了理由はスペース共通のためテーブルを作らず、**アプリ内定数**として持つ（値は `00-spec-verified.md` の表のとおり）。

### 4.3 課題

```
issues
  id, project_id, key_id            -- 表示は project.key + '-' + key_id
  issue_type_id, summary, description
  status_id, priority_id, resolution_id
  assignee_id, created_by, updated_by
  start_date, due_date, estimated_hours, actual_hours
  parent_issue_id
  board_order          -- ボードの並び順（float）
  created_at, updated_at

issue_categories    issue_id, category_id
issue_milestones    issue_id, version_id     -- versions を参照
issue_versions      issue_id, version_id     -- versions を参照（発生バージョン）
issue_relations     issue_id, related_issue_id     -- 対等な関連課題
issue_participants  issue_id, user_id
```

- **担当者は単一カラム。** 本家が複数担当を認めていないので配列にしない
- `parent_issue_id` は1階層のみ。親を持つ課題は親になれない（アプリ側でバリデート）

インデックス（v1設計書から引き継ぎ。一覧の既定ソートと「自分の課題」ダッシュボードがここに乗る）:

| インデックス | 効かせる先 |
|---|---|
| `(project_id, key_id)` unique | 課題キーの一意性と `PROJ-12` での参照 |
| `(project_id, status_id, assignee_id)` | 課題一覧・ボードの絞り込み |
| `(assignee_id, due_date)` | ダッシュボードの「自分が担当」 |
| `(project_id, updated_at desc)` | 一覧の既定ソート |

### 4.4 活動履歴とコメント

コメントと変更履歴は**1テーブルに統合する**。本家の課題画面は両者が時系列で混ざるため、分けると必ず結合して並べ直す羽目になる。

```
activities
  id, project_id, type
  issue_id / wiki_page_id / pull_request_id (nullable)
  user_id, content
  changes jsonb        -- [{field:'status', from:'2', to:'3'}, ...]
  created_at

activity_notified_users   activity_id, user_id     -- 「お知らせ」宛先
stars                     user_id, activity_id / issue_id / wiki_page_id
```

`changes` をJSONBにすることで、フィールド追加のたびにスキーマを触らずに済む。表示側は field 名から日本語ラベルと値を解決する共通関数を1つ用意する。

### 4.5 通知

通知の入口は3経路（お知らせ・ウォッチ・メンション）。**発生源が違うだけで、生成される通知レコードは同一形式にする。**

```
watchings       id, user_id, issue_id, note, last_read_at, created_at
notifications   id, user_id, activity_id,
                reason ('notified'|'watching'|'mentioned'|'assigned'),
                read_at
```

同一 activity に対して複数の理由が該当する場合は、`notified > assigned > mentioned > watching` の優先順で1件に寄せる。

### 4.6 Wiki・ファイル・Git

```
wiki_pages        id, project_id, name, content, created_by, updated_by
wiki_revisions    wiki_page_id, content, user_id, created_at   -- 全文スナップショット
wiki_tags         wiki_page_id, tag

attachments       id, project_id, name, size, mime, storage_key, created_by
issue_attachments / wiki_attachments / comment_attachments

shared_files      id, project_id, dir, name, storage_key
issue_shared_files / wiki_shared_files      -- 課題・Wikiからのリンク

repositories        id, project_id, gitea_repo_id, name, default_branch,
                    link_commits_to_issues
commit_issue_links  repository_id, commit_sha, issue_id, message, committed_at
pull_requests       id, repository_id, gitea_pr_number, issue_id, ...
```

---

## 5. 実装の勘所

### keyId の採番

同時作成で衝突するため、アプリ側で MAX+1 を取ってはいけない。

```sql
UPDATE projects SET last_issue_no = last_issue_no + 1
WHERE id = $1 RETURNING last_issue_no;
```

課題INSERTと同一トランザクションで実行する。削除による欠番は許容する。

### 課題一覧のフィルタ

条件（種別・カテゴリー・マイルストーン・バージョン・担当・状態・優先度・完了理由・親子・キーワード・各種日付範囲・カスタム属性）は組み合わせ爆発する。**条件オブジェクトをURLクエリとして正規化し、Prismaの `where` を組み立てる関数を1本に集約する。** ここを分散させると一覧・ボード・ガント・API・エクスポートで同じバグを4回踏む。

キーワードのみ Meilisearch に投げ、返ったIDでDBを絞る二段構え。

### 権限チェック

`can(user, action, resource)` を1関数に集約し、APIルートの入口で必ず通す。ゲストや「課題の閲覧のみ」制限があるため、**一覧クエリ自体に権限条件を注入する**設計にする（取得後にフィルタすると件数とページングが壊れる）。

管理者であっても未参加プロジェクトは見えない、という本家の挙動を忘れないこと。

### ガントチャート

表示条件は4パターンあり（`00-spec-verified.md` 5章）、「開始日と期限日が揃った課題だけ」ではない。描画関数は課題1件を受けて `{ from, to, kind }` を返す純関数に切り出し、単体テストを書く。ここは仕様の分岐が多く、目視デバッグに向かない。

- 表示開始日の既定は当日の1週間前
- グルーピングは担当者・マイルストーン・カテゴリー・親課題・種別
- 依存線と自動スケジューリングは作らない

### ボード

- プロジェクトの全課題を表示（完了課題も含む）
- 並び順は `board_order` を float で持ち、隣接2件の中間値を入れる（全件再採番を避ける）
- 他ユーザーの変更をSSEで反映する
- カードの表示項目は固定（課題キー・件名・担当者・期限日）

---

## 6. Git連携

### 実装する

1. **ユーザー同期**: 自作アプリでユーザーを作成したら Gitea API でも作成し、`users.gitea_user_id` を保持
2. **リポジトリ作成**: プロジェクトに紐づく Gitea リポジトリをAPIで作成し、同時にwebhookを自動登録
3. **push webhook**: コミットメッセージを `\b([A-Z][A-Z0-9_]*-\d+)\b` で走査し、該当課題があれば `commit_issue_links` に保存して `activities` に積む。プロジェクト設定 `link_commits_to_issues` がONのときのみ
4. **ブランチ名連携**: ブランチ名に課題キーが含まれる場合、そのブランチからPRを作ると自動で関連課題として紐づける。運用は `PROJ-100/fix-something` 形式
5. **リポジトリ閲覧**: ファイルツリー・ファイル内容・コミット一覧・差分を Gitea API から取得して自作UIで描画

### 実装しない

**コミットログのキーワードによる状態変更（`#fix` / `#close`）は作らない。** 本家クラウド版が2019年12月に廃止しており、理由は「利用率が0.1%程度で、複雑なブランチモデルに合わない」。同じ結論に従う。

---

## 7. API設計

`/api/v2/...` を **本家APIのパス・パラメータ名・レスポンス構造に合わせる。**

- `GET /api/v2/projects/:projectIdOrKey/issues`
- `POST /api/v2/issues`（必須は projectId / summary / issueTypeId / priorityId）
- `GET /api/v2/issues/:issueIdOrKey/comments`

`category` `milestone` が単数形キーで配列を返すといった本家の癖もそのまま踏襲する。既存のBacklog向けCLIやスクリプトが流用でき、公式ドキュメントがそのまま設計書として使える。

認証はAPIキー（`api_tokens` テーブル）。レート制限のヘッダも本家に合わせておく。

---

## 8. 職場移設時に効いてくる項目

- **バックアップ**: `pg_dump` + 添付ボリュームの tar を日次。復元手順を自宅で1回実演しておく
- **SSO**: OIDCなら Auth.js のProvider追加のみ。LDAPしか無い場合は worker に同期ジョブを足す
- **メール**: SMTPリレーが使えない可能性が高い。`MAIL_ENABLED=false` で丸ごと落としてもアプリ内通知だけで回るようにする
- **CSVインポート**: 既存のExcel課題表の取り込みは、職場展開の直前に必ず要求される。ロードマップ上は後半だが前倒しの可能性を見ておく
- **ライセンス**: Gitea は MIT。他も許容的なライセンスで、社内確認が必要なのはこの点くらい

---

## 9. 作らないもの

- Gitホスティングの実装本体（Giteaに任せる）
- SVN対応
- コミットログのキーワードによる状態変更（本家廃止済み）
- ガントの依存関係と自動スケジューリング（本家に無い）
- Backlog記法（独自記法のため）
- Wikiのリアルタイム共同編集（楽観ロック＋競合警告で十分）
- モバイルアプリ（レスポンシブWebで賄う）
- ドキュメント機能（Wikiと役割が重複。必要になってから）

---

## レビュー履歴

### v1 → v2 の修正（一次情報との突き合わせで判明した誤り）

| # | v1の記述 | 正しい仕様 |
|---|---|---|
| 1 | 優先度は `priority (1..4)` の4段階 | 3段階。id は 2=高 / 3=中 / 4=低 で、1は欠番 |
| 2 | マイルストーンとバージョンを別テーブル | 同一エンティティ（`versions`）。参照の仕方で役割が変わるだけ |
| 3 | 状態は4つを初期投入し追加可能、とだけ記述 | 標準4状態は削除・並べ替え不可。追加状態はOpenより前/Closedより後に置けない |
| 4 | ガントは開始日と期限日が入っている課題を描画 | 開始日のみ・期限日のみ・マイルストーンのみ・完了日、の4パターンがある |
| 5 | `#fix` による状態変更をフェーズ4で実装 | 本家クラウドは2019年に廃止済み。実装しない |
| 6 | 通知はメンション・ウォッチ・担当の3種 | 「お知らせ」(`notifiedUserId`)という明示指定の経路が別にある。参加者の概念も欠落していた |
| 7 | ロールを admin/member/reporter/guest の4値で定義 | 「種別 × 制限 × プロジェクト管理者フラグ」の3軸。レポーターは旧プランの呼称 |

### v1 で欠落していた機能

関連課題、スター、Wikiのタグ、共有ファイルの課題/Wikiへのリンク、チーム、最近見た項目、プロジェクト単位のwebhook、バーンダウンチャート、テキスト整形ルール設定、プロジェクト機能のON/OFF（チャート・Wiki・ファイル共有・Git・親子課題）。

このうち、プロジェクト機能のON/OFFは**課題の入力可否そのものに影響する**（チャートがOFFだと開始日・期限日を入力できない）ため、フェーズ0のスキーマに入れる必要がある。
