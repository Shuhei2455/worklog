"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import {
  giteaEnabled,
  ensureOrg,
  gitOwnerOf,
  createGiteaRepo,
  ensureRepoWebhook,
} from "@/lib/gitea";
import { REPO_NAME_RE } from "@/lib/repo";
import { audit } from "@/lib/audit";

/**
 * リポジトリの設定。
 *
 * **ここは "use server" のファイル。非同期関数しかエクスポートできない**
 * （CLAUDE.md）。正規表現などの定数は src/lib/repo.ts に置いてある。
 */

async function projectByKey(key: string) {
  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!project) redirect("/");
  return project;
}

/**
 * **redirect しない。** 同じURLへ飛ばすと先頭までスクロールが戻り、
 * 「リロードされた」ように見える（CLAUDE.md の規約）。
 * メッセージはフラッシュ（cookie）で運ぶ。
 *
 * 以前は `never` を返していたので `if (cond) return await back(...)` で処理が止まっていた。
 * いまは通常復帰するので、**呼び出し側は必ず `return await back(...)`**。
 */
async function back(key: string, message?: string, isError = false): Promise<void> {
  const path = `/projects/${key}/settings`;
  if (message) await setFlash(path, message, isError);
  revalidatePath(path);
}

/**
 * リポジトリを作る。
 *
 * Gitea 側（organization・メンバー・リポジトリ・webhook）とこちらの
 * メタデータを同時に用意する。**Gitea が先**で、成功したら行を作る。
 * 逆にすると、行はあるのに実体が無い状態が残る。
 */
export async function createRepository(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  if (!giteaEnabled()) {
    return await back(key, "Gitea が設定されていません（GITEA_URL と GITEA_ADMIN_TOKEN）", true);
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!REPO_NAME_RE.test(name)) {
    return await back(key, "リポジトリ名は英数字・ハイフン・アンダースコア・ドットで1〜64文字です", true);
  }

  const dup = await prisma.repository.findFirst({
    where: { projectId: project.id, name },
  });
  if (dup) return await back(key, `${name} は既にあります`, true);

  try {
    const org = await ensureOrg(project.id);
    const repo = await createGiteaRepo(org, name, description);
    await ensureRepoWebhook(org, name, process.env.GITEA_WEBHOOK_SECRET ?? "");

    await prisma.repository.create({
      data: {
        projectId: project.id,
        externalRepoId: String(repo.id),
        name: repo.name,
        description: description || null,
        defaultBranch: repo.default_branch || "main",
        createdById: actor.id,
        displayOrder: await nextDisplayOrder(project.id),
      },
    });

    // Git を使い始めたならプロジェクトの機能も開けておく
    if (!project.gitEnabled) {
      await prisma.project.update({
        where: { id: project.id },
        data: { gitEnabled: true },
      });
    }

    // メンバーを organization に入れる。**`git.access` を持つ人だけ**。
    // 行を作ってから呼ぶ（リポジトリが無いと syncOrgMembers は何もしない）
    const { syncOrgMembers } = await import("@/lib/gitea-members");
    await syncOrgMembers(project.id);
  } catch (e) {
    return await back(key, `Gitea でのリポジトリ作成に失敗しました: ${(e as Error).message}`, true);
  }

  await audit(actor.id, {
    action: "repository.create",
    targetType: "repository",
    targetId: `${project.key}/${name}`,
    detail: { description },
  });

  return await back(key, `${name} を作成しました`);
}

async function nextDisplayOrder(projectId: number): Promise<number> {
  const last = await prisma.repository.findFirst({
    where: { projectId },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  return (last?.displayOrder ?? 0) + 1;
}

/**
 * コミットと課題の連携を切り替える。
 *
 * OFFにすると push してもコメントが付かなくなる
 * （02-roadmap.md フェーズ4の受け入れ条件）。
 */
export async function toggleLinkCommits(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  const repo = await prisma.repository.findFirst({
    where: { id, projectId: project.id },
  });
  if (!repo) return await back(key, "リポジトリが見つかりません", true);

  await prisma.repository.update({
    where: { id: repo.id },
    data: { linkCommitsToIssues: !repo.linkCommitsToIssues },
  });

  return await back(
    key,
    `${repo.name}: コミットとタスクの連携を${repo.linkCommitsToIssues ? "OFF" : "ON"}にしました`,
  );
}

/**
 * リポジトリの登録を解除する。
 *
 * **Gitea 側のリポジトリは消さない。** 消すとコードが失われるので、
 * 取り消しのつかない操作をこの画面から起こさない。こちらの一覧から
 * 外れるだけで、Gitea には残る。
 */
export async function detachRepository(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  const repo = await prisma.repository.findFirst({
    where: { id, projectId: project.id },
  });
  if (!repo) return await back(key, "リポジトリが見つかりません", true);

  await audit(actor.id, {
    action: "repository.detach",
    targetType: "repository",
    targetId: `${project.key}/${repo!.name}`,
    detail: { externalRepoId: repo!.externalRepoId },
  });

  await prisma.repository.delete({ where: { id: repo.id } });
  return await back(key, `${repo.name} の登録を解除しました（Gitea 側のリポジトリは残っています）`);
}

/** Gitea に既にあるリポジトリを、この一覧に取り込む */
export async function importRepository(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const name = String(formData.get("name") ?? "").trim();
  if (!REPO_NAME_RE.test(name)) return await back(key, "リポジトリ名が不正です", true);

  try {
    const org = await gitOwnerOf(project.id);
    const repo = await createGiteaRepo(org, name, ""); // あれば既存を返す
    await ensureRepoWebhook(org, name, process.env.GITEA_WEBHOOK_SECRET ?? "");

    await prisma.repository.upsert({
      where: { projectId_name: { projectId: project.id, name: repo.name } },
      update: { externalRepoId: String(repo.id) },
      create: {
        projectId: project.id,
        externalRepoId: String(repo.id),
        name: repo.name,
        description: repo.description || null,
        defaultBranch: repo.default_branch || "main",
        createdById: actor.id,
        displayOrder: await nextDisplayOrder(project.id),
      },
    });
  } catch (e) {
    return await back(key, `取り込みに失敗しました: ${(e as Error).message}`, true);
  }

  return await back(key, `${name} を取り込みました`);
}
