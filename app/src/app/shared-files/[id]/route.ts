import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { getFile } from "@/lib/storage";

/**
 * 共有ファイルのダウンロード。
 *
 * **権限は sharedFile.access で見る。** 課題の添付とは違い、
 * 制限のあるユーザーは閲覧すらできない(00-spec-verified.md 7.1)。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.uid;
  if (!userId) return new NextResponse("認証が必要です", { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.disabledAt) {
    return new NextResponse("認証が必要です", { status: 401 });
  }

  const file = await prisma.sharedFile.findUnique({ where: { id: Number(id) } });
  if (!file) return new NextResponse("見つかりません", { status: 404 });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: file.projectId, userId: user.id } },
  });
  const allowed = can(user, "sharedFile.access", {
    projectId: file.projectId,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  });
  if (!allowed) return new NextResponse("権限がありません", { status: 403 });

  let bytes: Buffer;
  try {
    bytes = await getFile(file.storageKey);
  } catch {
    return new NextResponse("ファイルが見つかりません", { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mime || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
