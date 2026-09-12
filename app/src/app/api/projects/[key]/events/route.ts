import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { can } from "@/lib/permissions";
import { subscribe, type ProjectEvent } from "@/lib/events";

/**
 * ボードのリアルタイム反映用の SSE エンドポイント。
 *
 * 権限チェックを入口で通す。参加していないプロジェクトの更新が
 * 流れてしまうと、件名から内容が推測できてしまう。
 */

// 接続を張りっぱなしにするので、静的化させない
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;

  const session = await auth();
  const userId = session?.uid;
  if (!userId) return new Response("認証が必要です", { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.disabledAt) {
    return new Response("認証が必要です", { status: 401 });
  }

  const project = await prisma.project.findUnique({ where: { key } });
  if (!project) return new Response("見つかりません", { status: 404 });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
  });
  const allowed = can(user, "issue.view", {
    projectId: project.id,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  });
  if (!allowed) return new Response("権限がありません", { status: 403 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // 既に閉じている
        }
      };

      // 接続できたことを先に伝える。クライアントはこれで購読開始を判断する
      send(`event: ready\ndata: {}\n\n`);

      const unsubscribe = subscribe(project.id, (e: ProjectEvent) => {
        send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      });

      // プロキシに切られないよう定期的にコメント行を送る。
      // Caddy の既定のタイムアウトは長いが、職場のプロキシは分からない
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 既に閉じている
        }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx 系のプロキシでバッファされると届かない
      "X-Accel-Buffering": "no",
    },
  });
}
