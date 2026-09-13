import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ProjectNav } from "@/components/ProjectNav";
import { PageTitle, ButtonLink, PillLink } from "@/components/ui";

export default async function WikiList({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const { key } = await params;
  const { tag } = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "wiki.view", ctx)) notFound();

  if (!project.wikiEnabled) {
    return (
      <Shell user={user} breadcrumbs={[{ label: project.name }, { label: "Wiki" }]}>
      <PageTitle>Wiki</PageTitle>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このプロジェクトは「Wikiを使用する」が無効です。
          <Link href={`/projects/${key}/settings`} className="ml-2 underline">
            プロジェクト設定
          </Link>
          で有効にしてください。
        </p>
      </Shell>
    );
  }

  // 一覧では content を引かない。本家も一覧に content を含めない
  const pages = await prisma.wikiPage.findMany({
    where: {
      projectId: project.id,
      ...(tag ? { tags: { some: { tag } } } : {}),
    },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      revision: true,
      updater: { select: { name: true } },
      tags: { select: { tag: true } },
    },
    orderBy: { name: "asc" },
  });

  const allTags = await prisma.wikiTag.findMany({
    where: { wikiPage: { projectId: project.id } },
    select: { tag: true },
    distinct: ["tag"],
    orderBy: { tag: "asc" },
  });

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Wiki" },
      ]}
    >
      <div className="flex items-center justify-between">
        <ProjectNav
        projectKey={key}
        current="wiki"
        show={{
          wiki: project.wikiEnabled && can(user, "wiki.view", ctx),
          files: project.fileSharingEnabled && can(user, "sharedFile.access", ctx),
          chart: project.chartEnabled,
          git: project.gitEnabled && can(user, "git.access", ctx),
          settings: can(user, "project.edit", ctx) || can(user, "issueType.manage", ctx),
        }}
      />
        <PageTitle>Wiki</PageTitle>
        {can(user, "wiki.edit", ctx) && (
          <ButtonLink href={`/projects/${key}/wiki/new`} variant="primary">
            ページを追加
          </ButtonLink>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">タグ</span>
          <PillLink href={`/projects/${key}/wiki`} active={!tag}>
            すべて
          </PillLink>
          {allTags.map((t) => (
            <PillLink key={t.tag} href={`/projects/${key}/wiki?tag=${encodeURIComponent(t.tag)}`} active={tag === t.tag}>
              {t.tag}
            </PillLink>
          ))}
        </div>
      )}

      {pages.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">ページがありません。</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {pages.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <Link
                href={`/projects/${key}/wiki/${encodeURIComponent(p.name)}`}
                className="flex-1 text-brand-700 hover:underline"
              >
                {p.name}
              </Link>
              {p.tags.map((t) => (
                <span
                  key={t.tag}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  {t.tag}
                </span>
              ))}
              <span className="text-xs text-slate-400">
                v{p.revision} / {p.updater.name} /{" "}
                {p.updatedAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
