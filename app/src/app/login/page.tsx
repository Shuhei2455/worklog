import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";
import { Button, Notice, Field, inputClass } from "@/components/ui";
import { LOGIN_LIMIT } from "@/lib/login-attempts";

/**
 * ログイン画面。
 *
 * 意匠は本家を模倣しない(CLAUDE.md)。
 *
 * M0 の時点では Tailwind を入れる前だったのでインラインスタイルで書いていたが、
 * **アプリで最初に見る画面が他と別物**になっていたので、他と同じ部品に揃えた。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        userId: formData.get("userId"),
        password: formData.get("password"),
        redirectTo: "/",
      });
    } catch (e) {
      // signIn は成功時にも redirect を投げる。認証失敗だけを拾う
      if (e instanceof AuthError) {
        redirect("/login?error=1");
      }
      throw e;
    }
  }

  return (
    <main className="flex min-h-screen justify-center bg-slate-50 px-4 pt-20">
      <form action={login} className="w-full max-w-xs">
        <h1 className="text-2xl font-semibold text-slate-800">Worklog</h1>
        <p className="mt-1 text-sm text-slate-500">プロジェクト管理</p>

        {error && (
          <Notice tone="error" className="mt-6">
            ログインIDまたはパスワードが違います
          </Notice>
        )}

        <div className="mt-6 space-y-4 rounded border border-slate-200 bg-white p-5">
          <Field label="ログインID">
            <input
              name="userId"
              required
              autoComplete="username"
              autoFocus
              className={inputClass}
            />
          </Field>

          <Field label="パスワード">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />
          </Field>

          <Button type="submit" variant="primary" size="md" className="w-full">
            ログイン
          </Button>
        </div>

        <p className="mt-3 text-sm text-slate-500">
          アカウントが無い場合は{" "}
          <Link href="/signup" className="text-brand-700 hover:underline">
            アカウントを作る
          </Link>
        </p>

        <p className="mt-3 text-xs text-slate-400">
          {LOGIN_LIMIT.maxAttempts} 回続けて失敗すると、
          {LOGIN_LIMIT.lockSeconds / 60} 分のあいだそのIDでのログインを受け付けません。
        </p>
      </form>
    </main>
  );
}
