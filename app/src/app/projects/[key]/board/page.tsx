import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext, visibleProjectIds } from "@/lib/session";
import { parseIssueFilter, buildIssueWhere } from "@/lib/issue-filter";
import { Shell } from "@/components/Shell";
import { saveFilter } from "../issues/actions";
import { BoardClient, type Card } from "./BoardClient";

/**
 * ボード（カンバン）。
 *
 * 本家の制約(docs/00-spec-verified.md 6章):
 * - ボードは全プロジェクトで使える。ガントと違い設定のON/OFFが無い
 * - プロジェクト内の全課題が出る。完了課題も出る
 * - 絞り込みは 種別・カテゴリー・マイルストーン・担当者 の4つだけ。
 *   **状態では絞れない**（列そのものが状態のため）
 * - **各条件は単一選択。複数指定できない**
 * - カードの表示項目は固定
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "issue.view", ctx)) notFound();

  const visible = await visibleProjectIds(user.id);

  // 一覧と同じ buildIssueWhere を通す。ボード用に別の組み立てをすると
  // 同じバグを踏む(docs/01-design.md 5章)。
  // 状態での絞り込みは受け付けないので、statusId は落としてから渡す
  const { statusId: _ignored, sort: _s, order: _o, ...boardParams } = sp;
  const filter = parseIssueFilter({
    ...boardParams,
    projectId: String(project.id),
    count: "100",
  });
  const where = buildIssueWhere(filter, visible);

  const [statuses, issues, issueTypes, categories, versions, members] =
    await Promise.all([
      prisma.status.findMany({
        where: { projectId: project.id },
        orderBy: { displayOrder: "asc" },
      }),
      prisma.issue.findMany({
        where,
        // 並び順は board_order。同値のときは課題キー順で安定させる
        orderBy: [{ boardOrder: "asc" }, { keyId: "asc" }],
        include: { assignee: { select: { name: true } } },
        take: 500,
      }),
      prisma.issueType.findMany({
        where: { projectId: project.id },
        orderBy: { displayOrder: "asc" },
      }),
      prisma.category.findMany({
        where: { projectId: project.id },
        orderBy: { displayOrder: "asc" },
      }),
      prisma.version.findMany({
        where: { projectId: project.id },
        orderBy: { displayOrder: "asc" },
      }),
      prisma.projectMember.findMany({
        where: { projectId: project.id },
        include: { user: true },
      }),
    ]);

  const cards: Card[] = issues.map((i) => ({
    id: i.id,
    keyId: i.keyId,
    summary: i.summary,
    assigneeName: i.assignee?.name ?? null,
    dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
    statusId: i.statusId,
  }));

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "ボード" },
      ]}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ボード</h1>
        <div className="flex gap-3 text-sm">
          <Link href={`/projects/${key}/issues`} className="text-brand-700 hover:underline">
            課題一覧
          </Link>
          {project.chartEnabled && (
            <Link href={`/projects/${key}/gantt`} className="text-brand-700 hover:underline">
              ガントチャート
            </Link>
          )}
        </div>
      </div>

      {/*
        絞り込みは4つだけで増やせない。各条件は単一選択。
        状態では絞れない（列そのものが状態）
      */}
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
        {[
          ["issueTypeId", "種別", issueTypes.map((t) => [t.id, t.name] as const)],
          ["categoryId", "カテゴリー", categories.map((c) => [c.id, c.name] as const)],
          ["milestoneId", "マイルストーン", versions.map((v) => [v.id, v.name] as const)],
          ["assigneeId", "担当者", members.map((m) => [m.userId, m.user.name] as const)],
        ].map(([name, label, opts]) => (
          <label key={name as string}>
            <span className="block text-xs text-slate-500">{label as string}</span>
            <select
              name={name as string}
              defaultValue={(sp[name as string] as string) ?? ""}
              className="mt-1 rounded border border-slate-300 px-2 py-1"
            >
              <option value="">すべて</option>
              {(opts as ReadonlyArray<readonly [number, string]>).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button className="h-8 rounded border border-slate-300 px-4 hover:bg-slate-50">
          絞り込む
        </button>
        <Link
          href={`/projects/${key}/board`}
          className="h-8 rounded border border-slate-300 px-4 leading-8 hover:bg-slate-50"
        >
          クリア
        </Link>
        <p className="w-full text-xs text-slate-500">
          絞り込めるのはこの4つだけです（本家と同じ）。状態は列そのものなので条件になりません。
        </p>
      </form>

      {/* 本家もボードから検索条件を保存できる */}
      <form
        action={saveFilter.bind(null, key)}
        className="mt-2 flex items-center gap-2 text-xs"
      >
        <input type="hidden" name="from" value="board" />
        <input
          type="hidden"
          name="query"
          value={new URLSearchParams(
            Object.entries(sp).filter(
              ([, v]) => typeof v === "string" && v !== "",
            ) as [string, string][],
          ).toString()}
        />
        <input
          name="name"
          placeholder="この条件に名前を付けて保存"
          className="w-56 rounded border border-slate-300 px-2 py-1"
        />
        <button className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">
          保存
        </button>
      </form>

      <BoardClient
        projectKey={key}
        columns={statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
        initialCards={cards}
        canEdit={can(user, "issue.edit", ctx)}
        canCreate={can(user, "issue.create", ctx)}
      />

      <p className="text-xs text-slate-500">
        カードをドラッグすると状態が変わり、活動履歴にも残ります。同じ列の中で動かすと並び順だけが変わります。
      </p>
    </Shell>
  );
}
