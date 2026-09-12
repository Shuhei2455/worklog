import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/project";
import { createIssue, updateIssue, deleteIssue } from "@/lib/issue";

/**
 * DBを使う結合テスト。
 *
 * keyId の並列採番は「アプリ側で MAX+1 を取らない」ことの確認が目的で、
 * モックでは意味がない(docs/02-roadmap.md フェーズ1の受け入れ条件)。
 *
 * 実行には postgres が要るので `docker compose exec app pnpm test` で走らせる。
 * テスト用のプロジェクトは後片付けする。
 */

const KEY = "TESTKEY";
let projectId = 0;
let userId = 0;

beforeAll(async () => {
  const admin = await prisma.user.findFirstOrThrow({ where: { userType: "admin" } });
  userId = admin.id;
  await prisma.project.deleteMany({ where: { key: KEY } });
  const p = await createProject({ key: KEY, name: "テスト", createdBy: userId });
  projectId = p.id;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { key: KEY } });
  await prisma.$disconnect();
});

const make = (summary: string, extra: Record<string, unknown> = {}) =>
  createIssue({
    projectId,
    summary,
    issueTypeId: 1,
    createdBy: userId,
    ...extra,
  });

describe("keyId の採番", () => {
  it("10件を同時に作っても重複しない", async () => {
    const issues = await Promise.all(
      Array.from({ length: 10 }, (_, i) => make(`並列 ${i}`)),
    );
    const keyIds = issues.map((i) => i.keyId).sort((a, b) => a - b);
    expect(new Set(keyIds).size).toBe(10);
    // 連番であること（欠番はここでは起きない）
    expect(keyIds[9] - keyIds[0]).toBe(9);
  });

  it("削除しても欠番のまま再利用しない（決定 D2）", async () => {
    const a = await make("採番A");
    await deleteIssue(a.id);
    const b = await make("採番B");
    expect(b.keyId).toBeGreaterThan(a.keyId);
  });
});

describe("親子課題は1階層まで", () => {
  it("親を持つ課題を親に指定できない", async () => {
    const parent = await make("親");
    const child = await make("子", { parentIssueId: parent.id });
    await expect(make("孫", { parentIssueId: child.id })).rejects.toThrow(
      /1階層/,
    );
  });

  it("子を持つ課題を他人の子にできない", async () => {
    const parent = await make("親2");
    await make("子2", { parentIssueId: parent.id });
    const other = await make("別の親");
    await expect(
      updateIssue({ issueId: parent.id, updatedBy: userId, parentIssueId: other.id }),
    ).rejects.toThrow(/子課題を持つ/);
  });

  it("自分自身を親にできない", async () => {
    const a = await make("自己参照");
    await expect(
      updateIssue({ issueId: a.id, updatedBy: userId, parentIssueId: a.id }),
    ).rejects.toThrow(/自分自身/);
  });
});

describe("課題の削除（決定 D13）", () => {
  it("子課題は消さず、親への参照だけ外す", async () => {
    const parent = await make("消される親");
    const child = await make("残る子", { parentIssueId: parent.id });
    await deleteIssue(parent.id);

    const stillThere = await prisma.issue.findUnique({ where: { id: child.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.parentIssueId).toBeNull();
  });
});

describe("更新と活動履歴", () => {
  it("変更とコメントを同時に送ると1レコードになる", async () => {
    // 本家は更新時に comment を一緒に送れる(00-spec-verified.md 2.2)。
    // 分けると本家の表示と食い違う
    const issue = await make("同時更新");
    await updateIssue({
      issueId: issue.id,
      updatedBy: userId,
      statusId: 2,
      comment: "着手します",
    });

    const acts = await prisma.activity.findMany({
      where: { issueId: issue.id },
      orderBy: { createdAt: "asc" },
    });
    // 作成 + 更新 の2件
    expect(acts).toHaveLength(2);
    const last = acts[1];
    expect(last.type).toBe("issue_updated");
    expect(last.content).toBe("着手します");
    expect(last.changes).toBeTruthy();
  });

  it("コメントだけなら type は comment", async () => {
    const issue = await make("コメントのみ");
    await updateIssue({
      issueId: issue.id,
      updatedBy: userId,
      comment: "メモ",
    });
    const acts = await prisma.activity.findMany({ where: { issueId: issue.id } });
    expect(acts[acts.length - 1].type).toBe("comment");
  });

  it("何も変わらなければ履歴を作らない", async () => {
    const issue = await make("無変更");
    const before = await prisma.activity.count({ where: { issueId: issue.id } });
    await updateIssue({
      issueId: issue.id,
      updatedBy: userId,
      summary: "無変更",
    });
    const after = await prisma.activity.count({ where: { issueId: issue.id } });
    expect(after).toBe(before);
  });

  it("状態を完了にすると completedAt が入る", async () => {
    const issue = await make("完了にする");
    await updateIssue({ issueId: issue.id, updatedBy: userId, statusId: 4 });
    const done = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(done.completedAt).toBeInstanceOf(Date);

    // 完了から戻すと消える
    await updateIssue({ issueId: issue.id, updatedBy: userId, statusId: 2 });
    const back = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(back.completedAt).toBeNull();
  });
});

describe("参加者の自動記録", () => {
  it("登録者は自動で参加者になる", async () => {
    const issue = await make("参加者");
    const ps = await prisma.issueParticipant.findMany({
      where: { issueId: issue.id },
    });
    expect(ps.map((p) => p.userId)).toContain(userId);
  });
});

describe("プロジェクト設定の反映", () => {
  it("チャートがOFFなら開始日・期限日が入らない", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { chartEnabled: false },
    });
    const issue = await make("日付なし", {
      startDate: new Date("2026-01-01"),
      dueDate: new Date("2026-01-31"),
    });
    expect(issue.startDate).toBeNull();
    expect(issue.dueDate).toBeNull();

    await prisma.project.update({
      where: { id: projectId },
      data: { chartEnabled: true },
    });
  });
});
