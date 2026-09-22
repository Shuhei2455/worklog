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

/**
 * パスワードの強度を見る。
 *
 * **職場展開の前に必要な3点のうちの1つ**（Obsidian の backlog-clone-index に
 * 記録した項目）。本家の要件は未確認なので、ここはこちらの決定（D27）。
 *
 * 複雑さの要求は強くしない。長さを確保する方が実効的で、
 * 「記号を1文字入れる」を強いると `Password1!` のような定型に寄る。
 * 代わりに、よくある文字列と同じ文字の繰り返しを弾く。
 */
/**
 * 2026-09-22 にユーザーの指示で 10 から 6 に緩めた。
 * 長さ以外の検査（よくある文字列・同じ文字の繰り返し・ログインIDや名前を
 * 含む）はそのまま残してある
 */
export const PASSWORD_MIN_LENGTH = 6;

/** 辞書ではなく、実際に使われがちな短い語だけ。長い辞書はここに持たない */
const COMMON = [
  "password",
  "passw0rd",
  "qwerty",
  "123456",
  "abc123",
  "admin",
  "backlog",
  "kadai",
  "welcome",
  "letmein",
];

export function checkPasswordStrength(
  plain: string,
  /** ログインIDと名前。パスワードに含まれていたら弾く */
  context: { userId?: string; name?: string; email?: string } = {},
): { ok: true } | { ok: false; error: string } {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `パスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください` };
  }
  if (plain.length > 200) {
    // scrypt の計算時間で詰まらせないための上限
    return { ok: false, error: "パスワードが長すぎます（200文字まで）" };
  }

  const lower = plain.toLowerCase();

  // 構造的なものを先に見る。「12345678901」は「123456 を含む」より
  // 「数字だけ」と言った方が、直し方が分かる
  if (/^(.)\1+$/.test(plain)) {
    return { ok: false, error: "同じ文字の繰り返しは使えません" };
  }
  if (/^\d+$/.test(plain)) {
    return { ok: false, error: "数字だけのパスワードは使えません" };
  }

  // 自分のIDや名前をそのまま使わせない
  for (const v of [context.userId, context.name, context.email?.split("@")[0]]) {
    if (v && v.length >= 3 && lower.includes(v.toLowerCase())) {
      return { ok: false, error: "ログインIDや名前を含めないでください" };
    }
  }

  for (const word of COMMON) {
    if (lower.includes(word)) {
      return { ok: false, error: `よく使われる文字列（${word}）を含めないでください` };
    }
  }

  // 種類は2種類以上（英小文字・英大文字・数字・その他）
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(plain),
  ).length;
  if (kinds < 2) {
    return {
      ok: false,
      error: "英字・数字・記号のうち2種類以上を混ぜてください",
    };
  }

  return { ok: true };
}
