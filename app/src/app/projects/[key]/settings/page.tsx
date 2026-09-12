import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import {
  updateFeatures,
  addStatus,
  reorderStatus,
  deleteStatus,
  addIssueType,
  addCategory,
  addVersion,
  addMember,
  removeMember,
  toggleProjectAdmin,
  addWebhook,
  deleteWebhook,
} from "./actions";
import {
  createRepository,
  toggleLinkCommits,
  detachRepository,
  importRepository,
} from "./git-actions";
import { giteaEnabled } from "@/lib/gitea";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default async function ProjectSettings({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { key } = await params;
  const { ok, error } = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  // 参加していないプロジェクトは管理者でも見えない
  if (!can(user, "project.edit", ctx) && !can(user, "issueType.manage", ctx)) {
    notFound();
  }

  const canEditProject = can(user, "project.edit", ctx);
  const canManageMasters = can(user, "issueType.manage", ctx);
  const canAssignAdmin = can(user, "projectAdmin.assign", ctx);

  const [statuses, issueTypes, categories, versions, members, webhooks, repositories] =
    await Promise.all([
    prisma.status.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.issueType.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.category.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.version.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: true },
      orderBy: { userId: "asc" },
    }),
    prisma.webhook.findMany({
      where: { projectId: project.id },
      orderBy: { id: "asc" },
    }),
    prisma.repository.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  const bind = <T,>(fn: (key: string, fd: FormData) => Promise<T>) =>
    fn.bind(null, key);

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/settings` },
        { label: "設定" },
      ]}
    >
      <h1 className="text-xl font-semibold">
        <span className="mr-2 rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-600">
          {project.key}
        </span>
        {project.name}
      </h1>

      {ok && (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ok}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* ---------------- 基本設定 ---------------- */}
      <Section
        title="基本設定"
        note="「チャートを使用する」がOFFだと、課題に開始日・期限日を入力できません。"
      >
        {canEditProject ? (
          <form action={bind(updateFeatures)} className="space-y-4">
            <label className="block text-sm">
              <span className="text-slate-600">プロジェクト名</span>
              <input
                name="name"
                defaultValue={project.name}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">説明</span>
              <textarea
                name="description"
                defaultValue={project.description ?? ""}
                rows={2}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                ["chartEnabled", "チャートを使用する", project.chartEnabled],
                ["subtaskingEnabled", "親子課題を使用する", project.subtaskingEnabled],
                ["wikiEnabled", "Wikiを使用する", project.wikiEnabled],
                ["fileSharingEnabled", "ファイル共有を使用する", project.fileSharingEnabled],
                ["gitEnabled", "Gitを使用する", project.gitEnabled],
              ].map(([n, label, v]) => (
                <label key={n as string} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name={n as string}
                    defaultChecked={v as boolean}
                  />
                  {label as string}
                </label>
              ))}
            </div>
            <button className="rounded bg-brand-700 px-4 py-1.5 text-sm text-white hover:bg-brand-800">
              保存
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            プロジェクトの編集は管理者とプロジェクト管理者のみ行えます。
          </p>
        )}
      </Section>

      {/* ---------------- 状態 ---------------- */}
      <Section
        title="状態"
        note="標準の4状態は削除も並べ替えもできません。追加した状態は「未対応」より前、「完了」より後には置けません。"
      >
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {statuses.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-6 text-right text-xs text-slate-400">{i + 1}</span>
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: s.color }}
              />
              <span className="flex-1">{s.name}</span>
              {s.isDefault && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  標準
                </span>
              )}
              <span className="w-14 text-right text-xs text-slate-400">
                {s.displayOrder}
              </span>
              {canEditProject && (
                <span className="flex gap-1">
                  {[-1, 1].map((d) => (
                    <form key={d} action={bind(reorderStatus)}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="delta" value={d} />
                      <button
                        title={
                          s.isDefault
                            ? "標準の4状態は並べ替えできません"
                            : d < 0
                              ? "上へ"
                              : "下へ"
                        }
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                        disabled={s.isDefault}
                      >
                        {d < 0 ? "↑" : "↓"}
                      </button>
                    </form>
                  ))}
                  <form action={bind(deleteStatus)}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-700 enabled:hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={s.isDefault}
                      title={s.isDefault ? "標準の4状態は削除できません" : "削除"}
                    >
                      削除
                    </button>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ul>

        {canEditProject && (
          <form action={bind(addStatus)} className="mt-3 flex items-end gap-2">
            <label className="text-sm">
              <span className="block text-slate-600">状態を追加</span>
              <input
                name="name"
                required
                placeholder="レビュー中"
                className="mt-1 rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <input
              type="color"
              name="color"
              defaultValue="#7c3aed"
              className="h-8 w-10 rounded border border-slate-300"
            />
            <button className="h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-50">
              追加
            </button>
          </form>
        )}
      </Section>

      {/* ---------------- 種別・カテゴリー・バージョン ---------------- */}
      <Section
        title="種別・カテゴリー・バージョン"
        note="これらは「制限なし」の一般ユーザーでも編集できます（プロジェクト管理者専用ではありません）。バージョンはマイルストーンと同一です。"
      >
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              label: "課題種別",
              items: issueTypes.map((t) => ({ id: t.id, name: t.name, color: t.color })),
              action: bind(addIssueType),
              withColor: true,
              extra: null,
            },
            {
              label: "カテゴリー",
              items: categories.map((c) => ({ id: c.id, name: c.name, color: null })),
              action: bind(addCategory),
              withColor: false,
              extra: null,
            },
            {
              label: "バージョン / マイルストーン",
              items: versions.map((v) => ({
                id: v.id,
                name:
                  v.name +
                  (v.releaseDueDate
                    ? ` (${v.releaseDueDate.toISOString().slice(0, 10)})`
                    : ""),
                color: null,
              })),
              action: bind(addVersion),
              withColor: false,
              extra: (
                <input
                  type="date"
                  name="releaseDueDate"
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              ),
            },
          ].map((g) => (
            <div key={g.label}>
              <h3 className="text-xs font-semibold text-slate-600">{g.label}</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {g.items.length === 0 && (
                  <li className="text-xs text-slate-400">なし</li>
                )}
                {g.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-slate-400">
                      {it.id}
                    </span>
                    {it.color && (
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: it.color }}
                      />
                    )}
                    {it.name}
                  </li>
                ))}
              </ul>
              {canManageMasters && (
                <form action={g.action} className="mt-3">
                  <input
                    name="name"
                    required
                    placeholder="名前"
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  {g.extra}
                  {g.withColor && (
                    <input
                      type="color"
                      name="color"
                      defaultValue="#3b82f6"
                      className="mt-1 h-7 w-10 rounded border border-slate-300"
                    />
                  )}
                  <button className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                    追加
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------------- Git ---------------- */}
      {canEditProject && (
        <Section
          title="Gitリポジトリ"
          note="リポジトリの実体は Gitea に置きます（Gitホスティングは自作しません）。ここで作ると organization・メンバー・webhook まで用意されます。"
        >
          {!giteaEnabled() ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Gitea が設定されていません。<code>GITEA_URL</code> と{" "}
              <code>GITEA_ADMIN_TOKEN</code> を入れて app を再起動してください
              （トークンの作り方は <code>scripts/gitea-setup.sh</code>）。
            </p>
          ) : repositories.length === 0 ? (
            <p className="text-xs text-slate-400">なし</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {repositories.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <a
                      href={`/projects/${key}/git/${encodeURIComponent(r.name)}`}
                      className="font-medium text-sky-700 hover:underline"
                    >
                      {r.name}
                    </a>
                    <span className="flex-1 truncate text-xs text-slate-500">
                      {r.description ?? ""}
                    </span>
                    <form action={bind(toggleLinkCommits)}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        className={`rounded border px-2 py-0.5 text-xs ${
                          r.linkCommitsToIssues
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-slate-300 text-slate-500"
                        }`}
                        title="コミットメッセージの課題キーから、課題へコメントを自動登録します"
                      >
                        課題連携 {r.linkCommitsToIssues ? "ON" : "OFF"}
                      </button>
                    </form>
                    <form action={bind(detachRepository)}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-red-700 hover:underline">
                        登録解除
                      </button>
                    </form>
                  </div>
                  <div className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
                    <div>{httpCloneUrl(project.giteaOrg ?? project.key, r.name)}</div>
                    <div>{sshCloneUrl(project.giteaOrg ?? project.key, r.name)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {giteaEnabled() && (
            <>
            <form
              action={bind(createRepository)}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="text-sm">
                <span className="block text-xs text-slate-500">リポジトリ名</span>
                <input
                  name="name"
                  required
                  placeholder="web"
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="flex-1 text-sm">
                <span className="block text-xs text-slate-500">説明</span>
                <input
                  name="description"
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <button className="h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-50">
                作成
              </button>
            </form>

            {/* Gitea に直接作ったリポジトリを、この一覧に載せる。
                webhook も登録し直すので、連携もそこから効き始める */}
            <form
              action={bind(importRepository)}
              className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
            >
              <label className="text-sm">
                <span className="block text-xs text-slate-500">
                  Gitea に既にあるリポジトリを取り込む
                </span>
                <input
                  name="name"
                  required
                  placeholder="リポジトリ名"
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <button className="h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-50">
                取り込む
              </button>
            </form>
            </>
          )}
        </Section>
      )}

      {/* ---------------- webhook ---------------- */}
      {canEditProject && (
        <Section
          title="webhook"
          note="課題の追加・更新などを外部へ通知します。Slack や Teams の受け口を想定しています。送信は非同期なので、相手が遅くても画面は待ちません。"
        >
          {webhooks.length === 0 ? (
            <p className="text-xs text-slate-400">なし</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {webhooks.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="font-medium">{w.name}</span>
                  <span className="flex-1 truncate font-mono text-xs text-slate-500">
                    {w.hookUrl}
                  </span>
                  <span className="text-xs text-slate-400">
                    {w.allEvent ? "全イベント" : `${w.activityTypes.length}種`}
                  </span>
                  <form action={bind(deleteWebhook)}>
                    <input type="hidden" name="id" value={w.id} />
                    <button className="text-xs text-red-700 hover:underline">削除</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={bind(addWebhook)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs text-slate-500">名前</span>
              <input
                name="name"
                required
                placeholder="Slack 通知"
                className="mt-1 rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="flex-1 text-sm">
              <span className="block text-xs text-slate-500">送信先URL</span>
              <input
                name="hookUrl"
                required
                placeholder="https://hooks.example.com/..."
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
              />
            </label>
            <button className="h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-50">
              追加
            </button>
          </form>
        </Section>
      )}

      {/* ---------------- 参加ユーザー ---------------- */}
      <Section
        title="参加ユーザー"
        note="ゲストと、制限のあるユーザーはプロジェクト管理者になれません。"
      >
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                {m.user.name}
                <span className="ml-2 font-mono text-xs text-slate-400">
                  {m.user.userId}
                </span>
              </span>
              <span className="text-xs text-slate-500">
                {{ admin: "管理者", member: "一般", guest: "ゲスト" }[m.user.userType]}
                {m.user.restriction !== "none" &&
                  ` / ${{ issue_create_only: "登録のみ", issue_view_only: "閲覧のみ" }[m.user.restriction]}`}
              </span>
              {m.isProjectAdmin && (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">
                  PJ管理者
                </span>
              )}
              {canAssignAdmin && (
                <form action={bind(toggleProjectAdmin)}>
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">
                    {m.isProjectAdmin ? "解除" : "PJ管理者にする"}
                  </button>
                </form>
              )}
              {canEditProject && (
                <form action={bind(removeMember)}>
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">
                    外す
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>

        {canEditProject && (
          <form action={bind(addMember)} className="mt-3 flex items-end gap-2">
            <label className="text-sm">
              <span className="block text-slate-600">ログインIDで追加</span>
              <input
                name="userId"
                required
                placeholder="admin"
                className="mt-1 rounded border border-slate-300 px-2 py-1 font-mono"
              />
            </label>
            <button className="h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-50">
              追加
            </button>
          </form>
        )}
      </Section>
    </Shell>
  );
}
