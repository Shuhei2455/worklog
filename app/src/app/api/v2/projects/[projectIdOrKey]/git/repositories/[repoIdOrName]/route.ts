import { apiRoute, findProject } from "@/lib/api/handler";
import { serializeRepository } from "@/lib/api/serialize";
import { findRepository } from "@/lib/api/git-lookup";
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

