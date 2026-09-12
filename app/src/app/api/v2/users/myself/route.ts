import { apiRoute } from "@/lib/api/handler";
import { serializeUser } from "@/lib/api/serialize";

/** GET /api/v2/users/myself — 疎通確認によく使われる */
export const GET = apiRoute(async (_req, ctx) => serializeUser(ctx.user));
