/**
 * ログインIDの形式。
 *
 * 管理者によるユーザー追加と、利用者自身のサインアップの両方で使う。
 * `"use server"` のファイルは非同期関数しかエクスポートできないため、
 * users/actions.ts に置いたままでは共有できない（CLAUDE.md）。
 */
export const USER_ID_RE = /^[a-zA-Z0-9_.-]{2,64}$/;

export const USER_ID_RULE =
  "ログインIDは英数字・ハイフン・アンダースコア・ドットで2〜64文字です";
