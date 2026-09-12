import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { buildIssueWhere, buildIssueOrderBy, issueFilterSchema } from "@/lib/issue-filter";
import { issuesToCsv, type IssueRow } from "@/lib/issue-csv";
import { loadFieldDefs } from "@/lib/custom-field-form";

/**
 * GET /projects/:key/issues/export?<一覧と同じ絞り込み>
 *
 * **一覧と同じ絞り込みをそのまま使う。** `buildIssueWhere` を共有しているので、
 * 画面で見ている条件と出てくる内容がずれない（CLAUDE.md の集約方針）。
 *
 * API v2 ではないので apiRoute() は通さない（画面からのダウンロード）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await params;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
  if (!project) return new Response("not found", { status: 404 });

  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "issue.view", ctx)) return new Response("not found", { status: 404 });

  const url = new URL(req.url);
  const filter = issueFilterSchema.parse(Object.fromEntries(url.searchParams));

  const issues = await prisma.issue.findMany({
    where: buildIssueWhere(filter, [project.id]),
    orderBy: buildIssueOrderBy(filter),
    include: {
      status: true,
      issueType: true,
      assignee: true,
      creator: true,
      parent: { select: { keyId: true } },
      categories: true,
      milestones: true,
      versions: true,
      customFieldValues: true,
    },
    // 上限を置く。無制限にすると、事故で全社ぶんを1ファイルにしてしまう
    take: 5000,
  });

  const [categories, versions, fields] = await Promise.all([
    prisma.category.findMany({ where: { projectId: project.id } }),
    prisma.version.findMany({ where: { projectId: project.id } }),
    loadFieldDefs(project.id),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const verName = new Map(versions.map((v) => [v.id, v.name]));

  const rows: IssueRow[] = issues.map((i) => ({
    issueKey: `${project.key}-${i.keyId}`,
    summary: i.summary,
    description: i.description,
    statusName: i.status.name,
    issueTypeName: i.issueType.name,
    priorityId: i.priorityId,
    assigneeName: i.assignee?.name ?? null,
    resolutionId: i.resolutionId,
    startDate: i.startDate,
    dueDate: i.dueDate,
    estimatedHours: i.estimatedHours,
    actualHours: i.actualHours,
    parentIssueKey: i.parent ? `${project.key}-${i.parent.keyId}` : null,
    categoryNames: i.categories.map((c) => catName.get(c.categoryId) ?? ""),
    milestoneNames: i.milestones.map((m) => verName.get(m.versionId) ?? ""),
    versionNames: i.versions.map((v) => verName.get(v.versionId) ?? ""),
    creatorName: i.creator.name,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    customValues: Object.fromEntries(
      i.customFieldValues.map((v) => [v.customFieldId, v.value]),
    ),
  }));

  const csv = issuesToCsv(rows, fields);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      // charset は書かない。BOM を付けてあるので Excel はそれで判断する
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        `${project.key}-issues-${stamp}.csv`,
      )}`,
    },
  });
}
