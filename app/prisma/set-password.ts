/**
 * ユーザーのパスワードを設定し直す。
 *
 *   docker compose exec app pnpm db:password <ログインID> <新しいパスワード>
 *
 * シード(seed.ts)は既存ユーザーのパスワードを書き換えない(upsert の update が空)。
 * 何度流しても既存の認証情報を壊さないようにするため。
 * 変更したいときだけこちらを明示的に実行する。
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const [userId, password] = process.argv.slice(2);

if (!userId || !password) {
  console.error(
    "使い方: pnpm db:password <ログインID> <新しいパスワード>",
  );
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { userId } });
if (!user) {
  console.error(`ユーザーが見つかりません: ${userId}`);
  process.exit(1);
}
if (user.authProvider !== "local") {
  console.error(
    `${userId} は ${user.authProvider} 認証です。パスワードは持ちません`,
  );
  process.exit(1);
}

await prisma.user.update({
  where: { userId },
  data: { passwordHash: hashPassword(password) },
});
console.log(`${userId} のパスワードを変更しました`);
await prisma.$disconnect();
