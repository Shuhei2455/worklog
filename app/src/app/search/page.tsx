import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser, visibleProjectIds } from "@/lib/session";
import { searchIssueIds, searchWikis, searchAvailable } from "@/lib/search";
import { Shell } from "@/components/Shell";
import { PageTitle, Button } from "@/components/ui";

/**
 * 横断検索。
 *
 * 課題とWikiをまとめて探す。**キーワードは Meilisearch に投げ、
 * 返ったIDでDBを絞る二段構え**(docs/01-design.md 5章)。
 * 権限とその他の条件はDB側で一度に効かせる。
 */
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await currentUser();
  const visible = await visibleProjectIds(user.id);
  const keyword = (q ?? "").trim();

  const available = await searchAvailable();

  let issues: Awaited<ReturnType<typeof prisma.issue.findMany>> = [];
  let issuesWithRel: Array<{
    id: number;
    keyId: number;
    summary: string;
    project: { key: string; name: string };
    status: { name: string; color: string };
  }> = [];
  let wikis: Awaited<ReturnType<typeof searchWikis>> = [];

  if (keyword && available) {
    const ids = await searchIssueIds(keyword, visible);
    if (ids.length) {
      // 権限は必ずDB側で効かせる。Meilisearch の結果をそのまま出さない
      const found = await prisma.issue.findMany({
        where: { id: { in: ids }, projectId: { in: visible } },
        include: {
          project: { select: { key: true, name: true } },
          status: { select: { name: true, color: true } },
        },
        take: 50,
      });
      // Meilisearch が返した順（関連度順）を保つ
      const rank = new Map(ids.map((id, i) => [id, i]));
      issuesWithRel = found
        .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
        .map((i) => ({
          id: i.id,
          keyId: i.keyId,
          summary: i.summary,
          project: i.project,
          status: i.status,
        }));
    }
    wikis = await searchWikis(keyword, visible);
  }
  void issues;

  return (
    <Shell user={user} breadcrumbs={[{ label: "検索" }]}>
      <PageTitle>検索</PageTitle>

      <form className="mt-4 flex gap-2">
        <input
          name="q"
          defaultValue={keyword}
          placeholder="課題とWikiをまとめて探す"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <Button variant="primary" size="md">
          検索
        </Button>
      </form>

      {!available && (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          検索エンジン（Meilisearch）に繋がりません。
          課題一覧のキーワード絞り込みは引き続き使えます。
        </p>
      )}

      {keyword && available && (
        <>
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-600">
              課題（{issuesWithRel.length}）
            </h2>
            {issuesWithRel.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">該当なし</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
                {issuesWithRel.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2">
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
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: i.status.color }}
                      />
                      {i.status.name}
                    </span>
                    <span className="text-xs text-slate-400">{i.project.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-600">
              Wiki（{wikis.length}）
            </h2>
            {wikis.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">該当なし</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
                {wikis.map((w) => (
                  <li key={w.id} className="px-4 py-2">
                    <Link
                      href={`/projects/${w.projectKey}/wiki/${encodeURIComponent(w.name)}`}
                      className="text-brand-700 hover:underline"
                    >
                      {w.name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-400">{w.projectKey}</span>
                    {w.tags?.length > 0 && (
                      <span className="ml-2 text-xs text-slate-500">
                        {w.tags.join(" / ")}
                      </span>
                    )}
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                      {w.content.slice(0, 140)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}
