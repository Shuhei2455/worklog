/**
 * ユーザーのパスワードを設定し直す。
 *
 *   開発: docker compose exec app pnpm db:password <ログインID> <新しいパスワード>
 *   本番: docker compose -f docker-compose.prod.yml run --rm set-password <ID> <新パスワード>
 *
 * シード(seed.ts)は既存ユーザーのパスワードを書き換えない(upsert の update が空)。
 * 何度流しても既存の認証情報を壊さないようにするため。
 * 変更したいときだけこちらを明示的に実行する。
 *
 * 本番イメージでは、管理者のパスワードが分からなくなったときの唯一の
 * 復旧手段になる（職場VMには pnpm もソースも無い）。
 *
 * 処理を main() に包んでいるのは、トップレベル await が使えないため。
 * 本番イメージのワーカー側ディレクトリには package.json の `type` 指定が
 * 無く、tsx が CJS として変換するので「Top-level await is currently not
 * supported with the "cjs" output format」で落ちる。
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

async function main() {
  const [userId, password] = process.argv.slice(2);

  if (!userId || !password) {
    console.error("使い方: set-password <ログインID> <新しいパスワード>");
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
}

main()
  .catch((e) => {
    console.error("失敗しました:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
