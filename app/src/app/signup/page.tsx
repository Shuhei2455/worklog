import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/db";
import { hashPassword, checkPasswordStrength, PASSWORD_MIN_LENGTH } from "@/lib/password";
import { USER_ID_RE, USER_ID_RULE } from "@/lib/user-id";
import { audit } from "@/lib/audit";
import { Button, Notice, Field, inputClass } from "@/components/ui";

/**
 * サインアップ（利用者が自分でアカウントを作る）。
 *
 * 2026-09-22 にユーザーの指示で追加した。それまでは管理者が
 * ユーザー管理画面から作る方式だけだった。
 *
 * 作られるのは **一般ユーザー・制限なし** で固定する。種別や制限を
 * 自己申告で選ばせると、管理者を名乗って作れてしまう。
 * 昇格は管理者がユーザー管理画面から行う。
 *
 * 検証は管理者による追加(users/actions.ts)と同じものを通す。
 * 片方だけ緩いと、緩い方が穴になる。
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;

  async function signup(formData: FormData) {
    "use server";

    const userId = String(formData.get("userId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const fail = (msg: string) => redirect("/signup?error=" + encodeURIComponent(msg));

    if (!USER_ID_RE.test(userId)) fail(USER_ID_RULE);
    if (!name) fail("名前を入れてください");
    if (!email.includes("@")) fail("メールアドレスの形が正しくありません");

    const strength = checkPasswordStrength(password, { userId, name, email });
    if (!strength.ok) fail(strength.error);

    if (await prisma.user.findUnique({ where: { userId } })) {
      fail(`ログインID「${userId}」は既に使われています`);
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      fail(`メールアドレス「${email}」は既に使われています`);
    }

    const created = await prisma.user.create({
      data: {
        userId,
        name,
        email,
        passwordHash: hashPassword(password),
        userType: "member",
        restriction: "none",
      },
    });

    // 誰が作ったかを残す。管理者による追加と違い、作った本人が actor になる
    await audit(created.id, {
      action: "user.create",
      targetType: "user",
      targetId: userId,
      detail: { name, email, self: true },
    });

    try {
      await signIn("credentials", { userId, password, redirectTo: "/" });
    } catch (e) {
      // signIn は成功時にも redirect を投げる
      if (e instanceof AuthError) redirect("/login");
      throw e;
    }
  }

  return (
    <main className="flex min-h-screen justify-center bg-slate-50 px-4 pt-20">
      <form action={signup} className="w-full max-w-xs">
        <h1 className="text-2xl font-semibold text-slate-800">Worklog</h1>
        <p className="mt-1 text-sm text-slate-500">アカウントを作る</p>

        {error && (
          <Notice tone="error" className="mt-6">
            {error}
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

          <Field label="名前">
            <input name="name" required autoComplete="name" className={inputClass} />
          </Field>

          <Field label="メールアドレス">
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className={inputClass}
            />
          </Field>

          <Field label="パスワード">
            <input
              name="password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>

          <p className="text-xs text-slate-500">
            パスワードは {PASSWORD_MIN_LENGTH} 文字以上。よくある文字列や、
            ログインID・名前を含むものは使えません。
          </p>

          <Button type="submit" variant="primary" size="md" className="w-full">
            アカウントを作る
          </Button>
        </div>

        <p className="mt-3 text-sm text-slate-500">
          すでにアカウントがある場合は{" "}
          <Link href="/login" className="text-brand-700 hover:underline">
            ログイン
          </Link>
        </p>
      </form>
    </main>
  );
}
