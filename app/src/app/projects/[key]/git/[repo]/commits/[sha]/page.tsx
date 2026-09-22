import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { projectNav } from "@/lib/project-nav";
import { loadGitContext, splitPatch } from "@/lib/git-view";

/** コミット1件の差分と、紐づいた課題（コミット→課題の経路） */
export default async function CommitDetail({
  params,
}: {
  params: Promise<{ key: string; repo: string; sha: string }>;
}) {
  const { key, repo, sha } = await params;
  const { user, project, ctx, repository, org, provider, repoRef } = await loadGitContext(
    key,
    decodeURIComponent(repo),
  );
  const name = repository!.name;

  const [commit] = provider && repoRef
    ? await provider.listCommits(repoRef, { sha, limit: 1 })
    : [];
  // 提供元はファイル単位で patch を返す（GitHubの形）
  const files = (provider && repoRef ? await provider.commitDiff(repoRef, sha) : []).map((f) => ({
    file: f.path,
    lines: splitPatch(f.patch),
  }));

  const links = await prisma.commitIssueLink.findMany({
    where: { repositoryId: repository!.id, commitSha: sha },
    include: { issue: { select: { keyId: true, summary: true } } },
  });

  return (
    <Shell
      user={user}
      project={projectNav(project, user, ctx, "git")}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Git", href: `/projects/${key}/git` },
        { label: name, href: `/projects/${key}/git/${encodeURIComponent(name)}` },
        { label: sha.slice(0, 7) },
      ]}
    >
      <h1 className="font-mono text-lg font-semibold">{sha.slice(0, 10)}</h1>

      {commit ? (
        <div className="mt-3 rounded border border-slate-200 bg-white p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm">
            {commit.message.trim()}
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            {commit.authorName} &lt;{commit.authorEmail}&gt; /{" "}
            {commit.authoredAt.slice(0, 19).replace("T", " ")}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このコミットは Gitea 側に見つかりません（force push などで消えた可能性があります）
        </p>
      )}

      {links.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-slate-600">関連するタスク</h2>
          <ul className="mt-2 space-y-1">
            {links.map((l) => (
              <li key={l.id} className="text-sm">
                <Link
                  href={`/issues/${project.key}-${l.issue.keyId}`}
                  className="font-mono text-brand-700 hover:underline"
                >
                  {project.key}-{l.issue.keyId}
                </Link>
                <span className="ml-2 text-slate-600">{l.issue.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-6 text-sm font-medium text-slate-600">
        変更 {files.length > 0 ? `(${files.length} ファイル)` : ""}
      </h2>
      {files.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">差分がありません</p>
      ) : (
        <div className="mt-2 space-y-4">
          {files.map((f) => (
            <div key={f.file} className="overflow-x-auto rounded border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-600">
                {f.file}
              </div>
              <pre className="text-xs leading-5">
                {f.lines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.kind === "add"
                        ? "bg-emerald-50 px-3 text-emerald-900"
                        : l.kind === "del"
                          ? "bg-red-50 px-3 text-red-900"
                          : l.kind === "hunk"
                            ? "bg-slate-100 px-3 text-slate-500"
                            : l.kind === "meta"
                              ? "px-3 text-slate-400"
                              : "px-3 text-slate-700"
                    }
                  >
                    {l.text || " "}
                  </div>
                ))}
              </pre>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
