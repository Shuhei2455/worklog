import type { GitProvider } from "./provider";
import { github, githubConfigured } from "./github";

/**
 * 使う提供元を1か所で決める。画面や API はここ経由でしか触らない。
 *
 * 本命は社内 Bitbucket。接続できるようになったら `bitbucket.ts` を足して
 * ここに分岐を1行増やす（呼び出し側は変えない）。
 */
export function gitProvider(): GitProvider | null {
  const name = process.env.GIT_PROVIDER || "github";
  if (name === "github") return githubConfigured() ? github : null;
  return null;
}

/** Git連携が使える状態か。未設定なら画面にGitのタブを出さない */
export function gitEnabled(): boolean {
  return gitProvider() !== null;
}

export * from "./provider";
