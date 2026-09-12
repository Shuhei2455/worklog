import { prisma } from "@/lib/db";
import { apiRoute, findProject } from "@/lib/api/handler";
import { serializeStatus } from "@/lib/api/serialize";

/**
 * GET /api/v2/projects/:projectIdOrKey/statuses
 * 状態はプロジェクト単位。各プロジェクトで id が 1 始まりになる
 */
export const GET = apiRoute<{ projectIdOrKey: string }>(
  async (_req, ctx, params) => {
    const project = await findProject(params.projectIdOrKey, ctx);
    const statuses = await prisma.status.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    });
    return statuses.map(serializeStatus);
  },
);
