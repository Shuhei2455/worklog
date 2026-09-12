import { prisma } from "@/lib/db";
import { apiRoute, findIssue } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { serializeIssue } from "@/lib/api/serialize";
import { updateIssue } from "@/lib/issue";
import { can } from "@/lib/permissions";

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

async function nameMaps(projectId: number) {
  const [cats, vers] = await Promise.all([
    prisma.category.findMany({ where: { projectId } }),
    prisma.version.findMany({ where: { projectId } }),
  ]);
  return {
    categories: new Map(cats.map((c) => [c.id, c.name])),
    versions: new Map(vers.map((v) => [v.id, { name: v.name, description: v.description }])),
  };
}

/**
 * カスタム属性の定義と値。
 *
 * 単体取得のときだけ引く。一覧で課題ごとに引くと件数ぶんクエリが出るので、
 * 一覧のレスポンスでは `customFields: []` のまま返す
 * （本家も一覧と単体で同じ構造だが、こちらは負荷を優先した。意図的な相違）。
 */
async function customFieldsFor(projectId: number, issueId: number) {
  const { loadFieldDefs, applicableTo } = await import("@/lib/custom-field-form");
  const [defs, rows, issue] = await Promise.all([
    loadFieldDefs(projectId),
    prisma.issueCustomFieldValue.findMany({ where: { issueId } }),
    prisma.issue.findUniqueOrThrow({
      where: { id: issueId },
      select: { issueTypeId: true },
    }),
  ]);
  return {
    customFields: applicableTo(defs, issue.issueTypeId),
    customFieldValues: Object.fromEntries(rows.map((r) => [r.customFieldId, r.value])),
  };
}

/** GET /api/v2/issues/:issueIdOrKey */
export const GET = apiRoute<{ issueIdOrKey: string }>(async (_req, ctx, params) => {
  const found = await findIssue(params.issueIdOrKey, ctx);
  const full = await prisma.issue.findUniqueOrThrow({ where: { id: found.id }, include });
  return serializeIssue(full, {
    ...(await nameMaps(full.projectId)),
    ...(await customFieldsFor(full.projectId, full.id)),
  });
});

/**
 * PATCH /api/v2/issues/:issueIdOrKey
 * 本家と同じく comment を一緒に送れる。変更履歴は1件にまとまる。
 */
export const PATCH = apiRoute<{ issueIdOrKey: string }>(async (req, ctx, params) => {
  const found = await findIssue(params.issueIdOrKey, ctx);

  const form = await req.formData().catch(() => null);
  const body = form
    ? Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
    : ((await req.json().catch(() => ({}))) as Record<string, unknown>);

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: found.projectId, userId: ctx.user.id } },
  });
  const resource = {
    projectId: found.projectId,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  };

  const changing = ["summary", "description", "statusId", "priorityId", "assigneeId",
                    "resolutionId", "startDate", "dueDate"].some((k) => k in body);
  if (changing && !can(ctx.user, "issue.edit", resource)) throw ApiError.denied();
  if (!changing && body.comment && !can(ctx.user, "comment.manage", resource)) {
    throw ApiError.denied();
  }

  const patch: Record<string, unknown> = { issueId: found.id, updatedBy: ctx.user.id };
  if (body.summary !== undefined) patch.summary = String(body.summary);
  if (body.description !== undefined) patch.description = String(body.description);
  if (body.statusId !== undefined) patch.statusId = Number(body.statusId);
  if (body.priorityId !== undefined) patch.priorityId = Number(body.priorityId);
  if (body.resolutionId !== undefined) patch.resolutionId = Number(body.resolutionId);
  if (body.assigneeId !== undefined) {
    patch.assigneeId = String(body.assigneeId) === "" ? null : Number(body.assigneeId);
  }
  if (body.startDate !== undefined) {
    patch.startDate = body.startDate ? new Date(String(body.startDate)) : null;
  }
  if (body.dueDate !== undefined) {
    patch.dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
  }
  if (body.comment) patch.comment = String(body.comment);

  await updateIssue(patch as Parameters<typeof updateIssue>[0]);

  const full = await prisma.issue.findUniqueOrThrow({ where: { id: found.id }, include });
  return serializeIssue(full, {
    ...(await nameMaps(full.projectId)),
    ...(await customFieldsFor(full.projectId, full.id)),
  });
});
