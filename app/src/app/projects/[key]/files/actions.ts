"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { putFile, deleteFile, MAX_ATTACHMENT_BYTES } from "@/lib/storage";
import { normalizeDir } from "@/lib/shared-file-path";

/**
 * 共有ファイル。
 *
 * 添付とは別物で、プロジェクトのファイル置き場。課題やWikiから「リンク」して使う。
 * 階層は dir カラムの文字列で表す（`/design/`、ルートは `/`）。
 * ディレクトリを別テーブルにしない（本家の dir も文字列）。
 *
 * **制限のあるユーザーは閲覧すらできない**(00-spec-verified.md 7.1)。
 * 課題・Wikiと扱いが違うので、権限は sharedFile.access で見る。
 */

async function projectByKey(key: string) {
  const p = await prisma.project.findUnique({ where: { key } });
  if (!p) throw new Error(`プロジェクトが見つかりません: ${key}`);
  if (!p.fileSharingEnabled) {
    throw new Error("このプロジェクトではファイル共有を使いません");
  }
  return p;
}

function back(key: string, dir: string, message?: string, isError = false) {
  const q = new URLSearchParams({ dir });
  if (message) q.set(isError ? "error" : "ok", message);
  revalidatePath(`/projects/${key}/files`);
  redirect(`/projects/${key}/files?${q.toString()}`);
}

export async function uploadSharedFile(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "sharedFile.access", project.id);

  const dir = normalizeDir(String(formData.get("dir") ?? "/"));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    back(key, dir, "ファイルを選んでください", true);
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    back(key, dir, `ファイルが大きすぎます（上限 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB）`, true);
    return;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const storageKey = await putFile(project.id, bytes);

  // 同じ場所に同じ名前があれば差し替える（本家も上書き）
  const existing = await prisma.sharedFile.findUnique({
    where: {
      projectId_dir_name: { projectId: project.id, dir, name: file.name },
    },
  });
  if (existing) {
    await prisma.sharedFile.update({
      where: { id: existing.id },
      data: {
        size: bytes.byteLength,
        mime: file.type || "application/octet-stream",
        storageKey,
      },
    });
    await deleteFile(existing.storageKey);
    back(key, dir, `「${file.name}」を差し替えました`);
    return;
  }

  await prisma.sharedFile.create({
    data: {
      projectId: project.id,
      dir,
      name: file.name,
      size: bytes.byteLength,
      mime: file.type || "application/octet-stream",
      storageKey,
      createdBy: actor.id,
    },
  });
  back(key, dir, `「${file.name}」を追加しました`);
}

export async function deleteSharedFile(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "sharedFile.access", project.id);

  const id = Number(formData.get("id"));
  const f = await prisma.sharedFile.findUnique({ where: { id } });
  if (!f || f.projectId !== project.id) {
    back(key, "/", "ファイルが見つかりません", true);
    return;
  }
  await prisma.sharedFile.delete({ where: { id } });
  await deleteFile(f.storageKey);
  back(key, f.dir, `「${f.name}」を削除しました`);
}

/** 課題から共有ファイルを参照する */
export async function linkSharedFileToIssue(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const [projectKey, keyIdRaw] = issueKey.split("-");
  const project = await projectByKey(projectKey);
  await assertCan(actor, "sharedFile.access", project.id);

  const issue = await prisma.issue.findUnique({
    where: { projectId_keyId: { projectId: project.id, keyId: Number(keyIdRaw) } },
  });
  if (!issue) throw new Error("課題が見つかりません");

  const sharedFileId = Number(formData.get("sharedFileId"));
  const f = await prisma.sharedFile.findUnique({ where: { id: sharedFileId } });
  if (f && f.projectId === project.id) {
    await prisma.issueSharedFile.upsert({
      where: { issueId_sharedFileId: { issueId: issue.id, sharedFileId } },
      update: {},
      create: { issueId: issue.id, sharedFileId },
    });
  }
  revalidatePath(`/issues/${issueKey}`);
  redirect(`/issues/${issueKey}`);
}

export async function unlinkSharedFileFromIssue(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const [projectKey, keyIdRaw] = issueKey.split("-");
  const project = await projectByKey(projectKey);
  await assertCan(actor, "sharedFile.access", project.id);

  const issue = await prisma.issue.findUnique({
    where: { projectId_keyId: { projectId: project.id, keyId: Number(keyIdRaw) } },
  });
  if (issue) {
    await prisma.issueSharedFile.deleteMany({
      where: { issueId: issue.id, sharedFileId: Number(formData.get("sharedFileId")) },
    });
  }
  revalidatePath(`/issues/${issueKey}`);
  redirect(`/issues/${issueKey}`);
}
