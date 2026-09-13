import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { loadGitContext, splitDiff } from "@/lib/git-view";
import { listCommits, commitDiff } from "@/lib/gitea";

/** コミット1件の差分と、紐づいた課題（コミット→課題の経路） */
export default async function CommitDetail({
  params,
}: {
  params: Promise<{ key: string; repo: string; sha: string }>;
}) {
  const { key, repo, sha } = await params;
  const { user, project, repository, org } = await loadGitContext(
    key,
    decodeURIComponent(repo),
  );
  const name = repository!.name;

  const [commit] = await listCommits(org, name, { sha, limit: 1 });
  const diff = await commitDiff(org, name, sha);
  const files = splitDiff(diff);

  const links = await prisma.commitIssueLink.findMany({
    where: { repositoryId: repository!.id, commitSha: sha },
    include: { issue: { select: { keyId: true, summary: true } } },
  });

  return (
    <Shell
      user={user}
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
            {commit.commit.message.trim()}
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            {commit.commit.author.name} &lt;{commit.commit.author.email}&gt; /{" "}
            {commit.commit.author.date.slice(0, 19).replace("T", " ")}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このコミットは Gitea 側に見つかりません（force push などで消えた可能性があります）
        </p>
      )}

      {links.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-slate-600">関連する課題</h2>
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
