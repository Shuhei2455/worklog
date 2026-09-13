import Link from "next/link";
import { Shell } from "@/components/Shell";
import { EmptyState, PageTitle } from "@/components/ui";
import { loadGitContext } from "@/lib/git-view";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";

/** リポジトリの一覧。プロジェクトのGitの入口 */
export default async function GitRepositories({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const { user, project, repositories, org } = await loadGitContext(key);

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Git" },
      ]}
    >
      <PageTitle>Gitリポジトリ</PageTitle>

      {repositories.length === 0 ? (
        <EmptyState className="mt-4">
          リポジトリがありません。
          <Link href={`/projects/${key}/settings`} className="ml-1 text-brand-700 underline">
            プロジェクト設定
          </Link>
          で作成してください。
        </EmptyState>
      ) : (
        <ul className="mt-4 space-y-3">
          {repositories.map((r) => (
            <li key={r.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="flex items-baseline gap-3">
                <Link
                  href={`/projects/${key}/git/${encodeURIComponent(r.name)}`}
                  className="text-base font-semibold text-brand-700 hover:underline"
                >
                  {r.name}
                </Link>
                {!r.linkCommitsToIssues && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    課題連携OFF
                  </span>
                )}
                <span className="flex-1 text-sm text-slate-500">{r.description ?? ""}</span>
                <Link
                  href={`/projects/${key}/git/${encodeURIComponent(r.name)}/commits`}
                  className="text-xs text-brand-700 hover:underline"
                >
                  コミット
                </Link>
                <Link
                  href={`/projects/${key}/git/${encodeURIComponent(r.name)}/pulls`}
                  className="text-xs text-brand-700 hover:underline"
                >
                  プルリクエスト
                </Link>
              </div>
              <dl className="mt-3 space-y-1 font-mono text-[11px] text-slate-500">
                <div>
                  <span className="mr-2 font-sans text-slate-400">HTTP</span>
                  {httpCloneUrl(org, r.name)}
                </div>
                <div>
                  <span className="mr-2 font-sans text-slate-400">SSH</span>
                  {sshCloneUrl(org, r.name)}
                </div>
              </dl>
              {r.pushedAt && (
                <p className="mt-2 text-xs text-slate-400">
                  最終push: {r.pushedAt.toISOString().slice(0, 16).replace("T", " ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
