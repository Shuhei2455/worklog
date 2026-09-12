import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { PR_STATUS } from "@/lib/api/serialize";

/**
 * プルリクエスト一覧の絞り込み。
 *
 * 一覧と件数の2つのルートが同じ条件を使う。課題一覧の `buildIssueWhere` と
 * 同じ方針で、条件の組み立てを1か所に集める
 * （分散させると一覧と件数がずれる）。
 *
 * 受け取るパラメータは本家に合わせる（00-spec-verified.md 4.1）:
 *   statusId[] / assigneeId[] / issueId[] / createdUserId[] / offset / count
 */

/** 1件ずつ `.catch()` を付ける。1つ壊れた値で全条件が消えるのを避ける（M1のバグ） */
const schema = z.object({
  statusId: z.array(z.coerce.number().int()).catch([]),
  assigneeId: z.array(z.coerce.number().int()).catch([]),
  issueId: z.array(z.coerce.number().int()).catch([]),
  createdUserId: z.array(z.coerce.number().int()).catch([]),
  offset: z.coerce.number().int().min(0).catch(0),
  // 本家と同じ 1〜100、既定20
  count: z.coerce.number().int().min(1).max(100).catch(20),
});

export type PullRequestQuery = z.infer<typeof schema>;

/** 状態の整数 → 内部の文字列。決定 D20 の逆写像 */
const STATE_BY_ID = new Map(
  Object.entries(PR_STATUS).map(([state, v]) => [v.id, state]),
);

export function pullRequestQuery(sp: URLSearchParams): PullRequestQuery {
  // 本家は `statusId[]=1&statusId[]=2` の形。`statusId=1` も受ける
  const many = (name: string) => [
    ...sp.getAll(`${name}[]`),
    ...sp.getAll(name),
  ];

  return schema.parse({
    statusId: many("statusId"),
    assigneeId: many("assigneeId"),
    issueId: many("issueId"),
    createdUserId: many("createdUserId"),
    offset: sp.get("offset") ?? undefined,
    count: sp.get("count") ?? undefined,
  });
}

export function pullRequestWhere(
  repositoryId: number,
  q: PullRequestQuery,
): Prisma.PullRequestWhereInput {
  const states = q.statusId
    .map((id) => STATE_BY_ID.get(id))
    .filter((s): s is string => Boolean(s));

  return {
    repositoryId,
    ...(states.length > 0 ? { state: { in: states } } : {}),
    ...(q.assigneeId.length > 0 ? { assigneeId: { in: q.assigneeId } } : {}),
    ...(q.issueId.length > 0 ? { issueId: { in: q.issueId } } : {}),
    ...(q.createdUserId.length > 0 ? { createdById: { in: q.createdUserId } } : {}),
  };
}
