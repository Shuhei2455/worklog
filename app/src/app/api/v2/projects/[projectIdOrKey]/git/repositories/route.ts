import { apiRoute, findProject } from "@/lib/api/handler";
import { serializeRepository } from "@/lib/api/serialize";
import { prisma } from "@/lib/db";
import { httpCloneUrl, sshCloneUrl } from "@/lib/repo";
import { gitProvider } from "@/lib/git";

/**
 * GET /api/v2/projects/:projectIdOrKey/git/repositories
 * 00-spec-verified.md 4.1
 */
export const GET = apiRoute<{ projectIdOrKey: string }>(async (_req, ctx, params) => {
  const project = await findProject(params.projectIdOrKey, ctx);
  const org = project.gitOwner ?? project.key;
  const provider = gitProvider();

  const repos = await prisma.repository.findMany({
    where: { projectId: project.id },
    include: { createdBy: true },
    orderBy: { displayOrder: "asc" },
  });

  return repos.map((r) =>
    serializeRepository(r, {
      httpUrl: provider ? provider.cloneUrls({ owner: org, name: r.name }).http : httpCloneUrl(org, r.name),
      // 本家は常に sshUrl を返すのでキーは残す。
      // SSH を使えない環境では空文字（決定 D31）
      sshUrl: (provider ? provider.cloneUrls({ owner: org, name: r.name }).ssh : sshCloneUrl(org, r.name)) ?? "",
    }),
  );
});
