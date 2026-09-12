import { prisma } from "@/lib/db";
import { apiRoute, findProject } from "@/lib/api/handler";
import { serializeIssueType } from "@/lib/api/serialize";

/** GET /api/v2/projects/:projectIdOrKey/issueTypes */
export const GET = apiRoute<{ projectIdOrKey: string }>(
  async (_req, ctx, params) => {
    const project = await findProject(params.projectIdOrKey, ctx);
    const types = await prisma.issueType.findMany({
      where: { projectId: project.id },
      orderBy: { displayOrder: "asc" },
    });
    return types.map(serializeIssueType);
  },
);
