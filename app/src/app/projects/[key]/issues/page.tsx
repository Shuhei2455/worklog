import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext, visibleProjectIds } from "@/lib/session";
import {
  parseIssueFilter,
  buildIssueWhere,
  buildIssueOrderBy,
} from "@/lib/issue-filter";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/constants";
import { searchIssueIds, searchAvailable } from "@/lib/search";
import { Shell } from "@/components/Shell";
import { saveFilter } from "./actions";


export default async function IssueList({
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
  // 参加していないプロジェクトは管理者でも見えない
  if (!can(user, "issue.view", ctx)) notFound();

  // 一覧には権限条件を注入する。取得後にフィルタすると件数とページングが壊れる
  const visible = await visibleProjectIds(user.id);
  const filter = parseIssueFilter({ ...sp, projectId: String(project.id) });
  // キーワードは Meilisearch に投げ、返ったIDでDBを絞る二段構え。
  // 繋がらないときは buildIssueWhere 側の部分一致にフォールバックする
  let keywordIds: number[] | undefined;
  if (filter.keyword && (await searchAvailable())) {
    keywordIds = await searchIssueIds(filter.keyword, visible);
  }
  const where = buildIssueWhere(filter, visible, keywordIds);

  const [total, issues, statuses, members] = await Promise.all([
    prisma.issue.count({ where }),
    prisma.issue.findMany({
      where,
      orderBy: buildIssueOrderBy(filter),
      skip: filter.offset,
      take: filter.count,
      include: { status: true, issueType: true, assignee: true },
    }),
    prisma.status.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: true },
    }),
  ]);

  const page = Math.floor(filter.offset / filter.count) + 1;
  const pages = Math.max(1, Math.ceil(total / filter.count));
  const qs = (over: Record<string, string | number>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && v !== "") q.set(k, v);
    }
    for (const [k, v] of Object.entries(over)) q.set(k, String(v));
    return `?${q.toString()}`;
  };

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "課題" },
      ]}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">課題</h1>
        <div className="flex items-center gap-3">
        {/* 制限のあるユーザーは共有ファイルを閲覧すらできないので、
            リンク自体を出さない(押しても404になるだけ) */}
        {project.fileSharingEnabled && can(user, "sharedFile.access", ctx) && (
          <Link
            href={`/projects/${key}/files`}
            className="text-sm text-brand-700 hover:underline"
          >
            ファイル
          </Link>
        )}
        {project.wikiEnabled && (
          <Link
            href={`/projects/${key}/wiki`}
            className="text-sm text-brand-700 hover:underline"
          >
            Wiki
          </Link>
        )}
        <Link
          href={`/projects/${key}/board`}
          className="text-sm text-brand-700 hover:underline"
        >
          ボード
        </Link>
        {project.gitEnabled && can(user, "git.access", ctx) && (
          <Link
            href={`/projects/${key}/git`}
            className="text-sm text-brand-700 hover:underline"
          >
            Git
          </Link>
        )}
        {project.chartEnabled && (
          <Link
            href={`/projects/${key}/gantt`}
            className="text-sm text-brand-700 hover:underline"
          >
            ガントチャート
          </Link>
        )}
        {can(user, "issue.create", ctx) && (
          <Link
            href={`/projects/${key}/issues/new`}
            className="rounded bg-brand-700 px-4 py-1.5 text-sm text-white hover:bg-brand-800"
          >
            課題を追加
          </Link>
        )}
        </div>
      </div>

      {/* 絞り込みはURLクエリ。この形のURLを貼れば同じ条件を再現できる */}
      <form className="mt-4 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
        <label>
          <span className="block text-xs text-slate-500">状態</span>
          <select
            name="statusId"
            defaultValue={(sp.statusId as string) ?? ""}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">すべて</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-slate-500">担当者</span>
          <select
            name="assigneeId"
            defaultValue={(sp.assigneeId as string) ?? ""}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">すべて</option>
            <option value="0">未割り当て</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1">
          <span className="block text-xs text-slate-500">キーワード</span>
          <input
            name="keyword"
            defaultValue={(sp.keyword as string) ?? ""}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label>
          <span className="block text-xs text-slate-500">並び順</span>
          <select
            name="sort"
            defaultValue={filter.sort}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            {[
              ["updated", "更新日"],
              ["created", "登録日"],
              ["dueDate", "期限日"],
              ["priority", "優先度"],
              ["status", "状態"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button className="h-8 rounded border border-slate-300 px-4 hover:bg-slate-50">
          絞り込む
        </button>
        <Link
          href={`/projects/${key}/issues`}
          className="h-8 rounded border border-slate-300 px-4 leading-8 hover:bg-slate-50"
        >
          クリア
        </Link>
      </form>

      {/* 条件はURLクエリなので、保存＝そのクエリを名前付きで覚えるだけ */}
      <form
        action={saveFilter.bind(null, key)}
        className="mt-2 flex items-center gap-2 text-xs"
      >
        <input type="hidden" name="from" value="issues" />
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

      <p className="mt-4 text-xs text-slate-500">
        {total} 件中 {total === 0 ? 0 : filter.offset + 1}〜
        {Math.min(filter.offset + filter.count, total)} 件を表示
      </p>

      <table className="mt-2 w-full border-collapse overflow-hidden rounded border border-slate-200 bg-white text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {["キー", "種別", "件名", "状態", "担当者", "優先度", "期限日"].map((h) => (
              <th key={h} className="border-b border-slate-200 px-3 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {issues.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                該当する課題がありません
              </td>
            </tr>
          )}
          {issues.map((i) => (
            <tr key={i.id} className="border-b border-slate-100 last:border-0">
              <td className="px-3 py-2">
                <Link
                  href={`/issues/${key}-${i.keyId}`}
                  className="font-mono text-xs text-brand-700 hover:underline"
                >
                  {key}-{i.keyId}
                </Link>
              </td>
              <td className="px-3 py-2">
                <span
                  className="rounded px-1.5 py-0.5 text-xs text-white"
                  style={{ background: i.issueType.color }}
                >
                  {i.issueType.name}
                </span>
              </td>
              <td className="px-3 py-2">
                <Link href={`/issues/${key}-${i.keyId}`} className="hover:underline">
                  {i.summary}
                </Link>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: i.status.color }}
                  />
                  {i.status.name}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-600">
                {i.assignee?.name ?? <span className="text-slate-300">未割り当て</span>}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {PRIORITY_LABEL.get(i.priorityId) ?? i.priorityId}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {i.dueDate ? i.dueDate.toISOString().slice(0, 10) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 && (
            <Link
              href={qs({ offset: filter.offset - filter.count })}
              className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
            >
              前へ
            </Link>
          )}
          <span className="text-slate-500">
            {page} / {pages}
          </span>
          {page < pages && (
            <Link
              href={qs({ offset: filter.offset + filter.count })}
              className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
            >
              次へ
            </Link>
          )}
        </div>
      )}
    </Shell>
  );
}
