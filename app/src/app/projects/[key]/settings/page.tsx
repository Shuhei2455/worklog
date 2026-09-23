import { notFound } from "next/navigation";
import { readFlash } from "@/lib/flash";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import {
  Section,
  PageTitle,
  ActionResult,
  Button,
  NoValue,
  inputClass,
  ToggleChip,
} from "@/components/ui";
import {
  updateFeatures,
  addStatus,
  updateStatus,
  updateCategory,
  updateIssueType,
  updateWebhook,
  reorderStatus,
  deleteStatus,
  addIssueType,
  addCategory,
  addVersion,
  updateVersion,
  addMember,
  removeMember,
  toggleProjectAdmin,
  addWebhook,
  deleteWebhook,
  addProjectTeam,
  removeProjectTeam,
} from "./actions";
import {
  connectRepository,
  toggleLinkCommits,
  detachRepository,
} from "./git-actions";
import { gitProvider, type GitRepo } from "@/lib/git";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";


export default async function ProjectSettings({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  // メッセージはフラッシュ（cookie）から。同じURLへ redirect すると画面が飛ぶ
  const flash = await readFlash(`/projects/${key}/settings`);
  const ok = sp.ok ?? flash.ok;
  const error = sp.error ?? flash.error;
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

  const [
    statuses,
    issueTypes,
    categories,
    versions,
    members,
    webhooks,
    repositories,
    projectTeams,
  ] = await Promise.all([
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
    prisma.projectTeam.findMany({
      where: { projectId: project.id },
      include: { team: { include: { _count: { select: { members: true } } } } },
    }),
  ]);

  // 提供元のリポジトリ一覧。未設定なら null にして、繋ぐ欄ごと出さない。
  // 向こうが落ちていても設定画面が開けなくなると困るので、失敗は空扱いにする
  const provider = gitProvider();
  const gitProviderName = provider?.name ?? "";
  let providerRepos: GitRepo[] | null = null;
  if (provider && canEditProject) {
    try {
      providerRepos = await provider.listRepos();
    } catch {
      providerRepos = [];
    }
  }

  const bind = <T,>(fn: (key: string, fd: FormData) => Promise<T>) =>
    fn.bind(null, key);

  return (
    <Shell
      user={user}
      project={{
        key: key,
        name: project.name,
        current: "settings",
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
      <PageTitle>
        <span className="mr-2 rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-600">
          {project.key}
        </span>
        {project.name}
      </PageTitle>

      <ActionResult ok={ok} error={error} />

      {/* ---------------- 基本設定 ---------------- */}
      <Section
        title="基本設定"
        note="「チャートを使用する」がOFFだと、タスクに開始日・期限日を入力できません。"
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
                ["subtaskingEnabled", "親子タスクを使用する", project.subtaskingEnabled],
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
            <Button variant="primary">
              保存
            </Button>
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
        note="標準の4状態は名前・色・並び順を変更できず、削除もできません（本家と同じ）。追加できるのは8つまでで、「未対応」より前、「完了」より後には置けません。"
      >
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {statuses.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-6 text-right text-xs text-slate-400">{i + 1}</span>
              {/* **標準4状態は名前も色も変えられない**（本家と同じ。
                  00-spec-verified.md 1.1）。編集フォームを出さない */}
              {canEditProject && !s.isDefault ? (
                // 追加した状態だけ、名前と色を直せる
                <form action={bind(updateStatus)} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="statusId" value={s.id} />
                  <input
                    type="color"
                    name="color"
                    defaultValue={s.color}
                    className="h-5 w-7 rounded border border-slate-300"
                  />
                  <input
                    name="name"
                    required
                    defaultValue={s.name}
                    className="w-40 rounded border border-slate-300 px-2 py-0.5 text-sm"
                  />
                  <Button variant="secondary" size="xs">
                    保存
                  </Button>
                </form>
              ) : (
                <>
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="flex-1">{s.name}</span>
                </>
              )}
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
                      <Button variant="secondary" size="xs" title={
                          s.isDefault
                            ? "標準の4状態は並べ替えできません"
                            : d < 0
                              ? "上へ"
                              : "下へ"
                        }
                        
                        disabled={s.isDefault}>
                        {d < 0 ? "↑" : "↓"}
                      </Button>
                    </form>
                  ))}
                  <form action={bind(deleteStatus)}>
                    <input type="hidden" name="id" value={s.id} />
                    <ConfirmSubmit
                      variant="dangerOutline"
                      size="xs"
                      disabled={s.isDefault}
                      title={s.isDefault ? "標準の4状態は削除できません" : "削除"}
                      message={`状態「${s.name}」を削除します。\n\nこの状態のタスクがあると削除できません。元に戻せません。`}
                    >
                      削除
                    </ConfirmSubmit>
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
            <Button variant="secondary">
              追加
            </Button>
          </form>
        )}
      </Section>

      {/* ---------------- 種別・カテゴリー・バージョン ---------------- */}
      <Section
        title="タスク種別・カテゴリー"
        note="これらは「制限なし」の一般ユーザーでも編集できます（プロジェクト管理者専用ではありません）。"
      >
        <div className="grid gap-6 md:grid-cols-2">
          {[
            {
              label: "タスク種別",
              items: issueTypes.map((t) => ({ id: t.id, name: t.name, color: t.color })),
              action: bind(addIssueType),
              // 一覧の各行を直せるようにする。以前は作るだけで直せなかった
              editAction: bind(updateIssueType),
              idField: "issueTypeId",
              withColor: true,
              extra: null,
            },
            {
              label: "カテゴリー",
              items: categories.map((c) => ({ id: c.id, name: c.name, color: null })),
              action: bind(addCategory),
              editAction: bind(updateCategory),
              idField: "categoryId",
              withColor: false,
              extra: null,
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
                    {canManageMasters ? (
                      <form
                        action={g.editAction}
                        className="flex flex-1 items-center gap-1"
                      >
                        <input type="hidden" name={g.idField} value={it.id} />
                        {g.withColor && (
                          <input
                            type="color"
                            name="color"
                            defaultValue={it.color ?? "#3b82f6"}
                            className="h-5 w-7 rounded border border-slate-300"
                          />
                        )}
                        <input
                          name="name"
                          required
                          defaultValue={it.name}
                          className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                        />
                        <Button variant="secondary" size="xs">
                          保存
                        </Button>
                      </form>
                    ) : (
                      <>
                        {it.color && (
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ background: it.color }}
                          />
                        )}
                        {it.name}
                      </>
                    )}
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
                  <Button variant="secondary" size="xs" className="mt-2 w-full">
                    追加
                  </Button>
                </form>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------------- マイルストーン / バージョン ---------------- */}
      <Section
        title="マイルストーン / バージョン"
        note="本家と同じく、マイルストーンとバージョンは同一のものです。バーンダウンチャートを描くには開始日と終了日の両方が必要です。"
      >
        {versions.length === 0 ? (
          <p className="text-xs text-slate-400">なし</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {versions.map((v) => (
              <li key={v.id} className="px-3 py-3">
                {canManageMasters ? (
                  // 1行が1つのフォーム。既存のものを直せないと、
                  // 開始日を入れ忘れたマイルストーンが永久に直せない
                  <form action={bind(updateVersion)} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="versionId" value={v.id} />
                    <span className="w-6 pb-1.5 text-right text-xs text-slate-400">{v.id}</span>
                    <label className="text-xs">
                      <span className="block text-slate-500">名前</span>
                      <input
                        name="name"
                        required
                        defaultValue={v.name}
                        className="mt-0.5 w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block text-slate-500">開始日</span>
                      <input
                        type="date"
                        name="startDate"
                        defaultValue={v.startDate ? v.startDate.toISOString().slice(0, 10) : ""}
                        className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="text-xs">
                      <span className="block text-slate-500">終了日</span>
                      <input
                        type="date"
                        name="releaseDueDate"
                        defaultValue={
                          v.releaseDueDate ? v.releaseDueDate.toISOString().slice(0, 10) : ""
                        }
                        className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="min-w-[10rem] flex-1 text-xs">
                      <span className="block text-slate-500">説明</span>
                      <input
                        name="description"
                        defaultValue={v.description ?? ""}
                        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="flex items-center gap-1 pb-1.5 text-xs text-slate-600">
                      <input type="checkbox" name="archived" defaultChecked={v.archived} />
                      完了
                    </label>
                    <Button variant="secondary" size="xs" className="mb-0.5">
                      保存
                    </Button>
                  </form>
                ) : (
                  <span className="text-sm">
                    <span className="mr-2 text-xs text-slate-400">{v.id}</span>
                    {v.name}
                    <span className="ml-2 text-xs text-slate-500">
                      {v.startDate ? v.startDate.toISOString().slice(0, 10) : "開始日なし"}
                      {" 〜 "}
                      {v.releaseDueDate
                        ? v.releaseDueDate.toISOString().slice(0, 10)
                        : "終了日なし"}
                    </span>
                    {v.archived && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        完了
                      </span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManageMasters && (
          <form action={bind(addVersion)} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="block text-slate-500">名前</span>
              <input
                name="name"
                required
                placeholder="v1.0"
                className="mt-0.5 w-40 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500">開始日</span>
              <input
                type="date"
                name="startDate"
                className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-slate-500">終了日</span>
              <input
                type="date"
                name="releaseDueDate"
                className="mt-0.5 rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="min-w-[10rem] flex-1 text-xs">
              <span className="block text-slate-500">説明</span>
              <input
                name="description"
                className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <Button variant="primary" size="xs" className="mb-0.5">
              追加
            </Button>
          </form>
        )}
      </Section>

      {/* ---------------- チーム ---------------- */}
      {canEditProject && (
        <Section
          title="チーム"
          note="チームはタスクの「お知らせ」先にまとめて指定できます。割り当てても参加ユーザーにはなりません（権限は個人単位で持っています）。"
        >
          {projectTeams.length === 0 ? (
            <p className="text-xs text-slate-400">なし</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {projectTeams.map((pt) => (
                <li
                  key={pt.teamId}
                  className="flex items-center gap-2 rounded bg-slate-100 px-2 py-1 text-sm"
                >
                  {pt.team.name}
                  <span className="text-xs text-slate-500">
                    {pt.team._count.members} 人
                  </span>
                  <form action={bind(removeProjectTeam)}>
                    <input type="hidden" name="teamId" value={pt.teamId} />
                    <ConfirmSubmit variant="danger" size="xs" message={`チーム「${pt.team.name}」をこのプロジェクトから外します。\n\nメンションの宛先として選べなくなります。参加ユーザーの権限は変わりません。`}>外す</ConfirmSubmit>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={bind(addProjectTeam)} className="mt-3 flex items-end gap-2">
            <label className="text-sm">
              <span className="block text-xs text-slate-500">チーム名</span>
              <input
                name="team"
                required
                placeholder="開発"
                className="mt-1 rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <Button variant="secondary">
              割り当て
            </Button>
          </form>
        </Section>
      )}

      {/* ---------------- Git ---------------- */}
      {canEditProject && (
        <Section
          title="Gitリポジトリ"
          note="提供元（GitHub など）にある既存のリポジトリを繋ぎます。向こうには何も作りません。"
        >
          {!provider ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Git連携が設定されていません。<code>GIT_PROVIDER</code> と{" "}
              <code>GITHUB_TOKEN</code> を入れて app を再起動してください。
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
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {r.name}
                    </a>
                    <span
                      title={r.description ?? undefined}
                      className="flex-1 truncate text-xs text-slate-500"
                    >
                      {r.description ?? ""}
                    </span>
                    <form action={bind(toggleLinkCommits)}>
                      <input type="hidden" name="id" value={r.id} />
                      <ToggleChip on={r.linkCommitsToIssues} tone="emerald" size="xs" title="コミットメッセージのタスクキーから、タスクへコメントを自動登録します">
                        タスク連携 {r.linkCommitsToIssues ? "ON" : "OFF"}
                      </ToggleChip>
                    </form>
                    <form action={bind(detachRepository)}>
                      <input type="hidden" name="id" value={r.id} />
                      <ConfirmSubmit
                        variant="danger"
                        size="xs"
                        message={`${r.name} の登録を解除します。\n\n提供元のリポジトリは残りますが、取り込んだプルリクエストとタスクへのコミットの紐付けは消えます。`}
                      >
                        登録解除
                      </ConfirmSubmit>
                    </form>
                  </div>
                  {/* 提供元が外にある場合、クローンURLは**向こうのもの**でないと使えない。
                      Gitea のときは自前の /git プロキシを指していた */}
                  <div className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
                    {(() => {
                      const owner = project.gitOwner ?? project.key;
                      const urls = provider
                        ? provider.cloneUrls({ owner, name: r.name })
                        : { http: httpCloneUrl(owner, r.name), ssh: sshCloneUrl(owner, r.name) };
                      return (
                        <>
                          <div>{urls.http}</div>
                          {/* SSH が使えない環境では出さない（lib/repo.ts） */}
                          {urls.ssh && <div>{urls.ssh}</div>}
                        </>
                      );
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {/* 提供元(GitHub/将来Bitbucket)にある既存リポジトリを繋ぐ。
              向こうに何も作らないので、Gitea用の「作成」「取り込み」とは別物 */}
          {providerRepos !== null && (
            <form
              action={bind(connectRepository)}
              className="mt-3 flex flex-wrap items-end gap-2"
            >
              <label className="flex-1 text-sm">
                <span className="block text-xs text-slate-500">
                  繋ぐリポジトリ（{gitProviderName}）
                </span>
                {providerRepos.length === 0 ? (
                  <span className="mt-1 block text-slate-400">
                    見えるリポジトリがありません（トークンの権限を確認してください）
                  </span>
                ) : (
                  <select
                    name="repo"
                    required
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                  >
                    {providerRepos.map((r) => (
                      <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                        {r.private ? "（非公開）" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <Button variant="primary">繋ぐ</Button>
            </form>
          )}

        </Section>
      )}

      {/* ---------------- webhook ---------------- */}
      {canEditProject && (
        <Section
          title="webhook"
          note="タスクの追加・更新などを外部へ通知します。送信は非同期なので、相手が遅くても画面は待ちません。Discord の Webhook URL は自動で判別し、Discord が読める形に変換して送ります。それ以外の宛先には本家Backlogと同じ形のJSONを送るので、Slack や Teams にはそのままでは届きません（受け口側で変換が必要です）。"
        >
          {webhooks.length === 0 ? (
            <p className="text-xs text-slate-400">なし</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {webhooks.map((w) => (
                <li key={w.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {/* URLを直せないと、送信先を間違えたとき作り直すしかなかった。
                      止めたいだけのときのために有効・無効も置く */}
                  <form
                    action={bind(updateWebhook)}
                    className="flex flex-1 items-center gap-2"
                  >
                    <input type="hidden" name="webhookId" value={w.id} />
                    <input
                      name="name"
                      required
                      defaultValue={w.name}
                      className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                    />
                    <input
                      name="hookUrl"
                      required
                      defaultValue={w.hookUrl}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input type="checkbox" name="enabled" defaultChecked={w.enabled} />
                      有効
                    </label>
                    <Button variant="secondary" size="xs">保存</Button>
                  </form>
                  <span className="shrink-0 text-xs text-slate-400">
                    {w.allEvent ? "全イベント" : `${w.activityTypes.length}種`}
                  </span>
                  <form action={bind(deleteWebhook)}>
                    <input type="hidden" name="id" value={w.id} />
                    <ConfirmSubmit variant="danger" size="xs" message={`Webhook「${w.name}」を削除します。\n\n通知が止まります。元に戻せません。`}>削除</ConfirmSubmit>
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
                placeholder="Discord 通知"
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
            <Button variant="secondary">
              追加
            </Button>
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
                  <Button variant="secondary" size="xs">
                    {m.isProjectAdmin ? "解除" : "PJ管理者にする"}
                  </Button>
                </form>
              )}
              {canEditProject && (
                <form action={bind(removeMember)}>
                  <input type="hidden" name="userId" value={m.userId} />
                  <ConfirmSubmit
                    variant="dangerOutline"
                    size="xs"
                    message={`${m.user.name} をこのプロジェクトから外します。\n\nタスクとWikiを見られなくなります。`}
                  >
                    外す
                  </ConfirmSubmit>
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
            <Button variant="secondary">
              追加
            </Button>
          </form>
        )}
      </Section>
    </Shell>
  );
}
