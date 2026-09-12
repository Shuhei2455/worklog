import type { DefaultSession } from "next-auth";

/**
 * セッションとJWTの型を拡張する。
 *
 * Auth.js の `session.user.id` は string 固定（AdapterUser の定義）だが、
 * こちらの users.id は連番の int。`as { id?: number }` で上書きすると
 * 「string と number は重ならない」と本番ビルドの型チェックで落ちるため、
 * 別名 `uid` を生やしてそこに数値を入れる。
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    /** users.id。権限判定はこの値でDBを引く */
    uid?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: number;
  }
}
