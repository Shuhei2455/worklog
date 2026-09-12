"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { nextMasterId } from "@/lib/numbering";
import {
  moveStatus,
  assignDisplayOrders,
  displayOrderForNewStatus,
} from "@/lib/status-order";

/**
 * プロジェクト設定のサーバーアクション。
 *
 * どのアクションも入口で assertCan() を通す。
 * 画面でボタンを隠すだけでは、直接POSTされたときに素通りする。
 */

async function projectByKey(key: string) {
  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) throw new Error(`プロジェクトが見つかりません: ${key}`);
  return project;
}

function back(key: string, message?: string, isError = false) {
  const q = message
    ? `?${isError ? "error" : "ok"}=${encodeURIComponent(message)}`
    : "";
  revalidatePath(`/projects/${key}/settings`);
  redirect(`/projects/${key}/settings${q}`);
}

/** 機能のON/OFF。chartEnabled は課題の入力可否そのものに影響する */
export async function updateFeatures(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  await prisma.project.update({
    where: { id: project.id },
    data: {
      name: String(formData.get("name") ?? project.name).trim() || project.name,
      description: String(formData.get("description") ?? ""),
      chartEnabled: formData.get("chartEnabled") === "on",
      subtaskingEnabled: formData.get("subtaskingEnabled") === "on",
      wikiEnabled: formData.get("wikiEnabled") === "on",
      fileSharingEnabled: formData.get("fileSharingEnabled") === "on",
      gitEnabled: formData.get("gitEnabled") === "on",
    },
  });
  back(key, "プロジェクト設定を保存しました");
}

/** 状態の追加。Closed の手前に入る（Closed より後には置けないため） */
export async function addStatus(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  // 状態の管理はプロジェクト編集と同じ扱い
  await assertCan(actor, "project.edit", project.id);

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#64748b");
  if (!name) back(key, "状態の名前を入力してください", true);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.status.findMany({
      where: { projectId: project.id },
      select: { id: true, displayOrder: true },
    });
    const id = await nextMasterId(tx, "statuses", project.id);
    await tx.status.create({
      data: {
        projectId: project.id,
        id,
        name,
        color,
        displayOrder: displayOrderForNewStatus(existing),
        isDefault: false,
      },
    });
  });
  back(key, `状態「${name}」を追加しました`);
}

/** 状態の並べ替え。制約は status-order.ts の純関数が judge する */
export async function reorderStatus(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  const delta = Number(formData.get("delta"));

  const current = await prisma.status.findMany({
    where: { projectId: project.id },
    orderBy: { displayOrder: "asc" },
    select: { id: true, name: true, isDefault: true },
  });

  const result = moveStatus(current, id, delta);
  if (!result.ok) back(key, result.reason, true);

  const orders = assignDisplayOrders(result.statuses);
  await prisma.$transaction(
    orders.map((o) =>
      prisma.status.update({
        where: { projectId_id: { projectId: project.id, id: o.id } },
        data: { displayOrder: o.displayOrder },
      }),
    ),
  );
  back(key);
}

/** 状態の削除。標準4状態は削除できない */
export async function deleteStatus(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  const status = await prisma.status.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
  });
  if (!status) back(key, "状態が見つかりません", true);
  if (status!.isDefault) back(key, "標準の4状態は削除できません", true);

  // 使用中の状態を消すときは置き換え先を選ばせる仕様だが、
  // 課題がまだ無い M0 の段階では使用中になり得ない。
  // TODO(M1): 課題が存在する状態を削除するとき、置き換え先を選ぶダイアログを出す
  const used = await prisma.issue.count({
    where: { projectId: project.id, statusId: id },
  });
  if (used > 0) {
    back(key, `この状態は ${used} 件の課題で使われています（置き換え先の選択は M1 で実装）`, true);
  }

  await prisma.status.delete({
    where: { projectId_id: { projectId: project.id, id } },
  });
  back(key, `状態「${status!.name}」を削除しました`);
}

/** 課題種別・カテゴリー・バージョンの追加。制限なしの一般ユーザーでも行える */
export async function addIssueType(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "issueType.manage", project.id);

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#64748b");
  if (!name) back(key, "種別の名前を入力してください", true);

  await prisma.$transaction(async (tx) => {
    const id = await nextMasterId(tx, "issue_types", project.id);
    const max = await tx.issueType.aggregate({
      where: { projectId: project.id },
      _max: { displayOrder: true },
    });
    await tx.issueType.create({
      data: {
        projectId: project.id,
        id,
        name,
        color,
        displayOrder: (max._max.displayOrder ?? 0) + 1000,
      },
    });
  });
  back(key, `種別「${name}」を追加しました`);
}

export async function addCategory(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "category.manage", project.id);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(key, "カテゴリーの名前を入力してください", true);

  await prisma.$transaction(async (tx) => {
    const id = await nextMasterId(tx, "categories", project.id);
    const max = await tx.category.aggregate({
      where: { projectId: project.id },
      _max: { displayOrder: true },
    });
    await tx.category.create({
      data: {
        projectId: project.id,
        id,
        name,
        displayOrder: (max._max.displayOrder ?? 0) + 1000,
      },
    });
  });
  back(key, `カテゴリー「${name}」を追加しました`);
}

/** バージョン = マイルストーン。本家が同一エンティティなので分けない */
export async function addVersion(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "version.manage", project.id);

  const name = String(formData.get("name") ?? "").trim();
  const releaseDue = String(formData.get("releaseDueDate") ?? "");
  if (!name) back(key, "バージョンの名前を入力してください", true);

  await prisma.$transaction(async (tx) => {
    const id = await nextMasterId(tx, "versions", project.id);
    const max = await tx.version.aggregate({
      where: { projectId: project.id },
      _max: { displayOrder: true },
    });
    await tx.version.create({
      data: {
        projectId: project.id,
        id,
        name,
        releaseDueDate: releaseDue ? new Date(releaseDue) : null,
        displayOrder: (max._max.displayOrder ?? 0) + 1000,
      },
    });
  });
  back(key, `バージョン「${name}」を追加しました`);
}

/** 参加ユーザーの追加 */
export async function addMember(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const loginId = String(formData.get("userId") ?? "").trim();
  const user = await prisma.user.findUnique({ where: { userId: loginId } });
  if (!user) back(key, `ユーザーが見つかりません: ${loginId}`, true);

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: user!.id } },
    update: {},
    create: { projectId: project.id, userId: user!.id },
  });
  back(key, `${user!.name} を追加しました`);
}

export async function removeMember(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const userId = Number(formData.get("userId"));
  const remaining = await prisma.projectMember.count({
    where: { projectId: project.id },
  });
  if (remaining <= 1) {
    back(key, "最後の1人は外せません", true);
  }
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId: project.id, userId } },
  });
  back(key, "参加ユーザーを外しました");
}

/** プロジェクト管理者フラグ。ゲストには付けられない */
export async function toggleProjectAdmin(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "projectAdmin.assign", project.id);

  const userId = Number(formData.get("userId"));
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId } },
    include: { user: true },
  });
  if (!member) back(key, "参加していないユーザーです", true);

  // ゲストはプロジェクト管理者になれない（本家の明記された制約）
  if (member!.user.userType === "guest") {
    back(key, "ゲストはプロジェクト管理者になれません", true);
  }
  // プロジェクト管理者は「一般ユーザー（制限なし）のみが設定可能」
  if (member!.user.restriction !== "none") {
    back(key, "制限のあるユーザーはプロジェクト管理者になれません", true);
  }

  await prisma.projectMember.update({
    where: { projectId_userId: { projectId: project.id, userId } },
    data: { isProjectAdmin: !member!.isProjectAdmin },
  });
  back(key, "プロジェクト管理者の設定を変更しました");
}
