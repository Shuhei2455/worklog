import { Worker } from "bullmq";
import {
  redis,
  SEARCH_QUEUE,
  WEBHOOK_QUEUE,
  MAIL_QUEUE,
  type SearchJob,
  type WebhookJob,
  type MailJob,
} from "@/lib/queue";
import { buildPayload, deliver } from "@/lib/webhook";
import { sendNotificationMail, mailEnabled } from "@/lib/mail";
import { prisma } from "@/lib/db";
import {
  meili,
  ensureIndexes,
  ISSUE_INDEX,
  WIKI_INDEX,
  type IssueDoc,
  type WikiDoc,
} from "@/lib/search";

/**
 * 非同期処理。
 *
 * いまは検索インデックスの更新だけ。メール送信と webhook 配信も
 * ここに足していく(docs/01-design.md 2章)。
 *
 * 画面の応答をこれらで遅くしないために別プロセスにしてある。
 */

async function issueDoc(id: number): Promise<IssueDoc | null> {
  const issue = await prisma.issue.findUnique({
    where: { id },
    include: {
      project: { select: { key: true } },
      activities: { select: { content: true } },
    },
  });
  if (!issue) return null;
  return {
    id: issue.id,
    projectId: issue.projectId,
    projectKey: issue.project.key,
    keyId: issue.keyId,
    summary: issue.summary,
    description: issue.description ?? "",
    // コメントも検索対象にする。「あの話どこで見たか」を探せないと使い物にならない
    comments: issue.activities
      .map((a) => a.content)
      .filter(Boolean)
      .join("\n"),
  };
}

async function wikiDoc(id: number): Promise<WikiDoc | null> {
  const page = await prisma.wikiPage.findUnique({
    where: { id },
    include: { project: { select: { key: true } }, tags: true },
  });
  if (!page) return null;
  return {
    id: page.id,
    projectId: page.projectId,
    projectKey: page.project.key,
    name: page.name,
    content: page.content,
    tags: page.tags.map((t) => t.tag),
  };
}

async function handle(job: SearchJob): Promise<string> {
  if (job.kind === "reindex-project") {
    const [issues, wikis] = await Promise.all([
      prisma.issue.findMany({ where: { projectId: job.id }, select: { id: true } }),
      prisma.wikiPage.findMany({ where: { projectId: job.id }, select: { id: true } }),
    ]);
    const issueDocs = (await Promise.all(issues.map((i) => issueDoc(i.id)))).filter(
      (d): d is IssueDoc => d !== null,
    );
    const wikiDocs = (await Promise.all(wikis.map((w) => wikiDoc(w.id)))).filter(
      (d): d is WikiDoc => d !== null,
    );
    if (issueDocs.length) await meili.index(ISSUE_INDEX).addDocuments(issueDocs);
    if (wikiDocs.length) await meili.index(WIKI_INDEX).addDocuments(wikiDocs);
    return `project ${job.id}: タスク${issueDocs.length} / Wiki${wikiDocs.length}`;
  }

  const index = job.kind === "issue" ? ISSUE_INDEX : WIKI_INDEX;

  if (job.op === "delete") {
    await meili.index(index).deleteDocument(job.id);
    return `${job.kind} ${job.id} を削除`;
  }

  const doc = job.kind === "issue" ? await issueDoc(job.id) : await wikiDoc(job.id);
  if (!doc) {
    // 積んだ後に消されていた場合。インデックスからも消しておく
    await meili.index(index).deleteDocument(job.id);
    return `${job.kind} ${job.id} は既に無いので削除`;
  }
  await meili.index(index).addDocuments([doc]);
  return `${job.kind} ${job.id} を更新`;
}

async function main() {
  // インデックスの設定は起動時に流す。filterable が無いと権限で絞れない
  try {
    await ensureIndexes();
    console.log("[worker] Meilisearch のインデックスを用意しました");
  } catch (e) {
    console.error("[worker] Meilisearch に繋がりません:", e);
  }

  const worker = new Worker<SearchJob>(
    SEARCH_QUEUE,
    async (job) => {
      const msg = await handle(job.data);
      console.log(`[worker] ${msg}`);
      return msg;
    },
    { connection: redis, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] 検索インデックス失敗 ${job?.id}:`, err.message);
  });

  // webhook の配信。外部が遅くても画面を待たせないために非同期にしている
  const hookWorker = new Worker<WebhookJob>(
    WEBHOOK_QUEUE,
    async (job) => {
      const payload = await buildPayload(job.data.activityId);
      if (!payload) return "活動が既に無い";
      const res = await deliver(job.data.hookUrl, payload);
      if (!res.ok) {
        if (res.permanent) {
          // **再試行しない。** 本文の形が違う・URLが失効している類の 4xx は
          // 何度送っても同じ結果にしかならない。
          // 以前は全部 throw していたため、Discord の 400 を延々と繰り返していた
          console.error(
            `[worker] webhook ${job.data.webhookId} は恒久エラーで中止: ` +
              `HTTP ${res.status} ${res.body}`,
          );
          return `webhook ${job.data.webhookId} 中止 (HTTP ${res.status})`;
        }
        // 落として再試行させる。相手が一時的に落ちていることがある
        throw new Error(`HTTP ${res.status} ${res.body}`);
      }
      return `webhook ${job.data.webhookId} へ送信 (HTTP ${res.status})`;
    },
    { connection: redis, concurrency: 4 },
  );

  hookWorker.on("completed", (job, result) => {
    console.log(`[worker] ${result}`);
  });
  hookWorker.on("failed", (job, err) => {
    console.error(`[worker] webhook失敗 ${job?.data?.webhookId}:`, err.message);
  });

  // メール。MAIL_ENABLED=false のときはワーカーごと起動しない。
  // 無効なのに接続を張ろうとして延々と失敗する、という状態を避ける
  if (mailEnabled()) {
    const mailWorker = new Worker<MailJob>(
      MAIL_QUEUE,
      async (job) => sendNotificationMail(job.data.notificationId),
      { connection: redis, concurrency: 2 },
    );
    mailWorker.on("completed", (_job, result) => console.log(`[worker] ${result}`));
    mailWorker.on("failed", (job, err) =>
      console.error(`[worker] メール失敗 ${job?.data?.notificationId}:`, err.message),
    );
    console.log("[worker] メール送信も待機します");
  } else {
    console.log("[worker] メールは無効です（MAIL_ENABLED=false）。アプリ内通知のみ");
  }

  console.log("[worker] 検索インデックスと webhook の配信を待機します");
}

main().catch((e) => {
  console.error("[worker] 起動に失敗しました:", e);
  process.exit(1);
});
