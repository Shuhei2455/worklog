import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";

const jst = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export default async function WikiHistory({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; name: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { key, name: raw } = await params;
  const { v } = await searchParams;
  const name = decodeURIComponent(raw);
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "wiki.view", ctx)) notFound();

  const page = await prisma.wikiPage.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
  });
  if (!page) notFound();

  // 履歴は全文スナップショット。version は古い順の連番にする
  const revisions = await prisma.wikiRevision.findMany({
    where: { wikiPageId: page.id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const numbered = revisions.map((r, i) => ({ ...r, version: i + 1 })).reverse();
  const selected = v
    ? numbered.find((r) => String(r.version) === v)
    : numbered[0];

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Wiki", href: `/projects/${key}/wiki` },
        {
          label: page.name,
          href: `/projects/${key}/wiki/${encodeURIComponent(page.name)}`,
        },
        { label: "履歴" },
      ]}
    >
      <h1 className="text-xl font-semibold">{page.name} の履歴</h1>

      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
          {numbered.map((r) => (
            <li key={r.id}>
              <Link
                href={`/projects/${key}/wiki/${encodeURIComponent(page.name)}/history?v=${r.version}`}
                className={`block px-3 py-2 hover:bg-slate-50 ${
                  selected?.id === r.id ? "bg-brand-50" : ""
                }`}
              >
                <span className="font-medium">v{r.version}</span>
                <span className="ml-2 text-xs text-slate-500">{r.user.name}</span>
                <span className="block text-xs text-slate-400">
                  {jst(r.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="rounded border border-slate-200 bg-white p-4">
          {selected ? (
            <>
              <p className="text-xs text-slate-500">
                v{selected.version} の本文（そのまま保存されたもの）
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs">
                {selected.content || "（本文なし）"}
              </pre>
            </>
          ) : (
            <p className="text-sm text-slate-400">履歴がありません</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
