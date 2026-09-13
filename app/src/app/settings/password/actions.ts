"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { hashPassword, verifyPassword, checkPasswordStrength } from "@/lib/password";
import { audit } from "@/lib/audit";

/**
 * 自分のパスワードを変更する。
 *
 * **職場展開の前に必要な3点のうちの1つ**。これが無いと、管理者に
 * `pnpm db:password` を叩いてもらうしか変更手段が無かった。
 *
 * 現在のパスワードを要求する。画面を開いたまま離席した端末から
 * 変えられてしまうのを防ぐ。
 */
export async function changeMyPassword(formData: FormData) {
  const user = await currentUser();
  const path = "/settings/password";

  const fail = (msg: string): never => {
    revalidatePath(path);
    redirect(`${path}?error=${encodeURIComponent(msg)}`);
  };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { userId: true, name: true, email: true, passwordHash: true, authProvider: true },
  });

  if (row.authProvider !== "local") {
    fail("このアカウントは外部認証のため、ここでは変更できません");
  }
  if (!verifyPassword(current, row.passwordHash)) {
    fail("現在のパスワードが違います");
  }
  if (next !== confirm) {
    fail("確認用のパスワードが一致しません");
  }
  if (next === current) {
    fail("いまと同じパスワードは使えません");
  }

  const strength = checkPasswordStrength(next, {
    userId: row.userId,
    name: row.name,
    email: row.email,
  });
  if (!strength.ok) fail(strength.error);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(next) },
  });

  await audit(user.id, {
    action: "user.password",
    targetType: "user",
    targetId: row.userId,
    detail: { target: "app", self: true },
  });

  revalidatePath(path);
  redirect(`${path}?ok=1`);
}
