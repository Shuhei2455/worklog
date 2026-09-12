import { apiRoute, findProject } from "@/lib/api/handler";
import { serializeProject } from "@/lib/api/serialize";

/** GET /api/v2/projects/:projectIdOrKey */
export const GET = apiRoute<{ projectIdOrKey: string }>(
  async (_req, ctx, params) =>
    serializeProject(await findProject(params.projectIdOrKey, ctx)),
);
