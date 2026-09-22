import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { projectNav } from "@/lib/project-nav";
import { EmptyState, PageTitle } from "@/components/ui";
import { loadGitContext, commitTitle } from "@/lib/git-view";
import { RepoTabs } from "../../RepoTabs";

/** コミット一覧。紐づいた課題キーも並べて「コミット→課題」を辿れるようにする */
export default async function Commits({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; repo: string }>;
  searchParams: Promise<{ page?: string; ref?: string }>;
}) {
  const { key, repo } = await params;
  const sp = await searchParams;
  const { user, project, ctx, repository, org, provider, repoRef } = await loadGitContext(
    key,
    decodeURIComponent(repo),
  );
  const name = repository!.name;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const ref = sp.ref || repository!.defaultBranch;

  // 提供元が未設定なら空。画面は開く（繋ぐ前でも設定へ辿り着けるように）
  const commits = provider && repoRef
    ? await provider.listCommits(repoRef, { sha: ref, page, limit: 30 })
    : [];

  // 紐づいている課題をまとめて引く（コミットごとにクエリを出さない）
  const links = await prisma.commitIssueLink.findMany({
    where: {
      repositoryId: repository!.id,
      commitSha: { in: commits.map((c) => c.sha) },
    },
    include: { issue: { select: { keyId: true, summary: true } } },
  });
  const byCommit = new Map<string, typeof links>();
  for (const l of links) {
    const arr = byCommit.get(l.commitSha) ?? [];
    arr.push(l);
    byCommit.set(l.commitSha, arr);
  }

  return (
    <Shell
      user={user}
      project={projectNav(project, user, ctx, "git")}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Git", href: `/projects/${key}/git` },
        { label: name, href: `/projects/${key}/git/${encodeURIComponent(name)}` },
        { label: "コミット" },
      ]}
    >
      <div className="flex items-baseline justify-between">
        <PageTitle>{name} のコミット</PageTitle>
        <span className="font-mono text-xs text-slate-500">{ref}</span>
      </div>

      <RepoTabs projectKey={key} repo={name} current="commits" />

      {commits.length === 0 ? (
        <EmptyState className="mt-4">
          コミットがありません
        </EmptyState>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {commits.map((c) => (
            <li key={c.sha} className="px-3 py-2.5">
              <div className="flex items-baseline gap-3">
                <Link
                  href={`/projects/${key}/git/${encodeURIComponent(name)}/commits/${c.sha}`}
                  className="font-mono text-xs text-brand-700 hover:underline"
                >
                  {c.sha.slice(0, 7)}
                </Link>
                <span className="flex-1 text-sm">{commitTitle(c.message)}</span>
                <span className="text-xs text-slate-400">
                  {c.authorName} /{" "}
                  {c.authoredAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>
              {(byCommit.get(c.sha) ?? []).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {(byCommit.get(c.sha) ?? []).map((l) => (
                    <Link
                      key={l.id}
                      href={`/issues/${project.key}-${l.issue.keyId}`}
                      className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800 hover:underline"
                      title={l.issue.summary}
                    >
                      {project.key}-{l.issue.keyId}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? (
          <Link
            href={`/projects/${key}/git/${encodeURIComponent(name)}/commits?page=${page - 1}&ref=${encodeURIComponent(ref)}`}
            className="text-brand-700 hover:underline"
          >
            ← 新しい
          </Link>
        ) : (
          <span />
        )}
        {commits.length === 30 && (
          <Link
            href={`/projects/${key}/git/${encodeURIComponent(name)}/commits?page=${page + 1}&ref=${encodeURIComponent(ref)}`}
            className="text-brand-700 hover:underline"
          >
            古い →
          </Link>
        )}
      </div>
    </Shell>
  );
}
