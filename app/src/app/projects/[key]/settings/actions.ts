"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { audit } from "@/lib/audit";
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

// 戻り値を never と明示する。redirect() は never を返すが、関数宣言では
// TypeScript が void と推論してしまい、呼び出し後のコードが
// 到達不能と見なされず型が絞られない（本番ビルドのみで落ちる）。
/**
 * フォームから数値を取り出す。
 *
 * `Number(formData.get(...))` をそのまま Prisma に渡すと、値が無いときに
 * NaN が入って PrismaClientValidationError で 500 になる。
 * 画面からは必ず入るが、作られたリクエストでも 500 にはしない。
 */
function numberField(formData: FormData, name: string, key: string): number {
  const n = Number(formData.get(name));
  if (!Number.isInteger(n)) back(key, "不正なリクエストです", true);
  return n;
}

function back(key: string, message?: string, isError = false): never {
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

  // リポジトリがあるなら Gitea 側にも入れる。ここを飛ばすと、
  // 後から参加した人はクローンできない（権限がプロジェクトと食い違う）
  const giteaNote = await syncGiteaMembership(project.id);

  await audit(actor.id, {
    action: "project.member.add",
    targetType: "project",
    targetId: project.key,
    detail: { userId: user!.userId, name: user!.name },
  });

  back(key, `${user!.name} を追加しました${giteaNote}`);
}

export async function removeMember(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const userId = numberField(formData, "userId", key);
  const remaining = await prisma.projectMember.count({
    where: { projectId: project.id },
  });
  if (remaining <= 1) {
    back(key, "最後の1人は外せません", true);
  }
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId: project.id, userId } },
  });

  // Gitea 側からも外す。残したままだとプロジェクトから外れた人が
  // コードを引き続き見られる
  const giteaNote = await syncGiteaMembership(project.id);

  await audit(actor.id, {
    action: "project.member.remove",
    targetType: "project",
    targetId: project.key,
    detail: { userId },
  });

  back(key, `参加ユーザーを外しました${giteaNote}`);
}

/** プロジェクト管理者フラグ。ゲストには付けられない */
export async function toggleProjectAdmin(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "projectAdmin.assign", project.id);

  const userId = numberField(formData, "userId", key);
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
  // プロジェクト管理者になると git.access が付く（制限があっても）。
  // Gitea 側の権限も合わせる
  const giteaNote = await syncGiteaMembership(project.id);

  back(key, `プロジェクト管理者の設定を変更しました${giteaNote}`);
}

/** webhook の追加。Slack や Teams への連携を想定している */
export async function addWebhook(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const name = String(formData.get("name") ?? "").trim();
  const hookUrl = String(formData.get("hookUrl") ?? "").trim();
  if (!name || !hookUrl) back(key, "名前とURLを入力してください", true);
  if (!/^https?:\/\//.test(hookUrl)) back(key, "URLは http(s) で始めてください", true);

  await prisma.webhook.create({
    data: {
      projectId: project.id,
      name,
      hookUrl,
      description: String(formData.get("description") ?? ""),
      // 既定では全イベント。絞りたければ後から編集する
      allEvent: true,
      enabled: true,
    },
  });
  back(key, `webhook「${name}」を追加しました`);
}

export async function deleteWebhook(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);
  await prisma.webhook.deleteMany({
    where: { id: Number(formData.get("id")), projectId: project.id },
  });
  back(key, "webhook を削除しました");
}


/**
 * プロジェクトのメンバーを Gitea の organization に反映する。
 *
 * 判定は syncOrgMembers に集約してある（**`git.access` を持つ人だけ**を入れる）。
 * Gitea が落ちていてもメンバー操作自体は成立させる——権限の変更を
 * Gitea の都合で止めない。結果は画面に出す。
 */
async function syncGiteaMembership(projectId: number): Promise<string> {
  const { giteaEnabled } = await import("@/lib/gitea");
  if (!giteaEnabled()) return "";

  try {
    const { syncOrgMembers } = await import("@/lib/gitea-members");
    const out = await syncOrgMembers(projectId);
    if (out.added.length === 0 && out.removed.length === 0) return "";
    return out.removed.length > 0
      ? `（Gitも反映。${out.removed.length}人を外しました）`
      : "（Gitも反映）";
  } catch (e) {
    console.error("[gitea] メンバーの同期に失敗:", e);
    return "（※Gitへの反映に失敗しました。設定を確認してください）";
  }
}

/**
 * プロジェクトにチームを割り当てる。
 *
 * 本家は `POST /api/v2/projects/:projectIdOrKey/teams`（11.2）。
 * **チームを足してもプロジェクトの参加ユーザーにはしない。**
 * 本家の参加ユーザーとチームは別の概念で、権限（`project_members`）は
 * 個人単位で持っているため。チームは「お知らせ先にまとめて指定できる単位」。
 */
export async function addProjectTeam(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const name = String(formData.get("team") ?? "").trim();
  if (!name) back(key, "チーム名を入れてください", true);

  const team = await prisma.team.findUnique({ where: { name } });
  if (!team) back(key, `チームが見つかりません: ${name}`, true);

  await prisma.projectTeam.upsert({
    where: { projectId_teamId: { projectId: project.id, teamId: team!.id } },
    update: {},
    create: { projectId: project.id, teamId: team!.id },
  });
  back(key, `チーム「${name}」を割り当てました`);
}

/** プロジェクトからチームの割り当てを外す */
export async function removeProjectTeam(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const teamId = numberField(formData, "teamId", key);
  await prisma.projectTeam.delete({
    where: { projectId_teamId: { projectId: project.id, teamId } },
  });
  back(key, "チームの割り当てを外しました");
}
