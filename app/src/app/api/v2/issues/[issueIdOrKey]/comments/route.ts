import { prisma } from "@/lib/db";
import { apiRoute, findIssue } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { serializeComment } from "@/lib/api/serialize";
import { updateIssue } from "@/lib/issue";
import { can } from "@/lib/permissions";

/** GET /api/v2/issues/:issueIdOrKey/comments */
export const GET = apiRoute<{ issueIdOrKey: string }>(async (req, ctx, params) => {
  const issue = await findIssue(params.issueIdOrKey, ctx);
  const url = new URL(req.url);
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get("count") || 20)));
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const activities = await prisma.activity.findMany({
    where: { issueId: issue.id },
    include: { user: true },
    orderBy: { createdAt: order },
    take: count,
  });
  return activities.map(serializeComment);
});

/** POST /api/v2/issues/:issueIdOrKey/comments */
export const POST = apiRoute<{ issueIdOrKey: string }>(async (req, ctx, params) => {
  const issue = await findIssue(params.issueIdOrKey, ctx);

  const form = await req.formData().catch(() => null);
  const body = form
    ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
    : ((await req.json().catch(() => ({}))) as Record<string, unknown>);

  const content = String(body.content ?? "").trim();
  if (!content) throw ApiError.invalid("content is required.");

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: issue.projectId, userId: ctx.user.id } },
  });
  const allowed = can(ctx.user, "comment.manage", {
    projectId: issue.projectId,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  });
  if (!allowed) throw ApiError.denied();

  await updateIssue({ issueId: issue.id, updatedBy: ctx.user.id, comment: content });

  const latest = await prisma.activity.findFirstOrThrow({
    where: { issueId: issue.id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
  return serializeComment(latest);
});
