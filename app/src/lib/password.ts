import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * パスワードのハッシュと照合。
 *
 * bcrypt / argon2 はネイティブ依存が絡み、職場VMへ docker save/load で
 * 持ち込むときにアーキテクチャ差で詰まりやすい。Node 標準の scrypt を使う。
 *
 * 形式: "scrypt$<salt(hex)>$<hash(hex)>"
 */

const KEY_LEN = 64;
const SALT_LEN = 16;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length !== KEY_LEN) return false;

  const actual = scryptSync(plain, salt, KEY_LEN);
  // 長さが同じことを確認してから定数時間比較する
  return timingSafeEqual(actual, expected);
}
