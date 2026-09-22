import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gitProvider } from "@/lib/git";
import { handlePush, handlePullRequest } from "@/lib/gitea-webhook";

/**
 * POST /api/git/webhook
 *
 * 提供元（GitHub / 将来 Bitbucket）からの通知の受け口。
 * **API v2 ではない**ので apiRoute() は通さない（APIキーではなく署名で確かめる）。
 *
 * 署名の方式は提供元ごとに違う（GitHub は X-Hub-Signature-256 の HMAC-SHA256）。
 * その差は provider.verifyWebhook に閉じてある。
 *
 * 出来事の解釈も provider.parseWebhook に任せ、ここは
 * 「どのリポジトリの話か」を解決して既存の処理へ渡すだけにする。
 */
export async function POST(req: Request): Promise<NextResponse> {
  const provider = gitProvider();
  if (!provider) {
    return NextResponse.json({ error: "git provider not configured" }, { status: 503 });
  }

  // 署名は**本文そのもの**に対して計算される。JSONに起こしてから
  // 文字列に戻すと空白が変わって合わなくなるので、先にテキストで受ける
  const body = await req.text();

  if (!provider.verifyWebhook(req.headers, body)) {
    console.warn("[git] 署名が合わないリクエストを拒否しました");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event;
  try {
    event = provider.parseWebhook(req.headers, body);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // 扱わない種類でも 200 を返す。向こうに「配信失敗」が溜まると、
  // 本当の失敗が埋もれる
  if (event.kind === "unsupported") {
    return NextResponse.json({ ok: true, message: "ignored" });
  }

  // 提供元は owner/name で語るが、こちらは外部IDで引く作りになっている。
  // 所有者はプロジェクト単位（Project.gitOwner）に持っているのでそこから解決する
  const repository = await prisma.repository.findFirst({
    where: {
      name: event.repo.name,
      project: { gitOwner: event.repo.owner },
    },
  });
  if (!repository) {
    return NextResponse.json({
      ok: true,
      message: `未登録のリポジトリ: ${event.repo.owner}/${event.repo.name}`,
    });
  }
  const repoId = Number(repository.externalRepoId);

  try {
    let message: string;
    if (event.kind === "push") {
      // 既存の handlePush は Gitea の形の payload を取る。
      // 課題キーの解釈と自動コメントをそのまま使うために写して渡す
      message = await handlePush({
        ref: event.ref,
        repository: {
          id: repoId,
          name: event.repo.name,
          full_name: `${event.repo.owner}/${event.repo.name}`,
        },
        commits: event.commits.map((c) => ({
          id: c.sha,
          message: c.message,
          timestamp: c.authoredAt,
          author: { name: c.authorName, email: c.authorEmail },
        })),
      });
    } else {
      const p = event.pull;
      message = await handlePullRequest({
        action: event.action,
        number: p.number,
        repository: { id: repoId, name: event.repo.name },
        pull_request: {
          number: p.number,
          title: p.title,
          body: p.body,
          state: p.state,
          merged: p.merged,
          merged_at: p.mergedAt,
          closed_at: p.closedAt,
          base: { ref: p.baseRef, sha: p.baseSha },
          head: { ref: p.headRef, sha: p.headSha },
          merge_commit_sha: p.mergeCommitSha,
          user: p.authorLogin ? { login: p.authorLogin } : null,
          assignee: p.assigneeLogin ? { login: p.assigneeLogin } : null,
        },
      });
    }
    console.log(`[git] ${message}`);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    console.error("[git] 処理に失敗:", e);
    // 500 なら向こうが再送する。こちらのバグなら再送しても直らないが、
    // DBの一時的な失敗には効く
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
