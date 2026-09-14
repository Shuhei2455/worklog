"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { audit } from "@/lib/audit";

/**
 * チームの管理。
 *
 * チームは**スペース全体のもの**（プロジェクトごとではない）。
 * 本家と同じく、プロジェクトにはチーム単位で追加でき、課題の「お知らせ」先にも
 * 指定できる（00-spec-verified.md 9章・11.2）。
 * 作成・変更はスペース管理者だけ（`space.edit`）。
 */

/**
 * 操作が終わったときに呼ぶ。
 *
 * **redirect しない。** `revalidatePath` だけならサーバーコンポーネントが
 * 再描画されて DOM が差分更新され、画面が飛ばない。
 * メッセージはクエリではなくフラッシュ（cookie）で運ぶ。lib/flash.ts を参照。
 *
 * 以前は `never` を返す（= redirect が投げる）前提で
 * `if (cond) back(...)` と書かれていた。いまは通常復帰するので、
 * **呼び出し側は必ず `return await back(...)` にする**こと。
 * 付け忘れると検証をすり抜けて処理が続く。
 */
async function back(message?: string, isError = false): Promise<void> {
  if (message) await setFlash("/teams", message, isError);
  revalidatePath("/teams");
}

export async function createTeam(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return await back("名前を入れてください", true);

  const dup = await prisma.team.findUnique({ where: { name } });
  if (dup) return await back(`${name} は既にあります`, true);

  const last = await prisma.team.findFirst({
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });

  await prisma.team.create({
    data: {
      name,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdById: actor.id,
      updatedById: actor.id,
    },
  });
  await audit(actor.id, { action: "team.create", targetType: "team", detail: { name } });
  return await back(`チーム「${name}」を作成しました`);
}

export async function renameTeam(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!Number.isInteger(id) || !name) return await back("不正なリクエストです", true);

  const dup = await prisma.team.findFirst({ where: { name, id: { not: id } } });
  if (dup) return await back(`${name} は既にあります`, true);

  await prisma.team.update({
    where: { id },
    data: { name, updatedById: actor.id },
  });
  await audit(actor.id, {
    action: "team.update",
    targetType: "team",
    targetId: id,
    detail: { name },
  });
  return await back(`チーム名を「${name}」に変更しました`);
}

/**
 * チームを削除する。
 *
 * 所属とプロジェクトへの割り当ては一緒に消える（カスケード）。
 * **過去のメンション `<@T{id}>` は本文に残る。** 解決できなくなるので、
 * 画面では記法のまま表示される（mention.ts の挙動）。
 */
export async function deleteTeam(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return await back("不正なリクエストです", true);

  const team = await prisma.team.findUnique({
    where: { id },
    include: { _count: { select: { members: true, projectTeams: true } } },
  });
  if (!team) return await back("チームが見つかりません", true);

  await audit(actor.id, {
    action: "team.delete",
    targetType: "team",
    targetId: id,
    // 消えた後に名前を引けないので、ここに残す
    detail: { name: team!.name, members: team!._count.members },
  });
  await prisma.team.delete({ where: { id } });
  return await back(
    `「${team!.name}」を削除しました（所属 ${team!._count.members} 人 / ` +
      `割り当て ${team!._count.projectTeams} プロジェクト）`,
  );
}

export async function addTeamMember(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const teamId = Number(formData.get("teamId"));
  const loginId = String(formData.get("userId") ?? "").trim();
  if (!Number.isInteger(teamId) || !loginId) return await back("不正なリクエストです", true);

  const user = await prisma.user.findUnique({ where: { userId: loginId } });
  if (!user) return await back(`ユーザーが見つかりません: ${loginId}`, true);

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId: user!.id } },
    update: {},
    create: { teamId, userId: user!.id },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: { updatedById: actor.id },
  });
  return await back(`${user!.name} を追加しました`);
}

export async function removeTeamMember(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const teamId = Number(formData.get("teamId"));
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(teamId) || !Number.isInteger(userId)) {
    return await back("不正なリクエストです", true);
  }

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId } },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: { updatedById: actor.id },
  });
  return await back("チームから外しました");
}
