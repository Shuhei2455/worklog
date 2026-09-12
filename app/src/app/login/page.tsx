import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";

/**
 * ログイン画面。
 *
 * 意匠は本家を模倣しない(CLAUDE.md)。UIライブラリ(Tailwind + shadcn/ui)は
 * M0-d で入れるので、ここでは素のスタイルにしてある。
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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        justifyContent: "center",
        paddingTop: 80,
      }}
    >
      <form action={login} style={{ width: 320 }}>
        <h1 style={{ fontSize: 24, marginBottom: 24 }}>Kadai</h1>

        {error && (
          <p
            style={{
              background: "#fdecea",
              color: "#b3261e",
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: 14,
            }}
          >
            ログインIDまたはパスワードが違います
          </p>
        )}

        <label style={{ display: "block", marginTop: 16, fontSize: 14 }}>
          ログインID
          <input
            name="userId"
            required
            autoComplete="username"
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: 8,
              border: "1px solid #ccc",
              borderRadius: 6,
            }}
          />
        </label>

        <label style={{ display: "block", marginTop: 16, fontSize: 14 }}>
          パスワード
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: 8,
              border: "1px solid #ccc",
              borderRadius: 6,
            }}
          />
        </label>

        <button
          type="submit"
          style={{
            marginTop: 24,
            width: "100%",
            padding: 10,
            border: 0,
            borderRadius: 6,
            background: "#1d4ed8",
            color: "#fff",
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          ログイン
        </button>
      </form>
    </main>
  );
}
