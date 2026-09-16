# 本家Backlog 仕様確認結果（一次情報ベース）

このファイルは**実装の正解データ**。ここに書かれた値・挙動は Nulab の公式APIドキュメントとヘルプセンターで確認済み。
実装中に仕様の判断が必要になったら、まずここを見る。ここに無い項目は「未確認」であり、**憶測で決めずに `TODO(要確認)` を残す**こと。

確認日: 2026-09-10
主な出典: developer.nulab.com/docs/backlog/api/2/ , support-ja.backlog.com , backlog.com/ja/blog

---

## 1. 固定ID（本家と同じ値を使う）

### 優先度 `GET /api/v2/priorities`

**3段階。4段階ではない。** スペース共通でプロジェクト単位ではない。

| id | 英語名 | 日本語表示 |
|---|---|---|
| 2 | High | 高 |
| 3 | Normal | 中 |
| 4 | Low | 低 |

id=1 は欠番。この欠番も含めて本家と揃える。

### 完了理由 `GET /api/v2/resolutions`

スペース共通。id が 0 始まりである点に注意。

| id | 英語名 | 日本語表示 |
|---|---|---|
| 0 | Fixed | 対応済み |
| 1 | Won't Fix | 対応しない |
| 2 | Invalid | 無効 |
| 3 | Duplication | 重複 |
| 4 | Cannot Reproduce | 再現しない |

### 状態 `GET /api/v2/projects/:projectIdOrKey/statuses`

**プロジェクト単位**（レスポンスに `projectId` を含む）。標準4状態は全プロジェクトに自動で入る。

| id | 英語名 | 日本語表示 | displayOrder |
|---|---|---|---|
| 1 | Open | 未対応 | 1000 |
| 2 | In Progress | 処理中 | (以降連番) |
| 3 | Resolved | 処理済み | |
| 4 | Closed | 完了 | |

制約（ヘルプセンターで確認済み）:
- 標準4状態は**削除できない**
- 標準4状態は**並べ替えできない**
- 追加した状態は **Open より前、Closed より後には置けない**
- 使用中の状態を削除するときは、置き換え先の状態を選ばせるダイアログを出す
- 状態には色を持たせる（例: Open は `#ed8077`）

---

## 2. 課題

### API レスポンスの主要フィールド（`GET /api/v2/issues/:issueIdOrKey`）

```
id            内部ID（スペース内で一意）
projectId
issueKey      "BLG-1"  ← 表示用
keyId         1        ← プロジェクト内連番。issueKey とは別フィールド
issueType     { id, projectId, name, color, displayOrder }
summary
description
resolution    null または { id, name }
priority      { id, name }
status        { id, projectId, name, color, displayOrder }
assignee      user オブジェクト（単一。配列ではない）
category      [] ← 単数形キーだが配列
versions      []
milestone     [] ← 単数形キーだが配列
startDate / dueDate        "yyyy-MM-dd"
estimatedHours / actualHours
parentIssueId
createdUser / created / updatedUser / updated
customFields  []
attachments   []
sharedFiles   []
stars         []
```

**キー名は本家に合わせる。** `category` と `milestone` が単数形なのは本家の仕様なので、そのまま踏襲する（API互換のため）。

### 重要な制約

- **担当者は1人だけ。** 複数担当は不可。本家は「複数人にしたければ親子課題を使え」という設計
- 親子課題は1階層のみ
- `POST /api/v2/issues` の必須項目は `projectId` `summary` `issueTypeId` `priorityId` の4つ
- 開始日・期限日は、**プロジェクト設定の「チャートを使用する」がONのときのみ入力できる**

### マイルストーンと発生バージョンは同一エンティティ

`GET /api/v2/projects/:key/versions` が両方を返す。テーブルを分けてはいけない。

```
{ id, projectId, name, description, startDate, releaseDueDate, archived, displayOrder }
```

同じレコードを、課題側で `versionId[]`（発生バージョン）として参照するか `milestoneId[]`（マイルストーン）として参照するかで役割が変わる。

### 課題一覧のフィルタ（`GET /api/v2/issues`）

`projectId[]` `issueTypeId[]` `categoryId[]` `versionId[]` `milestoneId[]` `statusId[]` `priorityId[]` `assigneeId[]` `createdUserId[]` `resolutionId[]` `parentChild` `attachment` `sharedFile` `sort` `order` `offset` `count`(最大100) `createdSince/Until` `updatedSince/Until` `startDateSince/Until` `dueDateSince/Until` `keyword` `customField_{id}`

`parentChild` の値: `0=すべて` `1=子課題のみ` `2=親課題のみ` `3=子課題以外` `4=子課題を持たない`

### 2.2 カスタム属性での絞り込み（2026-09-17 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/get-issue-list/

型によってパラメータの形が変わる。

| 型 | パラメータ | 値 |
|---|---|---|
| テキスト（1）/ 文章（2） | `customField_${id}` | String（キーワード） |
| 数値（3） | `customField_${id}_min` / `customField_${id}_max` | Number |
| 日付（4） | `customField_${id}_min` / `customField_${id}_max` | String（日付） |
| リスト（5）/ 複数リスト（6） | `customField_${id}[]` | Number（選択肢のID・複数可） |

- テキストは**キーワード**と書かれている。完全一致ではなく部分一致と読める
- 数値と日付は**範囲**。片方だけの指定もできる
- リストは**選択肢のID**の配列。名前ではない

未確認:

- `TODO(要確認)`: **チェックボックス（7）とラジオ（8）の形式**。
  公式ドキュメントに記載が無い。選択肢を持つ型なのでリストと同じ
  `customField_${id}[]` と推測できるが、**憶測で埋めない**。
  実装では リスト と同じ扱いにし、ここに未確認である旨を残す
- `TODO(要確認)`: テキストが部分一致か前方一致か。「キーワード」としか書かれていない

並び替えは `sort=customField_${id}`（2.1 の20種に含まれる）。

### 2.1 一覧の並び替えとページング（2026-09-12 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/get-issue-list/

`sort` に指定できる値は20種:

```
issueType  category  version  milestone  summary  status  priority
attachment sharedFile created  createdUser updated updatedUser assignee
startDate  dueDate   estimatedHours actualHours childIssue customField_${id}
```

- `order` は `asc` / `desc`。**既定は `desc`**
- `count` は 1〜100、**既定は 20**
- `offset` でページング

**`sort` の既定値はドキュメントに書かれていない。** 一覧の初期表示は体感を
大きく左右する箇所なので、本アプリの決定として 10.2 に記録する。

### 2.2 課題の更新と活動履歴（2026-09-12 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/update-issue/

`PATCH /api/v2/issues/:issueIdOrKey` のフォームパラメータ:

```
summary  parentIssueId  description  statusId  resolutionId
startDate  dueDate  estimatedHours  actualHours  issueTypeId
categoryId[]  versionId[]  milestoneId[]  priorityId  assigneeId
notifiedUserId[]  attachmentId[]  comment
```

**設計に効く点が2つある。**

1. **更新時に `comment` を一緒に送れる。** つまり「状態を変えつつコメントを書く」が
   1リクエストで起きる。`activities` は1テーブルに統合しているので、
   このとき `changes` と `content` の**両方を持つ1レコード**になる。
   変更履歴とコメントを別レコードにすると本家の表示と食い違う。
2. **`notifiedUserId[]` は更新時にも指定できる。** 「お知らせ」は課題登録時だけの
   仕組みではない。コメント単位でも `POST /issues/:key/comments/:commentId/notifications`
   がある。

### 2.3 添付ファイルの流れ（2026-09-12 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/post-attachment-file/

**2段階。** 先に `POST /api/v2/space/attachment` でファイルを送って id を受け取り、
課題の作成・更新時に `attachmentId[]` で紐づける。
スペース単位のエンドポイントで、課題にもWikiにも使える。
`attachments` を実体1本＋紐づけテーブルに分けた設計と整合している。

### 2.4 関連課題のエンドポイント（2026-09-12 に確認）

```
GET    /api/v2/issues/:issueIdOrKey/relatedIssues
POST   /api/v2/issues/:issueIdOrKey/relatedIssues
DELETE /api/v2/issues/:issueIdOrKey/relatedIssues/:id
```

9章に `/issues/:key/relatedIssues` と書いてあったパスは正しい。

---

## 3. 通知の3経路（設計上ここが重要）

本家には性質の違う通知経路が3つある。**v1設計ではこのうち「お知らせ」が抜けていた。**

| 経路 | 発生源 | データ構造 |
|---|---|---|
| お知らせ | 課題登録・コメント時に `notifiedUserId[]` で明示的に指定 | 課題/コメントごとに宛先ユーザーのリスト |
| ウォッチ | ユーザーが課題をウォッチ登録 | `/api/v2/watchings` 。ウォッチにはメモ(`note`)を付けられる |
| メンション | 本文中の `<@U{id}>` 記法（下記 3.1） | 本文パース時に抽出 |

さらに「参加者(participants)」という概念があり、`GET /api/v2/issues/:key/participants` で取れる。登録者・担当者・コメントした人などが自動で参加者になる。

### 3.1 メンション記法（2026-09-12 に一次情報で確認・訂正）

出典: https://developer.nulab.com/docs/backlog/tips#mention-users-in-text

**`@ユーザー名` ではない。** `description` `comment` `content` が受け付ける記法は次の3つ。

| 記法 | 対象 |
|---|---|
| `<@U{id}>` | ユーザー。`{id}` は `Get Project User List` が返す数値の `id` |
| `<@T{id}>` | チーム。`{id}` は `Get Project Team List` が返す数値の `id` |
| `<@project>` | そのプロジェクトの全メンバー |

実装で効く点:

- **メンションされたユーザーは `notifiedUserId[]` に入っていなくても通知される。**
  「お知らせ」とは独立した経路である、という3章の記述の裏付け
- **プロジェクトのメンバーでないユーザーは通知されない**
- **存在しないIDはメンションとして扱われず、通知も飛ばない**（エラーにはならない）
- 本文には `<@U5>` のまま保存され、**表示側で名前に解決する**。
  名前を埋め込む方式だと、ユーザー名の変更に追随できない

前の版の「`@ユーザー` 記法」は誤り。`@` で始まる普通の文字列はメンションにならない。

---

## 4. Git連携

### コミットログでの状態変更は、クラウド版では廃止済み

2019年11月に予告、**2019年12月に廃止**。「利用率が全コミットログの0.1%程度で、近年の複雑なブランチモデルに合わない」というのが理由。Enterprise（オンプレ）版のヘルプには記述が残っている。

→ **本アプリでは実装しない。** webhookで同等のことは実現できる、というのが本家の案内。

### 残っている連携（こちらを実装する）

- コミットメッセージに課題キーが含まれていると、**その課題にコメントとして自動登録される**。プロジェクト設定の「コミットと課題を連携する」でON/OFF
- プルリクエストの本文・コメント内の課題キーは自動でリンクになる
- **ブランチ名に課題キーを含めると、そのブランチからPRを作るとき自動的に関連課題になる**。ヌーラボ社内では `BLG-100/fix-some-problem` という「課題キー/サマリー」形式で運用している

### 参考: サードパーティ実装のキーワード仕様

GitHub Action の backlog-notify は、課題キーは**先頭の1つのみ**、キーワードは**末尾の1つのみ**認識する。`#fix|#fixes|#fixed` で処理済み、`#close|#closes|#closed` で完了。本家廃止機能を再現したい場合はこの仕様を参考にする。

### 4.1 Git関連のAPI（2026-09-13 に一次情報で確認）

#### プロジェクトの機能フラグ

出典: https://developer.nulab.com/docs/backlog/api/2/get-project/

Git に関係するのは `useGit` と `useSubversion`、それに `useDevAttributes`。
**`link_commits_to_issues` に当たるフィールドはプロジェクトオブジェクトに無い。**
「コミットと課題を連携する」の設定はAPIに出てこない（画面だけの設定）。
本アプリはこれを**リポジトリ単位**で持つ（決定 D18）。

#### リポジトリ

`GET /api/v2/projects/:projectIdOrKey/git/repositories`
`GET /api/v2/projects/:projectIdOrKey/git/repositories/:repoIdOrName`

| キー | 型 | 備考 |
|---|---|---|
| `id` | Number | |
| `projectId` | Number | |
| `name` | String | |
| `description` | String | |
| `hookUrl` | String/null | |
| `httpUrl` | String | |
| `sshUrl` | String | |
| `displayOrder` | Number | |
| `pushedAt` | String/null | 最後に push された時刻 |
| `createdUser` / `created` / `updatedUser` / `updated` | | |

#### プルリクエスト

`GET /api/v2/projects/:projectIdOrKey/git/repositories/:repoIdOrName/pullRequests`

絞り込み: `statusId[]` `assigneeId[]` `issueId[]` `createdUserId[]` `offset`
`count`（1〜100、既定20。課題一覧と同じ）

| キー | 型 | 備考 |
|---|---|---|
| `id` | Number | |
| `projectId` | Number | |
| `repositoryId` | Number | |
| `number` | Number | リポジトリ内の連番。課題の `keyId` と同じ役回り |
| `summary` | String | **`title` ではない** |
| `description` | String | |
| `base` | String | マージ先のブランチ |
| `branch` | String | マージ元のブランチ |
| `status` | Object | `{id, name}`。`id: 1` は `Open` |
| `assignee` | User/null | |
| `issue` | Object/null | `{id}` だけ。関連課題 |
| `baseCommit` / `branchCommit` / `mergeCommit` | Object/null | |
| `closeAt` / `mergeAt` | String/null | **`closedAt` ではない** |
| `createdUser` / `created` / `updatedUser` / `updated` | | |

`PATCH .../pullRequests/:number` の受け取るパラメータは
`summary` `description` `issueId` `assigneeId` `notifiedUserId[]` `comment`。
**`statusId` は無い**（APIからPRの状態は変えられない）。

TODO(要確認): PRの `status.id` は 1 = Open しか確認できていない。
Closed / Merged に当たる値があると思われるが、一覧・更新のどちらの
ドキュメントにも値の表が無い。

TODO(要確認): コミットメッセージ中の課題キーを何個認識するか
（先頭の1つだけか、出現した全部か）。本家のヘルプに記述が見つからない。
本アプリは**出現した全部**に紐づける（決定 D19）。

TODO(要確認): Git push（活動種別12）と PRコメント（同20）の `content` の構造。
課題とWikiの例しか公開されていない。

---

## 5. ガントチャート

### 表示条件（2026-09-12 に一次情報で再確認し、記述を訂正）

出典: https://support-ja.backlog.com/hc/ja/articles/360036144673
「ガントチャートに課題を表示させる方法」

課題に **開始日・期限日・マイルストーン・状態が「完了」のいずれか**があれば表示される。

| 課題の状態 | 帯の描き方 |
|---|---|
| 開始日と期限日の両方あり | 開始日〜期限日の帯 |
| 開始日のみ | 開始日の位置にだけ帯 |
| 期限日のみ | 期限日の位置にだけ帯 |
| 日付なし・マイルストーンに終了日あり | マイルストーンの終了日の位置に帯 |
| 日付なし・マイルストーンに終了日なし・状態が「完了」 | 完了にした日の位置に帯 |
| 上のいずれにも当たらない | **表示されない** |

**前の版からの訂正点:**

1. 「4パターン」と書いていたが、帯の描き方は**5通り**（＋非表示）。
   「4」は表示のきっかけになる属性の数（開始日・期限日・マイルストーン・完了）を
   指していたと思われる。**実装は5通り＋非表示の6分岐**として扱う
2. 「日付なし・マイルストーンあり」と書いていたが、正しくは
   **マイルストーンに「終了日」が設定されている場合**。
   終了日の無いマイルストーンでは帯が出ず、状態が「完了」のときだけ完了日に出る。
   マイルストーンと完了日は**並列ではなく、マイルストーンが優先**

### その他の確認済み仕様

- ガントは**プロジェクト設定の「チャートを使用する」が有効なときだけ使える**。
  新規作成時は既定で有効
- 表示開始日のデフォルトは**当日の1週間前**
- **絞り込みは5つ**: 種別・**状態**・カテゴリー・マイルストーン・担当者
  （前の版は「状態」が抜けて4つになっていた）
- グルーピングは5つ: 担当者・種別・マイルストーン・カテゴリー・親課題
- サイドパネルで課題詳細を表示し、**開始日・期限日・担当者・状態は直接編集できる**
- タイムスケール: 日・週・月・**四半期**（四半期はプレミアムプラン以上）
- 「開始・期限日が未設定の課題」を一覧するダイアログがあり、そこで日付を設定できる
- 複数課題のスケジュールをまとめて変更できる。
  **親課題をドラッグすると「子課題もまとめて移動しますか？」のダイアログが出る**
- 表示条件を保持した短いURLを発行できる
- Excel形式でエクスポートできる
- **依存関係の線は無い**（公式ヘルプに記述が無く、自動スケジューリング機能も存在しない）

## 6. ボード（カンバン）

2026-09-12 に一次情報で再確認した。
出典: https://support-ja.backlog.com/hc/ja/articles/360041544073 「ボードの概要」

- 列 = 状態。標準なら「未対応/処理中/処理済み/完了」。
  追加状態はプロジェクト設定の並び順で列になる
- **ボードは全プロジェクトで使える。個別の設定は無い**
  （ガントと違い「使用する」のON/OFFが無い点に注意）
- **プロジェクト内の全課題が表示される**。完了課題も表示される
- **カードの上限は無い。** ただし100件以上だと列の件数表示が「+99」になる
- **親子課題は区別なく並ぶ。** 子課題だけを見たいときはフィルタで絞る
- ドラッグ＆ドロップで状態を変更
- **カードの並び順を自由に変更でき、保存される**
- 他のユーザーの変更がリアルタイムに反映される
- カードに出る情報: 課題キー・件名・担当者・期限日。**表示項目はカスタマイズ不可**
- **未対応の列から直接課題を追加できる**
- 検索条件を保存できる

### フィルタの制約（実装で効く）

フィルタできるのは**4つだけで、増やせない**: 種別・カテゴリー・マイルストーン・担当者。
一覧と違い**状態では絞れない**（列そのものが状態なので）。

> **各条件は単一選択で、複数指定できない。**
> 一覧の `buildIssueWhere` は配列を受けるので、ボードから呼ぶときは
> 1件だけ入った配列を渡すことになる。UIで複数選ばせないよう注意する。

**プロジェクトを横断したボードは無い。**

## 7. 権限モデル

本家は「ユーザー種別 × 追加権限 × 制限」の3軸で、単純なロール列挙ではない。

- ユーザー種別: **管理者 / 一般ユーザー / ゲスト**
- 制限（管理者が個別に設定）: **制限なし / 課題の登録のみ / 課題の閲覧のみ**
- プロジェクト管理者: プロジェクト単位のフラグ。プロジェクトに関しては管理者と同等だが、スペース設定は変更できない。**一般ユーザー（制限なし）のみが設定可能**
- 管理者であっても、**自分が参加していないプロジェクトの課題やWikiは閲覧できない**
- ゲストは、同じプロジェクトに参加しているメンバーのユーザー名しか参照できない
- API のユーザーオブジェクトの `roleType` は**「種別」ではなく「種別 × 制限」を1つの数値に潰したもの**。
  **ゲストかどうかは `roleType` では区別されない。**（2026-09-11 に一次情報で確認・訂正）

  | roleType | 公式の定義 |
  |---|---|
  | 1 | Administrator |
  | 2 | Member, Guest (No restriction) |
  | 3 | Member, Guest (Add issue only) |
  | 4 | Member, Guest (View only) |

  出典: https://developer.nulab.com/docs/backlog/api/2/get-user-list/

  → 内部モデルは「種別 × 制限 × プロジェクト管理者フラグ」の3軸のまま持ち、
  API で返すときにこの4値へ**写像する**。ゲスト判別用のカラムは別に必要。

旧クラシックプランの「レポーター」「ビューアー」は、現行では一般ユーザー＋制限に統合されている。

### 7.1 権限マトリクス（2026-09-12 に一次情報で確認）

出典: https://support-ja.backlog.com/hc/ja/articles/360035643434 「ユーザーの権限」

**追加権限**という軸もある（v2設計で抜けていた）。管理者・一般ユーザーに付与する:
契約管理者 / プロジェクト管理者 / メンバー招待 / チーム管理者。
ゲストには追加権限を付与できず、**プロジェクト管理者になることはできない**。

#### スペース全体に関する権限

| 操作 | 管理者 | PJ管理者 | 制限なし | 登録のみ | 閲覧のみ |
|---|---|---|---|---|---|
| スペースの編集 | ○ | × | × | × | × |
| プロジェクト管理者の設定 | ○ | △ | × | × | × |
| プロジェクトの追加/削除 | ○ | × | × | × | × |
| アクセス制限 | ○ | × | × | × | × |

#### プロジェクトに関する権限

| 操作 | 管理者 | PJ管理者 | 制限なし | 登録のみ | 閲覧のみ |
|---|---|---|---|---|---|
| プロジェクトの編集 | ○ | ○ | × | × | × |
| 種別の追加/編集/削除 | ○ | ○ | ○ | × | × |
| カテゴリーの追加/編集/削除 | ○ | ○ | ○ | × | × |
| 発生バージョン/マイルストーンの追加/編集/削除 | ○ | ○ | ○ | × | × |

**種別・カテゴリー・バージョンは「制限なし」の一般ユーザーでも編集できる**点に注意。
プロジェクト管理者だけの機能ではない。

#### 各機能に関する権限

列は 管理者 / PJ管理者 / 一般(制限なし・登録のみ・閲覧のみ) / ゲスト(制限なし・登録のみ・閲覧のみ)。

| 操作 | 管理 | PJ管 | 一般:なし | 一般:登録 | 一般:閲覧 | ゲスト:なし | ゲスト:登録 | ゲスト:閲覧 |
|---|---|---|---|---|---|---|---|---|
| 課題の閲覧 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 課題の追加 | ○ | ○ | ○ | ○ | × | ○ | ○ | × |
| 課題の編集 | ○ | ○ | ○ | × | × | ○ | × | × |
| 課題の削除 | ○ | ○ | × | × | × | × | × | × |
| コメント追加/編集/削除 | ○ | ○ | ○ | ○ | × | ○ | ○ | × |
| 課題の添付ファイル追加 | ○ | ○ | ○ | ○ | × | ○ | ○ | × |
| 課題の添付ファイル削除 | ○ | ○ | ○ | × | × | ○ | × | × |
| Wikiの閲覧 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Wikiの追加/編集/削除 | ○ | ○ | ○ | × | × | ○ | × | × |
| 共有ファイルの閲覧/追加/編集/削除 | ○ | ○ | ○ | × | × | ○ | × | × |
| Git の閲覧/コミットなどのアクセス | ○ | ○ | ○ | × | × | ○ | × | × |
| 個人設定の変更 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

ここから読み取れる、実装で間違えやすい点:

- **課題の削除は「管理者」と「プロジェクト管理者」だけ。** 制限なしの一般ユーザーでもできない
- **「課題の登録のみ」は課題を追加できるが、編集はできない。** 自分が作った課題も編集できない
- **「課題の閲覧のみ」でもコメントは付けられない**（コメント追加が ×）
- **Wiki と課題の「閲覧」は、制限に関わらず全員できる。** ただし参加プロジェクトに限る
- **共有ファイルは「閲覧」すら制限ユーザーには許されない**（課題・Wikiと扱いが違う）
- ゲストと一般ユーザーは、同じ制限なら課題まわりの権限が同一。違うのは
  プロジェクト管理者になれない点と、参照できるユーザー範囲

△ は注釈付きの条件付き許可。TODO(要確認): 「プロジェクト管理者の設定」における
△(※1) の具体的な条件。7章本文では「一般ユーザー（制限なし）のみが設定可能」とある。

---

## 8. テキスト整形ルール

- スペース設定で既定を決め、プロジェクト設定で「スペースの設定を使う / Backlog記法 / Markdown」から上書きできる
- Markdown は **2025年10月23日から GitHub Flavored Markdown 準拠**
- Backlog記法は独自仕様（見出し `*`、箇条書き `-`、`{code}` マクロ等）

→ **本アプリでは Markdown(GFM) のみ実装する。** Backlog記法は独自記法であり、再現する実務上の利益が無い。プロジェクト設定の項目自体は持っておき、値は `markdown` 固定にする。

---

## 9. その他、本家にあって v1 設計から漏れていた機能

- **関連課題**: 親子とは別の、対等な課題同士のリンク（`/issues/:key/relatedIssues`）
- **スター**: 課題・コメント・Wikiに付けられる。ユーザーごとの受信スター数も取れる
- **Wikiのタグ**: Wikiページにタグを付けて分類できる
- **共有ファイルの課題/Wikiへのリンク**: 添付とは別に、プロジェクトのファイル置き場にあるファイルを課題から参照する
- **チーム**: ユーザーをまとめる単位。チーム単位でプロジェクトに追加でき、課題の「お知らせ」先にも指定できる
- **最近見た課題/プロジェクト/Wiki**: 閲覧履歴
- **プロジェクト単位のwebhook**: 課題追加・更新などのイベントを外部に飛ばす
- **バーンダウンチャート**: マイルストーン単位
- **ドキュメント機能**: Wikiとは別に、ツリー構造とタグを持つ新しい文書機能（近年追加）

---

## 9.1 Wiki（2026-09-12 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/get-wiki-page/ ほか

```
GET    /api/v2/wikis?projectIdOrKey=      一覧（content を含まない）
GET    /api/v2/wikis/:wikiId              1件（content / tags / attachments / sharedFiles / stars を含む）
PATCH  /api/v2/wikis/:wikiId              更新（name / content / mailNotify）
GET    /api/v2/wikis/:wikiId/history      履歴
```

実装で効く点:

- **一覧には `content` が含まれない。** 一覧で本文まで返すと重くなるため。
  こちらも一覧では select で落とす
- Wikiページは `name` `content` `tags` `attachments` `sharedFiles` `stars` を持つ
- 履歴は `{ pageId, version, name, content, createdUser, created }`。
  **`version` は履歴側が持つ連番**で、本文の全文スナップショットも履歴に入る
- **更新APIに楽観ロック用の引数は無い**（`name` `content` `mailNotify` のみ）。
  本家は後勝ちと思われる
- `mailNotify` で更新時にメール通知するかを選べる

TODO(要確認): 本家が同時編集をどう扱うか（後勝ちか、警告を出すか）

---

## 9.2 共有ファイル（2026-09-12 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/get-list-of-shared-files/

```
GET    /api/v2/projects/:projectIdOrKey/files/metadata/:path   ディレクトリの中身
GET    /api/v2/projects/:projectIdOrKey/files/:sharedFileId    ファイルの取得
POST   /api/v2/issues/:issueIdOrKey/sharedFiles                課題へのリンク
DELETE /api/v2/issues/:issueIdOrKey/sharedFiles/:id            リンクの解除
POST   /api/v2/wikis/:wikiId/sharedFiles                       Wikiへのリンク
```

レスポンスの形:

```
{ id, projectId, type: "file" | "directory", dir: "/design/", name, size,
  createdUser, created, updatedUser, updated }
```

実装で効く点:

- **`dir` は前後にスラッシュを付けた文字列**（`/design/`、ルートは `/`）。
  ディレクトリを別テーブルにせず、この文字列で階層を表す
- **`type` にディレクトリも含まれる。** 一覧は同じ配列にファイルとディレクトリが混ざる
- 共有ファイルは添付とは別物。**プロジェクトのファイル置き場**で、
  課題やWikiから「リンク」して参照する
- 権限は 7.1 のとおり、**制限のあるユーザーは閲覧すらできない**
  （課題・Wikiと扱いが違う）

---

## 9.3 活動の種類と通知の理由（2026-09-12 に一次情報で確認）

出典: https://developer.nulab.com/docs/backlog/api/2/get-recent-updates/

M0 で `TODO(要確認)` にしていた「activities の type の整数対応」が判明した。
**本家APIは type も reason も整数で返す。** webhook の `activityTypeIds` も同じ値。

### 活動の種類（type / activityTypeId）

| id | 内容 | id | 内容 |
|---|---|---|---|
| 1 | Issue Created | 14 | Issue Multi Updated |
| 2 | Issue Updated | 15 | Project User Added |
| 3 | Issue Commented | 16 | Project User Deleted |
| 4 | Issue Deleted | 17 | Comment Notification Added |
| 5 | Wiki Created | 18 | Pull Request Added |
| 6 | Wiki Updated | 19 | Pull Request Updated |
| 7 | Wiki Deleted | 20 | Comment Added on Pull Request |
| 8 | File Added | 21 | Pull Request Deleted |
| 9 | File Updated | 22〜24 | Milestone Created / Updated / Deleted |
| 10 | File Deleted | 25, 26 | Project Group Added / Deleted |
| 11 | SVN Committed | 36〜49 | Document 関連（本アプリでは作らない） |
| 12 | Git Pushed | | |
| 13 | Git Repository Created | | |

### 通知の理由（reason）

| id | 内容 |
|---|---|
| 1 | Assigned to Issue |
| 2 | Issue Commented |
| 3 | Issue Created |
| 4 | Issue Updated |
| 5 | File Added |
| 6 | Project User Added |
| 9 | Other |
| 10〜13 | Pull Request 関連 |
| 14〜17 | Document 関連 |

**内部モデルとは別物である点に注意。** 本アプリの `notifications.reason` は
「なぜ通知が飛んだか」（notified / assigned / mentioned / watching）で、
本家の `reason` は「何が起きたか」に近い。API で返すときに写像する。

TODO(要確認): 本家の reason に「メンションされた」に当たる値が見当たらない
（Document 用の 17 はある）。課題のメンションは 9:Other になると思われる

---

## 9.4 活動の中身と変更差分（2026-09-13 に一次情報で確認）

出典: Get Recent Updates / Get Project Recent Updates
（https://developer.nulab.com/docs/backlog/api/2/get-project-recent-updates/）

活動オブジェクトのトップレベル:

| キー | 備考 |
|---|---|
| `id` | |
| `project` | |
| `type` | 活動種別の**整数**（9.3の表） |
| `content` | 種別ごとに中身が変わる |
| `notifications` | |
| `createdUser` | |
| `created` | |

課題関連の `content`:

| キー | 備考 |
|---|---|
| `id` | 課題のID |
| `key_id` | **スネークケース**。`keyId` ではない |
| `summary` | |
| `description` | |
| `comment` | `{ id, content }` |
| `changes` | 下記 |

`changes` の1要素:

```json
{ "field": "status", "new_value": "4", "old_value": "1", "type": "standard" }
```

- キーは `field` / `new_value` / `old_value` / `type`。**`from` / `to` ではない**
- 値は**文字列**
- `type` は標準項目で `"standard"`
- `field` の値は内部のカラム名ではない。レスポンス例で確認できたのは
  **`status` と `milestone`**（`statusId` / `milestoneIds` ではない）

本アプリは内部では `[{ field, from, to }]` で保持し（読んで分かる形のため）、
外に出すときに `src/lib/api/changes.ts` で写像する。活動種別の整数と同じ考え方。

TODO(要確認): `status` と `milestone` 以外の `field` の値。
とくに担当者（`assignee` か `assigner` か）と期限日（`dueDate` か `limitDate` か）は
本家が別名を使っている可能性がある。ヘルプセンターの Webhook のページに
一覧があると思われるが、機械的な取得が拒否される（HTTP 403）ため未確認。
確認先: https://support-ja.backlog.com/hc/ja/articles/360036147713-Webhook

---

## 11. カスタム属性・チーム・監査ログ（2026-09-13 に一次情報で確認）

### 11.1 カスタム属性

出典: https://developer.nulab.com/docs/backlog/api/2/get-custom-field-list/

`GET /api/v2/projects/:projectIdOrKey/customFields`

| キー | 型 | 備考 |
|---|---|---|
| `id` | Number | |
| `projectId` | Number | |
| `typeId` | Number | 10.1 の8種 |
| `name` | String | |
| `description` | String | |
| `required` | Boolean | |
| `applicableIssueTypes` | Array | 有効な課題種別のID。空なら全種別 |
| `allowAddItem` | Boolean | リスト型で項目の追加を許すか |
| `items` | Array | リスト型の選択肢。`{id, name, displayOrder}` |

**課題への値の渡し方** — 出典: https://developer.nulab.com/docs/backlog/api/2/add-issue/

- `customField_{id}` に値を入れる
- リスト型の「その他」欄は `customField_{id}_otherValue`
  （**`_otherItem` ではない**）

TODO(要確認): 課題のレスポンスに入る `customFields` の各要素の構造。
Get Issue の例は `"customFields": []` で中身が出ていない。
本アプリは `{id, fieldTypeId, name, value}` で返す（決定 D24）。

### 11.2 チーム

出典: https://developer.nulab.com/docs/backlog/api/2/get-list-of-teams/

`GET /api/v2/teams` — `order`(asc/desc、既定 desc) / `offset` / `count`(1〜100、既定20)

| キー | 型 | 備考 |
|---|---|---|
| `id` | Number | |
| `name` | String | |
| `members` | Array | ユーザーオブジェクトの配列 |
| `displayOrder` | Number/null | **null を返しうる** |
| `createdUser` / `created` / `updatedUser` / `updated` | | |

プロジェクトへの割り当て:

- `GET /api/v2/projects/:projectIdOrKey/teams`
- `POST /api/v2/projects/:projectIdOrKey/teams`（追加）
- `DELETE /api/v2/projects/:projectIdOrKey/teams`（削除）

チームは課題の「お知らせ」先に指定でき、メンション記法 `<@T{id}>` の
`{id}` はこの `id`（3.1 で確認済み）。

### 11.3 監査ログ

**APIは無い。** Nulab Pass（組織向けの認証基盤）の機能として提供されており、
Backlog のAPIドキュメントにエンドポイントが存在しない。
ヘルプセンターの該当ページは機械的な取得が拒否される（HTTP 403）ため、
記録項目も確認できない。

→ 本アプリは独自に設計する（決定 D25）。本家に合わせる対象ではない。

---

## 11.1 ダッシュボード（2026-09-13 に一次情報で確認）

出典:
- https://backlog.com/ja/enterprise-help/userguide/userguide1165/ （ダッシュボードについて）
- https://backlog.com/ja/enterprise-help/userguide/userguide1171/ （自分の課題）
- https://backlog.com/ja/enterprise-help/userguide/userguide1174/ （最近の更新）
- https://support-ja.backlog.com/hc/ja/articles/360036146933 （ダッシュボードについて）

ログイン後に最初に出る画面。**4つのブロック**で構成される。

| ブロック | 中身 |
|---|---|
| プロジェクト | 参加しているプロジェクトの一覧。名前・プロジェクトキーで検索できる。**ピン留め**で上位に固定し、ドラッグで並べ替えできる。クリックすると課題・課題の追加・Wiki・ファイル・Subversion・Git・ガントチャート・プロジェクト設定へ直接飛べる |
| 自分の課題 | **全プロジェクト横断**。担当の課題が**10件**。10件を超えるとボタンで全件へ。絞り込みは「担当 / 登録」と、期限日「全て / 4日以内 / 今日まで / 期限切れ」 |
| 自分のプルリクエスト | 自分に関係するプルリクエスト |
| 最近の更新 | プロジェクトメンバー（自分を含む）の活動を**時系列**で。課題の更新・課題の状態の変更・コミット・共有ファイルへのアップロードなど。各行からダッシュボード上で**コメントを追加できる** |

未確認:

- `TODO(要確認)`: 「最近の更新」の表示件数と、絞り込みの有無。ヘルプに記載がない
- `TODO(要確認)`: 「自分の課題」の既定の並び順。ヘルプに記載がない
- `TODO(要確認)`: 「自分のプルリクエスト」の抽出条件（担当のみか、登録も含むか）と件数

本アプリの実装（差分は D29 / D30 を参照）:

- 4ブロックとも作った。ピン留めと、ダッシュボード上でのコメント追加は**未実装**
- 「最近の更新」は20件、「自分の課題」は本家と同じ10件
- 「自分のプルリクエスト」は**担当 or 登録**で、状態が open のものに絞った
- 本家がグローバルナビに持つ「最近見た項目」「フィルタ」の画面が無いため、
  その2つをダッシュボードの右側に置いている

## 10. 実装時の判断（未確認項目と本アプリの決定）

一次情報を確認できなかった項目は、**本家の仕様として断定せず**「本アプリの決定」として記録する。
本家の挙動が後で判明したら、この節を更新して差分を検討する。

### 10.1 一次情報で確認できたもの（2026-09-11 追記）

**カスタム属性の型** — 出典: https://developer.nulab.com/docs/backlog/api/2/add-custom-field/

| typeId | 型 |
|---|---|
| 1 | Text（文字列） |
| 2 | Sentence（文章） |
| 3 | Number（数値） |
| 4 | Date（日付） |
| 5 | Single list（リスト） |
| 6 | Multiple list（複数リスト） |
| 7 | Checkbox（チェックボックス） |
| 8 | Radio（ラジオ） |

型ごとの追加パラメータ:

- Number: `min` `max` `initialValue` `unit`
- Date: `min` `max` `initialValueType`(1=today / 2=today+initialShift / 3=指定日) `initialDate` `initialShift`
- リスト系(5,6): `items[]` `allowAddItem` `allowInput`

**状態のレスポンス構造** — 出典: https://developer.nulab.com/docs/backlog/api/2/get-status-list-of-project/

`{ id, projectId, name, color, displayOrder }`。例に出ているのは Open のみで
`id=1` `color=#ed8077` `displayOrder=1000`。**残り3状態の色と displayOrder は公式ドキュメントに記載が無い。**

**状態追加時に選べる色** — 出典: https://developer.nulab.com/docs/backlog/api/2/add-status/

`#ea2c00` `#e87758` `#e07b9a` `#868cb7` `#3b9dbd` `#4caf93` `#b0be3c` `#eda62a` `#f42858` `#393939` の10色。

### 12. 本家の画面から採寸した値（2026-09-13）

**方針変更により、意匠も本家に合わせることになった**（CLAUDE.md）。
本家の画面にログインし、`getComputedStyle` で値を読んで記録した。
スクリーンショットやCSSファイルは取り込んでいない。

#### 12.1 標準4状態の色

ドキュメントには Open の `#ed8077` しか載っていない（上記）。残り3つは
画面で `.status--N` の計算済みスタイルを読んで確定した。

| id | 名前 | 色 |
|---|---|---|
| 1 | 未対応 | `#ed8077` （ドキュメントと一致） |
| 2 | 処理中 | `#4488c5` |
| 3 | 処理済み | `#5eb5a6` |
| 4 | 完了 | `#a1af2f` |
| 5以降 | （追加した状態） | `#bbbbbb` が既定 |

状態のラベルは**塗りのピル**。白文字・12px・角丸20px・余白 `1px 6px`。

#### 12.2 画面の骨格（左サイドバー型）

```
header.global-header   全幅 x 50px   bg #edf4f0
core-wrapper
  ├ nav.project-nav     200px幅       bg #4caf93（緑の下地）
  │   ├ 折りたたみボタン          50px
  │   └ 項目リスト（各50px・13px） ホーム / 課題の追加 / 課題 / ボード /
  │                              ガントチャート / ドキュメント / ファイル /
  │                              プロジェクト設定
  └ div.content-outer
      ├ header.content-header  49px  bg 白   ← プロジェクト名を出す
      └ div.content-main
```

- サイドバーの項目は**リンク色 `#00836b`、選択中は `#2c9a7a`**。
  項目自体の背景は透明で、下地の緑が透ける
- グローバルヘッダの左: ダッシュボード / プロジェクト / 最近見た項目 / フィルタ
- グローバルヘッダの右: ユーザーメニュー

こちらはタブ型のナビだったので、**左サイドバー型に作り替える**。

#### 12.3 基本のトークン

| 項目 | 値 |
|---|---|
| 書体 | `"Open Sans", "Hiragino Sans", ヒラギノ角ゴシック, "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN W3", "Helvetica Neue", Helvetica, Arial, sans-serif` |
| 基準の文字サイズ | **13px** / 行の高さ 20px |
| 文字色 | `#222222` |
| ページの背景 | `#f0f0f0` |
| ヘッダの背景 | `#edf4f0` （高さ 50px） |
| リンク・文字のアクセント | `#00836b` |
| 塗りのアクセント（選択中・バッジ） | `#2c9a7a` |
| 枠線 | `#bdbdbd`（一般） / `#adadad`（ボタン） |
| 副ボタン | 白背景・`#222222`・**角丸20px（ピル）**・高さ32px・枠 `#adadad` |
| ラベル（種別など） | 塗りのピル・白文字・12px・角丸20px |

**ボタンはピル型**（角丸20px）。こちらは4pxの角丸だったので、ここが
見た目のいちばん大きな違いだった。

### 10.2 本アプリの決定（本家の仕様ではない）

| # | 項目 | 決定 | 理由 |
|---|---|---|---|
| D1 | プロジェクトキーの文字種 | `^[A-Z][A-Z0-9_]{0,9}$` | 本家の制約は未確認。安全側に倒す |
| D2 | 課題削除時の keyId | 欠番のまま再利用しない | `UPDATE ... RETURNING` による採番と整合する |
| D3 | 完了理由の必須性 | 状態を「完了」にしても任意 | 必須にすると入力が止まる。本家の挙動は未確認 |
| D4 | 状態の色 | **本家と同じ値を使う**（未対応 `#ed8077` / 処理中 `#4488c5` / 処理済み `#5eb5a6` / 完了 `#a1af2f`） | **2026-09-13 改訂**: 「独自パレットを定義する」としていたのは CLAUDE.md の「意匠は模倣しない」が根拠だったが、その方針をユーザーが変更した。未対応は公式ドキュメントに記載があり、残り3つは本家の画面で採寸した（12.1） |
| D5 | 標準4状態の displayOrder | 1000 / 2000 / 3000 / 4000 | Open=1000 のみ判明。並べ替え制約は相対比較で足り、実値の一致は不要 |
| D6 | 標準4状態の id | 各プロジェクト内で 1/2/3/4 に固定 | 本家が `{id:1, projectId:N}` を返すため。API互換に必要 |
| D7 | ゲストの保持 | `users.user_type` に `admin`/`member`/`guest`、制限は別カラム | `roleType` にゲストの区別が無いため（7章）。API出力時に写像する |
| D8 | プロジェクト作成時の既定マスタ | 課題種別に「タスク」「バグ」「要望」「その他」を投入。カテゴリーは空 | 本家が何を自動生成するかは未確認。運用上この4つがあれば足りる |
| D9 | 添付ファイルのサイズ上限 | 10MB（`MAX_ATTACHMENT_MB` で変更可） | 本家の上限は未確認。職場VMのディスクを考えた値 |
| D10 | 通知の理由の優先順 | `notified > assigned > mentioned > watching` | 本家の挙動は未確認。明示指定を最優先にするのが自然 |
| D11 | 課題一覧の既定ソート | `updated` の降順 | 本家の既定は未記載。`order` の既定が `desc` であること、「最近動いた課題から見る」のが実務の基本であることから。インデックス `(project_id, updated_at desc)` もこれに合わせてある |
| D12 | 課題一覧の既定件数 | 20（本家と同じ） | ドキュメントに `default=20` と明記されている |
| D13 | 課題削除時の子課題 | 子課題は削除せず、親への参照だけ外す | 本家の挙動は未確認。子ごと消えると取り返しがつかない |
| D14 | 変更履歴に残すフィールド | 課題のスカラー項目と多対多（カテゴリー・バージョン・マイルストーン） | 本家が何を記録するかの網羅は未確認。`changes` がJSONBなので後から増やせる |
| D15 | 課題が複数のマイルストーンを持つときのガントの位置 | 最も早い終了日を使う | 本家の挙動は未確認。早い方に寄せた方が期限を見落としにくい |
| D17 | APIのレート制限の上限値 | read 600 / update 150 / search 150 / icon 60（1分あたり、環境変数で変更可） | **2026-09-13 訂正**: 「プランごとで非公開」と書いていたが誤り。Get Rate Limit のレスポンス例に read 600 / update 150 / search 150 / icon 60 が明記されており、本アプリの既定値はこれと一致する（偶然一致していた）。数え方（ユーザー単位・4種別・429・X-RateLimit-* ヘッダ）も本家に合わせた。出典: https://developer.nulab.com/docs/backlog/api/2/get-rate-limit/ |
| D18 | 「コミットと課題を連携する」の持ち方 | **リポジトリ単位**（`repositories.link_commits_to_issues`） | 本家はこの設定をAPIに出していないため、置き場所を決める必要があった。プロジェクト単位にすると「社内向けリポジトリだけ連携したい」ができない。OFFで連携が止まることは受け入れ条件（02-roadmap.md フェーズ4） |
| D19 | コミットメッセージ中の課題キーの扱い | **出現した全部**に紐づける。同じキーが複数回出ても1回だけ | 本家が何個認識するかは未確認（4.1のTODO）。1つに絞ると「AA-1 と AA-2 をまとめて直した」コミットが片方にしか残らず、後から追えない。多く拾いすぎても誤リンクを消せばよい |
| D20 | PRの状態の持ち方 | 内部は文字列（`open` / `closed` / `merged`）。APIでは `status: {id, name}` に写像し、id は 1=Open / 2=Closed / 3=Merged | 本家は 1=Open しか公開していない（4.1のTODO）。Gitea の状態をそのまま持つと本家形式で返せないため写像する。2と3の値が判明したら合わせる |
| D21 | コミットが参照できる課題の範囲 | **同じプロジェクトの課題だけ**。他プロジェクトのキーは無視する | 課題キーは全体で一意なので技術的には他プロジェクトにも書ける。しかし書けてしまうと、そのリポジトリに触れる人が**見る権限の無い課題にコメントを残せる**。権限の穴になるので同一プロジェクトに限る |
| D22 | ガントの「Excelエクスポート」の形式 | **CSV**（xlsxは作らない） | 2026-09-13 にユーザーが選択。xlsx を書くにはライブラリが必要で、帯の見た目を再現する実務価値が薄い。Excel で開けて再集計できれば足りる |
| D23 | CSVインポートの入力形式 | **CSVのみ**（xlsx は読まない）。UTF-8・BOM付き・Shift_JIS を自動判別 | 2026-09-13 にユーザーが選択。Excel から「CSV UTF-8」で保存し直す前提。文字化けだけはこちらで面倒を見る |
| D24 | 課題APIの `customFields` の形 | `{id, fieldTypeId, name, value}`。リスト型の `value` は `{id, name}`（複数リストは配列）、その他欄は `otherValue` | 本家のレスポンス例が空配列で中身が不明（11.1のTODO）。`fieldTypeId` という名前は本家の他の箇所の命名（`issueTypeId` など）に合わせた |
| D25 | 監査ログの記録項目 | `{発生時刻, 実行者, 操作, 対象, 詳細(JSONB), IPアドレス}` | 本家は API も記録項目も公開していない（11.3）。合わせる対象が無いので、職場の要求（誰がいつ何を消したか）に必要な最小限を独自に決めた |
| D26 | バーンダウンの定義 | マイルストーン単位。縦軸は**残り課題数**と**残り予定時間**の2本立て、横軸はマイルストーンの開始日〜終了日。理想線は初日の残量から終了日のゼロへの直線 | 本家の計算式は非公開。予定時間が未入力の課題が多い運用でも読めるように、件数ベースも並べる |
| D27 | パスワードの強度 | 10文字以上・英数記号のうち2種類以上・ログインIDや名前・よくある文字列・同じ文字の繰り返し・数字だけを禁止 | 本家の要件は未確認。複雑さを強く要求すると `Password1!` のような定型に寄るので、長さの確保を優先した。画面・CLI（set-password）の両方で同じ関数を通す |
| D28 | ログイン失敗の制限 | **ログインIDごと**に数え、10回でそのIDを15分間拒否（正しいパスワードでも通さない）。成功で解除 | IP単位にすると、社内は全員が同じ出口IPで来るため1人の打ち間違いで全員が止まる。Redisが落ちているときは通す（ログインできない方が被害が大きい） |
| D29 | プロジェクトの進捗表示（**本家に無い機能**） | プロジェクト一覧とダッシュボードに、状態ごとの積み上げバーと完了率を出す。完了率は**課題の件数**（完了した課題 ÷ 全課題）。予定時間ベースの率も併記するが、予定時間が1件も入っていなければ出さない | ユーザーの要望。本家のヘルプは「ダッシュボードで関わる全てのプロジェクトの進捗が把握できる」と書くが、実際に出るのは課題の一覧だけで進捗率の表示は無い。予定時間を主にしないのは、未入力の課題が多い運用では0%に張り付いて使えないため（バーンダウンで同じ問題に当たり、件数の線を併記した経緯がある）。色は本家の状態色をそのまま使う——利用者が課題一覧で見慣れている対応を崩さないため |
| D30 | ダッシュボードの未実装部分 | ピン留め（お気に入り）と、ダッシュボード上でのコメント追加は作らない | ピン留めは参加プロジェクトが5〜20人規模では十数件に収まり、並べ替えの価値が小さい。ダッシュボードからのコメントは、課題画面を開けば同じことができる。どちらも後から足せる |
| D31 | Discord への webhook 通知（**本家に無い機能**） | 送信先のURLが Discord なら、本文を Discord の形（`{username, embeds:[...]}`）に変換して送る。それ以外は本家と同じ形のJSONのまま | 本家寄りの形は最上位の `content` がオブジェクトだが、**Discord は `content` を文字列として読む**ため、そのまま送ると `Could not interpret "{...}" as string` で HTTP 400 になる（実測）。受け口を変えられない以上、送る側で形を変えるしかない。`/slack` `/github` の互換エンドポイントは Discord 側が解釈するので手を出さない |
| D32 | webhook の再試行 | 4xx（429を除く）は**再試行しない**。5xx とタイムアウトだけ再試行する | 本文の形が違う・URLが失効している類のエラーは何度送っても同じ結果にしかならない。実際に Discord の 400 を延々と繰り返していた |
| D33 | ガントの日付ヘッダを2段にする | 上段に月の帯（`2026年9月`）、下段に日付。**日スケールでは日付だけ**（`14`）を出し、週・月・四半期スケールは間引くので `M/D` のまま | 1マス22pxに対し `12/31` は25px必要で、**はみ出して隣のラベルと重なっていた**（ブラウザで実測）。`9/14` でも隙間が2.5pxしかなく窮屈だった。月は帯で分かるので情報は落ちない。**本家のヘッダの体裁は一次情報に記述が無く、確認できていない**ので「本家と同じ」とは書かない。なおタイムスケールが日・週・月・四半期の4種である点はヘルプで確認済み |
| D16 | Wiki の同時編集 | 楽観ロックで競合を警告する | 本家の更新APIに楽観ロック用の引数が無く、後勝ちと思われる。設計書(01-design.md 4.6)が「楽観ロック＋競合警告」を求めているのでそちらに従う。APIでは引数を任意にして、省略時は本家と同じ後勝ちにする |

### 10.3 まだ確認できていないこと

以下は一次情報にあたっても答えが出ていない。実装で必要になったら再調査する。

- `TODO(要確認)`: 標準4状態（Open以外）の本家での色と displayOrder
- `TODO(要確認)`: 本家がゲストをどのAPIフィールドで判別しているか
- `TODO(要確認)`: プロジェクト作成時に本家が自動生成するマスタの内容
- `TODO(要確認)`: 添付ファイルのサイズ上限
- `TODO(要確認)`: 状態を「完了」にするとき完了理由が必須か
- `TODO(要確認)`: 課題一覧の `sort` の既定値
- `TODO(要確認)`: 課題を削除したとき子課題がどうなるか
- `TODO(要確認)`: `keyword` 検索が見る範囲（件名・詳細・コメントのどこまでか）
- `TODO(要確認)`: 変更履歴に記録されるフィールドの網羅
- `TODO(要確認)`: 課題が複数のマイルストーンを持つとき、ガントはどの終了日に帯を出すか
- `TODO(要確認)`: ガントの四半期スケールの区切り方（暦の四半期か、表示開始日からか）
