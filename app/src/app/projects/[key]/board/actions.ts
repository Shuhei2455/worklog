"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { updateIssue } from "@/lib/issue";
import {
  orderForPosition,
  needsRenumber,
  renumber,
  type CardRef,
} from "@/lib/board-order";

/**
 * ボードでカードを動かす。
 *
 * 状態が変わるなら updateIssue を通す。活動履歴に残さないと
 * 「いつ誰が処理中にしたのか」が追えなくなる。
 * 並び順だけの移動は履歴に残さない（本家も残さない想定。
 * TODO(要確認): 本家がボードの並び替えを履歴に残すか）。
 */
export async function moveCard(
  projectKey: string,
  issueId: number,
  toStatusId: number,
  toIndex: number,
) {
  const actor = await currentUser();
  const project = await prisma.project.findUnique({ where: { key: projectKey } });
  if (!project) throw new Error("プロジェクトが見つかりません");

  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.projectId !== project.id) {
    throw new Error("課題が見つかりません");
  }

  const statusChanged = issue.statusId !== toStatusId;
  // 状態を変えるなら編集権限が要る。並び替えだけなら閲覧できる人でよい
  await assertCan(actor, statusChanged ? "issue.edit" : "issue.view", project.id);

  await prisma.$transaction(async (tx) => {
    // 移動先の列の並び（自分自身は除く）
    const siblings: CardRef[] = await tx.issue.findMany({
      where: { projectId: project.id, statusId: toStatusId, id: { not: issueId } },
      orderBy: [{ boardOrder: "asc" }, { keyId: "asc" }],
      select: { id: true, boardOrder: true },
    });

    const index = Math.max(0, Math.min(toIndex, siblings.length));
    const prev = index > 0 ? siblings[index - 1]?.boardOrder : undefined;
    const next = siblings[index]?.boardOrder;

    if (needsRenumber(prev, next)) {
      // float の桁を使い切ったときだけ、その列を1000刻みに振り直す
      const ids = siblings.map((s) => s.id);
      ids.splice(index, 0, issueId);
      for (const r of renumber(ids)) {
        await tx.issue.update({
          where: { id: r.id },
          data: { boardOrder: r.boardOrder },
        });
      }
      return;
    }

    await tx.issue.update({
      where: { id: issueId },
      data: { boardOrder: orderForPosition(siblings, index) },
    });
  });

  // 状態の変更は活動履歴に残す
  if (statusChanged) {
    await updateIssue({ issueId, updatedBy: actor.id, statusId: toStatusId });
  }

  revalidatePath(`/projects/${projectKey}/board`);
}
