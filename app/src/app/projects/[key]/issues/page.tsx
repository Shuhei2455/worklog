import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { ActionResult, PageTitle, Button, ButtonLink, StatusLabel } from "@/components/ui";
import { readFlash } from "@/lib/flash";
import { STATUS_ID_CLOSED } from "@/lib/constants";
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
  // 検索条件の保存・CSV取り込みの結果はフラッシュ（cookie）で来る
  const flash = await readFlash(`/projects/${key}/issues`);
  // 期限切れの判定に使う。時刻が混ざると「今日が期限」が実行時刻で変わる
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // CSV出力へ渡すクエリ。いま見ている絞り込みをそのまま引き継ぐ
  const queryString = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]],
    ),
  ).toString();
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  // 参加していないプロジェクトは管理者でも見えない
  if (!can(user, "issue.view", ctx)) notFound();

  // 本家は statusId 未指定で開くと「完了以外」をURLに書き込んでから表示する
  // (00-spec-verified.md 13.1 / 13.6)。同じ挙動にするため既定値付きURLへ送る。
  //
  // - `statusId=""` は「すべて」を明示的に選んだ状態なので素通りさせる
  //   (undefined のときだけ誘導するので、往復にはならない)
  // - これは**画面の既定**。API の GET /issues には入れない(入れるとAPI互換が壊れる)
  // - CLAUDE.md の「同じURLへ redirect しない」は、サーバーアクションの戻りで
  //   スクロール位置が飛ぶのを防ぐための規約。ここは初回表示でクエリを足す誘導なので別物
  if (sp.statusId === undefined) {
    const open = await prisma.status.findMany({
      where: { projectId: project.id, id: { not: STATUS_ID_CLOSED } },
      select: { id: true },
      orderBy: { displayOrder: "asc" },
    });
    if (open.length > 0) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) {
        if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
        else if (typeof v === "string") q.set(k, v);
      }
      q.set("statusId", open.map((s) => s.id).join(","));
      redirect(`/projects/${key}/issues?${q.toString()}`);
    }
  }

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

  // 上のリダイレクトが作る値と同じ並び・同じ連結でないと、select の選択状態が合わない
  const openStatusValue = statuses
    .filter((s) => s.id !== STATUS_ID_CLOSED)
    .map((s) => s.id)
    .join(",");

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
      project={{
        key: key,
        name: project.name,
        current: "issues",
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
      {/* 画面をまたぐ移動は左サイドバー(ProjectSidebar)に集約した。
          ここには**この画面固有の操作**だけを残す */}
      <PageTitle
        actions={
          <>
            <a
              href={`/projects/${key}/issues/export${queryString ? `?${queryString}` : ""}`}
              className="text-sm text-brand-700 hover:underline"
              title="いま見ている絞り込みをそのまま出力します"
            >
              CSV出力
            </a>
            {can(user, "issue.create", ctx) && (
              <Link
                href={`/projects/${key}/issues/import`}
                className="text-sm text-brand-700 hover:underline"
              >
                CSV取り込み
              </Link>
            )}
            {can(user, "issue.create", ctx) && (
              <ButtonLink href={`/projects/${key}/issues/new`} variant="primary">
                タスクを追加
              </ButtonLink>
            )}
          </>
        }
      >
        タスク
      </PageTitle>

      <ActionResult ok={flash.ok} error={flash.error} />

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
            {/* 本家にもある「完了以外」。既定はこれなので、選択状態と絞り込みが食い違わないよう
                リダイレクトで入る値（displayOrder 順に連結したid）と同じ文字列にする */}
            <option value={openStatusValue}>完了以外</option>
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
        <Button variant="secondary">
          絞り込む
        </Button>
        <ButtonLink href={`/projects/${key}/issues`} variant="secondary">
          クリア
        </ButtonLink>
      </form>

      {/* 条件はURLクエリなので、保存＝そのクエリを名前付きで覚えるだけ */}
      <form
        action={saveFilter.bind(null, key)}
        className="mt-2 flex flex-wrap items-center gap-2 text-xs"
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
          className="w-full rounded border border-slate-300 px-2 py-1 sm:w-56"
        />
        <Button variant="secondary">
          保存
        </Button>
      </form>

      <p className="mt-4 text-xs text-slate-500">
        {total} 件中 {total === 0 ? 0 : filter.offset + 1}〜
        {Math.min(filter.offset + filter.count, total)} 件を表示
      </p>

      {/* スマホでは表が入らない（375px で 268px はみ出していた）。
          1行をカードに積み替える。出すのはキー・状態・件名・担当者・期限日で、
          種別と優先度は落とす（詳細を開けば見られる）。表はPC幅でだけ出す。 */}
      <ul className="mt-2 space-y-2 md:hidden">
        {issues.length === 0 && (
          <li className="rounded border border-slate-200 bg-white px-3 py-8 text-center text-slate-400">
            該当するタスクがありません
          </li>
        )}
        {issues.map((i) => (
          <li key={i.id} className="rounded border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/issues/${key}-${i.keyId}`}
                className="font-mono text-xs text-brand-700 hover:underline"
              >
                {key}-{i.keyId}
              </Link>
              <StatusLabel name={i.status.name} color={i.status.color} />
            </div>
            <Link
              href={`/issues/${key}-${i.keyId}`}
              className="mt-1 block text-base hover:underline"
            >
              {i.summary}
            </Link>
            <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
              <span>担当 {i.assignee?.name ?? "未割り当て"}</span>
              {i.dueDate && (
                <span
                  className={
                    i.dueDate < today && i.statusId !== STATUS_ID_CLOSED
                      ? "font-medium text-red-700"
                      : ""
                  }
                >
                  期限 {i.dueDate.toISOString().slice(0, 10)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <table className="mt-2 hidden w-full border-collapse overflow-hidden rounded border border-slate-200 bg-white text-sm md:table">
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
                該当するタスクがありません
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
                <StatusLabel name={i.status.name} color={i.status.color} />
              </td>
              <td className="px-3 py-2 text-slate-600">
                {i.assignee?.name ?? <span className="text-slate-300">未割り当て</span>}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {PRIORITY_LABEL.get(i.priorityId) ?? i.priorityId}
              </td>
              {/* 期限切れは赤くする。ダッシュボードと揃える
                  （完了したタスクは過ぎていても急ぎではないので普通の色） */}
              <td
                className={`px-3 py-2 ${
                  i.dueDate && i.dueDate < today && i.statusId !== STATUS_ID_CLOSED
                    ? "font-medium text-red-700"
                    : "text-slate-600"
                }`}
              >
                {i.dueDate ? i.dueDate.toISOString().slice(0, 10) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          {page > 1 && (
            <ButtonLink href={qs({ offset: filter.offset - filter.count })} variant="secondary">
              前へ
            </ButtonLink>
          )}
          <span className="text-slate-500">
            {page} / {pages}
          </span>
          {page < pages && (
            <ButtonLink href={qs({ offset: filter.offset + filter.count })} variant="secondary">
              次へ
            </ButtonLink>
          )}
        </div>
      )}
    </Shell>
  );
}
