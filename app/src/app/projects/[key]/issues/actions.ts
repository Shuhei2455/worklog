"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { createIssue, updateIssue, deleteIssue } from "@/lib/issue";

/** 課題まわりのサーバーアクション。入口で必ず assertCan を通す */

async function projectByKey(key: string) {
  const p = await prisma.project.findUnique({ where: { key } });
  if (!p) throw new Error(`プロジェクトが見つかりません: ${key}`);
  return p;
}

const num = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== "" ? n : undefined;
};
const date = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? new Date(s) : null;
};

export async function addIssue(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "issue.create", project.id);

  let created;
  try {
    created = await createIssue({
      projectId: project.id,
      summary: String(formData.get("summary") ?? "").trim(),
      description: String(formData.get("description") ?? ""),
      issueTypeId: num(formData.get("issueTypeId")) ?? 1,
      priorityId: num(formData.get("priorityId")),
      assigneeId: num(formData.get("assigneeId")) ?? null,
      startDate: date(formData.get("startDate")),
      dueDate: date(formData.get("dueDate")),
      createdBy: actor.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "作成に失敗しました";
    redirect(`/projects/${key}/issues/new?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/projects/${key}/issues`);
  redirect(`/issues/${key}-${created.keyId}`);
}

/** 更新。本家と同じく、変更とコメントを同時に送れる */
export async function editIssue(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const [projectKey] = issueKey.split("-");
  const project = await projectByKey(projectKey);

  const keyId = Number(issueKey.split("-")[1]);
  const issue = await prisma.issue.findUnique({
    where: { projectId_keyId: { projectId: project.id, keyId } },
  });
  if (!issue) throw new Error("課題が見つかりません");

  const comment = String(formData.get("comment") ?? "").trim();
  const wantsChange = ["statusId", "assigneeId", "priorityId", "resolutionId"].some(
    (k) => formData.get(k) !== null,
  );
  // コメントだけならコメント権限、値を変えるなら編集権限
  await assertCan(actor, wantsChange ? "issue.edit" : "comment.manage", project.id);

  const patch: Record<string, unknown> = { issueId: issue.id, updatedBy: actor.id };
  if (comment) patch.comment = comment;
  for (const k of ["statusId", "assigneeId", "priorityId", "resolutionId"]) {
    const raw = formData.get(k);
    if (raw === null) continue;
    patch[k] = String(raw) === "" ? null : Number(raw);
  }

  try {
    await updateIssue(patch as Parameters<typeof updateIssue>[0]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新に失敗しました";
    redirect(`/issues/${issueKey}?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/issues/${issueKey}`);
  redirect(`/issues/${issueKey}`);
}

export async function removeIssue(issueKey: string) {
  const actor = await currentUser();
  const [projectKey, keyIdRaw] = issueKey.split("-");
  const project = await projectByKey(projectKey);
  // 課題の削除は管理者とプロジェクト管理者だけ
  await assertCan(actor, "issue.delete", project.id);

  const issue = await prisma.issue.findUnique({
    where: { projectId_keyId: { projectId: project.id, keyId: Number(keyIdRaw) } },
  });
  if (issue) await deleteIssue(issue.id);

  revalidatePath(`/projects/${projectKey}/issues`);
  redirect(`/projects/${projectKey}/issues`);
}
