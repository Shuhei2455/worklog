import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { getFile } from "@/lib/storage";

/**
 * 添付ファイルのダウンロード。
 *
 * **権限チェックを必ず通す。** URLを知っていれば誰でも取れる状態にすると、
 * 参加していないプロジェクトの資料が漏れる。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const userId = (session?.user as { id?: number } | undefined)?.id;
  if (!userId) return new NextResponse("認証が必要です", { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.disabledAt) {
    return new NextResponse("認証が必要です", { status: 401 });
  }

  const attachment = await prisma.attachment.findUnique({
    where: { id: Number(id) },
  });
  if (!attachment) return new NextResponse("見つかりません", { status: 404 });

  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId: attachment.projectId, userId: user.id },
    },
  });
  const allowed = can(user, "issue.view", {
    projectId: attachment.projectId,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  });
  if (!allowed) return new NextResponse("権限がありません", { status: 403 });

  let bytes: Buffer;
  try {
    bytes = await getFile(attachment.storageKey);
  } catch {
    return new NextResponse("ファイルが見つかりません", { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mime || "application/octet-stream",
      // 日本語のファイル名が化けないよう RFC 5987 形式も付ける
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
