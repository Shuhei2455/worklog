import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser, visibleProjectIds } from "@/lib/session";
import { STATUS_ID_CLOSED } from "@/lib/constants";
import { Shell } from "@/components/Shell";

/**
 * ダッシュボード。自分が担当・自分が登録・最近見た課題。
 *
 * どのクエリも visibleProjectIds で絞る。
 * 参加していないプロジェクトの課題は管理者でも見えない。
 */

function IssueList({
  title,
  note,
  issues,
}: {
  title: string;
  note?: string;
  issues: Array<{
    id: number;
    keyId: number;
    summary: string;
    dueDate: Date | null;
    project: { key: string };
    status: { name: string; color: string };
  }>;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
      {issues.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">なし</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {issues.map((i) => {
            const overdue = i.dueDate != null && i.dueDate < today;
            return (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Link
                  href={`/issues/${i.project.key}-${i.keyId}`}
                  className="font-mono text-xs text-brand-700 hover:underline"
                >
                  {i.project.key}-{i.keyId}
                </Link>
                <Link
                  href={`/issues/${i.project.key}-${i.keyId}`}
                  className="flex-1 truncate hover:underline"
                >
                  {i.summary}
                </Link>
                <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: i.status.color }}
                  />
                  {i.status.name}
                </span>
                {i.dueDate && (
                  <span
                    className={`shrink-0 text-xs ${overdue ? "font-medium text-red-600" : "text-slate-400"}`}
                  >
                    {i.dueDate.toISOString().slice(0, 10)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function Dashboard() {
  const user = await currentUser();
  const visible = await visibleProjectIds(user.id);

  const include = {
    project: { select: { key: true } },
    status: { select: { name: true, color: true } },
  };
  const inVisible = { projectId: { in: visible } };
  // 完了した課題は日々の作業では見たくない
  const open = { statusId: { not: STATUS_ID_CLOSED } };

  const [assigned, created, recent, savedFilters] = await Promise.all([
    prisma.issue.findMany({
      where: { ...inVisible, ...open, assigneeId: user.id },
      include,
      // 期限が近いものから。期限なしは後ろに回す
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 20,
    }),
    prisma.issue.findMany({
      where: { ...inVisible, ...open, createdBy: user.id },
      include,
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.recentlyViewedIssue.findMany({
      where: { userId: user.id, issue: inVisible },
      include: { issue: { include } },
      orderBy: { viewedAt: "desc" },
      take: 10,
    }),
    prisma.savedFilter.findMany({
      where: { userId: user.id },
      include: { project: { select: { key: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <Shell user={user} breadcrumbs={[{ label: "ダッシュボード" }]}>
      <h1 className="text-xl font-semibold">ダッシュボード</h1>

      <div className="mt-6 space-y-6">
        <IssueList
          title="自分が担当"
          note="期限が近い順。完了した課題は出しません"
          issues={assigned}
        />
        <IssueList title="自分が登録" issues={created} />
        <IssueList
          title="最近見た課題"
          issues={recent.map((r) => r.issue)}
        />

        {savedFilters.length > 0 && (
          <section className="rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2">
              <h2 className="text-sm font-semibold">保存した検索条件</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {savedFilters.map((f) => {
                const q = new URLSearchParams(
                  f.condition as Record<string, string>,
                ).toString();
                const href = f.project
                  ? `/projects/${f.project.key}/issues?${q}`
                  : `/?${q}`;
                return (
                  <li key={f.id} className="px-4 py-2 text-sm">
                    <Link href={href} className="text-brand-700 hover:underline">
                      {f.name}
                    </Link>
                    {f.project && (
                      <span className="ml-2 text-xs text-slate-400">
                        {f.project.name}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Shell>
  );
}
