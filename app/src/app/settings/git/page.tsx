import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { giteaEnabled, giteaPublicBase } from "@/lib/gitea";
import { setMyGiteaPassword } from "./actions";

/**
 * Git（Gitea）の個人設定。
 *
 * レビューとマージは Gitea の画面で行う設計なので、そこへ入るための
 * パスワードを本人が決められるようにする。SSH鍵の登録も Gitea 側。
 */
export default async function GitSettings({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { giteaLogin: true, giteaUserId: true },
  });

  return (
    <Shell user={user} breadcrumbs={[{ label: "Git" }]}>
      <h1 className="text-xl font-semibold">Git</h1>
      <p className="mt-1 text-sm text-slate-500">
        リポジトリの実体は Gitea にあります。クローンと push、プルリクエストの
        レビュー・マージは Gitea の画面で行います。
      </p>

      {!giteaEnabled() ? (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Gitea が設定されていません。
        </p>
      ) : (
        <>
          {sp.ok && (
            <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              パスワードを設定しました。
              <a
                href={giteaPublicBase()}
                target="_blank"
                rel="noreferrer"
                className="ml-1 underline"
              >
                Gitea を開く
              </a>
            </p>
          )}
          {sp.error && (
            <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {sp.error}
            </p>
          )}

          <dl className="mt-4 rounded border border-slate-200 bg-white p-4 text-sm">
            <div className="flex justify-between border-b border-slate-100 py-1.5">
              <dt className="text-slate-500">Gitea のログインID</dt>
              <dd className="font-mono">
                {me?.giteaLogin ?? "（未同期。リポジトリを作ると同期されます）"}
              </dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-slate-500">Gitea の画面</dt>
              <dd>
                <a
                  href={giteaPublicBase()}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 underline"
                >
                  {giteaPublicBase()}
                </a>
              </dd>
            </div>
          </dl>

          {me?.giteaLogin && me.giteaLogin !== user.userId && (
            <p className="mt-2 text-xs text-slate-500">
              このアプリのログインID（<code>{user.userId}</code>）は Gitea が
              予約している名前のため、Gitea 側は{" "}
              <code>{me.giteaLogin}</code> になっています。
            </p>
          )}

          <div className="mt-6 rounded border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Gitea のパスワードを設定する</h2>
            <p className="mt-1 text-xs text-slate-500">
              このアプリのパスワードとは別のものです。HTTPでのクローンと、
              Gitea の画面へのログインに使います。
            </p>
            <form action={setMyGiteaPassword} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-xs text-slate-500">新しいパスワード</span>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={8}
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-slate-500">確認</span>
                <input
                  type="password"
                  name="confirm"
                  required
                  minLength={8}
                  className="mt-1 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <button className="h-8 rounded border border-slate-300 px-3 text-sm hover:bg-slate-50">
                設定
              </button>
            </form>
          </div>
        </>
      )}
    </Shell>
  );
}
