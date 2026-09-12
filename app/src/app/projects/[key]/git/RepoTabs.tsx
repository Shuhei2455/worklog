import Link from "next/link";

/** リポジトリ内のタブ。ファイル / コミット / プルリクエスト */
export function RepoTabs({
  projectKey,
  repo,
  current,
}: {
  projectKey: string;
  repo: string;
  current: "files" | "commits" | "pulls";
}) {
  const base = `/projects/${projectKey}/git/${encodeURIComponent(repo)}`;
  const tabs = [
    { id: "files", label: "ファイル", href: base },
    { id: "commits", label: "コミット", href: `${base}/commits` },
    { id: "pulls", label: "プルリクエスト", href: `${base}/pulls` },
  ] as const;

  return (
    <nav className="mt-3 flex gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className={
            t.id === current
              ? "-mb-px border-b-2 border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-800"
              : "px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
