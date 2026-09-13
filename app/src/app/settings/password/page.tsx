import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import { LOGIN_LIMIT } from "@/lib/login-attempts";
import { changeMyPassword } from "./actions";

/** 自分のパスワードの変更 */
export default async function PasswordSettings({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();

  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { authProvider: true },
  });

  return (
    <Shell user={user} breadcrumbs={[{ label: "パスワード" }]}>
      <h1 className="text-xl font-semibold">パスワード</h1>

      {row.authProvider !== "local" ? (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          このアカウントは外部認証（{row.authProvider}）です。パスワードは
          認証元で変更してください。
        </p>
      ) : (
        <>
          {sp.ok && (
            <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              パスワードを変更しました。
            </p>
          )}
          {sp.error && (
            <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {sp.error}
            </p>
          )}

          <form
            action={changeMyPassword}
            className="mt-4 max-w-sm space-y-3 rounded border border-slate-200 bg-white p-4"
          >
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">現在のパスワード</span>
              <input
                type="password"
                name="current"
                required
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">新しいパスワード</span>
              <input
                type="password"
                name="next"
                required
                minLength={PASSWORD_MIN_LENGTH}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-slate-500">確認</span>
              <input
                type="password"
                name="confirm"
                required
                minLength={PASSWORD_MIN_LENGTH}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
            </label>
            <button className="rounded bg-brand-700 px-4 py-1.5 text-sm text-white hover:bg-brand-800">
              変更
            </button>
          </form>

          <div className="mt-4 max-w-sm text-xs text-slate-500">
            <p>条件:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>{PASSWORD_MIN_LENGTH} 文字以上</li>
              <li>英字・数字・記号のうち2種類以上</li>
              <li>ログインIDや名前、よくある文字列を含まない</li>
            </ul>
            <p className="mt-2">
              ログインに {LOGIN_LIMIT.maxAttempts} 回失敗すると、
              {LOGIN_LIMIT.lockSeconds / 60} 分のあいだそのIDでのログインを
              受け付けません。
            </p>
          </div>
        </>
      )}
    </Shell>
  );
}
