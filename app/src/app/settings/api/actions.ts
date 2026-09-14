"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { audit } from "@/lib/audit";
import { generateApiToken } from "@/lib/api/token";

/** APIキーの発行。生のキーは発行直後の一度しか見られない */
export async function issueToken(formData: FormData) {
  const actor = await currentUser();
  const name = String(formData.get("name") ?? "").trim() || "APIキー";
  const { raw, hash } = generateApiToken();
  const token = await prisma.apiToken.create({
    data: { userId: actor.id, name, tokenHash: hash },
  });
  // APIキーは「誰がいつ発行したか」を後から追えないと困る種類のもの
  await audit(actor.id, {
    action: "apiToken.create",
    targetType: "apiToken",
    targetId: token.id,
    detail: { name },
  });
  revalidatePath("/settings/api");
  // 生のキーはURLで一度だけ返す。DBには置かない
  // **発行した鍵をURLに載せない。** 履歴やアクセスログに残ってしまう。
  // フラッシュ（httpOnly cookie・5秒）で1回だけ画面に出す
  await setFlash("/settings/api", `created:${raw}`);
}

export async function revokeToken(formData: FormData) {
  const actor = await currentUser();
  const id = Number(formData.get("id"));
  await prisma.apiToken.updateMany({
    where: { id, userId: actor.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit(actor.id, {
    action: "apiToken.revoke",
    targetType: "apiToken",
    targetId: id,
  });
  await setFlash("/settings/api", "APIキーを失効させました");
  revalidatePath("/settings/api");
}
