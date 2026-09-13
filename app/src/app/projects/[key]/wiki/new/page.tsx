import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PageTitle, Button, ButtonLink } from "@/components/ui";
import { createWiki } from "../actions";

export default async function NewWiki({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { key } = await params;
  const { error } = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "wiki.edit", ctx) || !project.wikiEnabled) notFound();

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Wiki", href: `/projects/${key}/wiki` },
        { label: "ページを追加" },
      ]}
    >
      <PageTitle>ページを追加</PageTitle>
      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form
        action={createWiki.bind(null, key)}
        className="mt-4 space-y-4 rounded border border-slate-200 bg-white p-4 text-sm"
      >
        <label className="block">
          <span className="text-slate-600">ページ名</span>
          <input
            name="name"
            required
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-slate-600">タグ（カンマまたは空白区切り）</span>
          <input
            name="tags"
            placeholder="手順書, 設計"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="text-slate-600">本文（Markdown / GFM）</span>
          <textarea
            name="content"
            rows={20}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="primary" size="md">
            追加
          </Button>
          <ButtonLink href={`/projects/${key}/wiki`} variant="secondary" size="md">
            キャンセル
          </ButtonLink>
        </div>
      </form>
    </Shell>
  );
}
