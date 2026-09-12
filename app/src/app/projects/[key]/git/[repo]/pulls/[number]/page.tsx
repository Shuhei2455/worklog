import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Shell } from "@/components/Shell";
import { Markdown } from "@/components/Markdown";
import { loadGitContext, PR_STATE_LABEL } from "@/lib/git-view";
import { linkPullRequestIssue } from "../../../actions";

/**
 * プルリクエストの詳細。
 *
 * レビューとマージは Gitea の画面で行う（自作しない）。ここでは
 * 中身の確認と、**関連課題の付け替え**ができるようにする。
 * ブランチ名から自動で付くが、後から直したいことがある。
 */
export default async function PullDetail({
  params,
}: {
  params: Promise<{ key: string; repo: string; number: string }>;
}) {
  const { key, repo, number } = await params;
  const { user, project, repository, org, ctx } = await loadGitContext(
    key,
    decodeURIComponent(repo),
  );
  const name = repository!.name;

  const pr = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_giteaPrNumber: {
        repositoryId: repository!.id,
        giteaPrNumber: Number(number),
      },
    },
    include: {
      issue: { select: { keyId: true, summary: true } },
      assignee: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!pr) notFound();

  const bind = linkPullRequestIssue.bind(null, key, name, pr.giteaPrNumber);
  const giteaUrl = `${process.env.APP_URL ?? ""}/git/${org}/${encodeURIComponent(name)}/pulls/${pr.giteaPrNumber}`;

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Git", href: `/projects/${key}/git` },
        { label: name, href: `/projects/${key}/git/${encodeURIComponent(name)}` },
        {
          label: "プルリクエスト",
          href: `/projects/${key}/git/${encodeURIComponent(name)}/pulls`,
        },
        { label: `#${pr.giteaPrNumber}` },
      ]}
    >
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">
          #{pr.giteaPrNumber} {pr.title}
        </h1>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            pr.state === "merged"
              ? "bg-violet-100 text-violet-800"
              : pr.state === "closed"
                ? "bg-slate-100 text-slate-600"
                : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {PR_STATE_LABEL[pr.state] ?? pr.state}
        </span>
      </div>

      <p className="mt-2 font-mono text-xs text-slate-500">
        {pr.headBranch} → {pr.baseBranch}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="rounded border border-slate-200 bg-white p-4">
          {pr.body ? (
            <Markdown>{pr.body}</Markdown>
          ) : (
            <p className="text-sm text-slate-400">説明はありません</p>
          )}
        </div>

        <aside className="space-y-4 text-sm">
          <dl className="rounded border border-slate-200 bg-white p-3">
            <Row label="作成者" value={pr.createdBy?.name ?? "不明"} />
            <Row label="担当者" value={pr.assignee?.name ?? "未割り当て"} />
            <Row
              label="マージ"
              value={pr.mergeAt ? pr.mergeAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
            />
            <Row
              label="クローズ"
              value={pr.closeAt ? pr.closeAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
            />
          </dl>

          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="text-xs font-medium text-slate-500">関連する課題</h2>
            {pr.issue ? (
              <p className="mt-1">
                <Link
                  href={`/issues/${project.key}-${pr.issue.keyId}`}
                  className="font-mono text-sky-700 hover:underline"
                >
                  {project.key}-{pr.issue.keyId}
                </Link>
                <span className="ml-2 text-slate-600">{pr.issue.summary}</span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                なし（ブランチ名に課題キーを入れると自動で付きます）
              </p>
            )}
            {ctx.isMember && (
              <form action={bind} className="mt-2 flex items-center gap-2">
                <input
                  name="issueKey"
                  placeholder={`${project.key}-1`}
                  className="w-28 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                />
                <button className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                  付け替え
                </button>
              </form>
            )}
          </div>

          <a
            href={giteaUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded border border-slate-300 px-3 py-2 text-center text-sm text-sky-700 hover:bg-slate-50"
          >
            Gitea で開く（レビュー・マージ）
          </a>
        </aside>
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
