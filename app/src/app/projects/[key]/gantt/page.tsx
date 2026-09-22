import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext, visibleProjectIds } from "@/lib/session";
import { parseIssueFilter, buildIssueWhere } from "@/lib/issue-filter";
import {
  resolveGanttBar,
  defaultGanttStart,
  barOffset,
  ganttRangeDays,
  GANTT_GROUP_LABELS,
  type TimeScale,
  type GanttGroupBy,
  type GanttBar,
  ganttTicks,
  ganttMonthBands,
} from "@/lib/gantt";
import { Shell } from "@/components/Shell";
import { PageTitle, Button, ButtonLink, PillLink } from "@/components/ui";

/** 帯の色。種類ごとに変えて、なぜそこに出ているか分かるようにする */
const KIND_STYLE: Record<GanttBar["kind"], { bg: string; label: string }> = {
  range: { bg: "#1d4ed8", label: "開始日〜期限日" },
  startOnly: { bg: "#0f766e", label: "開始日のみ" },
  dueOnly: { bg: "#c2410c", label: "期限日のみ" },
  milestone: { bg: "#7c3aed", label: "マイルストーンの終了日" },
  completed: { bg: "#15803d", label: "完了日" },
};

const DAY_PX = 22;

export default async function GanttPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  // CSV出力へ渡すクエリ。画面の絞り込みをそのまま引き継ぐ
  const ganttQuery = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v === undefined
        ? []
        : Array.isArray(v)
          ? v.map((x) => [k, x] as [string, string])
          : [[k, v] as [string, string]],
    ),
  ).toString();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "issue.view", ctx)) notFound();

  // ガントはプロジェクト設定の「チャートを使用する」が有効なときだけ使える
  if (!project.chartEnabled) {
    return (
      <Shell
        user={user}
        project={{
          key: key,
          name: project.name,
          current: "gantt",
          show: {
            addIssue: can(user, "issue.create", ctx),
            wiki: project.wikiEnabled && can(user, "wiki.view", ctx),
            files: project.fileSharingEnabled && can(user, "sharedFile.access", ctx),
            chart: project.chartEnabled,
            git: project.gitEnabled && can(user, "git.access", ctx),
            settings: can(user, "project.edit", ctx) || can(user, "issueType.manage", ctx),
          },
        }}
      >
        <div className="flex items-baseline justify-between">
      <PageTitle>ガントチャート</PageTitle>
          <a
            href={`/projects/${key}/gantt/export`}
            className="text-sm text-brand-700 hover:underline"
          >
            CSV出力
          </a>
        </div>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このプロジェクトは「チャートを使用する」が無効です。
          <Link href={`/projects/${key}/settings`} className="ml-2 underline">
            プロジェクト設定
          </Link>
          で有効にしてください。
        </p>
      </Shell>
    );
  }

  const scale = (["day", "week", "month", "quarter"] as const).includes(
    sp.scale as TimeScale,
  )
    ? (sp.scale as TimeScale)
    : "day";
  const groupBy = (
    ["assignee", "issueType", "milestone", "category", "parentIssue"] as const
  ).includes(sp.groupBy as GanttGroupBy)
    ? (sp.groupBy as GanttGroupBy)
    : null;

  const rangeStart =
    typeof sp.start === "string" && !Number.isNaN(Date.parse(sp.start))
      ? new Date(sp.start + "T00:00:00")
      : defaultGanttStart();
  const days = ganttRangeDays(scale);

  const visible = await visibleProjectIds(user.id);
  // 絞り込みは一覧と同じ buildIssueWhere を通す。
  // ガント用に別の組み立てをすると同じバグを踏む
  const filter = parseIssueFilter({ ...sp, projectId: String(project.id), count: "100" });
  const where = buildIssueWhere(filter, visible);

  const [issues, statuses, issueTypes, categories, versions, members] =
    await Promise.all([
      prisma.issue.findMany({
        where,
        include: {
          status: true,
          issueType: true,
          assignee: true,
          parent: { select: { keyId: true, summary: true } },
          milestones: true,
          categories: true,
        },
        orderBy: [{ startDate: "asc" }, { dueDate: "asc" }, { keyId: "asc" }],
        take: 300,
      }),
      prisma.status.findMany({ where: { projectId: project.id }, orderBy: { displayOrder: "asc" } }),
      prisma.issueType.findMany({ where: { projectId: project.id }, orderBy: { displayOrder: "asc" } }),
      prisma.category.findMany({ where: { projectId: project.id }, orderBy: { displayOrder: "asc" } }),
      prisma.version.findMany({ where: { projectId: project.id }, orderBy: { displayOrder: "asc" } }),
      prisma.projectMember.findMany({ where: { projectId: project.id }, include: { user: true } }),
    ]);

  const versionById = new Map(versions.map((v) => [v.id, v]));
  const categoryById = new Map(categories.map((c) => [c.id, c.name]));

  // 帯を決める。判定は resolveGanttBar に集約してある
  const rows = issues.map((i) => ({
    issue: i,
    bar: resolveGanttBar({
      startDate: i.startDate,
      dueDate: i.dueDate,
      statusId: i.statusId,
      completedAt: i.completedAt,
      milestoneReleaseDueDates: i.milestones.map(
        (m) => versionById.get(m.versionId)?.releaseDueDate ?? null,
      ),
    }),
  }));

  const shown = rows.filter((r) => r.bar !== null);
  const hidden = rows.filter((r) => r.bar === null);

  // グルーピング
  const groupKey = (r: (typeof rows)[number]): string => {
    const i = r.issue;
    switch (groupBy) {
      case "assignee":
        return i.assignee?.name ?? "未割り当て";
      case "issueType":
        return i.issueType.name;
      case "milestone":
        return i.milestones.length
          ? i.milestones.map((m) => versionById.get(m.versionId)?.name ?? "?").join("、")
          : "マイルストーンなし";
      case "category":
        return i.categories.length
          ? i.categories.map((c) => categoryById.get(c.categoryId) ?? "?").join("、")
          : "カテゴリーなし";
      case "parentIssue":
        return i.parent ? `${key}-${i.parent.keyId} ${i.parent.summary}` : "親タスクなし";
      default:
        return "";
    }
  };

  const groups = new Map<string, typeof shown>();
  for (const r of shown) {
    const g = groupBy ? groupKey(r) : "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  // 目盛りと、その上に出す月の帯。
  // 日スケールで `9/14` を出すと 22px のマスからはみ出して隣と重なるので、
  // 日付だけにして月は帯で示す（lib/gantt.ts）
  const ticks = ganttTicks(rangeStart, days, scale);
  const monthBands = ganttMonthBands(rangeStart, days);

  const link = (over: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && v !== "") q.set(k, v);
    }
    for (const [k, v] of Object.entries(over)) {
      if (v === "") q.delete(k);
      else q.set(k, v);
    }
    return `?${q.toString()}`;
  };

  const width = days * DAY_PX;

  return (
    <Shell
      user={user}
      project={{
        key: key,
        name: project.name,
        current: "gantt",
        show: {
          addIssue: can(user, "issue.create", ctx),
          wiki: project.wikiEnabled && can(user, "wiki.view", ctx),
          files: project.fileSharingEnabled && can(user, "sharedFile.access", ctx),
          chart: project.chartEnabled,
          git: project.gitEnabled && can(user, "git.access", ctx),
          settings: can(user, "project.edit", ctx) || can(user, "issueType.manage", ctx),
        },
      }}
    >
      <div className="flex items-center justify-between">
        <PageTitle>ガントチャート</PageTitle>
        <div className="flex items-center gap-3">
          {/* 絞り込みを引き継ぐ。画面と同じ resolveGanttBar を使うので内容が一致する */}
          <a
            href={`/projects/${key}/gantt/export${ganttQuery ? `?${ganttQuery}` : ""}`}
            className="text-sm text-brand-700 hover:underline"
          >
            CSV出力
          </a>
        </div>
      </div>

      {/* 絞り込みは本家と同じ5つ: 種別・状態・カテゴリー・マイルストーン・担当者 */}
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
        <input type="hidden" name="scale" value={scale} />
        {groupBy && <input type="hidden" name="groupBy" value={groupBy} />}
        {[
          ["issueTypeId", "種別", issueTypes.map((t) => [t.id, t.name] as const)],
          ["statusId", "状態", statuses.map((s) => [s.id, s.name] as const)],
          ["categoryId", "カテゴリー", categories.map((c) => [c.id, c.name] as const)],
          ["milestoneId", "マイルストーン", versions.map((v) => [v.id, v.name] as const)],
          ["assigneeId", "担当者", members.map((m) => [m.userId, m.user.name] as const)],
        ].map(([name, label, opts]) => (
          <label key={name as string} className="max-w-full">
            <span className="block text-xs text-slate-500">{label as string}</span>
            <select
              name={name as string}
              defaultValue={(sp[name as string] as string) ?? ""}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 sm:w-auto"
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
        <label className="max-w-full">
          <span className="block text-xs text-slate-500">開始日</span>
          <input
            type="date"
            name="start"
            defaultValue={rangeStart.toISOString().slice(0, 10)}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <Button variant="secondary">
          適用
        </Button>
        <ButtonLink href={`/projects/${key}/gantt`} variant="secondary">
          クリア
        </ButtonLink>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="text-slate-500">タイムスケール</span>
        {(
          [
            ["day", "日"],
            ["week", "週"],
            ["month", "月"],
            ["quarter", "四半期"],
          ] as const
        ).map(([v, l]) => (
          <PillLink key={v} href={link({ scale: v })} active={scale === v}>
            {l}
          </PillLink>
        ))}

        <span className="ml-4 text-slate-500">グルーピング</span>
        <PillLink href={link({ groupBy: "" })} active={!groupBy}>
          なし
        </PillLink>
        {(Object.keys(GANTT_GROUP_LABELS) as GanttGroupBy[]).map((g) => (
          <PillLink key={g} href={link({ groupBy: g })} active={groupBy === g}>
            {GANTT_GROUP_LABELS[g]}
          </PillLink>
        ))}
      </div>

      {/* 帯の色の意味。なぜそこに出ているかが分かるようにする */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        {Object.entries(KIND_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-4 rounded-sm"
              style={{ background: v.bg }}
            />
            {v.label}
          </span>
        ))}
      </div>

      {/* 本家と同じく「開始・期限日が未設定のタスク」を出す */}
      {hidden.length > 0 && (
        <details className="mt-4 rounded border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-2 text-sm">
            開始・期限日が未設定のタスク（{hidden.length} 件）
          </summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-200">
            {hidden.map((r) => (
              <li key={r.issue.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Link
                  href={`/issues/${key}-${r.issue.keyId}`}
                  className="font-mono text-xs text-brand-700 hover:underline"
                >
                  {key}-{r.issue.keyId}
                </Link>
                <span className="flex-1 truncate" title={r.issue.summary}>
                  {r.issue.summary}
                </span>
                <span className="text-xs text-slate-400">{r.issue.status.name}</span>
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 text-xs text-slate-500">
            タスクを開いて開始日・期限日を設定すると、ここからガントへ移ります。
          </p>
        </details>
      )}

      <div className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white">
        <div style={{ minWidth: 320 + width }}>
          {/* 目盛り */}
          {/* ---- ヘッダ上段: 月の帯 ---- */}
          <div className="flex border-b border-slate-200 bg-slate-50 text-[10px] text-slate-600">
            <div className="w-80 shrink-0 border-r border-slate-200 px-3 py-1" />
            <div className="flex" style={{ width }}>
              {monthBands.map((b, idx) => (
                <div
                  key={`${b.label}-${idx}`}
                  className="shrink-0 overflow-hidden whitespace-nowrap border-r border-slate-200 px-1 py-1 font-medium"
                  style={{ width: b.days * DAY_PX }}
                  title={b.label}
                >
                  {/* 端の月は幅が足りないことがある。はみ出さずに切る */}
                  {b.label}
                </div>
              ))}
            </div>
          </div>

          {/* ---- ヘッダ下段: 日付 ---- */}
          <div className="flex border-b border-slate-200 bg-slate-50 text-[10px] text-slate-500">
            <div className="w-80 shrink-0 border-r border-slate-200 px-3 py-1">タスク</div>
            <div className="relative flex" style={{ width }}>
              {ticks.map((t) => (
                <div
                  key={t.i}
                  // 週・月スケールは間引くので、ラベルが隣の空マスへはみ出して構わない。
                  // overflow-hidden にすると `10/12` が切れる（実測で発覚）
                  className={`shrink-0 border-r border-slate-100 py-1 text-center tabular-nums ${
                    t.today
                      ? "bg-amber-100 font-semibold text-amber-800"
                      : t.weekend
                        ? "bg-slate-100"
                        : ""
                  }`}
                  style={{ width: DAY_PX }}
                >
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          {shown.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">
              表示できるタスクがありません
            </p>
          )}

          {[...groups.entries()].map(([g, list]) => (
            <div key={g}>
              {groupBy && (
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  {g}（{list.length}）
                </div>
              )}
              {list.map(({ issue: i, bar }) => {
                const { offsetDays, spanDays } = barOffset(bar!, rangeStart);
                const style = KIND_STYLE[bar!.kind];
                const visibleBar = offsetDays + spanDays > 0 && offsetDays < days;
                return (
                  <div
                    key={i.id}
                    className="flex border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <div className="flex w-80 shrink-0 items-center gap-2 border-r border-slate-200 px-3 py-1.5 text-sm">
                      <Link
                        href={`/issues/${key}-${i.keyId}`}
                        className="font-mono text-xs text-brand-700 hover:underline"
                      >
                        {key}-{i.keyId}
                      </Link>
                      {/* 省略したままだと全文を確かめられない。hoverで出す */}
                      <span className="truncate" title={i.summary}>
                        {i.summary}
                      </span>
                    </div>
                    <div className="relative" style={{ width }}>
                      {ticks.map((t) => (
                        <div
                          key={t.i}
                          className={`absolute top-0 h-full border-r border-slate-50 ${
                            t.today ? "bg-amber-50" : t.weekend ? "bg-slate-50" : ""
                          }`}
                          style={{ left: t.i * DAY_PX, width: DAY_PX }}
                        />
                      ))}
                      {visibleBar && (
                        <div
                          className="absolute top-1.5 h-4 rounded-sm"
                          style={{
                            left: Math.max(0, offsetDays) * DAY_PX + 1,
                            width:
                              (Math.min(days, offsetDays + spanDays) -
                                Math.max(0, offsetDays)) *
                                DAY_PX -
                              2,
                            background: style.bg,
                          }}
                          title={`${style.label}: ${bar!.from.toISOString().slice(0, 10)}〜${bar!.to.toISOString().slice(0, 10)}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        依存関係の線と自動スケジューリングは本家に無いため作りません。
      </p>
    </Shell>
  );
}
