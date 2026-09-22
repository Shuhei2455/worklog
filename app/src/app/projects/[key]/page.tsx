import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { activityTypeLabel } from "@/lib/activity-type";
import { loadProjectProgress } from "@/lib/project-progress";
import { Shell } from "@/components/Shell";
import { EmptyState, PageTitle, StatusLabel } from "@/components/ui";
import { ProgressBar, ProgressPercent } from "@/components/ProgressBar";
import { CommitGraph } from "@/components/CommitGraph";
import { layoutCommits } from "@/lib/git-graph";
import { gitProvider } from "@/lib/git";
import { commitTitle } from "@/lib/git-view";

/**
 * プロジェクトホーム。
 *
 * **スペース全体のダッシュボードとは別物**（docs/00-spec-verified.md 14）。
 * あちらは参加している全プロジェクトを横断するが、こちらは1つの中だけを見る。
 *
 * サイドバーに「ホーム」があるのに画面が無く、課題一覧を指したままだった。
 * 2026-09-23 に本家の画面を見て仕様を起こしてから作った。
 *
 * 構成は本家に合わせて、左に活動の時系列、右に4ブロック。
 * ただし**バーンダウンは別画面へのリンクに留める**（決定 D32）。
 * 本家はここに小さなチャートを出すが、こちらは既にバーンダウンの画面があり、
 * 同じ計算を2か所に置くと片方だけ直す事故が起きる。
 */
export default async function ProjectHome({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const user = await currentUser();

  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  // 参加していないプロジェクトは中身を出さない（決定 D31）
  if (!can(user, "issue.view", ctx)) notFound();

  const [activities, statuses, milestones, categories, progressMap] = await Promise.all([
    prisma.activity.findMany({
      where: { projectId: project.id },
      include: {
        user: { select: { name: true } },
        issue: { select: { keyId: true, summary: true, description: true } },
        wikiPage: { select: { id: true, name: true } },
        pullRequest: {
          select: { externalPrNumber: true, title: true, repository: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.status.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    // マイルストーンとバージョンは**同一テーブル**。関連の張り方で区別する
    prisma.version.findMany({
      where: { projectId: project.id, archived: false },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.category.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    loadProjectProgress([project.id]),
  ]);

  const progress = progressMap.get(project.id)!;

  // Gitの直近の動き。ホームからコードの流れが見えるようにする。
  // 提供元が落ちていてもホームは開くようにし、失敗は「無し」として扱う
  const provider = gitProvider();
  const canGit = project.gitEnabled && can(user, "git.access", ctx);
  const repository = canGit
    ? await prisma.repository.findFirst({
        where: { projectId: project.id },
        orderBy: { displayOrder: "asc" },
      })
    : null;
  let commits: Awaited<ReturnType<NonNullable<typeof provider>["listCommits"]>> = [];
  if (provider && repository) {
    try {
      commits = await provider.listCommits(
        { owner: project.gitOwner ?? project.key, name: repository.name },
        { limit: 8 },
      );
    } catch {
      commits = [];
    }
  }
  const graph = layoutCommits(commits.map((c) => ({ sha: c.sha, parents: c.parents })));
  const graphLanes = Math.min(Math.max(1, ...graph.map((r) => r.width)), 3);

  // 状態ごとの件数。右の「状態」ブロックで使う
  const counts = await prisma.issue.groupBy({
    by: ["statusId"],
    where: { projectId: project.id },
    _count: { _all: true },
  });
  const countOf = (statusId: number) =>
    counts.find((c) => c.statusId === statusId)?._count._all ?? 0;

  // マイルストーン・カテゴリーごとの進み具合。件数だけで出す
  const [byMilestone, byCategory] = await Promise.all([
    prisma.issueMilestone.groupBy({
      by: ["versionId"],
      where: { issue: { projectId: project.id } },
      _count: { _all: true },
    }),
    prisma.issueCategory.groupBy({
      by: ["categoryId"],
      where: { issue: { projectId: project.id } },
      _count: { _all: true },
    }),
  ]);

  const dateLabel = (d: Date) =>
    d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  // 日付ごとにまとめる。本家も日付の見出しで区切っている（14.1）
  const byDate = new Map<string, typeof activities>();
  for (const a of activities) {
    const label = dateLabel(a.createdAt);
    if (!byDate.has(label)) byDate.set(label, []);
    byDate.get(label)!.push(a);
  }

  const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">{title}</h2>
      <div className="p-3">{children}</div>
    </section>
  );

  return (
    <Shell
      user={user}
      project={{
        key,
        name: project.name,
        current: "home",
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
      <PageTitle>プロジェクトホーム</PageTitle>

      {/* grid-cols-1 を明示する。付けないと狭い幅で中身の最大幅まで伸びる
          （ダッシュボードで踏んだのと同じ） */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ==== 左: 最近の更新 ==== */}
        <div className="space-y-4">
          {repository && commits.length > 0 && (
            <section className="rounded border border-slate-200 bg-white">
              <h2 className="flex items-baseline gap-2 border-b border-slate-200 px-3 py-2 text-sm font-semibold">
                Git
                <span className="font-normal text-slate-500">{repository.name}</span>
                <Link
                  href={`/projects/${project.key}/git/${encodeURIComponent(repository.name)}/commits`}
                  className="ml-auto text-xs font-normal text-brand-700 hover:underline"
                >
                  すべて見る
                </Link>
              </h2>
              <ul className="divide-y divide-slate-100">
                {commits.map((c, i) => (
                  <li key={c.sha} className="h-11 py-0 pl-2 pr-3">
                    <div className="flex items-stretch gap-2">
                      {graph[i] && <CommitGraph row={graph[i]} lanes={graphLanes} />}
                      <div className="flex min-w-0 flex-1 items-center gap-3 self-center">
                        <Link
                          href={`/projects/${project.key}/git/${encodeURIComponent(repository.name)}/commits/${c.sha}`}
                          className="shrink-0 font-mono text-xs text-brand-700 hover:underline"
                        >
                          {c.sha.slice(0, 7)}
                        </Link>
                        <span
                          className="min-w-0 flex-1 truncate text-sm"
                          title={commitTitle(c.message)}
                        >
                          {commitTitle(c.message)}
                        </span>
                        <span className="hidden shrink-0 text-xs text-slate-400 sm:block">
                          {c.authorName}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h2 className="text-sm font-semibold text-slate-600">最近の更新</h2>
          {activities.length === 0 ? (
            <EmptyState>まだ活動がありません。</EmptyState>
          ) : (
            [...byDate.entries()].map(([label, items]) => (
              <section key={label} className="rounded border border-slate-200 bg-white">
                <h3 className="border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500">
                  {label}
                </h3>
                <ul className="divide-y divide-slate-100">
                  {items.map((a) => {
                    let href: string | null = null;
                    let target = "";
                    let excerpt: string | null = null;
                    if (a.issue) {
                      href = `/issues/${project.key}-${a.issue.keyId}`;
                      target = `${project.key}-${a.issue.keyId} ${a.issue.summary}`;
                      excerpt = a.issue.description;
                    } else if (a.wikiPage) {
                      href = `/projects/${project.key}/wiki/${encodeURIComponent(a.wikiPage.name)}`;
                      target = a.wikiPage.name;
                    } else if (a.pullRequest) {
                      href = `/projects/${project.key}/git/${encodeURIComponent(a.pullRequest.repository.name)}/pulls/${a.pullRequest.externalPrNumber}`;
                      target = `${a.pullRequest.repository.name}#${a.pullRequest.externalPrNumber} ${a.pullRequest.title}`;
                    }
                    return (
                      <li key={a.id} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                          <span className="font-medium">{a.user.name}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {activityTypeLabel(user.locale === "en" ? "en" : "ja", a.type)}
                          </span>
                          <span className="ml-auto text-xs text-slate-400">
                            {a.createdAt.toLocaleString("ja-JP", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        {href ? (
                          <Link
                            href={href}
                            title={target}
                            className="mt-0.5 block truncate text-sm text-brand-700 hover:underline"
                          >
                            {target}
                          </Link>
                        ) : (
                          <span className="mt-0.5 block text-sm text-slate-500">—</span>
                        )}
                        {/* 本家は本文の抜粋を出し、長ければ「もっと読む」（14.1）。
                            ここでは折り返さずに3行で止める */}
                        {excerpt && (
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500">
                            {excerpt}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* ==== 右: 状態 / バーンダウン / マイルストーン / カテゴリー ==== */}
        <div className="space-y-4">
          <Block title="状態">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <ProgressBar progress={progress} locale={user.locale} />
              </div>
              <ProgressPercent progress={progress} />
            </div>
            <ul className="mt-3 space-y-1">
              {statuses.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <StatusLabel name={s.name} color={s.color} />
                  <Link
                    href={`/projects/${project.key}/issues?statusId=${s.id}`}
                    className="text-sm text-brand-700 hover:underline"
                  >
                    {countOf(s.id)}
                  </Link>
                </li>
              ))}
            </ul>
          </Block>

          {project.chartEnabled && (
            <Block title="バーンダウンチャート">
              {/* 本家はここに小さなチャートを出すが、同じ計算を2か所に置くと
                  片方だけ直す事故が起きる。既存の画面へ送る（決定 D32） */}
              <Link
                href={`/projects/${project.key}/burndown`}
                className="text-sm text-brand-700 hover:underline"
              >
                バーンダウンチャートを開く
              </Link>
            </Block>
          )}

          <Block title="マイルストーン">
            {milestones.length === 0 ? (
              <p className="text-sm text-slate-400">未設定</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {milestones.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/projects/${project.key}/issues?milestoneId=${m.id}`}
                      title={m.name}
                      className="min-w-0 truncate text-brand-700 hover:underline"
                    >
                      {m.name}
                    </Link>
                    <span className="shrink-0 text-xs text-slate-500">
                      {byMilestone.find((b) => b.versionId === m.id)?._count._all ?? 0} 件
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="カテゴリー">
            {categories.length === 0 ? (
              <p className="text-sm text-slate-400">未設定</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {categories.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/projects/${project.key}/issues?categoryId=${c.id}`}
                      title={c.name}
                      className="min-w-0 truncate text-brand-700 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="shrink-0 text-xs text-slate-500">
                      {byCategory.find((b) => b.categoryId === c.id)?._count._all ?? 0} 件
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </div>
      </div>
    </Shell>
  );
}
