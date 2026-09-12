/**
 * 内部の変更差分 → 本家の形。
 *
 * 内部では `[{ field, from, to }]` で持っている（読んで分かる形にしてある）。
 * 一方、本家が webhook と活動APIで返すのは
 * `[{ field, new_value, old_value, type }]`（00-spec-verified.md 9.4）。
 * 外に出すときだけここで写像する。ACTIVITY_TYPE_ID と同じ考え方。
 *
 * **キー名を合わせないと、本家向けに作られた受け側がそのまま動かない。**
 * これが webhook を本家の形にしている唯一の理由なので、ここは妥協しない。
 */

/**
 * 内部のフィールド名 → 本家の `field` の値。
 *
 * 一次情報で確認できたのは `status` と `milestone` の2つだけ
 * （Get Project Recent Updates のレスポンス例）。
 * 残りはヘルプセンターに一覧があるはずだが、そのページは機械的に取得できない
 * （HTTP 403）。内部名から `Id` / `Ids` を落とした形を暫定で使っている。
 *
 * TODO(要確認): status / milestone 以外の `field` の値。
 *   特に次の2つは本家が別名を使っている可能性が高い:
 *     - 担当者: `assignee` か `assigner` か
 *     - 期限日: `dueDate` か `limitDate` か
 *   確認先: https://support-ja.backlog.com/hc/ja/articles/360036147713-Webhook
 */
const FIELD_NAME: Record<string, string> = {
  summary: "summary",
  description: "description",
  // 確認済み
  statusId: "status",
  // 確認済み
  milestoneIds: "milestone",
  // 以下は未確認（上の TODO）
  resolutionId: "resolution",
  priorityId: "priority",
  issueTypeId: "issueType",
  assigneeId: "assignee",
  parentIssueId: "parentIssue",
  startDate: "startDate",
  dueDate: "dueDate",
  estimatedHours: "estimatedHours",
  actualHours: "actualHours",
  categoryIds: "category",
  versionIds: "version",
};

export type BacklogChange = {
  field: string;
  new_value: string;
  old_value: string;
  /** 本家は標準項目で "standard"。カスタム属性(M5)は別の値になる想定 */
  type: string;
};

type InternalChange = { field: string; from: string | null; to: string | null };

function isInternalChange(x: unknown): x is InternalChange {
  return typeof x === "object" && x !== null && "field" in x;
}

/** 活動1件の changes を本家の形に直す。changes が無い活動では空配列 */
export function toBacklogChanges(changes: unknown): BacklogChange[] {
  if (!Array.isArray(changes)) return [];
  return changes.filter(isInternalChange).map((c) => ({
    // 知らないフィールドは内部名のまま出す。黙って落とすと
    // 受け側が「変更が無かった」と誤解する
    field: FIELD_NAME[c.field] ?? c.field,
    // 本家は値を文字列で返す。未設定は空文字（null ではない）
    new_value: c.to ?? "",
    old_value: c.from ?? "",
    type: "standard",
  }));
}
