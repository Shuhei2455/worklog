/**
 * ダッシュボードの「自分の課題」の絞り込み。
 *
 * 本家の仕様（一次情報: backlog.com/ja/enterprise-help/userguide/userguide1171/）:
 *   - 全プロジェクト横断で、担当の課題が **10件** 表示される
 *   - 絞り込みは「担当 / 登録」と、期限日「全て / 4日以内 / 今日まで / 期限切れ」
 *
 * 期限日の境界は**日付**で持っている（DBは `date` 型）ので、
 * 時刻を落としてから比較する。時刻が混ざると「今日が期限」の課題が
 * 実行時刻によって出たり出なかったりする。
 */

/** 本家の表示件数 */
export const MY_ISSUES_LIMIT = 10;

export const DUE_FILTERS = ["all", "within4days", "today", "overdue"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

import type { MessageKey } from "@/lib/i18n";

export const DUE_FILTER_KEY: Record<DueFilter, MessageKey> = {
  all: "dash.dueAll",
  within4days: "dash.dueWithin4Days",
  today: "dash.dueToday",
  overdue: "dash.dueOverdue",
};

export function toDueFilter(v: unknown): DueFilter {
  return typeof v === "string" && (DUE_FILTERS as readonly string[]).includes(v)
    ? (v as DueFilter)
    : "all";
}

export const ROLE_FILTERS = ["assigned", "created"] as const;
export type RoleFilter = (typeof ROLE_FILTERS)[number];

export const ROLE_FILTER_KEY: Record<RoleFilter, MessageKey> = {
  assigned: "dash.roleAssigned",
  created: "dash.roleCreated",
};

export function toRoleFilter(v: unknown): RoleFilter {
  return v === "created" ? "created" : "assigned";
}

/** その日の 00:00（ローカル）に丸める */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * 期限日の Prisma `where` 断片を返す。
 *
 * `all` は期限なしの課題も含めたいので、条件そのものを出さない
 * （`dueDate: undefined` にすると Prisma が絞り込まない）。
 */
export function dueDateWhere(
  filter: DueFilter,
  today: Date,
): { dueDate?: { lt?: Date; lte?: Date } } {
  const t = startOfDay(today);
  switch (filter) {
    case "all":
      return {};
    // 「4日以内」は今日から数えて4日後まで。期限切れも急ぎなので含める
    case "within4days":
      return { dueDate: { lte: addDays(t, 4) } };
    case "today":
      return { dueDate: { lte: t } };
    case "overdue":
      return { dueDate: { lt: t } };
  }
}
