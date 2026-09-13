"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { isLocale } from "@/lib/i18n";

/**
 * 表示言語を変える。
 *
 * `users.lang` に持つ（M0 から列はあり、本家の API も `lang` を返す）。
 * サーバーコンポーネントが描くときに読むので、保存したら次の描画から効く。
 */
export async function setLanguage(formData: FormData) {
  const user = await currentUser();
  const lang = String(formData.get("lang") ?? "");

  if (!isLocale(lang)) {
    redirect(`/settings/language?error=${encodeURIComponent("その言語は選べません")}`);
  }

  await prisma.user.update({ where: { id: user.id }, data: { lang } });

  // ヘッダもサイドバーも言語で変わるので、全体を作り直させる
  revalidatePath("/", "layout");
  redirect("/settings/language?ok=1");
}
