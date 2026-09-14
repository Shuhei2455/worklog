"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
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
    await setFlash("/settings/language", "その言語は選べません", true);
    revalidatePath("/settings/language");
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lang } });

  // ヘッダもサイドバーも言語で変わるので、全体を作り直させる
  // 表示言語は全画面に効くのでレイアウトごと作り直す
  await setFlash("/settings/language", "表示言語を変更しました");
  revalidatePath("/", "layout");
}
