/**
 * 共有ファイルの階層を表す `dir` 文字列の正規化。
 *
 * 本家も `dir` は `/design/` のような文字列で、ディレクトリを別テーブルに
 * 持たない(docs/00-spec-verified.md 9.2)。
 *
 * `"use server"` のファイルには同期関数を置けないので、ここに分けてある。
 */

/** `/a/b/` の形に正規化する。ルートは `/` */
export function normalizeDir(raw: string): string {
  const parts = raw
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  // `..` でプロジェクトの外へ出させない
  if (parts.some((p) => p === "..")) throw new Error("不正なディレクトリです");
  return parts.length ? `/${parts.join("/")}/` : "/";
}

/** `/a/b/` の1つ上。ルートなら null */
export function parentDir(dir: string): string | null {
  if (dir === "/") return null;
  return normalizeDir(dir.split("/").slice(0, -2).join("/"));
}
