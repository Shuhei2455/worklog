import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import {
  loginLockState,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/login-attempts";

/**
 * 認証。
 *
 * 自宅ではローカルID/パスワード、職場では会社のAD/OIDCに繋ぐ可能性が高い。
 * users に auth_provider / external_id を最初から持たせてあるので、
 * ここに Provider を足すだけで切り替えられる(docs/01-design.md 1.C)。
 *
 * セッションは JWT。Redis に載せないのは、職場VMで Redis が落ちても
 * ログイン状態だけは保たれるようにするため。
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // リバースプロキシ(Caddy)の後ろにいるので、リクエストのホストを信用する
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        userId: { label: "ログインID", type: "text" },
        password: { label: "パスワード", type: "password" },
      },
      async authorize(creds) {
        const userId = typeof creds?.userId === "string" ? creds.userId : "";
        const password = typeof creds?.password === "string" ? creds.password : "";
        if (!userId || !password) return null;

        // 失敗が続いているIDは、正しいパスワードでも通さない（決定 D28）。
        // 総当たりを放置しないため。Redis が落ちていれば通す（fail-open）
        const lock = await loginLockState(userId);
        if (lock.locked) {
          console.warn(`[auth] ${userId} は失敗が続いたため一時的に拒否`);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { userId } });
        // 無効化されたユーザーはログインできない
        if (!user || user.disabledAt) {
          await recordLoginFailure(userId);
          return null;
        }
        // ローカル認証以外はパスワードを持たない
        if (user.authProvider !== "local") return null;
        if (!verifyPassword(password, user.passwordHash)) {
          await recordLoginFailure(userId);
          return null;
        }

        await clearLoginFailures(userId);
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * リダイレクト先を必ず相対パスに落とす。
     *
     * 既定の挙動は絶対URLを組み立てるが、開発中はNextが 0.0.0.0:3000 に
     * バインドされているため http://0.0.0.0:3000 という到達不能なURLになった。
     * LAN・Tailscale・職場VMとアクセス経路が複数あるので、
     * 特定のホスト名を設定で固定するのも避けたい。
     *
     * 相対パスを返せばブラウザが現在のオリジンで解決するため、
     * どの経路でも正しく戻る。外部ドメインへ飛ばされる余地も無くなる。
     */
    async redirect({ url }) {
      try {
        const u = new URL(url, "http://placeholder.invalid");
        return u.pathname + u.search;
      } catch {
        return "/";
      }
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = Number(user.id);
      return token;
    },
    async session({ session, token }) {
      // 種別や制限はトークンに埋めない。権限判定のたびにDBから読む。
      // 埋めるとユーザーの権限を変更してもログアウトまで反映されない
      // 数値のIDは session.uid に入れる（型は src/types/next-auth.d.ts）
      if (token.uid) session.uid = Number(token.uid);
      return session;
    },
  },
});
