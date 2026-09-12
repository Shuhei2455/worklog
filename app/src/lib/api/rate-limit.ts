import { redis } from "@/lib/queue";

/**
 * レート制限。
 *
 * 出典: https://developer.nulab.com/docs/backlog/rate-limit/
 *
 * 本家は4種類に分かれていて、**APIキー単位ではなくユーザー単位**で数える。
 * 同じユーザーが複数キーを作っても合算される。
 *
 * 具体的な上限値はプランによって変わり公表されていないので、
 * ここでは自前の既定値を使う（決定 D17）。`.env` で変えられる。
 */

export type RateKind = "read" | "update" | "search" | "icon";

/** 1分あたりの上限。本家の値は非公開なので自前で決める(決定 D17) */
export const RATE_LIMITS: Record<RateKind, number> = {
  read: Number(process.env.RATE_LIMIT_READ || 600),
  update: Number(process.env.RATE_LIMIT_UPDATE || 150),
  search: Number(process.env.RATE_LIMIT_SEARCH || 150),
  icon: Number(process.env.RATE_LIMIT_ICON || 60),
};

/** メソッドとパスから種別を決める。本家の分類に合わせる */
export function rateKindFor(method: string, pathname: string): RateKind {
  if (/\/(icon|logo)$/.test(pathname)) return "icon";
  if (method === "GET") {
    // Search: 課題一覧・課題数・Wiki一覧・Wiki数
    if (/\/api\/v2\/issues\/?$/.test(pathname)) return "search";
    if (/\/api\/v2\/issues\/count$/.test(pathname)) return "search";
    if (/\/api\/v2\/wikis\/?$/.test(pathname)) return "search";
    if (/\/api\/v2\/wikis\/count$/.test(pathname)) return "search";
    return "read";
  }
  return "update";
}

export type RateResult = {
  limit: number;
  remaining: number;
  /** リセット時刻（UTC epoch 秒）。本家のヘッダと同じ単位 */
  reset: number;
  allowed: boolean;
};

/**
 * 1分の固定窓で数える。
 *
 * Redis が落ちているときは**通す**。
 * 制限のために本体が止まる方が困る。
 */
export async function consumeRate(
  userId: number,
  kind: RateKind,
): Promise<RateResult> {
  const limit = RATE_LIMITS[kind];
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % 60);
  const reset = windowStart + 60;
  const key = `ratelimit:${userId}:${kind}:${windowStart}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 120);
    return {
      limit,
      remaining: Math.max(0, limit - count),
      reset,
      allowed: count <= limit,
    };
  } catch {
    // Redis が無くても API は使えるべき
    return { limit, remaining: limit, reset, allowed: true };
  }
}

/** 現在の状況を消費せずに見る。GET /api/v2/rateLimit 用 */
export async function peekRate(userId: number): Promise<Record<RateKind, RateResult>> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % 60);
  const reset = windowStart + 60;
  const out = {} as Record<RateKind, RateResult>;

  for (const kind of ["read", "update", "search", "icon"] as RateKind[]) {
    const limit = RATE_LIMITS[kind];
    let used = 0;
    try {
      used = Number((await redis.get(`ratelimit:${userId}:${kind}:${windowStart}`)) || 0);
    } catch {
      used = 0;
    }
    out[kind] = {
      limit,
      remaining: Math.max(0, limit - used),
      reset,
      allowed: used < limit,
    };
  }
  return out;
}
