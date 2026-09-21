import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  parseCustomFieldFilters,
  customFieldWhere,
  type CustomFieldFilter,
} from "@/lib/custom-field-filter";

/**
 * 課題フィルタの正規化と Prisma の where 組み立て。
 *
 * **一覧・ボード・ガント・API・エクスポートは全部この関数を使うこと。**
 * ここを分散させると同じバグを4回踏む(docs/01-design.md 5章)。
 *
 * パラメータ名は本家APIに合わせる(docs/00-spec-verified.md 2章)。
 * URLクエリとしてそのまま共有できる形にしておくと、
 * 一覧のURLを貼るだけで同じ条件を再現できる。
 */

/** 本家の sort に指定できる値(00-spec-verified.md 2.1) */
export const SORT_KEYS = [
  "issueType",
  "category",
  "version",
  "milestone",
  "summary",
  "status",
  "priority",
  "attachment",
  "sharedFile",
  "created",
  "createdUser",
  "updated",
  "updatedUser",
  "assignee",
  "startDate",
  "dueDate",
  "estimatedHours",
  "actualHours",
  "childIssue",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** 決定 D11 / D12: 既定は updated の降順・20件 */
export const DEFAULT_SORT: SortKey = "updated";
export const DEFAULT_ORDER = "desc" as const;
export const DEFAULT_COUNT = 20;
export const MAX_COUNT = 100;

/** `parentChild` の値(00-spec-verified.md 2章) */
export const PARENT_CHILD = {
  all: 0,
  childOnly: 1,
  parentOnly: 2,
  notChild: 3,
  noChildren: 4,
} as const;

/** 数値配列。URLクエリは "1,2,3" でも ?a=1&a=2 でも受ける */
const numList = z
  .union([z.string(), z.array(z.string()), z.number(), z.array(z.number())])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : [v];
    const nums = arr
      .flatMap((x) => String(x).split(","))
      .map((x) => x.trim())
      // 空文字を先に落とす。Number("") は 0 で Number.isInteger(0) も真なので、
      // 落とさないと `?statusId=`（絞り込みの「すべて」）が「id=0で絞る」に化けて
      // 0件になる
      .filter((x) => x !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n));
    return nums.length ? nums : undefined;
  });

const boolish = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) =>
    v === undefined ? undefined : v === true || v === "true" || v === "1",
  );

const dateish = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  });

/**
 * URLクエリを正規化する。不正な値は落として既定に寄せる。
 * 例外を投げないのは、壊れたURLを踏んでも一覧が出る方が実用的だから。
 */
export const issueFilterSchema = z.object({
  projectId: numList,
  issueTypeId: numList,
  categoryId: numList,
  versionId: numList,
  milestoneId: numList,
  statusId: numList,
  priorityId: numList,
  assigneeId: numList,
  createdUserId: numList,
  resolutionId: numList,
  parentIssueId: numList,
  parentChild: z.coerce.number().int().min(0).max(4).optional(),
  attachment: boolish,
  sharedFile: boolish,
  keyword: z.string().trim().min(1).optional(),
  createdSince: dateish,
  createdUntil: dateish,
  updatedSince: dateish,
  updatedUntil: dateish,
  startDateSince: dateish,
  startDateUntil: dateish,
  dueDateSince: dateish,
  dueDateUntil: dateish,
  // .catch() を付けて、壊れた値はその項目だけ既定に落とす。
  // 付けないと safeParse 全体が失敗し、?count=500 のような1箇所の誤りで
  // statusId や keyword まで丸ごと失われる
  sort: z.enum(SORT_KEYS).catch(DEFAULT_SORT),
  order: z.enum(["asc", "desc"]).catch(DEFAULT_ORDER),
  offset: z.coerce.number().int().min(0).catch(0),
  count: z.coerce.number().int().min(1).max(MAX_COUNT).catch(DEFAULT_COUNT),
});

export type IssueFilter = z.infer<typeof issueFilterSchema> & {
  /**
   * カスタム属性での絞り込み。
   *
   * パラメータ名が `customField_12_min` のように動的なので、
   * 固定の zod オブジェクトでは受けられない。別に解析して足す
   * （lib/custom-field-filter.ts）。
   */
  // 省略可。CSV出力のように固定条件で組み立てる箇所があるため
  customFields?: CustomFieldFilter[];
};

/**
 * 壊れた値を落としつつ、必ずフィルタを返す。
 *
 * 各項目に .catch() を付けてあるので、1箇所が壊れていても
 * 他の条件は生き残る。壊れたURLを踏んでも一覧が出る方が実用的。
 */
export function parseIssueFilter(
  params: Record<string, string | string[] | undefined>,
): IssueFilter {
  const customFields = parseCustomFieldFilters(params);
  const result = issueFilterSchema.safeParse(params);
  if (result.success) return { ...result.data, customFields };
  // ここには来ない想定だが、来ても既定で返す
  return { ...issueFilterSchema.parse({}), customFields };
}

/** 日付範囲を Prisma の gte/lte に畳む。両方 undefined なら undefined */
function range(since?: Date, until?: Date) {
  if (!since && !until) return undefined;
  return { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) };
}

/**
 * フィルタから Prisma の where を組む。
 *
 * `visibleProjectIds` は**呼び出し側が必ず渡す**。
 * 権限条件をクエリに注入しないと件数とページングが壊れる
 * (docs/01-design.md 5章)。省略可能にすると忘れるので必須引数にしてある。
 *
 * `keyword` は Meilisearch に投げて返ったIDで絞る二段構えにするため、
 * ここでは `keywordIssueIds` として受け取る。M1 では未接続で、
 * 件名・詳細の部分一致にフォールバックする。
 */
export function buildIssueWhere(
  filter: IssueFilter,
  visibleProjectIds: number[],
  keywordIssueIds?: number[],
): Prisma.IssueWhereInput {
  // 参加しているプロジェクトの中からさらに絞る。
  // filter.projectId が未参加のIDを含んでいても、この積で落ちる
  const projectIds = filter.projectId
    ? filter.projectId.filter((id) => visibleProjectIds.includes(id))
    : visibleProjectIds;

  const where: Prisma.IssueWhereInput = {
    projectId: { in: projectIds },
  };

  if (filter.issueTypeId) where.issueTypeId = { in: filter.issueTypeId };
  if (filter.statusId) where.statusId = { in: filter.statusId };
  if (filter.priorityId) where.priorityId = { in: filter.priorityId };
  if (filter.resolutionId) where.resolutionId = { in: filter.resolutionId };
  if (filter.createdUserId) where.createdBy = { in: filter.createdUserId };
  if (filter.parentIssueId) where.parentIssueId = { in: filter.parentIssueId };

  // 担当者は単一カラム。「未割り当て」を 0 で表せるようにする
  if (filter.assigneeId) {
    const ids = filter.assigneeId.filter((id) => id !== 0);
    const wantsUnassigned = filter.assigneeId.includes(0);
    if (wantsUnassigned && ids.length) {
      where.OR = [{ assigneeId: { in: ids } }, { assigneeId: null }];
    } else if (wantsUnassigned) {
      where.assigneeId = null;
    } else {
      where.assigneeId = { in: ids };
    }
  }

  // 多対多は中間テーブル越しに絞る
  if (filter.categoryId)
    where.categories = { some: { categoryId: { in: filter.categoryId } } };
  if (filter.milestoneId)
    where.milestones = { some: { versionId: { in: filter.milestoneId } } };
  if (filter.versionId)
    where.versions = { some: { versionId: { in: filter.versionId } } };

  // 親子の絞り込み(00-spec-verified.md 2章)
  switch (filter.parentChild) {
    case PARENT_CHILD.childOnly:
      where.parentIssueId = { not: null };
      break;
    case PARENT_CHILD.parentOnly:
      where.children = { some: {} };
      break;
    case PARENT_CHILD.notChild:
      where.parentIssueId = null;
      break;
    case PARENT_CHILD.noChildren:
      where.children = { none: {} };
      break;
    default:
      break;
  }

  if (filter.attachment !== undefined) {
    where.attachments = filter.attachment ? { some: {} } : { none: {} };
  }
  if (filter.sharedFile !== undefined) {
    where.sharedFiles = filter.sharedFile ? { some: {} } : { none: {} };
  }

  const created = range(filter.createdSince, filter.createdUntil);
  if (created) where.createdAt = created;
  const updated = range(filter.updatedSince, filter.updatedUntil);
  if (updated) where.updatedAt = updated;
  const start = range(filter.startDateSince, filter.startDateUntil);
  if (start) where.startDate = start;
  const due = range(filter.dueDateSince, filter.dueDateUntil);
  if (due) where.dueDate = due;

  // AND に積むものをまとめる。
  // **キーワードとカスタム属性が両方あるとき、片方で上書きしない**ようにする
  const and: Prisma.IssueWhereInput[] = [];

  if (keywordIssueIds) {
    where.id = { in: keywordIssueIds };
  } else if (filter.keyword) {
    // Meilisearch 未接続のあいだの代替。
    // TODO(M3): Meilisearch に投げて返ったIDで絞る二段構えにする
    and.push({
      OR: [
        { summary: { contains: filter.keyword, mode: "insensitive" } },
        { description: { contains: filter.keyword, mode: "insensitive" } },
      ],
    });
  }

  // カスタム属性は条件ごとに独立した some になる（組み合わせで絞るため）
  and.push(...(customFieldWhere(filter.customFields ?? []) as Prisma.IssueWhereInput[]));

  if (and.length > 0) where.AND = and;

  return where;
}

/** sort の値を Prisma の orderBy に写す */
export function buildIssueOrderBy(
  filter: IssueFilter,
): Prisma.IssueOrderByWithRelationInput[] {
  const dir = filter.order;
  const map: Partial<Record<SortKey, Prisma.IssueOrderByWithRelationInput>> = {
    issueType: { issueTypeId: dir },
    summary: { summary: dir },
    status: { statusId: dir },
    priority: { priorityId: dir },
    created: { createdAt: dir },
    updated: { updatedAt: dir },
    assignee: { assigneeId: dir },
    startDate: { startDate: dir },
    dueDate: { dueDate: dir },
    estimatedHours: { estimatedHours: dir },
    actualHours: { actualHours: dir },
    createdUser: { createdBy: dir },
    updatedUser: { updatedBy: dir },
  };

  // 「添付あり」「共有ファイルあり」「子課題あり」は件数で並べる。
  // 本家も有無での並べ替えなので、0件/1件以上の順序は一致する
  const byCount: Partial<Record<SortKey, Prisma.IssueOrderByWithRelationInput>> = {
    attachment: { attachments: { _count: dir } },
    sharedFile: { sharedFiles: { _count: dir } },
    childIssue: { children: { _count: dir } },
  };

  const primary = map[filter.sort] ?? byCount[filter.sort];

  // category / version / milestone は多対多で、値そのものでは並べられない。
  // 本家が何を基準に並べるか（先頭要素か、displayOrder か）は未確認なので、
  // 誤った並びを出すより既定に寄せる。
  // TODO(要確認): 本家の category/version/milestone の並べ替え基準

  // 並びが同値のときに順序がぶれるとページングで取りこぼす。
  // 必ず一意なキーを最後に足す
  return primary ? [primary, { id: dir }] : [{ updatedAt: dir }, { id: dir }];
}
