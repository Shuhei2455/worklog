import { redis } from "@/lib/queue";

/**
 * ログイン失敗のレート制限。
 *
 * **職場展開の前に必要な3点のうちの1つ**（Obsidian の backlog-clone-index）。
 * 社内ネットワークからでも、総当たりを放置する理由はない。
 *
 * 決定 D28: ログインIDごとに数える。同じIDへの失敗が `MAX` 回に達したら
 * `LOCK_SECONDS` のあいだ、正しいパスワードでも通さない。成功したら数を消す。
 *
 * IDごとにしたのは、社内だと**全員が同じ出口IPで来る**ことが多く、
 * IP単位にすると1人の打ち間違いで全員が止まるため。
 * 逆にIDを変えながら総当たりする相手には弱いが、社内向けの規模では
 * そこまでの防御より「運用が止まらないこと」を優先する。
 *
 * Redis が落ちているときは**通す**。ログインできない方が被害が大きい
 * （他の箇所と同じ方針。キューもレート制限も fail-open にしている）。
 */

const MAX_ATTEMPTS = 10;
const LOCK_SECONDS = 15 * 60;
const WINDOW_SECONDS = 15 * 60;

const key = (userId: string) => `login-fail:${userId.toLowerCase()}`;

export type LockState = { locked: boolean; remaining: number };

/** いま止められているか。残り秒数も返す */
export async function loginLockState(userId: string): Promise<LockState> {
  if (!userId) return { locked: false, remaining: 0 };
  try {
    const k = key(userId);
    const count = Number((await redis.get(k)) ?? 0);
    if (count < MAX_ATTEMPTS) return { locked: false, remaining: 0 };
    const ttl = await redis.ttl(k);
    return { locked: true, remaining: ttl > 0 ? ttl : 0 };
  } catch {
    // Redis が落ちていてもログインは通す
    return { locked: false, remaining: 0 };
  }
}

/**
 * 失敗を数える。
 *
 * 最初の失敗で有効期限を付ける。以降の失敗では延ばさない
 * （延ばすと、打ち間違いを繰り返す人が永久に入れなくなる）。
 */
export async function recordLoginFailure(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const k = key(userId);
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, WINDOW_SECONDS);
    if (count === MAX_ATTEMPTS) {
      // 到達した時点で、ロック時間に差し替える
      await redis.expire(k, LOCK_SECONDS);
    }
    return count;
  } catch {
    return 0;
  }
}

/** 成功したら数を消す */
export async function clearLoginFailures(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await redis.del(key(userId));
  } catch {
    // 消せなくても実害は小さい（時間で消える）
  }
}

export const LOGIN_LIMIT = {
  maxAttempts: MAX_ATTEMPTS,
  lockSeconds: LOCK_SECONDS,
};
