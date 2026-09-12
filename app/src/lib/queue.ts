import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * 非同期処理のキュー（BullMQ）。
 *
 * 検索インデックスの更新・メール送信・webhook 配信をここに積む。
 * 画面の応答をこれらで遅くしない、というのが worker を分けている理由。
 *
 * **キューに積めなくてもアプリの操作は成立させる。**
 * Redis が落ちているときに課題が作れなくなるのは割に合わない。
 */

const globalForQueue = globalThis as unknown as {
  redis?: IORedis;
  searchQueue?: Queue;
  webhookQueue?: Queue;
  mailQueue?: Queue;
};

export const redis =
  globalForQueue.redis ??
  new IORedis(process.env.REDIS_URL || "redis://redis:6379", {
    maxRetriesPerRequest: null,
    // 落ちていても起動を止めない
    enableOfflineQueue: false,
    lazyConnect: false,
  });
redis.on("error", () => {
  // 再接続は ioredis に任せる。ここで落とさない
});

if (process.env.NODE_ENV !== "production") globalForQueue.redis = redis;

export const SEARCH_QUEUE = "search-index";
export const WEBHOOK_QUEUE = "webhook";
export const MAIL_QUEUE = "mail";

export type WebhookJob = { activityId: number; hookUrl: string; webhookId: number };
export type MailJob = { notificationId: number };

export type SearchJob =
  | { kind: "issue"; op: "upsert" | "delete"; id: number }
  | { kind: "wiki"; op: "upsert" | "delete"; id: number }
  | { kind: "reindex-project"; id: number };

export const searchQueue =
  globalForQueue.searchQueue ??
  new Queue<SearchJob>(SEARCH_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

if (process.env.NODE_ENV !== "production") globalForQueue.searchQueue = searchQueue;

export const webhookQueue =
  globalForQueue.webhookQueue ??
  new Queue<WebhookJob>(WEBHOOK_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      // 外部が一時的に落ちていることがあるので、検索より粘る
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

export const mailQueue =
  globalForQueue.mailQueue ??
  new Queue<MailJob>(MAIL_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.webhookQueue = webhookQueue;
  globalForQueue.mailQueue = mailQueue;
}

/** webhook の送信を積む。失敗しても呼び出し元を止めない */
export async function enqueueWebhook(job: WebhookJob): Promise<void> {
  try {
    await webhookQueue.add("deliver", job);
  } catch {
    // Redis が落ちていても本体は動かす
  }
}

/** メール送信を積む。MAIL_ENABLED=false なら積まない */
export async function enqueueMail(job: MailJob): Promise<void> {
  if (process.env.MAIL_ENABLED !== "true") return;
  try {
    await mailQueue.add("send", job);
  } catch {
    // 同上
  }
}

/**
 * 検索インデックスの更新を積む。
 * 失敗しても呼び出し元を止めない（検索が少し古くなるだけ）。
 */
export async function enqueueSearch(job: SearchJob): Promise<void> {
  try {
    await searchQueue.add(job.kind, job);
  } catch {
    // Redis が落ちていてもアプリの操作は続行させる。
    // TODO(M5): 取りこぼしを拾う定期の再インデックスを足す
  }
}
