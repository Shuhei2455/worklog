import { apiRoute, findProject } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { serializePullRequest } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { findRepository } from "@/lib/api/git-lookup";

/**
 * GET .../pullRequests/:number
 * `number` はリポジトリ内の連番（本家も id ではなく番号で引く）。
 */
export const GET = apiRoute<{
  projectIdOrKey: string;
  repoIdOrName: string;
  number: string;
}>(async (_req, ctx, params) => {
  const project = await findProject(params.projectIdOrKey, ctx);
  const repo = await findRepository(project.id, params.repoIdOrName);

  const pr = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_giteaPrNumber: {
        repositoryId: repo.id,
        giteaPrNumber: Number(params.number),
      },
    },
    include: { assignee: true, createdBy: true },
  });
  if (!pr) throw ApiError.notFound("pullRequest");

  return serializePullRequest({ ...pr, projectId: project.id });
});
