import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@/lib/db";
import { describeChanges } from "@/lib/describe-changes";
import { changeLookupsFor } from "@/lib/issue-view";
import { renderMentions } from "@/lib/mention";

/**
 * メール通知。
 *
 * **`MAIL_ENABLED=false` で完全に無効化できること**が受け入れ条件
 * (docs/02-roadmap.md フェーズ3)。職場VMではSMTPリレーが使えない
 * 可能性が高く、その場合はアプリ内通知だけで運用が回る必要がある。
 *
 * 無効のときは接続を作らない。設定が空のまま起動しても何も起きない。
 */

export function mailEnabled(): boolean {
  return process.env.MAIL_ENABLED === "true" && Boolean(process.env.SMTP_HOST);
}

const globalForMail = globalThis as unknown as { mailer?: Transporter };

function transporter(): Transporter | null {
  if (!mailEnabled()) return null;
  if (globalForMail.mailer) return globalForMail.mailer;

  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // 465 は暗黙のTLS、それ以外は STARTTLS に任せる
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  globalForMail.mailer = t;
  return t;
}

const REASON_LABEL: Record<string, string> = {
  notified: "お知らせ",
  assigned: "担当になりました",
  mentioned: "メンション",
  watching: "ウォッチ中",
};

/** 通知1件をメールの本文に組む */
export async function buildMail(notificationId: number): Promise<{
  to: string;
  subject: string;
  text: string;
} | null> {
  const n = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      user: true,
      activity: {
        include: {
          user: true,
          project: { select: { key: true, name: true } },
          issue: { select: { keyId: true, summary: true } },
          wikiPage: { select: { name: true } },
        },
      },
    },
  });
  if (!n || n.user.disabledAt) return null;

  const a = n.activity;
  const appUrl = process.env.APP_URL || "";
  const lookups = await changeLookupsFor(a.projectId);
  const described = describeChanges(a.changes, lookups);

  const where = a.issue
    ? `${a.project.key}-${a.issue.keyId} ${a.issue.summary}`
    : a.wikiPage
      ? `Wiki: ${a.wikiPage.name}`
      : a.project.name;

  const link = a.issue
    ? `${appUrl}/issues/${a.project.key}-${a.issue.keyId}`
    : a.wikiPage
      ? `${appUrl}/projects/${a.project.key}/wiki/${encodeURIComponent(a.wikiPage.name)}`
      : appUrl;

  const teams = new Map((await prisma.team.findMany()).map((t) => [t.id, t.name]));
  const body = a.content
    ? renderMentions(a.content, { users: lookups.users ?? new Map(), teams })
    : "";

  const lines = [
    `${a.user.name} さんが更新しました。`,
    "",
    where,
    "",
    ...described.map((d) => `  ${d.label}: ${d.from ?? "未設定"} → ${d.to ?? "未設定"}`),
    ...(body ? ["", body] : []),
    "",
    link,
    "",
    `— この通知が届いた理由: ${REASON_LABEL[n.reason] ?? n.reason}`,
  ];

  return {
    to: n.user.email,
    subject: `[${a.project.key}] ${where}`,
    text: lines.join("\n"),
  };
}

/** 送る。無効なら何もしない */
export async function sendNotificationMail(notificationId: number): Promise<string> {
  const t = transporter();
  if (!t) return "メールは無効（MAIL_ENABLED=false）";

  const mail = await buildMail(notificationId);
  if (!mail) return "通知が見つからない";

  await t.sendMail({
    from: process.env.MAIL_FROM || "kadai@example.local",
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
  return `メール送信: ${mail.to}`;
}

/** 設定が正しいか試す。設定画面から使う */
export async function verifyMail(): Promise<{ ok: boolean; message: string }> {
  const t = transporter();
  if (!t) return { ok: false, message: "MAIL_ENABLED=false か SMTP_HOST が未設定です" };
  try {
    await t.verify();
    return { ok: true, message: "SMTPに接続できました" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "接続できません" };
  }
}
