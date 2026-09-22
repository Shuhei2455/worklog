import { notFound } from "next/navigation";
import { readFlash } from "@/lib/flash";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
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
  createRepository,
  toggleLinkCommits,
  detachRepository,
  importRepository,
} from "./git-actions";
import {
  addCustomField,
  updateCustomField,
  deleteCustomField,
  toggleCustomFieldRequired,
  setCustomFieldIssueTypes,
} from "./custom-field-actions";
import {
  CUSTOM_FIELD_TYPE_LABEL,
  CUSTOM_FIELD_TYPE_ID,
  hasItems,
} from "@/lib/custom-field";
import { giteaEnabled } from "@/lib/gitea";
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
    customFields,
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
    prisma.customField.findMany({
      where: { projectId: project.id },
      include: { items: { orderBy: { displayOrder: "asc" } }, _count: { select: { values: true } } },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

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
                    <Button variant="dangerOutline" size="xs" disabled={s.isDefault}
                      title={s.isDefault ? "標準の4状態は削除できません" : "削除"}>
                      削除
                    </Button>
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
                    <Button variant="danger" size="xs">外す</Button>
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

      {/* ---------------- カスタム属性 ---------------- */}
      {canEditProject && (
        <Section
          title="カスタム属性"
          note="タスクに独自の入力欄を足します。型は本家と同じ8種（00-spec-verified.md 10.1）。削除すると入力済みの値も消えます。"
        >
          {customFields.length === 0 ? (
            <p className="text-xs text-slate-400">なし</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {customFields.map((f) => (
                <li key={f.id} className="px-3 py-2 text-sm">
                  {/* スマホ幅では4ブロックが1行に入らない（375pxで167pxはみ出していた）。
                      折り返しを許し、編集フォームだけ1行を占有させる */}
                  <div className="flex flex-wrap items-center gap-3">
                    {/* 名前と説明を直せるようにする。
                        型と選択肢は変えられない（入力済みの値の解釈が変わるため） */}
                    <form
                      action={bind(updateCustomField)}
                      className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1"
                    >
                      <input type="hidden" name="id" value={f.id} />
                      <input
                        name="name"
                        required
                        defaultValue={f.name}
                        className="w-32 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                      />
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {CUSTOM_FIELD_TYPE_LABEL[f.typeId]}
                      </span>
                      <input
                        name="description"
                        defaultValue={f.description ?? ""}
                        placeholder="説明"
                        className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                      />
                      <Button variant="secondary" size="xs">
                        保存
                      </Button>
                    </form>
                    <form action={bind(toggleCustomFieldRequired)}>
                      <input type="hidden" name="id" value={f.id} />
                      <ToggleChip on={f.required} tone="amber" size="xs">
                        {f.required ? "必須" : "任意"}
                      </ToggleChip>
                    </form>
                    {f._count.values > 0 && (
                      <span className="text-xs text-slate-400">
                        入力済み {f._count.values} 件
                      </span>
                    )}
                    <form action={bind(deleteCustomField)}>
                      <input type="hidden" name="id" value={f.id} />
                      <Button variant="danger" size="xs">削除</Button>
                    </form>
                  </div>
                  {f.items.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      選択肢: {f.items.map((i) => i.name).join(" / ")}
                    </p>
                  )}
                  {/* 有効なタスク種別。チェックを全部外すと全種別で有効（本家と同じ） */}
                  <form
                    action={bind(setCustomFieldIssueTypes)}
                    className="mt-1 flex flex-wrap items-center gap-2 text-xs"
                  >
                    <input type="hidden" name="id" value={f.id} />
                    <span className="text-slate-500">有効な種別</span>
                    {issueTypes.map((t) => (
                      <label key={t.id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          name="issueTypeId"
                          value={t.id}
                          defaultChecked={f.applicableIssueTypes.includes(t.id)}
                        />
                        {t.name}
                      </label>
                    ))}
                    <Button variant="secondary" size="xs">
                      保存
                    </Button>
                    <span className="text-slate-400">
                      {f.applicableIssueTypes.length === 0 ? "（いまは全種別）" : ""}
                    </span>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={bind(addCustomField)} className="mt-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-xs text-slate-500">名前</span>
                <input
                  name="name"
                  required
                  placeholder="顧客名"
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500">型</span>
                <select
                  name="typeId"
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                >
                  {(
                    Object.keys(CUSTOM_FIELD_TYPE_ID) as Array<
                      keyof typeof CUSTOM_FIELD_TYPE_ID
                    >
                  ).map((t) => (
                    <option key={t} value={CUSTOM_FIELD_TYPE_ID[t]}>
                      {CUSTOM_FIELD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 text-sm">
                <span className="block text-xs text-slate-500">説明</span>
                <input
                  name="description"
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="required" />
                <span className="text-xs text-slate-600">必須</span>
              </label>
              <Button variant="secondary">
                追加
              </Button>
            </div>

            {/* 型ごとの追加パラメータ。使う型のものだけ埋めれば足りる */}
            <details className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs text-slate-600">
                型ごとの設定（リスト系の選択肢・数値の範囲・日付の初期値）
              </summary>
              <div className="mt-2 space-y-2">
                <label className="block text-sm">
                  <span className="block text-xs text-slate-500">
                    選択肢（リスト・複数リスト・チェックボックス・ラジオ用。1行に1つ）
                  </span>
                  <textarea
                    name="items"
                    rows={3}
                    placeholder={"A社\nB社\nC社"}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="allowAddItem" />
                    項目の追加を許す
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="allowInput" />
                    「その他」の自由入力を許す
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <label>
                    数値の最小
                    <input
                      name="min"
                      className="ml-1 w-20 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                  <label>
                    最大
                    <input
                      name="max"
                      className="ml-1 w-20 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                  <label>
                    単位
                    <input
                      name="unit"
                      placeholder="円"
                      className="ml-1 w-16 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                  <label>
                    日付の最小
                    <input
                      name="dateMin"
                      placeholder="2026-01-01"
                      className="ml-1 w-28 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                  <label>
                    最大
                    <input
                      name="dateMax"
                      placeholder="2026-12-31"
                      className="ml-1 w-28 rounded border border-slate-300 px-1 py-0.5"
                    />
                  </label>
                </div>
              </div>
            </details>
          </form>
        </Section>
      )}

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
                      <Button variant="danger" size="xs">
                        登録解除
                      </Button>
                    </form>
                  </div>
                  <div className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-500">
                    <div>{httpCloneUrl(project.giteaOrg ?? project.key, r.name)}</div>
                    {/* SSH が使えない環境では出さない（lib/repo.ts） */}
                    {sshCloneUrl(project.giteaOrg ?? project.key, r.name) && (
                      <div>{sshCloneUrl(project.giteaOrg ?? project.key, r.name)}</div>
                    )}
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
              <Button variant="secondary">
                作成
              </Button>
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
              <Button variant="secondary">
                取り込む
              </Button>
            </form>
            </>
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
                    <Button variant="danger" size="xs">削除</Button>
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
                  <Button variant="dangerOutline" size="xs">
                    外す
                  </Button>
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
