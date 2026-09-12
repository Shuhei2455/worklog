import { prisma } from "@/lib/db";
import { apiRoute } from "@/lib/api/handler";
import { serializeProject } from "@/lib/api/serialize";

/**
 * GET /api/v2/projects
 * 参加しているプロジェクトだけ。管理者でも未参加は出さない。
 */
export const GET = apiRoute<Record<string, never>>(async (_req, ctx) => {
  const projects = await prisma.project.findMany({
    where: { id: { in: ctx.visibleProjectIds } },
    orderBy: { id: "asc" },
  });
  return projects.map(serializeProject);
});
