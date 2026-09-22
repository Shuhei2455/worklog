import { ACTIVITY_TYPE_BY_ID, ACTIVITY_TYPE_LABEL } from "@/lib/activity-type";
import type { WebhookPayload } from "@/lib/webhook";

/**
 * チャットサービス向けの webhook 変換。
 *
 * **なぜ要るか。**
 * webhook の本文は本家Backlogに寄せた形（`{id, project, type, content, ...}`）で
 * 送っている。受け側を差し替えやすくするためだが、
 * **Discord はこの形を受け付けない。**
 * Discord の Incoming Webhook は最上位の `content` を**文字列**として読むので、
 * こちらがオブジェクトを入れていると
 * `Could not interpret "{...}" as string` で HTTP 400 になる。
 *
 * 実際に 2026-09-14 まで、登録された Discord の webhook は全部 400 で落ちていた。
 *
 * そこで**送信先のURLを見て本文の形を変える**。
 * 本家寄りの形は、本家向けに作られた受け側のために残す。
 */

export type ChatKind = "discord" | "backlog";

/**
 * URLから送信先の種類を判定する。
 *
 * Discord の Incoming Webhook は
 *   https://discord.com/api/webhooks/<id>/<token>
 * の形。`discordapp.com` は旧ドメインだがまだ生きている。
 *
 * 末尾に `/slack` や `/github` を付けると Discord 側が
 * その形式を受け付けるが、**こちらから付けることはしない**
 * （利用者が付けている場合はそれを尊重して素通しする）。
 */
export function chatKindOf(hookUrl: string): ChatKind {
  let host: string;
  let path: string;
  try {
    const u = new URL(hookUrl);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return "backlog";
  }
  const isDiscordHost =
    host === "discord.com" ||
    host === "discordapp.com" ||
    host.endsWith(".discord.com") ||
    host.endsWith(".discordapp.com");
  if (!isDiscordHost) return "backlog";
  // 互換エンドポイントは Discord 側が解釈するので、こちらは触らない
  if (path.endsWith("/slack") || path.endsWith("/github")) return "backlog";
  return "discord";
}

/** 活動の種類ごとの色。課題一覧の状態色ではなく、出来事の性質で分ける */
const COLOR: Record<string, number> = {
  issue_created: 0x5eb5a6, // 追加＝緑
  issue_updated: 0x4488c5, // 更新＝青
  comment: 0x4488c5,
  issue_deleted: 0xed8077, // 削除＝赤
  wiki_created: 0x5eb5a6,
  wiki_updated: 0x4488c5,
  wiki_deleted: 0xed8077,
  file_added: 0x5eb5a6,
  file_updated: 0x4488c5,
  git_push: 0xa1af2f,
  pull_request_created: 0x5eb5a6,
  pull_request_updated: 0x4488c5,
  project_user_added: 0x5eb5a6,
  project_user_removed: 0xed8077,
};
const COLOR_DEFAULT = 0x2c9a7a;

export type DiscordPayload = {
  username: string;
  embeds: Array<{
    title: string;
    url?: string;
    description?: string;
    color: number;
    fields?: Array<{ name: string; value: string; inline: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
};

/** Discord の上限に合わせて切る。超えると全体が 400 になる */
function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/**
 * 本家寄りのペイロードを Discord の形に変換する。
 *
 * `appUrl` があれば課題へのリンクを付ける。無ければタイトルだけ。
 */
export function toDiscord(payload: WebhookPayload, appUrl?: string): DiscordPayload {
  const type = ACTIVITY_TYPE_BY_ID.get(payload.type);
  const typeLabel = type ? ACTIVITY_TYPE_LABEL[type] : "更新";
  const c = payload.content as {
    key_id?: number;
    summary?: string;
    name?: string;
    description?: string;
    comment?: { content?: string };
    changes?: Array<{ field?: string; old_value?: string; new_value?: string }>;
  };

  const projectKey = payload.project.projectKey;
  const issueKey = c.key_id != null ? `${projectKey}-${c.key_id}` : null;

  // 課題なら「AA-1 件名」、Wikiなどはページ名
  const subject = c.summary ?? c.name ?? payload.project.name;
  const title = clip(issueKey ? `${issueKey} ${subject}` : subject, 256);

  const url =
    appUrl && issueKey ? `${appUrl.replace(/\/$/, "")}/issues/${issueKey}` : undefined;

  // 本文はコメント優先。無ければ課題の説明
  const body = c.comment?.content ?? c.description ?? "";

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  for (const ch of c.changes ?? []) {
    if (!ch.field) continue;
    const from = ch.old_value ?? "（なし）";
    const to = ch.new_value ?? "（なし）";
    fields.push({
      name: clip(ch.field, 256),
      value: clip(`${from} → ${to}`, 1024),
      inline: true,
    });
    // Discord の上限は25個。実務では数個しか変わらないが、念のため切る
    if (fields.length >= 25) break;
  }

  return {
    // 送信元が分かるようにする。Discord側の名前より優先される
    username: `Worklog / ${payload.project.name}`,
    embeds: [
      {
        title,
        url,
        description: body ? clip(body, 4000) : undefined,
        color: type ? (COLOR[type] ?? COLOR_DEFAULT) : COLOR_DEFAULT,
        fields: fields.length > 0 ? fields : undefined,
        footer: { text: `${typeLabel} · ${payload.createdUser.name}` },
        timestamp: payload.created,
      },
    ],
  };
}
