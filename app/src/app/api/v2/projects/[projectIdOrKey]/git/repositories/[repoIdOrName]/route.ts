import { apiRoute, findProject } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { serializeRepository } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";
import { giteaOrgOf } from "@/lib/gitea";

/**
 * GET /api/v2/projects/:projectIdOrKey/git/repositories/:repoIdOrName
 *
 * 本家と同じく id と名前のどちらでも引ける。
 */
export const GET = apiRoute<{ projectIdOrKey: string; repoIdOrName: string }>(
  async (_req, ctx, params) => {
    const project = await findProject(params.projectIdOrKey, ctx);
    const repo = await findRepository(project.id, params.repoIdOrName);
    const org = project.giteaOrg ?? (await giteaOrgOf(project.id));

    return serializeRepository(repo, {
      httpUrl: httpCloneUrl(org, repo.name),
      sshUrl: sshCloneUrl(org, repo.name),
    });
  },
);

/** id か名前でリポジトリを引く。共通で使うのでここに置く */
export async function findRepository(projectId: number, idOrName: string) {
  const asNumber = Number(idOrName);
  const repo = Number.isInteger(asNumber)
    ? await prisma.repository.findFirst({
        where: { id: asNumber, projectId },
        include: { createdBy: true },
      })
    : await prisma.repository.findFirst({
        where: { projectId, name: decodeURIComponent(idOrName) },
        include: { createdBy: true },
      });
  if (!repo) throw ApiError.notFound("repository");
  return repo;
}
