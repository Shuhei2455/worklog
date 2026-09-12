import type { Prisma, NotificationReason } from "@prisma/client";
import { parseMentions, resolveMentionTargets } from "@/lib/mention";

/**
 * 通知の生成。
 *
 * 入口は3経路（お知らせ・ウォッチ・メンション）＋担当者。
 * **発生源が違うだけで、生成される通知レコードは同一形式にする**
 * (docs/01-design.md 4.5)。
 *
 * 同じ activity に複数の理由が該当したら、決定D10 の優先順で1件に寄せる:
 *   notified > assigned > mentioned > watching
 */

/** 優先順。数字が小さいほど強い */
const REASON_RANK: Record<NotificationReason, number> = {
  notified: 0,
  assigned: 1,
  mentioned: 2,
  watching: 3,
};

export type NotifyInput = {
  activityId: number;
  issueId: number;
  projectId: number;
  /** この活動を起こした人。自分の操作では自分に通知しない */
  actorId: number;
  /** 「お知らせ」で明示指定された宛先 */
  notifiedUserIds?: number[];
  /** 担当者になった人 */
  assigneeId?: number | null;
  /** メンションを探す本文。説明とコメントの両方を渡してよい */
  texts?: Array<string | null | undefined>;
};

/**
 * 通知を作る。**トランザクション内で呼ぶこと。**
 * 活動履歴と通知がずれると、通知だけ残って中身が無い状態になる。
 */
export async function createNotifications(
  tx: Prisma.TransactionClient,
  input: NotifyInput,
): Promise<number> {
  // 理由ごとに宛先を集め、最後に一番強い理由へ寄せる
  const candidates = new Map<number, NotificationReason>();

  const add = (userId: number, reason: NotificationReason) => {
    // 自分の操作で自分に通知しない
    if (userId === input.actorId) return;
    const cur = candidates.get(userId);
    if (cur === undefined || REASON_RANK[reason] < REASON_RANK[cur]) {
      candidates.set(userId, reason);
    }
  };

  // 1. お知らせ（明示指定）
  for (const id of input.notifiedUserIds ?? []) add(id, "notified");

  // 2. 担当者
  if (input.assigneeId) add(input.assigneeId, "assigned");

  // 3. メンション
  const mentions = (input.texts ?? []).flatMap((t) => parseMentions(t));
  if (mentions.length > 0) {
    const [members, teams] = await Promise.all([
      tx.projectMember.findMany({
        where: { projectId: input.projectId },
        select: { userId: true },
      }),
      tx.teamMember.findMany({ select: { teamId: true, userId: true } }),
    ]);
    const teamMembers = new Map<number, number[]>();
    for (const t of teams) {
      const list = teamMembers.get(t.teamId) ?? [];
      list.push(t.userId);
      teamMembers.set(t.teamId, list);
    }
    const targets = resolveMentionTargets(mentions, {
      memberIds: members.map((m) => m.userId),
      teamMembers,
    });
    for (const id of targets) add(id, "mentioned");
  }

  // 4. ウォッチ
  const watchers = await tx.watching.findMany({
    where: { issueId: input.issueId },
    select: { userId: true },
  });
  for (const w of watchers) add(w.userId, "watching");

  if (candidates.size === 0) return 0;

  // 参加していないユーザーには通知しない。
  // プロジェクトから外れた後も通知が届くと、件名から内容が推測できてしまう
  const members = await tx.projectMember.findMany({
    where: {
      projectId: input.projectId,
      userId: { in: [...candidates.keys()] },
    },
    select: { userId: true },
  });
  const allowed = new Set(members.map((m) => m.userId));

  const rows = [...candidates.entries()]
    .filter(([userId]) => allowed.has(userId))
    .map(([userId, reason]) => ({
      userId,
      activityId: input.activityId,
      reason,
    }));

  if (rows.length === 0) return 0;

  const result = await tx.notification.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}
