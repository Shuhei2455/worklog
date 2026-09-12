import { prisma } from "@/lib/db";
import { apiRoute } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { serializeIssue } from "@/lib/api/serialize";
import { parseIssueFilter, buildIssueWhere, buildIssueOrderBy } from "@/lib/issue-filter";
import { searchIssueIds, searchAvailable } from "@/lib/search";
import { createIssue } from "@/lib/issue";
import { can } from "@/lib/permissions";
import { DEFAULT_PRIORITY_ID } from "@/lib/constants";

/** 課題の表示名を引くための辞書 */
async function nameMaps(projectIds: number[]) {
  const [cats, vers] = await Promise.all([
    prisma.category.findMany({ where: { projectId: { in: projectIds } } }),
    prisma.version.findMany({ where: { projectId: { in: projectIds } } }),
  ]);
  return {
    categories: new Map(cats.map((c) => [c.id, c.name])),
    versions: new Map(vers.map((v) => [v.id, { name: v.name, description: v.description }])),
  };
}

const include = {
  project: { select: { key: true } },
  issueType: true,
  status: true,
  assignee: true,
  creator: true,
  updater: true,
  categories: true,
  milestones: true,
  versions: true,
} as const;

/**
 * GET /api/v2/issues
 * フィルタは画面と同じ buildIssueWhere を通す。別に組み立てない。
 */
export const GET = apiRoute(async (req, ctx) => {
  const url = new URL(req.url);
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (key === "apiKey") continue;
    // 本家は projectId[]=1&projectId[]=2 の形。[] を外して受ける
    const name = key.replace(/\[\]$/, "");
    params[name] = url.searchParams.getAll(key);
  }

  const filter = parseIssueFilter(params);
  let keywordIds: number[] | undefined;
  if (filter.keyword && (await searchAvailable())) {
    keywordIds = await searchIssueIds(filter.keyword, ctx.visibleProjectIds);
  }
  const where = buildIssueWhere(filter, ctx.visibleProjectIds, keywordIds);

  const issues = await prisma.issue.findMany({
    where,
    orderBy: buildIssueOrderBy(filter),
    skip: filter.offset,
    take: filter.count,
    include,
  });
  const names = await nameMaps([...new Set(issues.map((i) => i.projectId))]);
  return issues.map((i) => serializeIssue(i, names));
});

/**
 * POST /api/v2/issues
 * 必須は projectId / summary / issueTypeId / priorityId の4つ
 */
export const POST = apiRoute(async (req, ctx) => {
  const form = await req.formData().catch(() => null);
  const body = form
    ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
    : ((await req.json().catch(() => ({}))) as Record<string, unknown>);

  const projectId = Number(body.projectId);
  const summary = String(body.summary ?? "").trim();
  const issueTypeId = Number(body.issueTypeId);
  const priorityId = Number(body.priorityId ?? DEFAULT_PRIORITY_ID);

  if (!Number.isInteger(projectId)) throw ApiError.invalid("projectId is required.");
  if (!summary) throw ApiError.invalid("summary is required.");
  if (!Number.isInteger(issueTypeId)) throw ApiError.invalid("issueTypeId is required.");
  if (![2, 3, 4].includes(priorityId)) throw ApiError.invalid("priorityId is invalid.");

  if (!ctx.visibleProjectIds.includes(projectId)) throw ApiError.notFound("project");

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ctx.user.id } },
  });
  const allowed = can(ctx.user, "issue.create", {
    projectId,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  });
  if (!allowed) throw ApiError.denied();

  const created = await createIssue({
    projectId,
    summary,
    description: body.description ? String(body.description) : undefined,
    issueTypeId,
    priorityId,
    assigneeId: body.assigneeId ? Number(body.assigneeId) : null,
    startDate: body.startDate ? new Date(String(body.startDate)) : null,
    dueDate: body.dueDate ? new Date(String(body.dueDate)) : null,
    createdBy: ctx.user.id,
  });

  const full = await prisma.issue.findUniqueOrThrow({
    where: { id: created.id },
    include,
  });
  return serializeIssue(full, await nameMaps([full.projectId]));
});
