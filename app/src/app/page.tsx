import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { toRoleType } from "@/lib/permissions";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as { id?: number }).id;
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  if (!user) redirect("/login");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const typeLabel = { admin: "管理者", member: "一般ユーザー", guest: "ゲスト" }[
    user.userType
  ];
  const restrictionLabel = {
    none: "制限なし",
    issue_create_only: "課題の登録のみ",
    issue_view_only: "課題の閲覧のみ",
  }[user.restriction];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 40 }}>
      <h1 style={{ fontSize: 24 }}>Kadai</h1>
      <p style={{ marginTop: 8 }}>
        {user.name} さんでログインしています（{user.userId}）
      </p>

      <table style={{ marginTop: 16, borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {[
            ["ユーザー種別", typeLabel],
            ["制限", restrictionLabel],
            ["API の roleType", String(toRoleType(user))],
          ].map(([k, v]) => (
            <tr key={k}>
              <th
                style={{
                  textAlign: "left",
                  padding: "4px 16px 4px 0",
                  color: "#555",
                  fontWeight: 500,
                }}
              >
                {k}
              </th>
              <td style={{ padding: "4px 0" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 24, color: "#666", fontSize: 14 }}>
        M0-c: 認証と権限関数まで完了。プロジェクト管理は M0-d で作ります。
      </p>

      <form action={logout} style={{ marginTop: 24 }}>
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            border: "1px solid #ccc",
            borderRadius: 6,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ログアウト
        </button>
      </form>
    </main>
  );
}
