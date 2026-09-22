import { createHmac, timingSafeEqual } from "node:crypto";
import {
  GitProviderError,
  type GitCommit,
  type GitDiffFile,
  type GitEntry,
  type GitFile,
  type GitProvider,
  type GitPull,
  type GitRepo,
  type GitWebhookEvent,
  type RepoRef,
} from "./provider";

/**
 * GitHub 実装。
 *
 * 読み取りとWebhook受信だけを行う。リポジトリやユーザーを**作らない**
 * （Gitea のときはアプリが作っていたが、GitHub ではこちらの持ち物ではない）。
 *
 * 認証は個人アクセストークン。使用感の確認が目的なので GitHub App は使わない。
 */

// composeが未設定の変数を**空文字**で渡すため `??` では既定に落ちない
// (`??` は null/undefined のときだけ)。空も既定に寄せる
const API = process.env.GITHUB_API_BASE || "https://api.github.com";
// APIと画面のホストは別。GitHub Enterprise では api.<host>/api/v3 と <host> に分かれる
const WEB = process.env.GITHUB_WEB_BASE || "https://github.com";

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

/** 一覧に出す持ち主。未設定ならトークンの本人 */
export function githubOwner(): string | undefined {
  return process.env.GITHUB_OWNER || undefined;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new GitProviderError(500, "GITHUB_TOKEN が設定されていません");

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GitProviderError(res.status, `GitHub ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---- 生の応答から中立な型へ写す ------------------------------------------

type RawRepo = {
  id: number;
  name: string;
  owner: { login: string };
  default_branch: string;
  html_url: string;
  private: boolean;
};

const toRepo = (r: RawRepo): GitRepo => ({
  externalId: String(r.id),
  owner: r.owner.login,
  name: r.name,
  defaultBranch: r.default_branch,
  htmlUrl: r.html_url,
  private: r.private,
});

type RawCommit = {
  sha: string;
  commit: { message: string; author: { name: string; email: string; date: string } };
  author: { login: string } | null;
};

const toCommit = (c: RawCommit): GitCommit => ({
  sha: c.sha,
  message: c.commit.message,
  authorName: c.commit.author.name,
  authorEmail: c.commit.author.email,
  authoredAt: c.commit.author.date,
  authorLogin: c.author?.login ?? null,
});

type RawPull = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged?: boolean;
  merged_at: string | null;
  closed_at: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  merge_commit_sha: string | null;
  user: { login: string } | null;
  assignee: { login: string } | null;
  html_url: string;
};

const toPull = (p: RawPull): GitPull => ({
  number: p.number,
  title: p.title,
  body: p.body ?? "",
  state: p.state === "open" ? "open" : "closed",
  // 一覧の応答には merged が無い。merged_at の有無で判断する
  merged: p.merged ?? p.merged_at !== null,
  mergedAt: p.merged_at,
  closedAt: p.closed_at,
  baseRef: p.base.ref,
  baseSha: p.base.sha,
  headRef: p.head.ref,
  headSha: p.head.sha,
  mergeCommitSha: p.merge_commit_sha,
  authorLogin: p.user?.login ?? null,
  assigneeLogin: p.assignee?.login ?? null,
  htmlUrl: p.html_url,
});

const repoPath = (r: RepoRef) =>
  `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;

/** 空のリポジトリや未作成のパスは「無い」として扱い、例外にしない */
async function orEmpty<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitProviderError && (e.status === 404 || e.status === 409)) return empty;
    throw e;
  }
}

export const github: GitProvider = {
  name: "github",

  async listRepos() {
    const owner = githubOwner();
    // 持ち主の指定が無ければトークンの本人がアクセスできるものを出す
    const path = owner
      ? `/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`
      : `/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member`;
    const raw = await call<RawRepo[]>(path);
    return raw.map(toRepo);
  },

  async getRepo(ref) {
    return orEmpty(async () => toRepo(await call<RawRepo>(repoPath(ref))), null);
  },

  async listCommits(ref, opts = {}) {
    const q = new URLSearchParams();
    if (opts.sha) q.set("sha", opts.sha);
    if (opts.path) q.set("path", opts.path);
    q.set("page", String(opts.page ?? 1));
    q.set("per_page", String(opts.limit ?? 30));
    return orEmpty(
      async () => (await call<RawCommit[]>(`${repoPath(ref)}/commits?${q}`)).map(toCommit),
      [],
    );
  },

  async listContents(ref, path = "", gitRef) {
    const q = gitRef ? `?ref=${encodeURIComponent(gitRef)}` : "";
    return orEmpty(async () => {
      const out = await call<GitEntry[] | GitEntry>(`${repoPath(ref)}/contents/${path}${q}`);
      return Array.isArray(out) ? out : [out];
    }, []);
  },

  async readFile(ref, path, gitRef) {
    const q = gitRef ? `?ref=${encodeURIComponent(gitRef)}` : "";
    return orEmpty(async () => {
      const out = await call<{ content: string; size: number; encoding: string }>(
        `${repoPath(ref)}/contents/${path}${q}`,
      );
      return { content: out.content, size: out.size, encoding: out.encoding } as GitFile;
    }, null);
  },

  async commitDiff(ref, sha) {
    return orEmpty(async () => {
      const out = await call<{ files?: GitDiffFile[] }>(
        `${repoPath(ref)}/commits/${encodeURIComponent(sha)}`,
      );
      return (out.files ?? []).map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      }));
    }, []);
  },

  async listPulls(ref, opts = {}) {
    const q = new URLSearchParams({ state: opts.state ?? "all", per_page: "100" });
    return orEmpty(
      async () => (await call<RawPull[]>(`${repoPath(ref)}/pulls?${q}`)).map(toPull),
      [],
    );
  },

  async getPull(ref, number) {
    return orEmpty(
      async () => toPull(await call<RawPull>(`${repoPath(ref)}/pulls/${number}`)),
      null,
    );
  },

  cloneUrls(ref) {
    const web = WEB.replace(/\/$/, "");
    const host = new URL(web).host;
    return {
      http: `${web}/${ref.owner}/${ref.name}.git`,
      ssh: `git@${host}:${ref.owner}/${ref.name}.git`,
    };
  },

  webUrl(ref, at) {
    const base = `${WEB.replace(/\/$/, "")}/${ref.owner}/${ref.name}`;
    if (at?.commit) return `${base}/commit/${at.commit}`;
    if (at?.pull) return `${base}/pull/${at.pull}`;
    return base;
  },

  verifyWebhook(headers, rawBody) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    // **秘密が未設定なら全部落とす。**
    // 素通りさせると、この受け口に届く誰もがタスクへコメントを書けてしまう。
    // 置き換え前の Gitea の受け口も同じ判断だった
    if (!secret) return false;
    const sent = headers.get("x-hub-signature-256");
    if (!sent) return false;
    const mine = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(sent);
    const b = Buffer.from(mine);
    // 長さが違うと timingSafeEqual が投げる
    return a.length === b.length && timingSafeEqual(a, b);
  },

  parseWebhook(headers, rawBody): GitWebhookEvent {
    const event = headers.get("x-github-event");
    const body = JSON.parse(rawBody) as {
      repository?: { name: string; owner: { login: string } };
      ref?: string;
      commits?: Array<{
        id: string;
        message: string;
        author: { name: string; email: string; username?: string };
        timestamp: string;
      }>;
      action?: string;
      pull_request?: RawPull;
    };

    const repo: RepoRef | null = body.repository
      ? { owner: body.repository.owner.login, name: body.repository.name }
      : null;
    if (!repo) return { kind: "unsupported", raw: rawBody.slice(0, 200) };

    if (event === "push") {
      return {
        kind: "push",
        repo,
        ref: body.ref ?? "",
        commits: (body.commits ?? []).map((c) => ({
          sha: c.id,
          message: c.message,
          authorName: c.author.name,
          authorEmail: c.author.email,
          authoredAt: c.timestamp,
          authorLogin: c.author.username ?? null,
        })),
      };
    }

    if (event === "pull_request" && body.pull_request) {
      return {
        kind: "pull_request",
        repo,
        action: body.action ?? "",
        pull: toPull(body.pull_request),
      };
    }

    return { kind: "unsupported", raw: rawBody.slice(0, 200) };
  },
};
