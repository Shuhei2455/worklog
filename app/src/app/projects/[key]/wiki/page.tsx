import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";

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
        <h1 className="text-xl font-semibold">Wiki</h1>
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
        <h1 className="text-xl font-semibold">Wiki</h1>
        {can(user, "wiki.edit", ctx) && (
          <Link
            href={`/projects/${key}/wiki/new`}
            className="rounded bg-brand-700 px-4 py-1.5 text-sm text-white hover:bg-brand-800"
          >
            ページを追加
          </Link>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">タグ</span>
          <Link
            href={`/projects/${key}/wiki`}
            className={`rounded border px-2 py-0.5 ${
              !tag ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300"
            }`}
          >
            すべて
          </Link>
          {allTags.map((t) => (
            <Link
              key={t.tag}
              href={`/projects/${key}/wiki?tag=${encodeURIComponent(t.tag)}`}
              className={`rounded border px-2 py-0.5 ${
                tag === t.tag
                  ? "border-brand-600 bg-brand-50 text-brand-700"
                  : "border-slate-300 hover:bg-slate-50"
              }`}
            >
              {t.tag}
            </Link>
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
