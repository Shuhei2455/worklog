import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PageTitle, Button } from "@/components/ui";
import {
  axisTicks,
  buildBurndown,
  completedAtFrom,
  type BurndownIssue,
  type BurndownPoint,
} from "@/lib/burndown";

/**
 * バーンダウンチャート（マイルストーン単位・決定 D26）。
 *
 * SVG を自分で描く。グラフのライブラリは入れない（CLAUDE.md）。
 * 折れ線2本と理想線だけなので、座標の計算で足りる。
 */
export default async function Burndown({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ milestoneId?: string }>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "issue.view", ctx)) notFound();

  // マイルストーン＝バージョン。期間が入っているものだけが対象
  const milestones = await prisma.version.findMany({
    where: { projectId: project.id },
    orderBy: [{ releaseDueDate: "asc" }, { id: "asc" }],
  });

  // 既定で選ぶマイルストーン。
  //
  // 以前は「期間が入っている最初のもの」だったが、並びが期限日の昇順なので
  // **一番古い＝終わったマイルストーン**が選ばれ、開くと空のグラフが出ていた。
  // 見たいのは普通いま動いているものなので、次の順で選ぶ:
  //   1. 今日が期間に入っているもの
  //   2. これから始まるもののうち一番早いもの
  //   3. それも無ければ一番新しい終わったもの
  // アーカイブ済みは 1・2 の対象から外す（終わった印なので）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const withRange = milestones.filter((m) => m.startDate && m.releaseDueDate);
  const active = withRange.filter((m) => !m.archived);
  const selected =
    milestones.find((m) => String(m.id) === sp.milestoneId) ??
    active.find((m) => m.startDate! <= today && today <= m.releaseDueDate!) ??
    active.find((m) => m.startDate! > today) ??
    withRange[withRange.length - 1] ??
    null;

  let points: BurndownPoint[] = [];
  let issueCount = 0;
  let missingRange = false;

  if (selected) {
    if (!selected.startDate || !selected.releaseDueDate) {
      missingRange = true;
    } else {
      const rows = await prisma.issue.findMany({
        where: {
          projectId: project.id,
          milestones: { some: { versionId: selected.id } },
        },
        select: {
          id: true,
          statusId: true,
          completedAt: true,
          estimatedHours: true,
          createdAt: true,
        },
      });
      issueCount = rows.length;

      // 「完了になった日」を活動履歴から補う（burndown.ts の説明のとおり）
      const changes = await prisma.activity.findMany({
        where: {
          projectId: project.id,
          issueId: { in: rows.map((r) => r.id) },
          type: "issue_updated",
        },
        select: { issueId: true, changes: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      const byIssue = new Map<number, Array<{ to: number | null; at: Date }>>();
      for (const a of changes) {
        if (!a.issueId || !Array.isArray(a.changes)) continue;
        for (const c of a.changes as Array<{ field?: string; to?: string | null }>) {
          if (c.field !== "statusId") continue;
          const list = byIssue.get(a.issueId) ?? [];
          list.push({ to: c.to == null ? null : Number(c.to), at: a.createdAt });
          byIssue.set(a.issueId, list);
        }
      }

      const issues: BurndownIssue[] = rows.map((r) => ({
        id: r.id,
        completedAt: completedAtFrom(r, byIssue.get(r.id) ?? []),
        estimatedHours: r.estimatedHours == null ? 0 : Number(r.estimatedHours),
        createdAt: r.createdAt,
      }));

      points = buildBurndown(issues, {
        start: selected.startDate,
        end: selected.releaseDueDate,
      });
    }
  }

  return (
    <Shell
      user={user}
      project={{
        key: key,
        name: project.name,
        current: "burndown",
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
      <PageTitle>バーンダウンチャート</PageTitle>
      </div>

      {milestones.length === 0 ? (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          マイルストーンがありません。
          <Link href={`/projects/${key}/settings`} className="ml-1 underline">
            プロジェクト設定
          </Link>
          で追加してください。
        </p>
      ) : (
        <form className="mt-4 flex flex-wrap items-end gap-2 text-sm">
          <label className="max-w-full">
            <span className="block text-xs text-slate-500">マイルストーン</span>
            <select
              name="milestoneId"
              defaultValue={selected ? String(selected.id) : ""}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 sm:w-auto"
            >
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.startDate && m.releaseDueDate ? "" : "（期間未設定）"}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary">
            表示
          </Button>
        </form>
      )}

      {missingRange && (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このマイルストーンには<strong>開始日と終了日</strong>が必要です。
          プロジェクト設定で入れてください。
        </p>
      )}

      {points.length > 0 && (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {selected?.name} / {points[0].date} 〜 {points[points.length - 1].date} /
            対象 {issueCount} 件
          </p>
          <Chart points={points} />
          <Table points={points} />
          <p className="mt-3 text-xs text-slate-500">
            残りは「その日の終わりに完了していないタスク」で数えています。
            予定時間が未入力のタスクは0時間として扱うため、件数の線も並べています
            （計算式は本家非公開のため独自。決定 D26）。
          </p>
        </>
      )}
    </Shell>
  );
}

/**
 * 線の色。
 *
 * **SVGの stroke と凡例で同じ値を使う。** 別々に書くと片方だけ直したときに
 * 食い違う（実際、凡例が sky・線が別の青になっていた）。
 * tailwind のクラスは SVG の stroke に使えないので、値をここに置く。
 */
const LINE_COLOR = {
  // brand-700。tailwind.config.ts の値と合わせてある
  count: "#1d4ed8",
  hours: "#16a34a",
  ideal: "#cbd5e1",
} as const;

/** SVGの折れ線。ライブラリは使わない */
function Chart({ points }: { points: BurndownPoint[] }) {
  const W = 720;
  const H = 260;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxCount = Math.max(1, ...points.map((p) => Math.max(p.remainingCount, p.idealCount)));
  const maxHours = Math.max(1, ...points.map((p) => Math.max(p.remainingHours, p.idealHours)));

  const x = (i: number) =>
    pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yCount = (v: number) => pad.top + innerH - (v / maxCount) * innerH;
  const yHours = (v: number) => pad.top + innerH - (v / maxHours) * innerH;

  const line = (
    values: Array<number | null>,
    y: (v: number) => number,
  ): string =>
    values
      .map((v, i) => (v === null ? null : `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`))
      .filter(Boolean)
      .join(" ");

  // 実績線は今日まで。未来は描かない（0に落ちて見えるのを避ける）
  const actualCount = points.map((p) => (p.future ? null : p.remainingCount));
  const actualHours = points.map((p) => (p.future ? null : p.remainingHours));

  return (
    <div className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="バーンダウン">
        {/* 目盛り。値を先に決めてから位置を出す。
            比率から値を出すと、max が小さいとき同じ数字が並ぶ（lib/burndown.ts） */}
        {axisTicks(maxCount).map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={pad.top + innerH * (1 - v / Math.max(maxCount, 1))}
              y2={pad.top + innerH * (1 - v / Math.max(maxCount, 1))}
              stroke="#e2e8f0"
            />
            <text
              x={pad.left - 6}
              y={pad.top + innerH * (1 - v / Math.max(maxCount, 1)) + 4}
              textAnchor="end"
              fontSize="10"
              fill="#94a3b8"
            >
              {v}
            </text>
          </g>
        ))}

        {/* 理想線 */}
        <path
          d={line(points.map((p) => p.idealCount), yCount)}
          fill="none"
          stroke={LINE_COLOR.ideal}
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        {/* 残り件数 */}
        <path d={line(actualCount, yCount)} fill="none" stroke={LINE_COLOR.count} strokeWidth="2" />
        {/* 残り予定時間（縦軸は別スケール） */}
        <path
          d={line(actualHours, yHours)}
          fill="none"
          stroke={LINE_COLOR.hours}
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />

        {/* 横軸のラベルは先頭・中間・末尾だけ。全部出すと潰れる */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">
            {points[i].date.slice(5)}
          </text>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5" style={{ background: LINE_COLOR.count }} />残りタスク数
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5" style={{ background: LINE_COLOR.hours }} />残り予定時間
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5" style={{ background: LINE_COLOR.ideal }} />理想線
        </span>
      </div>
    </div>
  );
}

function Table({ points }: { points: BurndownPoint[] }) {
  return (
    <details className="mt-3 rounded border border-slate-200 bg-white px-3 py-2">
      <summary className="cursor-pointer text-xs text-slate-600">数値で見る</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 text-left">日付</th>
              <th className="py-1 text-right">残り件数</th>
              <th className="py-1 text-right">残り予定時間</th>
              <th className="py-1 text-right">理想（件）</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className={p.future ? "text-slate-400" : ""}>
                <td className="py-0.5">{p.date}</td>
                <td className="py-0.5 text-right">{p.future ? "—" : p.remainingCount}</td>
                <td className="py-0.5 text-right">{p.future ? "—" : p.remainingHours}</td>
                <td className="py-0.5 text-right">{p.idealCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
