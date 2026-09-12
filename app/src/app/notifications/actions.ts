"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";

/** 1件を既読にする */
export async function markAsRead(formData: FormData) {
  const actor = await currentUser();
  const id = Number(formData.get("id"));
  // 自分の通知しか触れないよう userId で縛る
  await prisma.notification.updateMany({
    where: { id, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

/** 未読をまとめて既読にする（本家の markAsRead 相当） */
export async function markAllAsRead() {
  const actor = await currentUser();
  await prisma.notification.updateMany({
    where: { userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}
