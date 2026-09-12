import { prisma } from "@/lib/db";
import { webhooksFor } from "@/lib/webhook";
import { enqueueWebhook, enqueueMail } from "@/lib/queue";
import type { ActivityType } from "@prisma/client";

/**
 * 活動が起きたときの外向きの通知をまとめて積む。
 *
 * **トランザクションの外で呼ぶこと。** 外部への送信をトランザクション内で
 * 待つと、DBの接続を握ったまま相手のタイムアウトを待つことになる。
 */
export async function dispatchActivity(
  activityId: number,
  projectId: number,
  type: ActivityType,
): Promise<void> {
  // webhook
  const hooks = await webhooksFor(projectId, type).catch(() => []);
  for (const h of hooks) {
    await enqueueWebhook({ activityId, hookUrl: h.hookUrl, webhookId: h.id });
  }

  // メール。MAIL_ENABLED=false なら enqueueMail 側で捨てられる
  const notifications = await prisma.notification
    .findMany({ where: { activityId }, select: { id: true } })
    .catch(() => []);
  for (const n of notifications) {
    await enqueueMail({ notificationId: n.id });
  }
}
