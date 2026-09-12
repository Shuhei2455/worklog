import Link from "next/link";
import { Shell } from "@/components/Shell";
import { loadGitContext, commitTitle } from "@/lib/git-view";
import { listContents, readFile, listCommits } from "@/lib/gitea";
import { RepoTabs } from "../RepoTabs";

/**
 * ファイルツリーと中身。
 *
 * 階層は URL のクエリ（`?path=src/lib`）で持つ。ルートを増やさずに済み、
 * この形のURLを貼れば同じ場所を開ける。
 */
export default async function RepoTree({
  params,
  searchParams,
}: {
  params: Promise<{ key: string; repo: string }>;
  searchParams: Promise<{ path?: string; ref?: string }>;
}) {
  const { key, repo } = await params;
  const sp = await searchParams;
  const { user, project, repository, org } = await loadGitContext(
    key,
    decodeURIComponent(repo),
  );
  const name = repository!.name;
  const path = (sp.path ?? "").replace(/^\/+|\/+$/g, "");
  const ref = sp.ref || repository!.defaultBranch;

  const entries = await listContents(org, name, path, ref);
  // 1件で type が file なら、それはディレクトリではなくファイルを指している
  const single = entries.length === 1 && entries[0].type === "file" && entries[0].path === path;
  const file = single ? await readFile(org, name, path, ref) : null;

  const [latest] = await listCommits(org, name, { sha: ref, limit: 1 });

  const crumbs = path ? path.split("/") : [];
  const href = (p: string) =>
    `/projects/${key}/git/${encodeURIComponent(name)}?path=${encodeURIComponent(p)}&ref=${encodeURIComponent(ref)}`;

  return (
    <Shell
      user={user}
      breadcrumbs={[
        { label: project.name, href: `/projects/${key}/issues` },
        { label: "Git", href: `/projects/${key}/git` },
        { label: name },
      ]}
    >
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{name}</h1>
        <span className="font-mono text-xs text-slate-500">{ref}</span>
      </div>

      <RepoTabs projectKey={key} repo={name} current="files" />

      {latest && (
        <p className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <Link
            href={`/projects/${key}/git/${encodeURIComponent(name)}/commits/${latest.sha}`}
            className="font-mono text-sky-700 hover:underline"
          >
            {latest.sha.slice(0, 7)}
          </Link>
          <span className="mx-2">{commitTitle(latest.commit.message)}</span>
          <span className="text-slate-400">
            {latest.commit.author.name} / {latest.commit.author.date.slice(0, 16).replace("T", " ")}
          </span>
        </p>
      )}

      {/* パンくず（リポジトリ内） */}
      <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm">
        <Link href={href("")} className="text-sky-700 hover:underline">
          {name}
        </Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-slate-400">/</span>
            {i === crumbs.length - 1 ? (
              <span className="text-slate-700">{c}</span>
            ) : (
              <Link
                href={href(crumbs.slice(0, i + 1).join("/"))}
                className="text-sky-700 hover:underline"
              >
                {c}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {file ? (
        <FileView
          name={crumbs[crumbs.length - 1] ?? name}
          content={file.content}
          encoding={file.encoding}
          size={file.size}
        />
      ) : entries.length === 0 ? (
        <p className="mt-4 rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
          ファイルがありません（まだ push されていないか、空のブランチです）
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {path && (
            <li className="px-3 py-2 text-sm">
              <Link
                href={href(path.split("/").slice(0, -1).join("/"))}
                className="text-sky-700 hover:underline"
              >
                ..
              </Link>
            </li>
          )}
          {[...entries]
            .sort((a, b) =>
              a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
            )
            .map((e) => (
              <li key={e.path} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-4 text-slate-400">{e.type === "dir" ? "▸" : "·"}</span>
                <Link href={href(e.path)} className="flex-1 text-sky-700 hover:underline">
                  {e.name}
                </Link>
                {e.type === "file" && (
                  <span className="text-xs text-slate-400">{e.size} B</span>
                )}
              </li>
            ))}
        </ul>
      )}
    </Shell>
  );
}

/** ファイルの中身。Gitea は base64 で返す */
function FileView({
  name,
  content,
  encoding,
  size,
}: {
  name: string;
  content: string;
  encoding: string;
  size: number;
}) {
  if (encoding !== "base64") {
    return (
      <p className="mt-4 rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
        このファイルは表示できません（{encoding}）
      </p>
    );
  }

  const buf = Buffer.from(content, "base64");
  // NUL を含むならバイナリ。そのまま出すと画面が壊れる
  const isBinary = buf.subarray(0, 8000).includes(0);
  if (isBinary) {
    return (
      <p className="mt-4 rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500">
        バイナリファイル（{size} B）
      </p>
    );
  }

  const text = buf.toString("utf8");
  const lines = text.split("\n");

  return (
    <div className="mt-3 overflow-x-auto rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-1.5 text-xs text-slate-500">
        {name} / {lines.length} 行 / {size} B
      </div>
      <table className="w-full border-collapse font-mono text-xs">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="w-12 select-none border-r border-slate-100 px-2 text-right align-top text-slate-400">
                {i + 1}
              </td>
              <td className="whitespace-pre px-3 align-top">{l || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
