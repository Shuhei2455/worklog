import { apiRoute } from "@/lib/api/handler";
import { peekRate } from "@/lib/api/rate-limit";

/**
 * GET /api/v2/rateLimit
 * 本家も具体的な上限はこのAPIで取る形なので、同じ構造で返す。
 */
export const GET = apiRoute<Record<string, never>>(async (_req, ctx) => {
  const r = await peekRate(ctx.user.id);
  const fmt = (x: { limit: number; remaining: number; reset: number }) => ({
    limit: x.limit,
    remaining: x.remaining,
    reset: x.reset,
  });
  return {
    rateLimit: {
      read: fmt(r.read),
      update: fmt(r.update),
      search: fmt(r.search),
      icon: fmt(r.icon),
    },
  };
});
