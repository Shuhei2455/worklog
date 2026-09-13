import Link from "next/link";
import { translator, type Locale } from "@/lib/i18n";

/**
 * プロジェクトの左サイドバー。
 *
 * 本家と同じ形（docs/00-spec-verified.md 12.2）:
 *   幅 200px / 下地は緑 `#4caf93` / 項目は各50px・13px /
 *   リンク色 `#00836b`・選択中 `#2c9a7a`
 *
 * 以前はタブ型のナビ（ProjectNav）だった。本家は左サイドバーなので作り替えた。
 *
 * 出す項目はプロジェクトの設定と権限で決まる:
 *   - Wiki / ファイル / Git はプロジェクトの機能フラグで消える
 *   - ガントとバーンダウンは `chartEnabled` が必要
 *   - Git は `git.access` を持つ人にだけ出す（M4の権限漏れの再発防止）
 *   - 設定は編集権限のある人だけ
 */
export type ProjectNavKey =
  | "home"
  | "issues"
  | "board"
  | "gantt"
  | "burndown"
  | "wiki"
  | "files"
  | "git"
  | "settings";

export type ProjectNavShow = {
  wiki?: boolean;
  files?: boolean;
  chart?: boolean;
  git?: boolean;
  settings?: boolean;
  addIssue?: boolean;
};

export function ProjectSidebar({
  projectKey,
  projectName,
  current,
  show,
  locale,
}: {
  projectKey: string;
  projectName: string;
  current: ProjectNavKey;
  show: ProjectNavShow;
  locale: Locale;
}) {
  const t = translator(locale);
  const base = `/projects/${projectKey}`;

  const items: Array<{ key: ProjectNavKey | "addIssue"; label: string; href: string }> = [
    { key: "home", label: t("project.home"), href: `${base}/issues` },
  ];
  if (show.addIssue) {
    items.push({ key: "addIssue", label: t("project.addIssue"), href: `${base}/issues/new` });
  }
  items.push({ key: "issues", label: t("project.issues"), href: `${base}/issues` });
  items.push({ key: "board", label: t("project.board"), href: `${base}/board` });
  if (show.chart) {
    items.push({ key: "gantt", label: t("project.gantt"), href: `${base}/gantt` });
    items.push({ key: "burndown", label: t("project.burndown"), href: `${base}/burndown` });
  }
  if (show.wiki) items.push({ key: "wiki", label: t("project.wiki"), href: `${base}/wiki` });
  if (show.files) items.push({ key: "files", label: t("project.files"), href: `${base}/files` });
  if (show.git) items.push({ key: "git", label: t("nav.git"), href: `${base}/git` });
  if (show.settings) {
    items.push({ key: "settings", label: t("project.settings"), href: `${base}/settings` });
  }

  return (
    // 下地の緑は本家と同じ #4caf93。項目は白地なので、緑は端に細く見える
    <nav className="w-[200px] shrink-0 bg-[#4caf93]">
      <div className="sticky top-0">
        {/* 先頭はプロジェクト名。本家は折りたたみボタンだが、
            こちらは折りたたみを作っていないので名前を出す */}
        <div className="flex h-[50px] items-center bg-white px-4 font-semibold">
          <span className="truncate" title={projectName}>
            {projectName}
          </span>
        </div>

        <ul className="bg-white">
          {items.map((i) => (
            <li key={i.key}>
              <Link
                href={i.href}
                aria-current={i.key === current ? "page" : undefined}
                className={`flex h-[50px] items-center border-b border-hairline/40 px-4 text-base hover:bg-slate-50 ${
                  i.key === current
                    ? "bg-brand-50 font-medium text-brand-600"
                    : "text-brand-700"
                }`}
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
