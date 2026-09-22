import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { buildIssueWhere, issueFilterSchema } from "@/lib/issue-filter";
import { resolveGanttBar } from "@/lib/gantt";
import { buildCsv } from "@/lib/csv";
import { PRIORITIES } from "@/lib/constants";

/**
 * GET /projects/:key/gantt/export
 *
 * ガントの内容をCSVで出す（決定 D22: xlsx は作らない）。
 * 帯の見た目は再現しないが、**どの課題がいつからいつまでか**という
 * ガントの中身はそのまま持ち出せる。Excelで開いて再集計できる。
 *
 * 表示条件は画面と同じ `resolveGanttBar` を使う。別に判定を書くと、
 * 画面に出ている課題とCSVの中身が食い違う。
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
  if (!project.chartEnabled) {
    return new Response("チャートが無効です", { status: 400 });
  }

  const url = new URL(req.url);
  const filter = issueFilterSchema.parse(Object.fromEntries(url.searchParams));

  const issues = await prisma.issue.findMany({
    where: buildIssueWhere(filter, [project.id]),
    orderBy: [{ startDate: "asc" }, { dueDate: "asc" }, { keyId: "asc" }],
    include: {
      status: true,
      issueType: true,
      assignee: true,
      milestones: { include: { version: true } },
    },
    take: 5000,
  });

  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  const rows: Array<Array<string | number | null>> = [
    [
      "タスクキー",
      "件名",
      "種別",
      "状態",
      "担当者",
      "優先度",
      "開始",
      "終了",
      "日数",
      "帯の由来",
      "マイルストーン",
    ],
  ];

  for (const i of issues) {
    const bar = resolveGanttBar({
      startDate: i.startDate,
      dueDate: i.dueDate,
      statusId: i.statusId,
      completedAt: i.completedAt,
      milestoneReleaseDueDates: i.milestones.map((m) => m.version.releaseDueDate),
    });
    // 画面に出ない課題はCSVにも出さない
    if (!bar) continue;

    const days =
      Math.round((bar.to.getTime() - bar.from.getTime()) / 86_400_000) + 1;

    rows.push([
      `${project.key}-${i.keyId}`,
      i.summary,
      i.issueType.name,
      i.status.name,
      i.assignee?.name ?? "",
      PRIORITIES.find((p) => p.id === i.priorityId)?.label ?? "",
      day(bar.from),
      day(bar.to),
      days,
      // 「なぜこの期間なのか」が分からないと、Excel側で直すときに迷う
      bar.kind,
      i.milestones.map((m) => m.version.name).join(" / "),
    ]);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        `${project.key}-gantt-${stamp}.csv`,
      )}`,
    },
  });
}
