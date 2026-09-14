import { prisma } from "@/lib/db";
import { ACTIVITY_TYPE_ID } from "@/lib/activity-type";
import { toBacklogChanges } from "@/lib/api/changes";
import type { ActivityType } from "@prisma/client";
import { chatKindOf, toDiscord } from "@/lib/webhook-chat";

/**
 * プロジェクト単位の webhook 送信。
 *
 * 送信は worker 経由の非同期。外部が遅くても画面を待たせない。
 *
 * ペイロードは本家に寄せた形にする。既存の受け側がある場合に
 * 差し替えやすくするため。
 *
 * **ただし Discord だけは形を変えて送る**（決定 D31）。
 * Discord は最上位の `content` を文字列として読むので、本家寄りの形
 * （`content` がオブジェクト）だと HTTP 400 になる。lib/webhook-chat.ts を参照。
 *
 * **Slack / Teams には未対応。** 同じ理由でそのままでは届かない
 * （Slack は `{text}` を期待する）。必要になったら webhook-chat.ts に足す。
 */

export type WebhookPayload = {
  id: number;
  project: { id: number; projectKey: string; name: string };
  type: number;
  content: Record<string, unknown>;
  notifications: [];
  createdUser: { id: number; userId: string; name: string };
  created: string;
};

/** その活動を受け取るべき webhook を選ぶ */
export async function webhooksFor(
  projectId: number,
  type: ActivityType,
): Promise<Array<{ id: number; hookUrl: string; name: string }>> {
  const hooks = await prisma.webhook.findMany({
    where: { projectId, enabled: true },
  });
  const typeId = ACTIVITY_TYPE_ID[type];
  return hooks
    .filter((h) => h.allEvent || h.activityTypes.includes(type))
    .map((h) => ({ id: h.id, hookUrl: h.hookUrl, name: h.name }));
}

/**
 * 1件送る。worker から呼ぶ。
 *
 * **送信先によって本文の形を変える。**
 * Discord は最上位の `content` を文字列として読むので、本家寄りの形
 * （`content` がオブジェクト）をそのまま送ると HTTP 400 になる。
 * lib/webhook-chat.ts を参照。
 *
 * `permanent` は「再試行しても無駄」を意味する。
 * 本文の形が違う・URLが失効しているといった 4xx は、
 * 何度送っても同じ結果にしかならない（429 は例外。待てば通る）。
 */
export async function deliver(
  hookUrl: string,
  payload: WebhookPayload,
): Promise<{ ok: boolean; status: number; body: string; permanent: boolean }> {
  const kind = chatKindOf(hookUrl);
  const body =
    kind === "discord" ? toDiscord(payload, process.env.APP_URL) : payload;

  const controller = new AbortController();
  // 相手が遅くても worker を占有させない
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(hookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 200),
      permanent: res.status >= 400 && res.status < 500 && res.status !== 429,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 活動から本家寄りのペイロードを組む */
export async function buildPayload(activityId: number): Promise<WebhookPayload | null> {
  const a = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      project: { select: { id: true, key: true, name: true } },
      user: { select: { id: true, userId: true, name: true } },
      issue: { select: { id: true, keyId: true, summary: true, description: true } },
      wikiPage: { select: { id: true, name: true } },
    },
  });
  if (!a) return null;

  const content: Record<string, unknown> = {};
  if (a.issue) {
    content.id = a.issue.id;
    content.key_id = a.issue.keyId;
    content.summary = a.issue.summary;
    content.description = a.issue.description ?? "";
    if (a.content) content.comment = { id: a.id, content: a.content };
    // 内部の {field, from, to} をそのまま出すと、本家向けに作られた
    // 受け側が読めない。{field, new_value, old_value, type} に直す
    const changes = toBacklogChanges(a.changes);
    if (changes.length > 0) content.changes = changes;
  } else if (a.wikiPage) {
    content.id = a.wikiPage.id;
    content.name = a.wikiPage.name;
  }

  return {
    id: a.id,
    project: {
      id: a.project.id,
      projectKey: a.project.key,
      name: a.project.name,
    },
    type: ACTIVITY_TYPE_ID[a.type],
    content,
    notifications: [],
    createdUser: a.user,
    created: a.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
