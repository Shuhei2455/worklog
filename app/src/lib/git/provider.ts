/**
 * Gitホスティングの提供元を差し替えられるようにする境界。
 *
 * 2026-09-22 の方針変更（CLAUDE.md）。それまでは Gitea 固定で、しかも
 * **アプリが Gitea を構築する**作りだった（ユーザー作成・パスワード同期・
 * organization作成・リポジトリ作成）。GitHub や Bitbucket ではこれができない。
 * 向こうにあるリポジトリへ「繋ぐ」だけなので、共通で持てるのは読み取りと
 * Webhook受信だけになる。
 *
 * 本命は社内 Bitbucket だが、現時点で接続できないため、まず GitHub 実装で
 * 使用感を確かめる。Bitbucket Server は REST の形（/rest/api/1.0/…）も
 * 応答の構造も違うので、**生のAPI形状を外へ出さない**。
 * ここで定義する中立な型に各実装が写す。
 */

/** リポジトリの指定。GitHub は owner/name、Bitbucket は project/slug */
export type RepoRef = { owner: string; name: string };

export type GitRepo = {
  /** 提供元での識別子。数値のこともスラッグのこともあるので文字列で持つ */
  externalId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  /** 人がブラウザで開くURL */
  htmlUrl: string;
  private: boolean;
};

export type GitCommit = {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** ISO8601 */
  authoredAt: string;
  /** 提供元アカウント名。紐付けできないときは null */
  authorLogin: string | null;
};

export type GitEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
};

export type GitFile = { content: string; size: number; encoding: string };

export type GitDiffFile = {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch: string | null;
};

export type GitPull = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  /** ISO8601 */
  mergedAt: string | null;
  closedAt: string | null;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  mergeCommitSha: string | null;
  authorLogin: string | null;
  assigneeLogin: string | null;
  htmlUrl: string;
};

/** Webhookで受け取る出来事。提供元ごとの差はここで吸収する */
export type GitWebhookEvent =
  | { kind: "push"; repo: RepoRef; ref: string; commits: GitCommit[] }
  | { kind: "pull_request"; repo: RepoRef; action: string; pull: GitPull }
  | { kind: "unsupported"; raw: string };

export interface GitProvider {
  readonly name: "github" | "bitbucket";

  /** 繋げられるリポジトリの一覧。設定画面で選ばせる */
  listRepos(): Promise<GitRepo[]>;
  getRepo(ref: RepoRef): Promise<GitRepo | null>;

  listCommits(
    ref: RepoRef,
    opts?: { sha?: string; path?: string; page?: number; limit?: number },
  ): Promise<GitCommit[]>;
  listContents(ref: RepoRef, path?: string, gitRef?: string): Promise<GitEntry[]>;
  readFile(ref: RepoRef, path: string, gitRef?: string): Promise<GitFile | null>;
  commitDiff(ref: RepoRef, sha: string): Promise<GitDiffFile[]>;

  listPulls(ref: RepoRef, opts?: { state?: "open" | "closed" | "all" }): Promise<GitPull[]>;
  getPull(ref: RepoRef, number: number): Promise<GitPull | null>;

  /**
   * クローンURL。Gitea のときは自前の /git プロキシを指していたが、
   * 提供元が外にある場合は**向こうのURL**でないと使えない
   */
  cloneUrls(ref: RepoRef): { http: string; ssh: string | null };

  /** ブラウザで開くURL。コミットやPRへの直リンクに使う */
  webUrl(ref: RepoRef, at?: { commit?: string; pull?: number }): string;

  /**
   * Webhookの署名を検証する。**本文は生のまま渡すこと**。
   * JSONに起こしてから文字列に戻すと空白が変わって署名が合わない
   */
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  parseWebhook(headers: Headers, rawBody: string): GitWebhookEvent;
}

export class GitProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitProviderError";
  }
}
