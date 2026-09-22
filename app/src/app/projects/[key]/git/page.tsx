import Link from "next/link";
import { Shell } from "@/components/Shell";
import { can } from "@/lib/permissions";
import { EmptyState, Notice, PageTitle } from "@/components/ui";
import { loadGitContext } from "@/lib/git-view";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";

/** リポジトリの一覧。プロジェクトのGitの入口 */
export default async function GitRepositories({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const { user, project, ctx, repositories, org, gitConfigured, provider } =
    await loadGitContext(key);

  return (
    <Shell
      user={user}
      project={{
        key: key,
        name: project.name,
        current: "git",
        show: {
          addIssue: can(user, "issue.create", ctx),
          wiki: project.wikiEnabled && can(user, "wiki.view", ctx),
          files: project.fileSharingEnabled && can(user, "sharedFile.access", ctx),
          chart: project.chartEnabled,
          git: true,
          settings: can(user, "project.edit", ctx),
        },
      }}
    >
      <PageTitle>Gitリポジトリ</PageTitle>

      {/* 提供元が未設定でも画面は開く。繋ぐ前に設定へ辿り着けなくなると困る */}
      {!gitConfigured && (
        <Notice tone="warn" className="mt-4">
          Git連携が設定されていません。<code>GIT_PROVIDER</code> と{" "}
          <code>GITHUB_TOKEN</code> を <code>.env</code> に入れてください。
        </Notice>
      )}

      {/* この規約は知らないと使えない。ツールチップだけでは伝わらないので、
          実際のプロジェクトキーを入れた例を画面に出す */}
      <section className="mt-4 rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">タスクと結びつける書き方</h2>
        <p className="mt-2 text-slate-600">
          コミットメッセージに<strong>タスクキー</strong>を書くと、そのタスクに
          コメントが自動で登録されます。
        </p>
        <pre className="mt-1 overflow-x-auto rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          git commit -m &quot;{project.key}-1 ログイン画面の配色を直す&quot;
        </pre>
        <p className="mt-3 text-slate-600">
          ブランチ名に入れると、プルリクエストがそのタスクに紐づきます。
        </p>
        <pre className="mt-1 overflow-x-auto rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          {project.key}-1/login-redesign
        </pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500">
          <li>
            対象は<strong>このプロジェクトのタスクだけ</strong>です。
            他プロジェクトのキーを書いても書き込みません
          </li>
          <li>リポジトリごとに「タスク連携」をOFFにできます（プロジェクト設定）</li>
          <li>
            反映には提供元側でのWebhook登録が要ります。登録していないと、
            <strong>エラーは出ずに何も起きません</strong>
          </li>
        </ul>
      </section>

      {repositories.length === 0 ? (
        <EmptyState className="mt-4">
          リポジトリがありません。
          <Link href={`/projects/${key}/settings`} className="ml-1 text-brand-700 underline">
            プロジェクト設定
          </Link>
          で繋いでください。
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
                    タスク連携OFF
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
              {/* 提供元が外にある場合は**向こうのURL**でないとクローンできない */}
              {(() => {
                const urls = provider
                  ? provider.cloneUrls({ owner: org, name: r.name })
                  : { http: httpCloneUrl(org, r.name), ssh: sshCloneUrl(org, r.name) };
                return (
                  <dl className="mt-3 space-y-1 font-mono text-[11px] text-slate-500">
                    <div>
                      <span className="mr-2 font-sans text-slate-400">HTTP</span>
                      {urls.http}
                    </div>
                    {/* SSH が使えない環境では出さない。
                        つながらないURLを見せると利用者が延々悩む（lib/repo.ts） */}
                    {urls.ssh && (
                      <div>
                        <span className="mr-2 font-sans text-slate-400">SSH</span>
                        {urls.ssh}
                      </div>
                    )}
                  </dl>
                );
              })()}
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
