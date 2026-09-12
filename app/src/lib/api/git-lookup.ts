import { prisma } from "@/lib/db";
import { ApiError } from "./errors";

/**
 * リポジトリを id か名前で引く。本家の `:repoIdOrName` に合わせる。
 *
 * **ルートファイル（route.ts）には置けない。** Next.js はルートの
 * エクスポートをハンドラだけに限っており、補助関数を置くと
 * 「does not satisfy the constraint」で型チェックに落ちる。
 */
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
