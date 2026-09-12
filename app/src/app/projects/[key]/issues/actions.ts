"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { createIssue, updateIssue, deleteIssue } from "@/lib/issue";
import { putFile, deleteFile, MAX_ATTACHMENT_BYTES } from "@/lib/storage";

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

/* ------------------------------------------------------------------ *
 * 添付ファイル・親子課題・関連課題
 * ------------------------------------------------------------------ */


async function issueByKey(issueKey: string) {
  const [projectKey, keyIdRaw] = issueKey.split("-");
  const project = await projectByKey(projectKey);
  const issue = await prisma.issue.findUnique({
    where: { projectId_keyId: { projectId: project.id, keyId: Number(keyIdRaw) } },
  });
  if (!issue) throw new Error("課題が見つかりません");
  return { project, issue };
}

function backToIssue(issueKey: string, message?: string, isError = false) {
  const q = message
    ? `?${isError ? "error" : "ok"}=${encodeURIComponent(message)}`
    : "";
  revalidatePath(`/issues/${issueKey}`);
  redirect(`/issues/${issueKey}${q}`);
}

/** 添付の追加。本家は2段階(先にファイルを送ってidを得る)だが、
 *  画面からは1操作にまとめる */
export async function attachFile(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issueAttachment.add", project.id);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    backToIssue(issueKey, "ファイルを選んでください", true);
    return;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    backToIssue(
      issueKey,
      `ファイルが大きすぎます（上限 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB）`,
      true,
    );
    return;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const storageKey = await putFile(project.id, bytes);

  await prisma.$transaction(async (tx) => {
    const a = await tx.attachment.create({
      data: {
        projectId: project.id,
        name: file.name,
        size: bytes.byteLength,
        mime: file.type || "application/octet-stream",
        storageKey,
        createdBy: actor.id,
      },
    });
    await tx.issueAttachment.create({
      data: { issueId: issue.id, attachmentId: a.id },
    });
    await tx.activity.create({
      data: {
        projectId: project.id,
        type: "issue_updated",
        issueId: issue.id,
        userId: actor.id,
        content: `添付ファイル「${file.name}」を追加しました`,
      },
    });
  });
  backToIssue(issueKey, `「${file.name}」を添付しました`);
}

export async function detachFile(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issueAttachment.delete", project.id);

  const attachmentId = Number(formData.get("attachmentId"));
  const a = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!a || a.projectId !== project.id) {
    backToIssue(issueKey, "添付が見つかりません", true);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.issueAttachment.deleteMany({
      where: { issueId: issue.id, attachmentId },
    });
    // 他から参照されていなければ実体も消す
    const used = await tx.issueAttachment.count({ where: { attachmentId } });
    const usedWiki = await tx.wikiAttachment.count({ where: { attachmentId } });
    const usedComment = await tx.commentAttachment.count({ where: { attachmentId } });
    if (used + usedWiki + usedComment === 0) {
      await tx.attachment.delete({ where: { id: attachmentId } });
    }
  });
  await deleteFile(a.storageKey);
  backToIssue(issueKey, `「${a.name}」を削除しました`);
}

/** 親課題の設定・解除 */
export async function setParent(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issue.edit", project.id);

  const raw = String(formData.get("parentKey") ?? "").trim().toUpperCase();
  if (!raw) {
    await updateIssue({ issueId: issue.id, updatedBy: actor.id, parentIssueId: null });
    backToIssue(issueKey, "親課題を解除しました");
    return;
  }

  const keyId = Number(raw.split("-")[1]);
  const parent = Number.isInteger(keyId)
    ? await prisma.issue.findUnique({
        where: { projectId_keyId: { projectId: project.id, keyId } },
      })
    : null;
  if (!parent) {
    backToIssue(issueKey, `課題が見つかりません: ${raw}`, true);
    return;
  }

  try {
    await updateIssue({
      issueId: issue.id,
      updatedBy: actor.id,
      parentIssueId: parent.id,
    });
  } catch (e) {
    backToIssue(issueKey, e instanceof Error ? e.message : "設定できません", true);
    return;
  }
  backToIssue(issueKey, "親課題を設定しました");
}

/** 関連課題。親子とは別の、対等なリンク */
export async function addRelation(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issue.edit", project.id);

  const raw = String(formData.get("relatedKey") ?? "").trim().toUpperCase();
  const keyId = Number(raw.split("-")[1]);
  const other = Number.isInteger(keyId)
    ? await prisma.issue.findUnique({
        where: { projectId_keyId: { projectId: project.id, keyId } },
      })
    : null;
  if (!other) {
    backToIssue(issueKey, `課題が見つかりません: ${raw}`, true);
    return;
  }
  if (other.id === issue.id) {
    backToIssue(issueKey, "自分自身とは関連づけられません", true);
    return;
  }

  // 対等なリンクなので両方向に張る。片方向だと相手側から辿れない
  await prisma.issueRelation.createMany({
    data: [
      { issueId: issue.id, relatedIssueId: other.id },
      { issueId: other.id, relatedIssueId: issue.id },
    ],
    skipDuplicates: true,
  });
  backToIssue(issueKey, "関連課題を追加しました");
}

export async function removeRelation(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issue.edit", project.id);

  const otherId = Number(formData.get("relatedIssueId"));
  await prisma.issueRelation.deleteMany({
    where: {
      OR: [
        { issueId: issue.id, relatedIssueId: otherId },
        { issueId: otherId, relatedIssueId: issue.id },
      ],
    },
  });
  backToIssue(issueKey, "関連課題を外しました");
}

/** 検索条件の保存。condition はURLクエリと同じ形なので、貼るだけで復元できる */
export async function saveFilter(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "issue.view", project.id);

  const name = String(formData.get("name") ?? "").trim();
  const query = String(formData.get("query") ?? "");
  // 一覧からもボードからも保存できる。戻り先だけ変える
  const from = String(formData.get("from") ?? "issues");
  const back = `/projects/${key}/${from === "board" ? "board" : "issues"}`;
  if (!name) {
    redirect(`${back}?${query}&error=${encodeURIComponent("名前を入れてください")}`);
  }

  const condition: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) {
    // 保存するのは条件だけ。ページ位置は持ち越さない
    if (k === "offset" || k === "error" || k === "ok") continue;
    if (v !== "") condition[k] = v;
  }

  await prisma.savedFilter.create({
    data: { userId: actor.id, projectId: project.id, name, condition },
  });
  revalidatePath("/dashboard");
  redirect(`${back}?${query}`);
}

/* ------------------------------------------------------------------ *
 * ウォッチ・スター
 * ------------------------------------------------------------------ */

/** ウォッチの登録・解除。ウォッチにはメモを付けられる */
export async function toggleWatching(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issue.view", project.id);

  const existing = await prisma.watching.findUnique({
    where: { userId_issueId: { userId: actor.id, issueId: issue.id } },
  });
  const note = String(formData.get("note") ?? "").trim();

  if (existing) {
    // メモだけ変えたい場合は解除しない
    if (formData.get("intent") === "note") {
      await prisma.watching.update({
        where: { id: existing.id },
        data: { note: note || null },
      });
      backToIssue(issueKey, "ウォッチのメモを更新しました");
      return;
    }
    await prisma.watching.delete({ where: { id: existing.id } });
    backToIssue(issueKey, "ウォッチを解除しました");
    return;
  }

  await prisma.watching.create({
    data: { userId: actor.id, issueId: issue.id, note: note || null },
  });
  backToIssue(issueKey, "ウォッチしました");
}

/** スター。課題・コメント・Wikiに付けられる */
export async function toggleStar(issueKey: string, formData: FormData) {
  const actor = await currentUser();
  const { project, issue } = await issueByKey(issueKey);
  await assertCan(actor, "issue.view", project.id);

  const activityId = Number(formData.get("activityId")) || null;

  if (activityId) {
    const found = await prisma.star.findFirst({
      where: { userId: actor.id, activityId },
    });
    if (found) await prisma.star.delete({ where: { id: found.id } });
    else await prisma.star.create({ data: { userId: actor.id, activityId } });
  } else {
    const found = await prisma.star.findFirst({
      where: { userId: actor.id, issueId: issue.id },
    });
    if (found) await prisma.star.delete({ where: { id: found.id } });
    else await prisma.star.create({ data: { userId: actor.id, issueId: issue.id } });
  }
  backToIssue(issueKey);
}
