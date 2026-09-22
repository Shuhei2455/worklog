import { readFlash } from "@/lib/flash";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { PRIORITIES, DEFAULT_PRIORITY_ID } from "@/lib/constants";
import { Shell } from "@/components/Shell";
import { projectNav } from "@/lib/project-nav";
import { PageTitle, Button } from "@/components/ui";
import { addIssue } from "../actions";
import { CustomFieldInputs } from "@/components/CustomFieldInputs";
import { loadFieldDefs } from "@/lib/custom-field-form";

export default async function NewIssue({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { key } = await params;
  const flash = await readFlash(`/projects/${key}/issues/new`);
  const sp = await searchParams;
  const error = sp.error ?? flash.error;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "issue.create", ctx)) notFound();

  const [issueTypes, members, customFields] = await Promise.all([
    prisma.issueType.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.projectMember.findMany({
      where: { projectId: project.id },
      include: { user: true },
    }),
    loadFieldDefs(project.id),
  ]);

  return (
    <Shell
      user={user}
      project={projectNav(project, user, ctx, "addIssue")}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "タスクを追加" },
      ]}
    >
      <PageTitle>タスクを追加</PageTitle>

      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form
        action={addIssue.bind(null, key)}
        className="mt-4 space-y-4 rounded border border-slate-200 bg-white p-4 text-sm"
      >
        <label className="block">
          <span className="text-slate-600">件名</span>
          <input
            name="summary"
            required
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-slate-600">種別</span>
            <select
              name="issueTypeId"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            >
              {issueTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">優先度</span>
            <select
              name="priorityId"
              defaultValue={DEFAULT_PRIORITY_ID}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            >
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">担当者</span>
            <select
              name="assigneeId"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
            >
              <option value="">未割り当て</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* チャートがOFFなら開始日・期限日は入力できない(本家と同じ) */}
        {project.chartEnabled ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-slate-600">開始日</span>
              <input
                type="date"
                name="startDate"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
            <label className="block">
              <span className="text-slate-600">期限日</span>
              <input
                type="date"
                name="dueDate"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            このプロジェクトは「チャートを使用する」がOFFのため、開始日・期限日を入力できません。
          </p>
        )}

        {/* カスタム属性。タスク種別ごとの絞り込みは送信後に行う
            （種別を選ぶたびに出し入れするには client JS が必要なため、
            ここでは全件出して、保存時に有効なものだけを使う） */}
        {customFields.length > 0 && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <h2 className="mb-2 text-xs font-medium text-slate-500">カスタム属性</h2>
            <CustomFieldInputs fields={customFields} />
          </div>
        )}

        <label className="block">
          <span className="text-slate-600">詳細（Markdown）</span>
          <textarea
            name="description"
            rows={8}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
          />
        </label>

        <Button variant="primary" size="md">
          追加
        </Button>
      </form>
    </Shell>
  );
}
