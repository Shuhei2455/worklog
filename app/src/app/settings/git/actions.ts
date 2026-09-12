"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";

/**
 * 自分の Gitea のパスワードを決める。
 *
 * **これが無いと誰も Gitea にログインできない。** アプリは管理者トークンで
 * API を叩いているだけなので、利用者自身のログイン情報は未設定のまま。
 * SSH鍵の登録・PRのレビュー・マージは Gitea の画面で行う設計なので、
 * ここを通れるようにしておく必要がある。
 *
 * アプリのパスワードとは別に持つ。同じにすると、片方を変えたときに
 * 食い違って「どちらが正しいか分からない」状態になる。
 */
export async function setMyGiteaPassword(formData: FormData) {
  const user = await currentUser();

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const path = "/settings/git";

  const fail = (msg: string): never => {
    revalidatePath(path);
    redirect(`${path}?error=${encodeURIComponent(msg)}`);
  };

  // Gitea の既定の下限は8文字。ここで弾かないとAPIのエラーがそのまま出る
  if (password.length < 8) fail("8文字以上にしてください");
  if (password !== confirm) fail("確認用のパスワードが一致しません");

  const { giteaEnabled, setGiteaPassword } = await import("@/lib/gitea");
  if (!giteaEnabled()) fail("Gitea が設定されていません");

  try {
    await setGiteaPassword(user.id, password);
  } catch (e) {
    fail(`設定できませんでした: ${(e as Error).message}`);
  }

  revalidatePath(path);
  redirect(`${path}?ok=1`);
}
