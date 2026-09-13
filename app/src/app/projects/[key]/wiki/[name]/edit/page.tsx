import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PageTitle, Button, ButtonLink } from "@/components/ui";
import { updateWiki } from "../../actions";

export default async function EditWiki({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; name: string }>;
  searchParams: Promise<{ conflict?: string; base?: string }>;
}) {
  const { key, name: raw } = await params;
  const { conflict, base } = await searchParams;
  const name = decodeURIComponent(raw);
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "wiki.edit", ctx)) notFound();

  const page = await prisma.wikiPage.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
    include: { tags: true, updater: { select: { name: true } } },
  });
  if (!page) notFound();

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Wiki", href: `/projects/${key}/wiki` },
        { label: page.name },
        { label: "編集" },
      ]}
    >
      <PageTitle>{page.name} を編集</PageTitle>

      {/*
        楽観ロック(決定D16)。開いている間に他の人が保存していたら
        上書きせずに知らせる。本家の更新APIには楽観ロックの引数が無く
        後勝ちと思われるが、設計書が競合警告を求めている
      */}
      {conflict && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">
            あなたが編集している間に、別の人がこのページを保存しました。
          </p>
          <p className="mt-1 text-xs">
            開いたとき v{base} でしたが、いまは v{page.revision}（最終更新:{" "}
            {page.updater.name}）です。
            下の本文は<strong>最新のもの</strong>に入れ替えてあります。
            自分の変更が必要なら、別タブで前の内容を確認してから貼り直してください。
          </p>
        </div>
      )}

      <form
        action={updateWiki.bind(null, key, name)}
        className="mt-4 space-y-4 rounded border border-slate-200 bg-white p-4 text-sm"
      >
        {/* 開いた時点のリビジョン。保存時に突き合わせる */}
        <input type="hidden" name="revision" value={page.revision} />

        <label className="block">
          <span className="text-slate-600">ページ名</span>
          <input
            name="name"
            defaultValue={page.name}
            required
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        <label className="block">
          <span className="text-slate-600">タグ（カンマまたは空白区切り）</span>
          <input
            name="tags"
            defaultValue={page.tags.map((t) => t.tag).join(", ")}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>

        <label className="block">
          <span className="text-slate-600">本文（Markdown / GFM）</span>
          <textarea
            name="content"
            defaultValue={page.content}
            rows={24}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
          />
        </label>

        <div className="flex gap-2">
          <Button variant="primary" size="md">
            保存
          </Button>
          <ButtonLink href={`/projects/${key}/wiki/${encodeURIComponent(page.name)}`} variant="secondary" size="md">
            キャンセル
          </ButtonLink>
        </div>
      </form>
    </Shell>
  );
}
