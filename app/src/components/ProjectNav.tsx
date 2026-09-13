import Link from "next/link";

/**
 * プロジェクト内のナビゲーション。
 *
 * これまで各画面が自前でリンクを並べており、**課題一覧には7つ並ぶのに、
 * ガントやWikiからは「課題一覧へ」しか戻れない**状態だった。
 * どの画面からでも同じ移動ができるように、ここに集約する。
 *
 * 出す項目はプロジェクトの設定と権限で決まる:
 *   - Wiki / ファイル / Git はプロジェクトの機能フラグで消える
 *   - ガントとバーンダウンは `chartEnabled` が必要
 *   - Git は `git.access` を持つ人にだけ出す（M4の権限漏れの再発防止）
 *   - 設定は編集権限のある人だけ
 */
export type ProjectNavKey =
  | "issues"
  | "board"
  | "gantt"
  | "burndown"
  | "wiki"
  | "files"
  | "git"
  | "settings";

export function ProjectNav({
  projectKey,
  current,
  show,
}: {
  projectKey: string;
  current: ProjectNavKey;
  /** 出す項目。呼び出し側が権限と設定を見て決める */
  show: {
    wiki?: boolean;
    files?: boolean;
    chart?: boolean;
    git?: boolean;
    settings?: boolean;
  };
}) {
  const items: Array<{ key: ProjectNavKey; label: string; href: string }> = [
    { key: "issues", label: "課題", href: `/projects/${projectKey}/issues` },
    { key: "board", label: "ボード", href: `/projects/${projectKey}/board` },
  ];

  if (show.chart) {
    items.push({ key: "gantt", label: "ガントチャート", href: `/projects/${projectKey}/gantt` });
    items.push({ key: "burndown", label: "バーンダウン", href: `/projects/${projectKey}/burndown` });
  }
  if (show.wiki) items.push({ key: "wiki", label: "Wiki", href: `/projects/${projectKey}/wiki` });
  if (show.files) items.push({ key: "files", label: "ファイル", href: `/projects/${projectKey}/files` });
  if (show.git) items.push({ key: "git", label: "Git", href: `/projects/${projectKey}/git` });
  if (show.settings) {
    items.push({ key: "settings", label: "設定", href: `/projects/${projectKey}/settings` });
  }

  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className={
            i.key === current
              ? "-mb-px border-b-2 border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-800"
              : "border-b-2 border-transparent px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
          }
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
