"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { generateApiToken } from "@/lib/api/token";

/** APIキーの発行。生のキーは発行直後の一度しか見られない */
export async function issueToken(formData: FormData) {
  const actor = await currentUser();
  const name = String(formData.get("name") ?? "").trim() || "APIキー";
  const { raw, hash } = generateApiToken();
  await prisma.apiToken.create({
    data: { userId: actor.id, name, tokenHash: hash },
  });
  revalidatePath("/settings/api");
  // 生のキーはURLで一度だけ返す。DBには置かない
  redirect(`/settings/api?created=${encodeURIComponent(raw)}`);
}

export async function revokeToken(formData: FormData) {
  const actor = await currentUser();
  const id = Number(formData.get("id"));
  await prisma.apiToken.updateMany({
    where: { id, userId: actor.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings/api");
  redirect("/settings/api");
}
