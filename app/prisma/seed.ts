/**
 * 初期データの投入。
 *
 * 入れるもの:
 * - 管理者ユーザー1件(.env の SEED_ADMIN_* から)
 *
 * 標準4状態と既定の課題種別は「プロジェクト作成時」に入るものなので
 * ここでは入れない。プロジェクトがまだ無いため。
 * 投入処理は src/lib/project.ts の createProject() に置いてある。
 *
 * 何度実行しても安全(upsert)。
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

/**
 * パスワードハッシュ。
 * bcrypt/argon2 はネイティブ依存が絡んで職場VMへの持ち込みで詰まりやすいので、
 * Node 標準の scrypt を使う。形式は "scrypt$<salt(hex)>$<hash(hex)>"。
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function main() {
  const userId = process.env.SEED_ADMIN_USER_ID ?? "admin";
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.local";
  const name = process.env.SEED_ADMIN_NAME ?? "管理者";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD が未設定です。.env を確認してください",
    );
  }

  const admin = await prisma.user.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      email,
      name,
      userType: "admin",
      restriction: "none",
      authProvider: "local",
      passwordHash: hashPassword(password),
    },
  });

  console.log(`[seed] 管理者を用意しました: ${admin.userId} (id=${admin.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
