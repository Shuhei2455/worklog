import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser, projectContext } from "@/lib/session";
import { giteaOrgOf } from "@/lib/gitea";

/**
 * Git の画面で毎回やること（プロジェクトの取得・権限・organization 名）を
 * 1か所にまとめる。
 *
 * **権限は `git.access`。** 閲覧のみ・登録のみのユーザーは通らない
 * （00-spec-verified.md 7.1 のマトリクス）。
 * プロジェクトに参加していなければ、管理者でも見えない。
 */
export async function loadGitContext(key: string, repoName?: string) {
  const user = await currentUser();

  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!project) notFound();

  const ctx = await projectContext(project.id, user.id);
  if (!can(user, "git.access", ctx)) notFound();

  const repositories = await prisma.repository.findMany({
    where: { projectId: project.id },
    orderBy: { displayOrder: "asc" },
  });

  const repository = repoName
    ? repositories.find((r) => r.name === repoName)
    : undefined;
  if (repoName && !repository) notFound();

  // organization 名はプロジェクトキーと一致しないことがある（予約名の回避）
  const org = project.giteaOrg ?? (await giteaOrgOf(project.id));

  return { user, project, ctx, repositories, repository, org };
}

/** 1行目だけ取り出す。コミット一覧の見出しに使う */
export function commitTitle(message: string): string {
  return message.split("\n")[0];
}

/**
 * unified diff を、画面で色分けできる形に割る。
 *
 * ライブラリは入れない（CLAUDE.md: 勝手に足さない）。行頭1文字で十分に分かる。
 */
export type DiffLine = { kind: "add" | "del" | "meta" | "hunk" | "ctx"; text: string };

export function splitDiff(diff: string): Array<{ file: string; lines: DiffLine[] }> {
  const files: Array<{ file: string; lines: DiffLine[] }> = [];
  let current: { file: string; lines: DiffLine[] } | null = null;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git")) {
      // `diff --git a/path b/path` の b 側を表示名にする
      const m = /b\/(.+)$/.exec(raw);
      current = { file: m ? m[1] : raw, lines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (raw.startsWith("@@")) current.lines.push({ kind: "hunk", text: raw });
    else if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("index "))
      current.lines.push({ kind: "meta", text: raw });
    else if (raw.startsWith("+")) current.lines.push({ kind: "add", text: raw });
    else if (raw.startsWith("-")) current.lines.push({ kind: "del", text: raw });
    else current.lines.push({ kind: "ctx", text: raw });
  }
  return files;
}

/** PRの状態の表示名。決定 D20 の写像と揃える */
export const PR_STATE_LABEL: Record<string, string> = {
  open: "オープン",
  merged: "マージ済み",
  closed: "クローズ",
};
