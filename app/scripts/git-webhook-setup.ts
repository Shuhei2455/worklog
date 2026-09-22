/**
 * 提供元にWebhookを登録する。秘密は環境変数から直接渡し、画面には出さない。
 *
 *   docker compose exec -T app pnpm tsx scripts/git-webhook-setup.ts <owner/repo> <公開URL>
 *
 * 本番（社内Bitbucket → 社内VM）では公開URLは要らない。同じネットワークなので
 * アプリのURLをそのまま登録すればよい。
 */
const [full, url] = process.argv.slice(2);
if (!full || !url) {
  console.log("使い方: git-webhook-setup.ts <owner/repo> <URL>");
  process.exit(1);
}
const [owner, repo] = full.split("/");
const token = process.env.GITHUB_TOKEN;
const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!token) throw new Error("GITHUB_TOKEN がありません");
if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET がありません");

const api = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const main = async () => {
  const existing = (await (await api("/hooks")).json()) as Array<{
    id: number;
    config: { url?: string };
  }>;
  const same = existing.find((h) => h.config.url === url);
  if (same) {
    console.log(`同じURLのWebhookが既にあります (id=${same.id})。作り直しません`);
    return;
  }

  const res = await api("/hooks", {
    method: "POST",
    body: JSON.stringify({
      name: "web",
      active: true,
      // まずは push だけ。pull_request は使い勝手を見てから足す
      events: ["push"],
      config: { url, content_type: "json", secret, insecure_ssl: "0" },
    }),
  });
  const body = (await res.json()) as { id?: number; message?: string };
  if (!res.ok) {
    console.log(`登録に失敗: HTTP ${res.status} ${body.message ?? ""}`);
    process.exit(1);
  }
  console.log(`登録しました (id=${body.id})  events=push  url=${url}`);
};

main();
