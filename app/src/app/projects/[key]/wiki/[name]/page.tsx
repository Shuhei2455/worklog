import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Markdown } from "@/components/Markdown";
import { deleteWiki } from "../actions";

const jst = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export default async function WikiPage({
  params,
}: {
  params: Promise<{ key: string; name: string }>;
}) {
  const { key, name: raw } = await params;
  const name = decodeURIComponent(raw);
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "wiki.view", ctx)) notFound();

  const page = await prisma.wikiPage.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
    include: {
      tags: true,
      creator: { select: { name: true } },
      updater: { select: { name: true } },
      _count: { select: { revisions: true } },
    },
  });
  if (!page) notFound();

  const canEdit = can(user, "wiki.edit", ctx);

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Wiki", href: `/projects/${key}/wiki` },
        { label: page.name },
      ]}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{page.name}</h1>
          <p className="mt-1 text-xs text-slate-500">
            v{page.revision} / 最終更新 {page.updater.name} {jst(page.updatedAt)}
          </p>
          {page.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {page.tags.map((t) => (
                <Link
                  key={t.tag}
                  href={`/projects/${key}/wiki?tag=${encodeURIComponent(t.tag)}`}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
                >
                  {t.tag}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 text-sm">
          <Link
            href={`/projects/${key}/wiki/${encodeURIComponent(page.name)}/history`}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            履歴 ({page._count.revisions})
          </Link>
          {canEdit && (
            <>
              <Link
                href={`/projects/${key}/wiki/${encodeURIComponent(page.name)}/edit`}
                className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
              >
                編集
              </Link>
              <form action={deleteWiki.bind(null, key, page.name)}>
                <button className="rounded border border-slate-300 px-3 py-1 text-red-700 hover:bg-red-50">
                  削除
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <article className="mt-6 rounded border border-slate-200 bg-white p-6">
        {page.content.trim() ? (
          <Markdown>{page.content}</Markdown>
        ) : (
          <p className="text-sm text-slate-400">（本文がありません）</p>
        )}
      </article>
    </Shell>
  );
}
