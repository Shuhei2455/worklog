import { prisma } from "@/lib/db";
import { randomBytes } from "node:crypto";

/**
 * Gitea との連携。
 *
 * **Gitホスティングは自作しない**（CLAUDE.md）。リポジトリとコミットの実体は
 * Gitea に置き、こちらはメタデータだけを鏡写しにする。画面はこちらで作る。
 *
 * 対応づけ:
 *   プロジェクト（キー AA） → Gitea の organization `AA`
 *   リポジトリ             → その organization 配下のリポジトリ
 *   ユーザー               → 同じログインIDの Gitea ユーザー
 *
 * organization を挟むのは、プロジェクトをまたいで同じリポジトリ名を
 * 使えるようにするため（`AA/web` と `BB/web` が別物になる）。
 */

export function giteaEnabled(): boolean {
  return Boolean(process.env.GITEA_URL && process.env.GITEA_ADMIN_TOKEN);
}

/** 外から見えるベースURL。クローンURLの組み立てに使う */
export function giteaPublicBase(): string {
  // APP_URL の配下に /git で載せている（caddy/Caddyfile）
  return `${process.env.APP_URL ?? ""}/git`;
}

export class GiteaError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Gitea ${status} ${path}: ${message}`);
  }
}

/**
 * Gitea の API を叩く。
 *
 * 管理者トークンで叩く。ユーザーごとのトークンを持たせると、
 * 棚卸しと失効の管理が増えるため（5〜20人の規模では割に合わない）。
 */
async function call<T>(
  path: string,
  init: RequestInit & { expect404?: boolean } = {},
): Promise<T> {
  if (!giteaEnabled()) throw new Error("Gitea が設定されていません");

  const { expect404, ...rest } = init;
  const res = await fetch(`${process.env.GITEA_URL}/api/v1${path}`, {
    ...rest,
    headers: {
      Authorization: `token ${process.env.GITEA_ADMIN_TOKEN}`,
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    // 相手は同じホストの中なので長く待つ意味がない
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 404 && expect404) return null as T;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GiteaError(res.status, path, body.slice(0, 300));
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export type GiteaUser = { id: number; login: string; email: string; full_name: string };
export type GiteaRepo = {
  id: number;
  name: string;
  full_name: string;
  description: string;
  default_branch: string;
  empty: boolean;
  clone_url: string;
  ssh_url: string;
  updated_at: string;
};

/** 繋がるか確かめる。設定画面から使う */
export async function giteaVersion(): Promise<string> {
  const v = await call<{ version: string }>("/version");
  return v.version;
}

// ---- ユーザー ------------------------------------------------------------

/**
 * Gitea が予約している名前。この名前ではユーザーも organization も作れない
 * （422 `name is reserved`）。**アプリの `admin` がそのまま当たる。**
 *
 * Gitea 1.22 の reservedUsernames から、アプリのログインIDやプロジェクトキーに
 * 使われそうなものを写した。網羅ではないので、実際のエラーでも拾う（下の isReserved）。
 */
const GITEA_RESERVED = new Set([
  "admin", "api", "assets", "attachments", "avatar", "avatars", "captcha",
  "commits", "debug", "error", "explore", "favicon.ico", "ghost", "issues",
  "login", "manifest.json", "metrics", "milestones", "new", "notifications",
  "org", "pulls", "raw", "repo", "repo-avatars", "required", "robots.txt",
  "search", "serviceworker.js", "ssh_info", "swagger.v1.json", "user", "v2",
]);

function isReservedError(e: unknown): boolean {
  return (
    e instanceof GiteaError &&
    e.status === 422 &&
    /reserved|already exist|not valid/i.test(e.message)
  );
}

/**
 * Gitea 側のログイン名を決める。
 *
 * 素のログインIDを使えるならそれが一番分かりやすい。使えないときだけ
 * `-kadai` を付ける。決め方を固定しておかないと、作り直したときに
 * 別のユーザーができてしまう。
 */
function giteaLoginFor(loginId: string, attempt: number): string {
  if (attempt === 0 && !GITEA_RESERVED.has(loginId.toLowerCase())) return loginId;
  return `${loginId}-kadai${attempt > 1 ? attempt : ""}`;
}

/**
 * アプリのユーザーに対応する Gitea ユーザーを用意する。
 *
 * パスワードはその場で作って**保存しない**。アプリ側のパスワードと
 * 同じものを入れると、片方を変えたときに食い違う。
 * Gitea に直接ログインする必要が出たときは setGiteaPassword() で入れ直す。
 */
export async function ensureGiteaUser(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`ユーザーが見つかりません: ${userId}`);
  if (user.giteaUserId && user.giteaLogin) return user.giteaUserId;

  // メールで先に探す。Gitea はメールの重複を拒むので、同じアドレスの
  // ユーザーが既にいるなら、名前を変えても作れない。それを掴んで紐づける
  const byEmail = await findGiteaUserByEmail(user.email);
  if (byEmail) {
    await prisma.user.update({
      where: { id: user.id },
      data: { giteaUserId: byEmail.id, giteaLogin: byEmail.login },
    });
    return byEmail.id;
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const login = giteaLoginFor(user.userId, attempt);

    // 既にいるかもしれない（過去に同期して列だけ消えた場合）。
    // ただし同じ名前の別人を掴まないよう、メールの一致も見る
    const existing = await call<GiteaUser | null>(
      `/users/${encodeURIComponent(login)}`,
      { expect404: true },
    );
    if (existing) {
      if (existing.email !== user.email) continue; // 別人。次の候補へ
      await prisma.user.update({
        where: { id: user.id },
        data: { giteaUserId: existing.id, giteaLogin: login },
      });
      return existing.id;
    }

    try {
      const gitea = await call<GiteaUser>("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: login,
          email: user.email,
          full_name: user.name,
          password: randomBytes(24).toString("base64url"),
          must_change_password: false,
          send_notify: false,
        }),
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { giteaUserId: gitea.id, giteaLogin: login },
      });
      return gitea.id;
    } catch (e) {
      // 予約名・使用中なら次の候補を試す。それ以外は本物の失敗
      if (!isReservedError(e)) throw e;
    }
  }
  throw new Error(`Gitea のユーザー名を決められません: ${user.userId}`);
}

/**
 * メールアドレスで Gitea のユーザーを探す。
 *
 * Gitea はメールの重複を拒む（422 e-mail already in use）。名前の候補を
 * 変えても解決しないので、作る前にこれで確認する。
 *
 * `/users/search` ではなく `/admin/emails` を使う。検索APIはメールを
 * 返さないことがあり（非公開設定）、**主でないアドレスも予約を続ける**ので、
 * 主・副を区別しないこの一覧でないと取りこぼす。実際に
 * 「画面上は別アドレスなのに作れない」状態を踏んだ。
 */
async function findGiteaUserByEmail(email: string): Promise<GiteaUser | null> {
  const rows = await call<
    Array<{ email: string; user_id: number; username: string; primary: boolean }>
  >(`/admin/emails?q=${encodeURIComponent(email)}`);
  const hit = rows.find((r) => r.email.toLowerCase() === email.toLowerCase());
  if (!hit) return null;
  return { id: hit.user_id, login: hit.username, email: hit.email, full_name: "" };
}

/** Gitea 側のログイン名。同期していなければ同期する */
export async function giteaLoginOf(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { giteaLogin: true },
  });
  if (user?.giteaLogin) return user.giteaLogin;
  await ensureGiteaUser(userId);
  const after = await prisma.user.findUnique({
    where: { id: userId },
    select: { giteaLogin: true },
  });
  if (!after?.giteaLogin) throw new Error("Gitea のログイン名が決まりません");
  return after.giteaLogin;
}

/** Gitea のパスワードを設定し直す。Gitea に直接ログインしたいとき用 */
export async function setGiteaPassword(userId: number, password: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`ユーザーが見つかりません: ${userId}`);
  const login = await giteaLoginOf(user.id);

  await call(`/admin/users/${encodeURIComponent(login)}`, {
    method: "PATCH",
    body: JSON.stringify({
      // Gitea の EditUser はメールとログイン名を必須で受け取る
      email: user.email,
      login_name: login,
      password,
      must_change_password: false,
    }),
  });
}

// ---- organization とリポジトリ -------------------------------------------

/**
 * プロジェクトに対応する organization を用意し、その名前を返す。
 *
 * 名前はプロジェクトキーをそのまま使うが、Gitea の予約名に当たるときは
 * `-kadai` を付けた名前になる（ユーザー名と同じ扱い）。
 * どちらになったかは projects.gitea_org に保存する。
 */
export async function ensureOrg(projectId: number): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`プロジェクトが見つかりません: ${projectId}`);
  if (project.giteaOrg) return project.giteaOrg;

  for (let attempt = 0; attempt < 4; attempt++) {
    const name = giteaLoginFor(project.key, attempt);

    const org = await call<{ id: number } | null>(`/orgs/${name}`, { expect404: true });
    if (org) {
      await prisma.project.update({
        where: { id: project.id },
        data: { giteaOrg: name },
      });
      return name;
    }

    try {
      await call("/orgs", {
        method: "POST",
        body: JSON.stringify({
          username: name,
          full_name: project.name,
          // 既定で非公開。社内のコードが URL を知っただけで見えるのは避ける
          visibility: "private",
          repo_admin_change_team_access: true,
        }),
      });
      await prisma.project.update({
        where: { id: project.id },
        data: { giteaOrg: name },
      });
      return name;
    } catch (e) {
      if (!isReservedError(e)) throw e;
    }
  }
  throw new Error(`Gitea の organization 名を決められません: ${project.key}`);
}

/** organization 名を引く。無ければ作る */
export async function giteaOrgOf(projectId: number): Promise<string> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: { giteaOrg: true },
  });
  return p?.giteaOrg ?? (await ensureOrg(projectId));
}

/** organization にユーザーを入れる（= リポジトリが見えるようになる） */
export async function addOrgMember(org: string, giteaLogin: string): Promise<void> {
  // Owners は organization 作成時に作られる唯一のチーム。
  // 5〜20人の規模でチームを細かく分ける意味がないので、ここに入れる
  await call(`/teams/${await ownersTeamId(org)}/members/${encodeURIComponent(giteaLogin)}`, {
    method: "PUT",
  });
}

/** organization から外す。プロジェクトのメンバーを外したときに呼ぶ */
export async function removeOrgMember(org: string, giteaLogin: string): Promise<void> {
  await call(`/orgs/${org}/members/${encodeURIComponent(giteaLogin)}`, {
    method: "DELETE",
  });
}

async function ownersTeamId(org: string): Promise<number> {
  const teams = await call<Array<{ id: number; name: string }>>(`/orgs/${org}/teams`);
  const owners = teams.find((t) => t.name === "Owners") ?? teams[0];
  if (!owners) throw new Error(`${org} にチームがありません`);
  return owners.id;
}

/** リポジトリを作る。すでにあればそれを返す */
export async function createGiteaRepo(
  org: string,
  name: string,
  description: string,
): Promise<GiteaRepo> {
  const existing = await call<GiteaRepo | null>(
    `/repos/${org}/${encodeURIComponent(name)}`,
    { expect404: true },
  );
  if (existing) return existing;

  return call<GiteaRepo>(`/orgs/${org}/repos`, {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      private: true,
      // 空のままだとクローンして最初の push をする流れになる。
      // 初期化しておくと画面から中身を見られる状態で始められる
      auto_init: true,
      default_branch: "main",
      readme: "Default",
    }),
  });
}

/**
 * push と PR をこちらへ通知させる webhook を登録する。
 *
 * 送信先はコンテナ名（http://app:3000/...）。Gitea は既定で
 * プライベートアドレスへの送信を拒むので、compose 側で
 * `webhook.ALLOWED_HOST_LIST=*` を入れてある。
 */
export async function ensureRepoWebhook(
  org: string,
  name: string,
  secret: string,
): Promise<number> {
  const url = `${process.env.APP_URL_INTERNAL ?? "http://app:3000"}/api/gitea/webhook`;
  const hooks = await call<Array<{ id: number; config: { url: string } }>>(
    `/repos/${org}/${encodeURIComponent(name)}/hooks`,
  );
  const found = hooks.find((h) => h.config.url === url);
  if (found) return found.id;

  const hook = await call<{ id: number }>(
    `/repos/${org}/${encodeURIComponent(name)}/hooks`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "gitea",
        active: true,
        // pull_request_comment まで取るのは活動種別20（PRへのコメント）のため
        events: ["push", "pull_request", "pull_request_comment"],
        config: {
          url,
          content_type: "json",
          secret,
        },
      }),
    },
  );
  return hook.id;
}

// ---- 閲覧用 --------------------------------------------------------------

export type GiteaCommit = {
  sha: string;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
  };
  author: { login: string } | null;
};

/** コミット一覧。画面の「コミット」タブで使う */
export async function listCommits(
  org: string,
  name: string,
  opts: { sha?: string; page?: number; limit?: number; path?: string } = {},
): Promise<GiteaCommit[]> {
  const q = new URLSearchParams();
  if (opts.sha) q.set("sha", opts.sha);
  if (opts.path) q.set("path", opts.path);
  q.set("page", String(opts.page ?? 1));
  q.set("limit", String(opts.limit ?? 30));
  // 空のリポジトリは 409 を返す
  try {
    return await call<GiteaCommit[]>(
      `/repos/${org}/${encodeURIComponent(name)}/commits?${q}`,
    );
  } catch (e) {
    if (e instanceof GiteaError && (e.status === 409 || e.status === 404)) return [];
    throw e;
  }
}

export type GiteaEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
};

/** ファイル一覧（1階層）。ツリー表示で使う */
export async function listContents(
  org: string,
  name: string,
  path = "",
  ref?: string,
): Promise<GiteaEntry[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  try {
    const out = await call<GiteaEntry[] | GiteaEntry>(
      `/repos/${org}/${encodeURIComponent(name)}/contents/${path}${q}`,
    );
    return Array.isArray(out) ? out : [out];
  } catch (e) {
    if (e instanceof GiteaError && (e.status === 404 || e.status === 409)) return [];
    throw e;
  }
}

/** ファイルの中身。画面で表示する */
export async function readFile(
  org: string,
  name: string,
  path: string,
  ref?: string,
): Promise<{ content: string; size: number; encoding: string } | null> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const out = await call<{
    content: string;
    size: number;
    encoding: string;
  } | null>(`/repos/${org}/${encodeURIComponent(name)}/contents/${path}${q}`, {
    expect404: true,
  });
  return out;
}

/** コミット1件の差分（unified diff のテキスト） */
export async function commitDiff(
  org: string,
  name: string,
  sha: string,
): Promise<string> {
  if (!giteaEnabled()) throw new Error("Gitea が設定されていません");
  const res = await fetch(
    `${process.env.GITEA_URL}/api/v1/repos/${org}/${encodeURIComponent(name)}/git/commits/${sha}.diff`,
    {
      headers: { Authorization: `token ${process.env.GITEA_ADMIN_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) return "";
  return res.text();
}

export type GiteaPull = {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  merged_at: string | null;
  closed_at: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  merge_commit_sha: string | null;
  user: { login: string } | null;
  assignee: { login: string } | null;
};

/** PR一覧。初回の取り込みに使う（以後は webhook で追随する） */
export async function listPulls(
  org: string,
  name: string,
): Promise<GiteaPull[]> {
  try {
    return await call<GiteaPull[]>(
      `/repos/${org}/${encodeURIComponent(name)}/pulls?state=all&limit=50`,
    );
  } catch (e) {
    if (e instanceof GiteaError && (e.status === 404 || e.status === 409)) return [];
    throw e;
  }
}
