import { PrismaClient } from "@prisma/client";

/**
 * Next.js の dev では毎回モジュールが読み直されるため、
 * そのたびに PrismaClient を作ると接続が枯れる。グローバルに1つ持つ。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
