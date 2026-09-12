import { z } from "zod";
import { apiRoute } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { serializeTeam } from "@/lib/api/serialize-team";

/**
 * GET /api/v2/teams
 *
 * 本家の絞り込みに合わせる: order(asc/desc、既定 desc) / offset /
 * count(1〜100、既定20)。00-spec-verified.md 11.2
 */
const query = z.object({
  order: z.enum(["asc", "desc"]).catch("desc"),
  offset: z.coerce.number().int().min(0).catch(0),
  count: z.coerce.number().int().min(1).max(100).catch(20),
});

export const GET = apiRoute<Record<string, never>>(async (req) => {
  const sp = new URL(req.url).searchParams;
  const q = query.parse({
    order: sp.get("order") ?? undefined,
    offset: sp.get("offset") ?? undefined,
    count: sp.get("count") ?? undefined,
  });

  const teams = await prisma.team.findMany({
    include: { members: { include: { user: true } }, createdBy: true, updatedBy: true },
    orderBy: { id: q.order },
    skip: q.offset,
    take: q.count,
  });
  return teams.map(serializeTeam);
});
