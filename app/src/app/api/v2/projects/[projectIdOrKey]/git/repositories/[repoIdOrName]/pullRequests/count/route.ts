import { apiRoute, findProject } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { findRepository } from "../../route";
import { pullRequestWhere, pullRequestQuery } from "@/lib/api/pull-request-filter";

/**
 * GET .../pullRequests/count
 * 本家と同じく `{ count: n }` を返す。
 */
export const GET = apiRoute<{ projectIdOrKey: string; repoIdOrName: string }>(
  async (req, ctx, params) => {
    const project = await findProject(params.projectIdOrKey, ctx);
    const repo = await findRepository(project.id, params.repoIdOrName);
    const q = pullRequestQuery(new URL(req.url).searchParams);

    return {
      count: await prisma.pullRequest.count({ where: pullRequestWhere(repo.id, q) }),
    };
  },
);
