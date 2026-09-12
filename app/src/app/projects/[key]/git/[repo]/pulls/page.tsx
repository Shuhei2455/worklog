import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { loadGitContext, PR_STATE_LABEL } from "@/lib/git-view";
import { syncPullRequests } from "../../actions";
import { RepoTabs } from "../../RepoTabs";

/**
 * プルリクエストの一覧。
 *
 * 実体は Gitea にあるが、一覧はこちらのDBから出す。webhook で
 * 取り込んであるので、画面を開くたびに Gitea を叩かずに済む。
 */
export default async function Pulls({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; repo: string }>;
  searchParams: Promise<{ state?: string; ok?: string }>;
}) {
  const { key, repo } = await params;
  const sp = await searchParams;
  const { user, project, repository, org } = await loadGitContext(
    key,
    decodeURIComponent(repo),
  );
  const name = repository!.name;
  const state = sp.state ?? "open";

  const pulls = await prisma.pullRequest.findMany({
    where: {
      repositoryId: repository!.id,
      ...(state === "all" ? {} : { state }),
    },
    include: {
      issue: { select: { keyId: true, summary: true } },
      assignee: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { giteaPrNumber: "desc" },
  });

  const filters = [
    { id: "open", label: "オープン" },
    { id: "merged", label: "マージ済み" },
    { id: "closed", label: "クローズ" },
    { id: "all", label: "すべて" },
  ];

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Git", href: `/projects/${key}/git` },
        { label: name, href: `/projects/${key}/git/${encodeURIComponent(name)}` },
        { label: "プルリクエスト" },
      ]}
    >
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{name} のプルリクエスト</h1>
        <a
          href={`${process.env.APP_URL ?? ""}/git/${org}/${encodeURIComponent(name)}/pulls`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sky-700 hover:underline"
        >
          Gitea で開く（作成・レビューはこちら）
        </a>
      </div>

      <RepoTabs projectKey={key} repo={name} current="pulls" />

      {sp.ok && (
        <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sp.ok}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 text-sm">
        {filters.map((f) => (
          <Link
            key={f.id}
            href={`/projects/${key}/git/${encodeURIComponent(name)}/pulls?state=${f.id}`}
            className={
              f.id === state
                ? "rounded bg-brand-700 px-2 py-0.5 text-white"
                : "rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100"
            }
          >
            {f.label}
          </Link>
        ))}
        <span className="flex-1" />
        {/* webhook は登録後のぶんしか来ない。取り込み直後は過去のPRが無いので、
            ここから手で埋められるようにする */}
        <form action={syncPullRequests.bind(null, key, name)}>
          <button className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
            Gitea から取り込む
          </button>
        </form>
      </div>

      {pulls.length === 0 ? (
        <p className="mt-4 rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          プルリクエストがありません
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {pulls.map((p) => (
            <li key={p.id} className="px-3 py-2.5">
              <div className="flex items-baseline gap-3">
                <Link
                  href={`/projects/${key}/git/${encodeURIComponent(name)}/pulls/${p.giteaPrNumber}`}
                  className="text-sm font-medium text-sky-700 hover:underline"
                >
                  #{p.giteaPrNumber} {p.title}
                </Link>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    p.state === "merged"
                      ? "bg-violet-100 text-violet-800"
                      : p.state === "closed"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {PR_STATE_LABEL[p.state] ?? p.state}
                </span>
                <span className="flex-1" />
                {p.issue && (
                  <Link
                    href={`/issues/${project.key}-${p.issue.keyId}`}
                    className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-xs text-sky-800 hover:underline"
                    title={p.issue.summary}
                  >
                    {project.key}-{p.issue.keyId}
                  </Link>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {p.headBranch} → {p.baseBranch}
                {p.createdBy && <span className="ml-2 font-sans">{p.createdBy.name}</span>}
                {p.assignee && (
                  <span className="ml-2 font-sans">担当: {p.assignee.name}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
