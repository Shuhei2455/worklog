"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { hashPassword, checkPasswordStrength } from "@/lib/password";
import { audit } from "@/lib/audit";

/**
 * ユーザーの管理（スペース管理者のみ）。
 *
 * **これが無いと職場でメンバーを追加できない。** ロードマップの
 * フェーズ5のタスクには挙がっていないが、受け入れ条件が
 * 「職場のメンバー2〜3人に使ってもらい…」なので、SQLを叩かずに
 * 追加できる手段が要る。
 *
 * 削除はしない。活動履歴が残るので**無効化**で止める
 * （users.disabled_at。01-design.md の方針）。
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
  if (message) await setFlash("/users", message, isError);
  revalidatePath("/users");
}

const USER_ID_RE = /^[a-zA-Z0-9_.-]{2,64}$/;

export async function createUser(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const userId = String(formData.get("userId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const userType = String(formData.get("userType") ?? "member");
  const restriction = String(formData.get("restriction") ?? "none");

  if (!USER_ID_RE.test(userId)) {
    return await back("ログインIDは英数字・ハイフン・アンダースコア・ドットで2〜64文字です", true);
  }
  if (!name) return await back("名前を入れてください", true);
  if (!email.includes("@")) return await back("メールアドレスの形が正しくありません", true);
  if (!["admin", "member", "guest"].includes(userType)) return await back("種別が不正です", true);
  if (!["none", "issue_create_only", "issue_view_only"].includes(restriction)) {
    return await back("制限が不正です", true);
  }

  // パスワードの条件は画面からの変更と同じものを通す
  const strength = checkPasswordStrength(password, { userId, name, email });
  if (!strength.ok) return await back(strength.error, true);

  const dupId = await prisma.user.findUnique({ where: { userId } });
  if (dupId) return await back(`ログインID「${userId}」は既に使われています`, true);
  const dupMail = await prisma.user.findUnique({ where: { email } });
  if (dupMail) return await back(`メールアドレス「${email}」は既に使われています`, true);

  const created = await prisma.user.create({
    data: {
      userId,
      name,
      email,
      passwordHash: hashPassword(password),
      userType: userType as "admin" | "member" | "guest",
      restriction: restriction as "none" | "issue_create_only" | "issue_view_only",
    },
  });

  await audit(actor.id, {
    action: "user.create",
    targetType: "user",
    targetId: userId,
    detail: { name, email, userType, restriction },
  });

  return await back(`${created.name} を追加しました`);
}

/** 種別と制限を変える。**3軸のうち2軸**（プロジェクト管理者はプロジェクト側） */
export async function updateUser(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return await back("不正なリクエストです", true);

  const userType = String(formData.get("userType") ?? "");
  const restriction = String(formData.get("restriction") ?? "");
  if (!["admin", "member", "guest"].includes(userType)) return await back("種別が不正です", true);
  if (!["none", "issue_create_only", "issue_view_only"].includes(restriction)) {
    return await back("制限が不正です", true);
  }

  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) return await back("ユーザーが見つかりません", true);

  await prisma.user.update({
    where: { id },
    data: {
      userType: userType as "admin" | "member" | "guest",
      restriction: restriction as "none" | "issue_create_only" | "issue_view_only",
    },
  });

  await audit(actor.id, {
    action: "user.update",
    targetType: "user",
    targetId: before!.userId,
    detail: {
      from: { userType: before!.userType, restriction: before!.restriction },
      to: { userType, restriction },
    },
  });

  // 制限が変わると Git のアクセス権も変わる。Gitea 側も合わせる
  const note = await syncGiteaForUser(id);
  return await back(`${before!.name} の種別と制限を変更しました${note}`);
}

/**
 * 無効化と再有効化。
 *
 * 削除はしない。課題の登録者や活動履歴から参照されているため。
 * 無効化したユーザーはログインできず、権限判定も全部落ちる（can() の入口）。
 */
export async function toggleUserDisabled(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return await back("不正なリクエストです", true);
  if (id === actor.id) return await back("自分自身は無効化できません", true);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return await back("ユーザーが見つかりません", true);

  const disabling = user!.disabledAt === null;

  // 最後の管理者を無効化すると誰も設定を変えられなくなる
  if (disabling && user!.userType === "admin") {
    const others = await prisma.user.count({
      where: { userType: "admin", disabledAt: null, id: { not: id } },
    });
    if (others === 0) return await back("最後の管理者は無効化できません", true);
  }

  await prisma.user.update({
    where: { id },
    data: { disabledAt: disabling ? new Date() : null },
  });

  await audit(actor.id, {
    action: disabling ? "user.disable" : "user.enable",
    targetType: "user",
    targetId: user!.userId,
    detail: { name: user!.name },
  });

  const note = await syncGiteaForUser(id);
  return await back(`${user!.name} を${disabling ? "無効化" : "有効化"}しました${note}`);
}

/** 管理者によるパスワードの再設定。本人が忘れたとき用 */
export async function resetUserPassword(formData: FormData) {
  const actor = await currentUser();
  await assertCan(actor, "space.edit");

  const id = Number(formData.get("id"));
  const password = String(formData.get("password") ?? "");
  if (!Number.isInteger(id)) return await back("不正なリクエストです", true);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return await back("ユーザーが見つかりません", true);
  if (user!.authProvider !== "local") {
    return await back(`${user!.name} は ${user!.authProvider} 認証のため設定できません`, true);
  }

  const strength = checkPasswordStrength(password, {
    userId: user!.userId,
    name: user!.name,
    email: user!.email,
  });
  if (!strength.ok) return await back(strength.error, true);

  await prisma.user.update({
    where: { id },
    data: { passwordHash: hashPassword(password) },
  });

  await audit(actor.id, {
    action: "user.password",
    targetType: "user",
    targetId: user!.userId,
    detail: { target: "app", byAdmin: true },
  });

  return await back(`${user!.name} のパスワードを再設定しました`);
}

/**
 * そのユーザーが参加している全プロジェクトの Gitea 権限を合わせる。
 *
 * 制限を変えたり無効化したときに、Gitea 側が開いたままだと
 * **画面は閉じているのにコードはクローンできる**状態になる（M4で踏んだ穴）。
 */
async function syncGiteaForUser(userId: number): Promise<string> {
  const { giteaEnabled } = await import("@/lib/gitea");
  if (!giteaEnabled()) return "";

  try {
    const { syncOrgMembers } = await import("@/lib/gitea-members");
    const members = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    let touched = 0;
    for (const m of members) {
      const out = await syncOrgMembers(m.projectId);
      if (out.added.length > 0 || out.removed.length > 0) touched++;
    }
    return touched > 0 ? "（Gitの権限も合わせました）" : "";
  } catch (e) {
    console.error("[gitea] ユーザー変更後の同期に失敗:", e);
    return "（※Gitへの反映に失敗しました）";
  }
}
