import { apiRoute, findProject } from "@/lib/api/handler";
import { serializePullRequest } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { findRepository } from "@/lib/api/git-lookup";
import { pullRequestWhere, pullRequestQuery } from "@/lib/api/pull-request-filter";

/**
 * GET .../git/repositories/:repoIdOrName/pullRequests
 *
 * 絞り込みは本家と同じ statusId[] / assigneeId[] / issueId[] /
 * createdUserId[] / offset / count（1〜100、既定20）。
 */
export const GET = apiRoute<{ projectIdOrKey: string; repoIdOrName: string }>(
  async (req, ctx, params) => {
    const project = await findProject(params.projectIdOrKey, ctx);
    const repo = await findRepository(project.id, params.repoIdOrName);

    const url = new URL(req.url);
    const q = pullRequestQuery(url.searchParams);

    const pulls = await prisma.pullRequest.findMany({
      where: pullRequestWhere(repo.id, q),
      include: { assignee: true, createdBy: true },
      orderBy: { giteaPrNumber: "desc" },
      skip: q.offset,
      take: q.count,
    });

    return pulls.map((pr) =>
      serializePullRequest({ ...pr, projectId: project.id }),
    );
  },
);
