import { apiRoute, findProject } from "@/lib/api/handler";
import { serializeRepository } from "@/lib/api/serialize";
import { findRepository } from "@/lib/api/git-lookup";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";
import { gitProvider } from "@/lib/git";

/**
 * GET /api/v2/projects/:projectIdOrKey/git/repositories/:repoIdOrName
 *
 * 本家と同じく id と名前のどちらでも引ける。
 */
export const GET = apiRoute<{ projectIdOrKey: string; repoIdOrName: string }>(
  async (_req, ctx, params) => {
    const project = await findProject(params.projectIdOrKey, ctx);
    const repo = await findRepository(project.id, params.repoIdOrName);
    const org = project.gitOwner ?? project.key;
  const provider = gitProvider();

    return serializeRepository(repo, {
      httpUrl: provider ? provider.cloneUrls({ owner: org, name: repo.name }).http : httpCloneUrl(org, repo.name),
      // 本家は常に sshUrl を返すのでキーは残す。
      // SSH を使えない環境では空文字（決定 D31）
      sshUrl: (provider ? provider.cloneUrls({ owner: org, name: repo.name }).ssh : sshCloneUrl(org, repo.name)) ?? "",
    });
  },
);

