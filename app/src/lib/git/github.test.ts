import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { github } from "./github";

/**
 * 生のGitHub応答から中立な型への写しと、Webhookの署名検証を確かめる。
 *
 * ここが狂うと画面には「コミットが無い」「PRが未マージに見える」といった
 * 形で出るだけで、例外にならない。目視では気づけないのでテストで押さえる。
 */

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

describe("応答の写し", () => {
  it("コミットを平らな形にする", async () => {
    vi.stubGlobal(
      "fetch",
      okJson([
        {
          sha: "abc123",
          commit: {
            message: "直した",
            author: { name: "山田", email: "y@example.com", date: "2026-09-22T01:00:00Z" },
          },
          author: { login: "yamada" },
        },
      ]),
    );
    const [c] = await github.listCommits({ owner: "o", name: "r" });
    expect(c).toEqual({
      sha: "abc123",
      message: "直した",
      authorName: "山田",
      authorEmail: "y@example.com",
      authoredAt: "2026-09-22T01:00:00Z",
      authorLogin: "yamada",
    });
  });

  it("GitHubアカウントに紐付かないコミットは authorLogin が null", async () => {
    vi.stubGlobal(
      "fetch",
      okJson([
        {
          sha: "d",
          commit: { message: "m", author: { name: "n", email: "e", date: "2026-01-01T00:00:00Z" } },
          author: null,
        },
      ]),
    );
    const [c] = await github.listCommits({ owner: "o", name: "r" });
    expect(c.authorLogin).toBeNull();
  });

  it("PR一覧には merged が無いので merged_at から判断する", async () => {
    // 一覧の応答は詳細と違い merged を返さない。素直に読むと
    // マージ済みのPRが全部「未マージ」になる
    vi.stubGlobal(
      "fetch",
      okJson([
        {
          number: 7,
          title: "t",
          body: null,
          state: "closed",
          merged_at: "2026-09-20T00:00:00Z",
          closed_at: "2026-09-20T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "topic", sha: "s" },
          merge_commit_sha: "m",
          user: { login: "u" },
          assignee: null,
          html_url: "https://example.com/pr/7",
        },
      ]),
    );
    const [p] = await github.listPulls({ owner: "o", name: "r" });
    expect(p.merged).toBe(true);
    expect(p.state).toBe("closed");
    expect(p.body).toBe("");
    expect(p.assigneeLogin).toBeNull();
  });

  it("閉じただけのPRは merged にしない", async () => {
    vi.stubGlobal(
      "fetch",
      okJson([
        {
          number: 8,
          title: "t",
          body: "b",
          state: "closed",
          merged_at: null,
          closed_at: "2026-09-20T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "topic", sha: "s" },
          merge_commit_sha: null,
          user: null,
          assignee: null,
          html_url: "u",
        },
      ]),
    );
    const [p] = await github.listPulls({ owner: "o", name: "r" });
    expect(p.merged).toBe(false);
  });

  it("空のリポジトリ（409）は例外にせず空配列", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => "empty",
      } as unknown as Response),
    );
    expect(await github.listCommits({ owner: "o", name: "r" })).toEqual([]);
  });
});

describe("Webhookの署名", () => {
  const body = '{"zen":"design"}';

  it("秘密が未設定なら落とす（誰でもタスクにコメントを書ける穴になる）", () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    expect(github.verifyWebhook(new Headers(), body)).toBe(false);
  });

  it("正しい署名は通る", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "s3cret";
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(github.verifyWebhook(new Headers({ "x-hub-signature-256": sig }), body)).toBe(true);
  });

  it("違う署名は弾く", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "s3cret";
    const sig = "sha256=" + createHmac("sha256", "wrong").update(body).digest("hex");
    expect(github.verifyWebhook(new Headers({ "x-hub-signature-256": sig }), body)).toBe(false);
  });

  it("署名が無ければ弾く", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "s3cret";
    expect(github.verifyWebhook(new Headers(), body)).toBe(false);
  });

  it("長さの違う署名でも落ちない（timingSafeEqual は長さ違いで投げる）", () => {
    process.env.GITHUB_WEBHOOK_SECRET = "s3cret";
    expect(github.verifyWebhook(new Headers({ "x-hub-signature-256": "sha256=ab" }), body)).toBe(
      false,
    );
  });
});

describe("Webhookの読み取り", () => {
  it("push を読む", () => {
    const raw = JSON.stringify({
      repository: { name: "r", owner: { login: "o" } },
      ref: "refs/heads/main",
      commits: [
        {
          id: "s1",
          message: "WEB-1 直した",
          author: { name: "山田", email: "e", username: "yamada" },
          timestamp: "2026-09-22T00:00:00Z",
        },
      ],
    });
    const ev = github.parseWebhook(new Headers({ "x-github-event": "push" }), raw);
    expect(ev.kind).toBe("push");
    if (ev.kind !== "push") throw new Error("push のはず");
    expect(ev.repo).toEqual({ owner: "o", name: "r" });
    expect(ev.commits[0].message).toBe("WEB-1 直した");
    expect(ev.commits[0].authorLogin).toBe("yamada");
  });

  it("知らない種類は unsupported にする", () => {
    const raw = JSON.stringify({ repository: { name: "r", owner: { login: "o" } } });
    expect(github.parseWebhook(new Headers({ "x-github-event": "star" }), raw).kind).toBe(
      "unsupported",
    );
  });

  it("リポジトリが無い本文でも落ちない", () => {
    expect(github.parseWebhook(new Headers({ "x-github-event": "push" }), "{}").kind).toBe(
      "unsupported",
    );
  });
});
