/**
 * コミットメッセージから課題キーを取り出す。
 *
 * 本家に残っている連携はこれ（00-spec-verified.md 4章）:
 *   コミットメッセージに課題キーが含まれていると、その課題にコメントが付く。
 *
 * **状態を変えるキーワード（`#fix` など）は実装しない。**
 * 本家がクラウド版で2019年12月に廃止しており、再現する意味がない。
 *
 * 決定 D19: **出現した課題キーは全部拾う**（本家が何個認識するかは未確認）。
 * 1つに絞ると「AA-1 と AA-2 をまとめて直した」コミットが片方にしか残らず、
 * 後から追えなくなる。拾いすぎたぶんは消せばよい。
 *
 * この関数は**字面だけを見る。** `UTF-8` や `SHA-1` も形が同じなので返る。
 * 実在する課題かどうかは呼び出し側がDBを引いて絞る。正規表現で弾こうとすると
 * 本物のプロジェクトキーまで落ちるので、ここでは判断しない。
 */

/**
 * 課題キーの形。プロジェクトキーの規則（決定 D1: `^[A-Z][A-Z0-9_]{0,9}$`）に
 * 続けてハイフンと数字。
 *
 * 前後は単語境界ではなく明示的に見る。`\b` だと `foo-AA-1` の `AA-1` や
 * `AA-12345678901` のような極端な数字も拾ってしまう。
 */
const ISSUE_KEY_RE = /(?<![A-Za-z0-9_-])([A-Z][A-Z0-9_]{0,9})-(\d{1,9})(?![0-9A-Za-z_-])/g;

export type ParsedKey = { key: string; projectKey: string; keyId: number };

/**
 * メッセージ中の課題キーを、出現順で重複なく返す。
 *
 * 同じキーが複数回出ても1件。コメントが同じコミットで何度も付くのを避ける。
 */
export function parseIssueKeys(message: string): ParsedKey[] {
  const out: ParsedKey[] = [];
  const seen = new Set<string>();

  for (const m of message.matchAll(ISSUE_KEY_RE)) {
    const key = `${m[1]}-${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, projectKey: m[1], keyId: Number(m[2]) });
  }
  return out;
}

/**
 * 課題へ自動登録するコメントの本文を組む。
 *
 * 本家の文面は未確認なので、こちらで決めた形
 * （`TODO(要確認)` にはしない。表示文字列であり仕様の根幹ではない）。
 * 1行目で出どころを示し、2行目以降にコミットメッセージをそのまま置く。
 * リンクは埋め込まない。ホスト名が変わると古い本文のURLが壊れるため、
 * 画面側は commit_issue_links から組み立てる。
 */
export function commitCommentBody(
  repositoryName: string,
  sha: string,
  message: string,
): string {
  const short = sha.slice(0, 7);
  const trimmed = message.trim();
  return `${repositoryName} に \`${short}\` がプッシュされました。\n\n${trimmed}`;
}
