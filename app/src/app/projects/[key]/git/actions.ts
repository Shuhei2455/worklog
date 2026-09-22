"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan, projectContext } from "@/lib/session";

/**
 * Git の画面からの操作。
 *
 * リポジトリの作成・削除はプロジェクト設定側（settings/git-actions.ts）。
 * ここは閲覧中にできる操作だけを置く。
 */

/**
 * プルリクエストの関連課題を付け替える。
 *
 * ブランチ名から自動で付くが、付け間違い・後から決まる場合がある。
 * 空で送ると関連を外す。
 */
export async function linkPullRequestIssue(
  key: string,
  repoName: string,
  prNumber: number,
  formData: FormData,
) {
  const actor = await currentUser();
  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!project) redirect("/");

  // 閲覧だけでなく編集なので issue.edit を要求する。
  // Git を見られる人が誰でも課題との関連を書き換えられるのは行き過ぎ
  await assertCan(actor, "issue.edit", project.id);

  const repository = await prisma.repository.findFirst({
    where: { projectId: project.id, name: repoName },
  });
  if (!repository) redirect(`/projects/${key}/git`);

  const pr = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_giteaPrNumber: {
        repositoryId: repository.id,
        giteaPrNumber: prNumber,
      },
    },
  });
  if (!pr) redirect(`/projects/${key}/git/${encodeURIComponent(repoName)}/pulls`);

  const raw = String(formData.get("issueKey") ?? "").trim().toUpperCase();
  const path = `/projects/${key}/git/${encodeURIComponent(repoName)}/pulls/${prNumber}`;

  if (!raw) {
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { issueId: null },
    });
      await setFlash(path, "タスクの紐づけを解除しました");
      revalidatePath(path);
      return;
  }

  // 同じプロジェクトの課題だけを許す（決定 D21 と揃える）
  const m = /^([A-Z][A-Z0-9_]*)-(\d+)$/.exec(raw);
  const keyId = m && m[1] === project.key ? Number(m[2]) : null;
  const issue = keyId
    ? await prisma.issue.findUnique({
        where: { projectId_keyId: { projectId: project.id, keyId } },
        select: { id: true },
      })
    : null;

  if (!issue) {
    await setFlash(path, `${raw} は見つかりません`, true);
    revalidatePath(path);
    return;
  }

  await prisma.pullRequest.update({
    where: { id: pr.id },
    data: { issueId: issue.id },
  });
  await setFlash(path, `${raw} に紐づけました`);
  revalidatePath(path);
}

/**
 * Gitea に既にあるPRをまとめて取り込む。
 *
 * webhook は登録後に起きたぶんしか来ない。リポジトリを取り込んだ直後は
 * 過去のPRが無いので、これで埋める。
 */
export async function syncPullRequests(key: string, repoName: string) {
  const actor = await currentUser();
  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!project) redirect("/");
  const ctx = await projectContext(project.id, actor.id);
  await assertCan(actor, "git.access", project.id);
  if (!ctx.isMember) redirect("/");

  const { giteaOrgOf, listPulls } = await import("@/lib/gitea");
  const { handlePullRequest } = await import("@/lib/gitea-webhook");

  const repository = await prisma.repository.findFirst({
    where: { projectId: project.id, name: repoName },
  });
  if (!repository) redirect(`/projects/${key}/git`);

  const org = await giteaOrgOf(project.id);
  const pulls = await listPulls(org, repoName);

  for (const p of pulls) {
    await handlePullRequest({
      action: "synchronized",
      number: p.number,
      repository: { id: repository.giteaRepoId, name: repoName },
      pull_request: {
        number: p.number,
        title: p.title,
        body: p.body ?? "",
        state: p.state,
        merged: p.merged,
        merged_at: p.merged_at,
        closed_at: p.closed_at,
        base: p.base,
        head: p.head,
        merge_commit_sha: p.merge_commit_sha,
        user: p.user,
        assignee: p.assignee,
      },
    });
  }

  const path = `/projects/${key}/git/${encodeURIComponent(repoName)}/pulls`;
  revalidatePath(path);
  // state=all で戻す。既定の「オープン」だと、取り込んだのが
  // マージ済みばかりのときに「0件」に見えて取り込めたか分からない
  redirect(
    `${path}?state=all&ok=${encodeURIComponent(`${pulls.length} 件を取り込みました`)}`,
  );
}
