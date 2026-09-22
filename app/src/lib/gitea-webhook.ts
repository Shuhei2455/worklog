import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { parseIssueKeys, commitCommentBody } from "@/lib/commit-link";
import { createNotifications } from "@/lib/notify";
import { enqueueSearch, enqueueWebhook } from "@/lib/queue";
import { webhooksFor } from "@/lib/webhook";
import type { Prisma } from "@prisma/client";

/**
 * Gitea からの webhook を受けて、課題との連携を行う。
 *
 * やること:
 *   push          → コミットメッセージの課題キーを拾い、課題にコメントを登録
 *   pull_request  → PRの行を作る/更新し、ブランチ名の課題キーから関連づける
 *
 * **リポジトリの `link_commits_to_issues` が OFF なら push 連携はしない**
 * （02-roadmap.md フェーズ4の受け入れ条件）。PR の取り込みは設定に関係なく続ける。
 * 一覧が欠けると画面が壊れるため。
 */

/**
 * 署名を確認する。
 *
 * Gitea は本文全体の HMAC-SHA256 を `X-Gitea-Signature` に16進で入れる
 * （webhook 登録時の `config.secret` が鍵）。
 * 秘密が未設定のときは**通さない**。誰でも課題にコメントを書ける穴になる。
 */
export function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.GITEA_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type PushPayload = {
  ref: string;
  repository: { id: number; name: string; full_name: string };
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: { name: string; email: string };
  }>;
  pusher?: { login?: string; email?: string };
};

type PullPayload = {
  action: string;
  number: number;
  repository: { id: number; name: string };
  pull_request: {
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
  sender?: { login?: string };
};

/** Gitea のログイン名からこちらのユーザーを引く。分からなければ null */
async function userByGiteaLogin(login: string | undefined | null) {
  if (!login) return null;
  return prisma.user.findFirst({ where: { giteaLogin: login } });
}

/** webhook の送り主を、行を作る人として決める。不明ならリポジトリを作った人 */
async function actorFor(
  repositoryCreatedById: number,
  login: string | undefined | null,
): Promise<number> {
  const user = await userByGiteaLogin(login);
  return user?.id ?? repositoryCreatedById;
}

/** push を処理する。戻り値はログ用 */
export async function handlePush(payload: PushPayload): Promise<string> {
  const repo = await prisma.repository.findFirst({
    where: { giteaRepoId: payload.repository.id },
    include: { project: { select: { id: true, key: true } } },
  });
  if (!repo) return `未登録のリポジトリ: ${payload.repository.full_name}`;

  const actorId = await actorFor(repo.createdById, payload.pusher?.login);

  // 最終push時刻を記録する。APIの `pushedAt` がこれを返す（4.1）
  const pushedAt = payload.commits.length
    ? new Date(payload.commits[payload.commits.length - 1].timestamp)
    : new Date();
  await prisma.repository.update({
    where: { id: repo.id },
    data: { pushedAt },
  });

  // 活動は連携のON/OFFに関係なく残す。「いつ誰が push したか」は
  // 連携を切っていても追いたい情報
  const pushActivity = await prisma.activity.create({
    data: {
      projectId: repo.projectId,
      userId: actorId,
      type: "git_push",
      content: `${repo.name} (${payload.ref.replace("refs/heads/", "")}) に ${payload.commits.length} 件`,
    },
  });
  await enqueueWebhookFor(repo.projectId, pushActivity.id);

  if (!repo.linkCommitsToIssues) {
    return `${repo.name}: タスク連携はOFF（コミット${payload.commits.length}件を記録のみ）`;
  }

  let linked = 0;
  for (const commit of payload.commits) {
    const keys = parseIssueKeys(commit.message);
    if (keys.length === 0) continue;

    // 字面だけでは実在しないキーも混ざる。**同じプロジェクトの課題だけ**を引く
    // （決定 D21: 他プロジェクトの課題には書き込まない）
    const issues = await prisma.issue.findMany({
      where: {
        projectId: repo.projectId,
        keyId: { in: keys.filter((k) => k.projectKey === repo.project.key).map((k) => k.keyId) },
      },
      select: { id: true, keyId: true, assigneeId: true },
    });

    for (const issue of issues) {
      // 同じコミットで二重に書かない（Gitea が再送することがある）
      const existing = await prisma.commitIssueLink.findUnique({
        where: {
          repositoryId_commitSha_issueId: {
            repositoryId: repo.id,
            commitSha: commit.id,
            issueId: issue.id,
          },
        },
      });
      if (existing) continue;

      await prisma.$transaction(async (tx) => {
        await tx.commitIssueLink.create({
          data: {
            repositoryId: repo.id,
            commitSha: commit.id,
            issueId: issue.id,
            message: commit.message,
            committedAt: new Date(commit.timestamp),
          },
        });

        const activity = await tx.activity.create({
          data: {
            projectId: repo.projectId,
            issueId: issue.id,
            userId: actorId,
            type: "comment",
            content: commitCommentBody(repo.name, commit.id, commit.message),
          },
        });

        // 担当者とウォッチャーには知らせる。自分の push では自分に飛ばない
        await createNotifications(tx, {
          activityId: activity.id,
          issueId: issue.id,
          projectId: repo.projectId,
          actorId,
          assigneeId: issue.assigneeId,
          // コミットメッセージ内のメンション記法も拾う（本文をそのまま渡す）
          texts: [commit.message],
        });
      });

      await enqueueSearch({ kind: "issue", op: "upsert", id: issue.id });
      linked++;
    }
  }

  return `${repo.name}: コミット${payload.commits.length}件 / タスクへの登録${linked}件`;
}

/** PR を処理する */
export async function handlePullRequest(payload: PullPayload): Promise<string> {
  const repo = await prisma.repository.findFirst({
    where: { giteaRepoId: payload.repository.id },
    include: { project: { select: { id: true, key: true } } },
  });
  if (!repo) return `未登録のリポジトリ: ${payload.repository.name}`;

  const pr = payload.pull_request;
  const actorId = await actorFor(repo.createdById, payload.sender?.login);
  const author = await userByGiteaLogin(pr.user?.login);
  const assignee = await userByGiteaLogin(pr.assignee?.login);

  // ブランチ名に課題キーがあれば関連づける。
  // ヌーラボ社内の `BLG-100/fix-some-problem` 形式を想定（4章）
  const fromBranch = parseIssueKeys(pr.head.ref).filter(
    (k) => k.projectKey === repo.project.key,
  );
  const related =
    fromBranch.length > 0
      ? await prisma.issue.findFirst({
          where: { projectId: repo.projectId, keyId: fromBranch[0].keyId },
          select: { id: true },
        })
      : null;

  const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";

  const data: Prisma.PullRequestUncheckedCreateInput = {
    repositoryId: repo.id,
    giteaPrNumber: pr.number,
    title: pr.title,
    body: pr.body || null,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    state,
    issueId: related?.id ?? null,
    assigneeId: assignee?.id ?? null,
    createdById: author?.id ?? null,
    baseCommitSha: pr.base.sha || null,
    branchCommitSha: pr.head.sha || null,
    mergeCommitSha: pr.merge_commit_sha,
    closeAt: pr.closed_at ? new Date(pr.closed_at) : null,
    mergeAt: pr.merged_at ? new Date(pr.merged_at) : null,
  };

  const before = await prisma.pullRequest.findUnique({
    where: {
      repositoryId_giteaPrNumber: { repositoryId: repo.id, giteaPrNumber: pr.number },
    },
  });

  const saved = await prisma.pullRequest.upsert({
    where: {
      repositoryId_giteaPrNumber: { repositoryId: repo.id, giteaPrNumber: pr.number },
    },
    create: data,
    // issueId は一度決まったら webhook で消さない。
    // 画面から付け替えたものを、次の更新通知で巻き戻さないため
    update: { ...data, issueId: before?.issueId ?? data.issueId },
  });

  const activity = await prisma.activity.create({
    data: {
      projectId: repo.projectId,
      userId: actorId,
      pullRequestId: saved.id,
      type: before ? "pull_request_updated" : "pull_request_created",
      content: `${repo.name} #${pr.number} ${pr.title}`,
    },
  });
  await enqueueWebhookFor(repo.projectId, activity.id);

  return `${repo.name} PR#${pr.number} (${payload.action}) を${before ? "更新" : "登録"}`;
}

/** プロジェクトの webhook にも流す（Slack などへ） */
async function enqueueWebhookFor(projectId: number, activityId: number) {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { type: true },
  });
  if (!activity) return;
  for (const hook of await webhooksFor(projectId, activity.type)) {
    await enqueueWebhook({
      activityId,
      hookUrl: hook.hookUrl,
      webhookId: hook.id,
    });
  }
}
