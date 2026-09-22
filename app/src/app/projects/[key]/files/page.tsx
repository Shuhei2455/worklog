import { readFlash } from "@/lib/flash";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ActionResult, PageTitle, Button } from "@/components/ui";
import { uploadSharedFile, deleteSharedFile } from "./actions";
import { normalizeDir, parentDir } from "@/lib/shared-file-path";

const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;

export default async function Files({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ dir?: string; ok?: string; error?: string }>;
}) {
  const { key } = await params;
  const flash = await readFlash(`/projects/${key}/files`);
  const sp = await searchParams;
  const user = await currentUser();

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) notFound();
  const ctx = await projectContext(project.id, user.id);

  // 制限のあるユーザーは閲覧すらできない
  if (!can(user, "sharedFile.access", ctx)) notFound();

  if (!project.fileSharingEnabled) {
    return (
      <Shell
        user={user}
        project={{
          key: key,
          name: project.name,
          current: "files",
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
      <PageTitle>ファイル</PageTitle>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このプロジェクトは「ファイル共有を使用する」が無効です。
          <Link href={`/projects/${key}/settings`} className="ml-2 underline">
            プロジェクト設定
          </Link>
          で有効にしてください。
        </p>
      </Shell>
    );
  }

  let dir = "/";
  try {
    dir = normalizeDir(sp.dir ?? "/");
  } catch {
    dir = "/";
  }

  const all = await prisma.sharedFile.findMany({
    where: { projectId: project.id },
    include: { _count: { select: { issues: true, wikis: true } } },
    orderBy: [{ dir: "asc" }, { name: "asc" }],
  });

  // この階層にあるファイル
  const files = all.filter((f) => f.dir === dir);
  // 直下のディレクトリ。dir は文字列なので、前方一致から1階層ぶんだけ取り出す
  const subdirs = [
    ...new Set(
      all
        .filter((f) => f.dir.startsWith(dir) && f.dir !== dir)
        .map((f) => f.dir.slice(dir.length).split("/")[0]),
    ),
  ].sort();

  const parent = parentDir(dir);
  const crumbs = dir.split("/").filter(Boolean);

  return (
    <Shell
      user={user}
      project={{
        key: key,
        name: project.name,
        current: "files",
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
      <PageTitle>ファイル</PageTitle>
      <p className="mt-1 text-xs text-slate-500">
        タスクやWikiから参照できる、プロジェクト共通の置き場です。タスクの添付とは別物です。
      </p>

      <ActionResult ok={sp.ok ?? flash.ok} error={sp.error ?? flash.error} />

      <nav className="mt-4 flex items-center gap-1 text-sm">
        <Link href={`/projects/${key}/files`} className="text-brand-700 hover:underline">
          /
        </Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <Link
              href={`/projects/${key}/files?dir=${encodeURIComponent("/" + crumbs.slice(0, i + 1).join("/") + "/")}`}
              className="text-brand-700 hover:underline"
            >
              {c}
            </Link>
            <span className="text-slate-300">/</span>
          </span>
        ))}
      </nav>

      <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
        {parent !== null && (
          <li className="px-4 py-2">
            <Link
              href={`/projects/${key}/files?dir=${encodeURIComponent(parent)}`}
              className="text-slate-500 hover:underline"
            >
              .. （上へ）
            </Link>
          </li>
        )}
        {subdirs.map((d) => (
          <li key={d} className="px-4 py-2">
            <Link
              href={`/projects/${key}/files?dir=${encodeURIComponent(dir + d + "/")}`}
              className="text-brand-700 hover:underline"
            >
              📁 {d}
            </Link>
          </li>
        ))}
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2">
            <a href={`/shared-files/${f.id}`} className="flex-1 text-brand-700 hover:underline">
              {f.name}
            </a>
            <span className="text-xs text-slate-400">{kb(f.size)}</span>
            {(f._count.issues > 0 || f._count.wikis > 0) && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                参照 {f._count.issues + f._count.wikis}
              </span>
            )}
            <form action={deleteSharedFile.bind(null, key)}>
              <input type="hidden" name="id" value={f.id} />
              <Button variant="danger" size="xs">削除</Button>
            </form>
          </li>
        ))}
        {subdirs.length === 0 && files.length === 0 && (
          <li className="px-4 py-8 text-center text-slate-400">
            このディレクトリは空です
          </li>
        )}
      </ul>

      <form
        action={uploadSharedFile.bind(null, key)}
        className="mt-4 rounded border border-slate-200 bg-white p-3 text-sm"
      >
        <h2 className="text-sm font-semibold">ファイルを追加</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label>
            <span className="block text-xs text-slate-500">置き場所</span>
            <input
              name="dir"
              defaultValue={dir}
              className="mt-1 w-56 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <input
            type="file"
            name="file"
            required
            className="text-xs file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs"
          />
          <Button variant="secondary">
            追加
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          置き場所に `/design/画像/` のように書くと、その階層に入ります。
          同じ場所に同じ名前があると差し替えになります。
        </p>
      </form>
    </Shell>
  );
}
