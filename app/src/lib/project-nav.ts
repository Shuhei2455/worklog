import { can } from "@/lib/permissions";
import type { ProjectNavKey } from "@/components/ProjectSidebar";
import type { currentUser, projectContext } from "@/lib/session";

/**
 * プロジェクト画面の左サイドバーに渡す値を組み立てる。
 *
 * **なぜ関数にするか。**
 * 以前は各ページが同じ12行を書き写していた。書き写しなので
 * **詳細画面（課題・Wikiの本文・Gitのリポジトリ配下など12画面）で
 * まるごと省かれており、ドリルダウンするとナビが消えていた。**
 * 1行で書けるようにして、付け忘れを起こしにくくする。
 *
 * 出す項目はプロジェクトの機能フラグと権限で決まる。
 * 判定を1か所に集めておけば、権限の条件を足すときに漏れない。
 */

export type ProjectNavSource = {
  key: string;
  name: string;
  wikiEnabled: boolean;
  fileSharingEnabled: boolean;
  chartEnabled: boolean;
  gitEnabled: boolean;
};

export function projectNav(
  project: ProjectNavSource,
  user: Awaited<ReturnType<typeof currentUser>>,
  ctx: Awaited<ReturnType<typeof projectContext>>,
  current: ProjectNavKey,
) {
  return {
    key: project.key,
    name: project.name,
    current,
    show: {
      addIssue: can(user, "issue.create", ctx),
      wiki: project.wikiEnabled && can(user, "wiki.view", ctx),
      files: project.fileSharingEnabled && can(user, "sharedFile.access", ctx),
      chart: project.chartEnabled,
      git: project.gitEnabled && can(user, "git.access", ctx),
      settings: can(user, "project.edit", ctx) || can(user, "issueType.manage", ctx),
    },
  };
}
