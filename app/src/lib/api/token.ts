import { createHash, randomBytes } from "node:crypto";

/**
 * APIキー。
 *
 * 本家は「クエリ `apiKey`」と「ヘッダ `Backlog-API-Key`」の**両方**を
 * 受け付ける(docs/00-spec-verified.md)。既存スクリプトがどちらを
 * 使っていても動くよう、両方に対応する。
 *
 * 生のキーは保存しない。ハッシュだけ持つ。
 * パスワードと違いキーは高エントロピーなので、ソルト無しの
 * SHA-256 で十分（総当たりが成立しない）。
 */

/** 生成する。戻り値の raw は**この一度しか見られない** */
export function generateApiToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashApiToken(raw) };
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** リクエストからキーを取り出す。クエリとヘッダの両方を見る */
export function extractApiKey(req: Request): string | null {
  const header = req.headers.get("Backlog-API-Key");
  if (header) return header.trim();
  const url = new URL(req.url);
  const q = url.searchParams.get("apiKey");
  return q ? q.trim() : null;
}
