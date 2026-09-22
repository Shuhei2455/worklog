import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser, visibleProjectIds } from "@/lib/session";
import { STATUS_ID_CLOSED } from "@/lib/constants";
import { activityTypeLabel } from "@/lib/activity-type";
import {
  DUE_FILTER_KEY,
  DUE_FILTERS,
  MY_ISSUES_LIMIT,
  ROLE_FILTER_KEY,
  ROLE_FILTERS,
  dueDateWhere,
  startOfDay,
  toDueFilter,
  toRoleFilter,
} from "@/lib/my-issues";
import { loadProjectProgress } from "@/lib/project-progress";
import { translator, type MessageKey, type T } from "@/lib/i18n";
import { Shell } from "@/components/Shell";
import { PageTitle, StatusLabel } from "@/components/ui";
import { ProgressBar, ProgressBreakdown, ProgressPercent } from "@/components/ProgressBar";

/**
 * ダッシュボード。
 *
 * 本家と同じ4ブロック構成にしてある
 * （一次情報: backlog.com/ja/enterprise-help/userguide/userguide1165/ ほか）:
 *
 *   プロジェクト        参加しているプロジェクトの一覧
 *   自分の課題          全プロジェクト横断・10件・担当/登録・期限日で絞り込み
 *   自分のプルリクエスト  自分が担当 or 登録した open のPR
 *   最近の更新          全プロジェクトの活動を時系列
 *
 * 以前は「自分が担当」「自分が登録」「最近見た課題」を縦に並べただけで、
 * プロジェクトのブロックも活動フィードも無かった。本家とは別物だったので作り替えた。
 *
 * **進捗バーは本家に無い**（決定 D29）。本家のヘルプは
 * 「ダッシュボードで関わる全てのプロジェクトの進捗が把握できる」と書いているが、
 * 実際に出るのは課題の件数だけで、進捗率の表示は無い。ユーザーの要望で足した。
 *
 * どのクエリも visibleProjectIds で絞る。
 * 参加していないプロジェクトの課題は管理者でも見えない。
 */

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-4 py-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

/** 絞り込みのタブ。状態はURLに持つので、クライアント側のJSは要らない */
function FilterTabs<V extends string>({
  options,
  labelKey,
  t,
  current,
  hrefFor,
}: {
  options: readonly V[];
  labelKey: Record<V, MessageKey>;
  t: T;
  current: V;
  hrefFor: (v: V) => string;
}) {
  return (
    <span className="flex items-center gap-1">
      {options.map((o) => (
        <Link
          key={o}
          href={hrefFor(o)}
          aria-current={o === current ? "true" : undefined}
          className={`rounded-pill px-3 py-0.5 text-sm ${
            o === current ? "bg-brand-600 text-white" : "text-brand-700 hover:bg-brand-50"
          }`}
        >
          {t(labelKey[o])}
        </Link>
      ))}
    </span>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; due?: string }>;
}) {
  const user = await currentUser();
  const t = translator(user.locale ?? "ja");
  const sp = await searchParams;
  const role = toRoleFilter(sp.role);
  const due = toDueFilter(sp.due);

  const visible = await visibleProjectIds(user.id);
  const inVisible = { projectId: { in: visible } };
  const today = startOfDay(new Date());

  const issueInclude = {
    project: { select: { key: true } },
    status: { select: { name: true, color: true } },
    assignee: { select: { name: true } },
  };

  const [projects, myIssues, myIssueCount, pullRequests, activities, recent, savedFilters] =
    await Promise.all([
    prisma.project.findMany({
      where: { id: { in: visible }, archived: false },
      orderBy: { key: "asc" },
      select: { id: true, key: true, name: true },
    }),

    prisma.issue.findMany({
      where: {
        ...inVisible,
        // 完了した課題は日々の作業では見たくない
        statusId: { not: STATUS_ID_CLOSED },
        ...(role === "assigned" ? { assigneeId: user.id } : { createdBy: user.id }),
        ...dueDateWhere(due, today),
      },
      include: issueInclude,
      // 期限が近いものから。期限なしは後ろに回す
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: MY_ISSUES_LIMIT,
    }),
    prisma.issue.count({
      where: {
        ...inVisible,
        statusId: { not: STATUS_ID_CLOSED },
        ...(role === "assigned" ? { assigneeId: user.id } : { createdBy: user.id }),
        ...dueDateWhere(due, today),
      },
    }),

    prisma.pullRequest.findMany({
      where: {
        state: "open",
        repository: { project: { id: { in: visible } } },
        OR: [{ assigneeId: user.id }, { createdById: user.id }],
      },
      include: {
        repository: { select: { name: true, project: { select: { key: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: MY_ISSUES_LIMIT,
    }),

    prisma.activity.findMany({
      where: inVisible,
      include: {
        user: { select: { name: true } },
        project: { select: { key: true, name: true } },
        issue: { select: { keyId: true, summary: true } },
        wikiPage: { select: { id: true, name: true } },
        pullRequest: {
          select: {
            externalPrNumber: true,
            title: true,
            repository: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),

    // 以下2つは本家ではグローバルナビの「最近見た項目」「フィルタ」にあたる。
    // その画面をまだ作っていないので、ダッシュボードの右側に置いている（意図的に相違）
    prisma.recentlyViewedIssue.findMany({
      where: { userId: user.id, issue: inVisible },
      include: { issue: { select: { keyId: true, summary: true, project: { select: { key: true } } } } },
      orderBy: { viewedAt: "desc" },
      take: 10,
    }),
    prisma.savedFilter.findMany({
      where: { userId: user.id },
      include: { project: { select: { key: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const progress = await loadProjectProgress(
    projects.map((p) => p.id),
    today,
  );

  const myIssuesHref = (r: string, d: string) => `/dashboard?role=${r}&due=${d}`;

  return (
    <Shell user={user} breadcrumbs={[{ label: t("nav.dashboard") }]}>
      <PageTitle>{t("nav.dashboard")}</PageTitle>

      {/* grid-cols-1 を明示する。付けないと狭い幅で暗黙の列が auto になり、
          グリッド項目の min-width:auto と合わさって中身の最大幅まで伸びる
          （375pxで101pxはみ出していた）。grid-cols-1 は minmax(0,1fr) なので縮められる */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ==== 左: 自分のタスク / プルリクエスト / 最近の更新 ==== */}
        <div className="space-y-4">
          <Block
            title={t("dash.myIssues")}
            action={
              <>
                <FilterTabs
                  options={ROLE_FILTERS}
                  labelKey={ROLE_FILTER_KEY}
                  t={t}
                  current={role}
                  hrefFor={(v) => myIssuesHref(v, due)}
                />
                <span className="text-slate-300">|</span>
                <FilterTabs
                  options={DUE_FILTERS}
                  labelKey={DUE_FILTER_KEY}
                  t={t}
                  current={due}
                  hrefFor={(v) => myIssuesHref(role, v)}
                />
              </>
            }
          >
            {myIssues.length === 0 ? (
              <Empty>{t("dash.noIssues")}</Empty>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {myIssues.map((i) => {
                    const overdue = i.dueDate != null && i.dueDate < today;
                    return (
                      <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                        <Link
                          href={`/issues/${i.project.key}-${i.keyId}`}
                          className="shrink-0 font-mono text-sm text-brand-700 hover:underline"
                        >
                          {i.project.key}-{i.keyId}
                        </Link>
                        {/* 省略したら全文を確かめる手段が要る（狭い幅ではほぼ必ず省略される） */}
                        <Link
                          href={`/issues/${i.project.key}-${i.keyId}`}
                          title={i.summary}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          {i.summary}
                        </Link>
                        <StatusLabel name={i.status.name} color={i.status.color} />
                        <span className="w-[76px] shrink-0 text-right text-sm">
                          {i.dueDate ? (
                            <span
                              className={
                                overdue ? "font-medium text-red-700" : "text-slate-500"
                              }
                            >
                              {i.dueDate.toISOString().slice(0, 10)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {/* 本家も10件で切って「全て表示」を出す */}
                {myIssueCount > myIssues.length && (
                  <div className="border-t border-slate-100 px-4 py-2 text-sm">
                    <Link href="/search" className="text-brand-700 hover:underline">
                      {t("dash.showAll", { count: myIssueCount })}
                    </Link>
                  </div>
                )}
              </>
            )}
          </Block>

          <Block title={t("dash.myPullRequests")}>
            {pullRequests.length === 0 ? (
              <Empty>{t("dash.noPullRequests")}</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pullRequests.map((pr) => (
                  <li key={pr.id} className="flex items-center gap-3 px-4 py-2">
                    <Link
                      href={`/projects/${pr.repository.project.key}/git/${pr.repository.name}/pulls/${pr.externalPrNumber}`}
                      className="shrink-0 font-mono text-sm text-brand-700 hover:underline"
                    >
                      {pr.repository.name}#{pr.externalPrNumber}
                    </Link>
                    <span title={pr.title} className="min-w-0 flex-1 truncate">{pr.title}</span>
                    <span className="shrink-0 text-sm text-slate-500">
                      {pr.headBranch} → {pr.baseBranch}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title={t("dash.recentUpdates")}>
            {activities.length === 0 ? (
              <Empty>{t("dash.noUpdates")}</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activities.map((a) => {
                  // 活動の種類ごとに、リンク先と対象の名前が変わる
                  let href: string | null = null;
                  let target = "";
                  if (a.issue) {
                    href = `/issues/${a.project.key}-${a.issue.keyId}`;
                    target = `${a.project.key}-${a.issue.keyId} ${a.issue.summary}`;
                  } else if (a.wikiPage) {
                    href = `/projects/${a.project.key}/wiki/${a.wikiPage.id}`;
                    target = a.wikiPage.name;
                  } else if (a.pullRequest) {
                    href = `/projects/${a.project.key}/git/${a.pullRequest.repository.name}/pulls/${a.pullRequest.externalPrNumber}`;
                    target = a.pullRequest.title;
                  }

                  return (
                    <li key={a.id} className="px-4 py-2">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 font-medium">{a.user.name}</span>
                        <span className="shrink-0 text-sm text-slate-500">
                          {activityTypeLabel(user.locale ?? "ja", a.type)}
                        </span>
                        <span className="flex-1" />
                        <span className="shrink-0 text-sm text-slate-400">
                          {a.createdAt.toLocaleString(
                            user.locale === "en" ? "en-US" : "ja-JP",
                            {
                              timeZone: "Asia/Tokyo",
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-baseline gap-2">
                        <Link
                          href={`/projects/${a.project.key}/issues`}
                          className="shrink-0 rounded bg-slate-100 px-1.5 text-sm text-slate-600 hover:underline"
                        >
                          {a.project.key}
                        </Link>
                        {href ? (
                          <Link href={href} title={target} className="min-w-0 truncate text-brand-700 hover:underline">
                            {target}
                          </Link>
                        ) : (
                          <span title={target || undefined} className="min-w-0 truncate text-slate-500">{target || "—"}</span>
                        )}
                      </div>
                      {a.content && (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.content}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>
        </div>

        {/* ==== 右: プロジェクト ==== */}
        <div className="space-y-4">
          <Block title={t("nav.projects")}>
            {projects.length === 0 ? (
              <Empty>{t("dash.noProjects")}</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {projects.map((p) => {
                  const prog = progress.get(p.id)!;
                  return (
                    <li key={p.id} className="px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <Link
                          href={`/projects/${p.key}/issues`}
                          title={p.name}
                          className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline"
                        >
                          {p.name}
                        </Link>
                        <ProgressPercent progress={prog} />
                      </div>
                      <div className="mt-2">
                        <ProgressBar progress={prog} locale={user.locale} />
                      </div>
                      <div className="mt-1">
                        <ProgressBreakdown progress={prog} locale={user.locale} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>

          <Block title={t("dash.recentlyViewed")}>
            {recent.length === 0 ? (
              <Empty>{t("dash.empty")}</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((r) => (
                  <li key={r.issue.keyId + r.issue.project.key} className="px-4 py-2">
                    <Link
                      href={`/issues/${r.issue.project.key}-${r.issue.keyId}`}
                      className="flex items-baseline gap-2 hover:underline"
                    >
                      <span className="shrink-0 font-mono text-sm text-brand-700">
                        {r.issue.project.key}-{r.issue.keyId}
                      </span>
                      <span title={r.issue.summary} className="min-w-0 truncate">{r.issue.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {savedFilters.length > 0 && (
            <Block title={t("dash.savedFilters")}>
              <ul className="divide-y divide-slate-100">
                {savedFilters.map((f) => {
                  const q = new URLSearchParams(
                    f.condition as Record<string, string>,
                  ).toString();
                  const href = f.project
                    ? `/projects/${f.project.key}/issues?${q}`
                    : `/?${q}`;
                  return (
                    <li key={f.id} className="px-4 py-2">
                      <Link href={href} className="text-brand-700 hover:underline">
                        {f.name}
                      </Link>
                      {f.project && (
                        <span className="ml-2 text-sm text-slate-400">{f.project.name}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Block>
          )}
        </div>
      </div>
    </Shell>
  );
}
