import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 添付ファイルの保管。
 *
 * ローカルボリューム前提だが、S3互換(MinIO)へ差し替えられるよう
 * 「パス」ではなく「キー」で扱う(docs/01-design.md 3章)。
 * 差し替えるときはこのファイルの4関数だけを置き換える。
 *
 * 永続データを PostgreSQL とこのディレクトリの2箇所に閉じるのが設計方針。
 * バックアップ対象がこの2つで済む。
 */

const ROOT = process.env.FILES_DIR || "/data/files";

export const MAX_ATTACHMENT_BYTES =
  Number(process.env.MAX_ATTACHMENT_MB || 10) * 1024 * 1024;

/** キーからディスク上のパスを作る。`..` を弾いてディレクトリ外へ出さない */
function resolveKey(key: string): string {
  const p = path.resolve(ROOT, key);
  if (!p.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error("不正なストレージキーです");
  }
  return p;
}

/**
 * 保存してキーを返す。
 *
 * キーは `<projectId>/<yyyy-mm>/<uuid>` の形。
 * 元のファイル名は使わない。日本語名や重複、パス区切りを含む名前で
 * 事故が起きるため、表示名はDB側(attachments.name)だけが持つ。
 */
export async function putFile(
  projectId: number,
  bytes: Buffer,
): Promise<string> {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `ファイルが大きすぎます（上限 ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB）`,
    );
  }
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const key = `${projectId}/${month}/${randomUUID()}`;
  const dest = resolveKey(key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    await stat(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await unlink(resolveKey(key));
  } catch {
    // 既に無いなら成功扱い。DBのレコードだけ残る方が困る
  }
}

/** 内容のハッシュ。将来の重複排除に使う */
export function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
