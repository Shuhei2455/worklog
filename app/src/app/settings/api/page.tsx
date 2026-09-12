import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { issueToken, revokeToken } from "./actions";

const jst = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

export default async function ApiSettings({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;
  const user = await currentUser();

  const tokens = await prisma.apiToken.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <Shell user={user} breadcrumbs={[{ label: "APIキー" }]}>
      <h1 className="text-xl font-semibold">APIキー</h1>
      <p className="mt-1 text-sm text-slate-500">
        本家 Backlog 向けに書かれたスクリプトが、ホスト名を差し替えるだけで動くようにしてあります。
      </p>

      {created && (
        <div className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            発行しました。**この画面を離れると二度と表示されません。**
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-xs">
            {created}
          </code>
        </div>
      )}

      <form
        action={issueToken}
        className="mt-4 flex items-end gap-2 rounded border border-slate-200 bg-white p-3 text-sm"
      >
        <label className="flex-1">
          <span className="block text-xs text-slate-500">用途がわかる名前</span>
          <input
            name="name"
            placeholder="集計スクリプト"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <button className="rounded bg-brand-700 px-4 py-1.5 text-white hover:bg-brand-800">
          発行
        </button>
      </form>

      {tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1">{t.name}</span>
              <span className="text-xs text-slate-400">
                作成 {jst(t.createdAt)}
                {t.lastUsedAt && ` / 最終利用 ${jst(t.lastUsedAt)}`}
              </span>
              {t.revokedAt ? (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  失効済み
                </span>
              ) : (
                <form action={revokeToken}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="text-xs text-red-700 hover:underline">失効させる</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8 rounded border border-slate-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">使い方</h2>
        <p className="mt-2 text-xs text-slate-600">
          本家と同じく、クエリとヘッダのどちらでも渡せます。
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
{`curl "http://<このホスト>/api/v2/users/myself?apiKey=<キー>"

curl -H "Backlog-API-Key: <キー>" \\
     "http://<このホスト>/api/v2/issues?projectId[]=1&count=5"`}
        </pre>

        <h3 className="mt-4 text-xs font-semibold text-slate-600">レート制限</h3>
        <table className="mt-1 text-xs">
          <tbody>
            {Object.entries(RATE_LIMITS).map(([k, v]) => (
              <tr key={k}>
                <td className="pr-4 text-slate-500">{k}</td>
                <td>{v} 回 / 分</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-slate-500">
          本家と同じく<strong>ユーザー単位</strong>で数えます（キーを複数作っても合算）。
          超えると 429 を返し、応答には X-RateLimit-* が付きます。
          現在値は <code>GET /api/v2/rateLimit</code> で取れます。
        </p>
      </section>
    </Shell>
  );
}
