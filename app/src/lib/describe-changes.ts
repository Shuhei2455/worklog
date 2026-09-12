import { PRIORITIES, RESOLUTIONS } from "@/lib/constants";
import type { Change } from "@/lib/issue";

/**
 * 変更差分JSONBを日本語ラベルに解決する。
 *
 * **表示側はこの関数だけを使う。** 課題詳細・通知・アクティビティ一覧・
 * メール本文が全部ここを通るので、ラベルの揺れが起きない。
 *
 * `changes` は `[{ field, from, to }]` の配列。
 * 値は文字列で入っているので、idを名前に解決するための辞書を渡してもらう。
 */

/** id → 名前 の辞書。プロジェクトごとに違うマスタはこれで引く */
export type ChangeLookups = {
  statuses?: Map<number, string>;
  issueTypes?: Map<number, string>;
  users?: Map<number, string>;
  categories?: Map<number, string>;
  versions?: Map<number, string>;
  issues?: Map<number, string>;
};

export type DescribedChange = {
  /** 「状態」「担当者」など */
  label: string;
  /** 変更前。未設定なら null */
  from: string | null;
  /** 変更後。未設定なら null */
  to: string | null;
};

/** フィールド名 → 日本語ラベル */
const FIELD_LABELS: Record<string, string> = {
  summary: "件名",
  description: "詳細",
  statusId: "状態",
  resolutionId: "完了理由",
  priorityId: "優先度",
  issueTypeId: "種別",
  assigneeId: "担当者",
  parentIssueId: "親課題",
  startDate: "開始日",
  dueDate: "期限日",
  estimatedHours: "予定時間",
  actualHours: "実績時間",
  categoryIds: "カテゴリー",
  milestoneIds: "マイルストーン",
  versionIds: "発生バージョン",
};

const PRIORITY_LABELS = new Map(PRIORITIES.map((p) => [p.id, p.label]));
const RESOLUTION_LABELS = new Map(RESOLUTIONS.map((r) => [r.id, r.label]));

/** "1,2,3" のような複数値を名前の並びに直す */
function resolveList(
  raw: string | null,
  dict: Map<number, string> | undefined,
): string | null {
  if (!raw) return null;
  const names = raw
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n))
    .map((id) => dict?.get(id) ?? `#${id}`);
  return names.length ? names.join("、") : null;
}

function resolveOne(
  raw: string | null,
  dict: Map<number, string> | undefined,
): string | null {
  if (raw === null || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return raw;
  return dict?.get(id) ?? `#${id}`;
}

/** 1件の差分を日本語に直す */
function describeOne(c: Change, lookups: ChangeLookups): DescribedChange {
  const label = FIELD_LABELS[c.field] ?? c.field;

  switch (c.field) {
    case "statusId":
      return { label, from: resolveOne(c.from, lookups.statuses), to: resolveOne(c.to, lookups.statuses) };
    case "issueTypeId":
      return { label, from: resolveOne(c.from, lookups.issueTypes), to: resolveOne(c.to, lookups.issueTypes) };
    case "assigneeId":
      return { label, from: resolveOne(c.from, lookups.users), to: resolveOne(c.to, lookups.users) };
    case "parentIssueId":
      return { label, from: resolveOne(c.from, lookups.issues), to: resolveOne(c.to, lookups.issues) };
    case "priorityId":
      return { label, from: resolveOne(c.from, PRIORITY_LABELS), to: resolveOne(c.to, PRIORITY_LABELS) };
    case "resolutionId":
      return { label, from: resolveOne(c.from, RESOLUTION_LABELS), to: resolveOne(c.to, RESOLUTION_LABELS) };
    case "categoryIds":
      return { label, from: resolveList(c.from, lookups.categories), to: resolveList(c.to, lookups.categories) };
    case "milestoneIds":
    case "versionIds":
      return { label, from: resolveList(c.from, lookups.versions), to: resolveList(c.to, lookups.versions) };
    case "description":
      // 詳細は長いので中身を出さない。本家も差分表示はしない
      return { label, from: c.from ? "（変更前）" : null, to: c.to ? "（変更後）" : null };
    default:
      return { label, from: c.from, to: c.to };
  }
}

/**
 * 変更差分を日本語ラベルの配列に解決する。
 *
 * 未知のフィールドが来てもフィールド名をそのまま出して落とさない。
 * `changes` はJSONBで、あとからフィールドが増えるため。
 */
export function describeChanges(
  changes: unknown,
  lookups: ChangeLookups = {},
): DescribedChange[] {
  if (!Array.isArray(changes)) return [];
  return changes
    .filter(
      (c): c is Change =>
        typeof c === "object" && c !== null && typeof (c as Change).field === "string",
    )
    .map((c) => describeOne(c, lookups));
}

/** 1行の文にする。通知やメールの件名で使う */
export function summarizeChanges(described: DescribedChange[]): string {
  if (described.length === 0) return "";
  return described
    .map((d) => `${d.label}を${d.from ?? "未設定"}から${d.to ?? "未設定"}に変更`)
    .join("、");
}
