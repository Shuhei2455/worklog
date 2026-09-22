import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/project";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { currentUser, visibleProjectIds } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PageTitle, Button } from "@/components/ui";
import { loadProjectProgress } from "@/lib/project-progress";
import { ProgressBar, ProgressBreakdown, ProgressPercent } from "@/components/ProgressBar";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  const { error } = await searchParams;

  // 決定 D31: 一覧には**全プロジェクトの名前**を出す。
  // ただし参加していないものは名前だけで、中身(課題・Wiki・進捗・人数)は出さない。
  // 管理者は参加していなくても中身を扱えるので、全部を「開ける」扱いにする。
  const memberIds = new Set(await visibleProjectIds(user.id));
  const projects = await prisma.project.findMany({
    where: { archived: false },
    orderBy: { key: "asc" },
    include: { _count: { select: { members: true } } },
  });
  const canOpen = (projectId: number) =>
    user.userType === "admin" || memberIds.has(projectId);

  // 進捗はまとめて1回で取る（プロジェクトごとに引くとN+1になる）。
  // 開けないプロジェクトの進捗は件数が漏れるので取りに行かない
  const progress = await loadProjectProgress(
    projects.filter((p) => canOpen(p.id)).map((p) => p.id),
  );

  const canCreate = can(user, "project.create");

  async function create(formData: FormData) {
    "use server";
    const actor = await currentUser();
    if (!can(actor, "project.create")) {
      redirect("/?error=" + encodeURIComponent("プロジェクトを作る権限がありません"));
    }
    const key = String(formData.get("key") ?? "").trim().toUpperCase();
    const name = String(formData.get("name") ?? "").trim();
    try {
      await createProject({ key, name, createdBy: actor.id });
      await audit(actor.id, {
        action: "project.create",
        targetType: "project",
        targetId: key,
        detail: { name },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "作成に失敗しました";
      redirect("/?error=" + encodeURIComponent(msg));
    }
    revalidatePath("/");
    redirect(`/projects/${key}/settings`);
  }

  return (
    <Shell user={user}>
      <div className="flex items-center justify-between">
        <PageTitle>プロジェクト</PageTitle>
      </div>

      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {projects.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">プロジェクトはありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {projects.map((p) => {
            // 参加していないプロジェクト（管理者以外）は名前だけ。
            // 進捗も人数も出さない。件数から中身が推測できてしまうため
            const open = canOpen(p.id);
            const prog = progress.get(p.id);
            return (
              <li key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-600">
                    {p.key}
                  </span>
                  {open ? (
                    <Link
                      href={`/projects/${p.key}/issues`}
                      title={p.name}
                      className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <span
                      title={p.name}
                      className="min-w-0 flex-1 truncate font-medium text-slate-500"
                    >
                      {p.name}
                    </span>
                  )}
                  {open ? (
                    <>
                      <span className="text-sm text-slate-500">
                        {p._count.members} 人
                      </span>
                      <Link
                        href={`/projects/${p.key}/settings`}
                        className="text-sm text-slate-500 hover:underline"
                      >
                        設定
                      </Link>
                    </>
                  ) : (
                    <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      未参加
                    </span>
                  )}
                </div>

                {/* 進捗（本家には無い機能。決定 D29） */}
                {open && prog && (
                  <>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <ProgressBar progress={prog} locale={user.locale} />
                      </div>
                      <ProgressPercent progress={prog} />
                    </div>
                    <div className="mt-1">
                      <ProgressBreakdown progress={prog} locale={user.locale} />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canCreate ? (
        <form
          action={create}
          className="mt-8 rounded border border-slate-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold">プロジェクトを追加</h2>
          <div className="mt-3 flex gap-3">
            <label className="text-sm">
              <span className="block text-slate-600">キー</span>
              <input
                name="key"
                required
                placeholder="PROJ"
                className="mt-1 w-32 rounded border border-slate-300 px-2 py-1 font-mono uppercase"
              />
            </label>
            <label className="flex-1 text-sm">
              <span className="block text-slate-600">名前</span>
              <input
                name="name"
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <Button variant="primary" className="mt-6">
              追加
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            キーは英大文字で始まる1〜10文字（英大文字・数字・アンダースコア）。
            作成後は変更できません。
          </p>
        </form>
      ) : (
        <p className="mt-8 text-xs text-slate-500">
          プロジェクトの追加は管理者のみ行えます。
        </p>
      )}
    </Shell>
  );
}
