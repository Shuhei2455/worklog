import { NextResponse } from "next/server";
import {
  verifySignature,
  handlePush,
  handlePullRequest,
} from "@/lib/gitea-webhook";

/**
 * POST /api/gitea/webhook
 *
 * Gitea からの通知の受け口。**API v2 ではない**ので apiRoute() は通さない
 * （APIキー認証ではなく署名で確かめる。レート制限もかけない）。
 *
 * 送信元は同じ compose ネットワークの gitea コンテナ。
 * 署名が合わないものは 401 で落とす。秘密が未設定なら全部落とす
 * （誰でも課題にコメントを書ける穴になるため）。
 */
export async function POST(req: Request): Promise<NextResponse> {
  // 署名は本文そのものに対して計算されるので、先にテキストで受ける
  const body = await req.text();
  const signature = req.headers.get("x-gitea-signature");

  if (!verifySignature(body, signature)) {
    console.warn("[gitea] 署名が合わないリクエストを拒否しました");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-gitea-event") ?? "";
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    let message: string;
    switch (event) {
      case "push":
        message = await handlePush(payload as never);
        break;
      case "pull_request":
        message = await handlePullRequest(payload as never);
        break;
      default:
        // 扱わないイベントでも 200 を返す。Gitea 側で「配信失敗」が
        // 溜まると、本当の失敗が埋もれる。
        //
        // `pull_request` を購読すると Gitea が配下のイベント
        // （pull_request_comment / pull_request_review_* など）まで
        // 登録するので、ここには日常的に届く。ログには出さない
        return NextResponse.json({ ok: true, message: `ignored: ${event}` });
    }
    console.log(`[gitea] ${message}`);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    console.error("[gitea] 処理に失敗:", e);
    // 500 を返すと Gitea が再送する。こちらのバグなら再送しても直らないが、
    // DBの一時的な失敗なら効くので、そのまま落とす
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
