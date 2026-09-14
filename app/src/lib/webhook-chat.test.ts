import { describe, expect, it } from "vitest";
import { chatKindOf, toDiscord } from "./webhook-chat";
import type { WebhookPayload } from "./webhook";

const base: WebhookPayload = {
  id: 1,
  project: { id: 1, projectKey: "OPS", name: "運用改善" },
  type: 1, // issue_created
  content: { id: 190, key_id: 8, summary: "深夜バッチの実行時間が伸びている", description: "" },
  notifications: [],
  createdUser: { id: 1, userId: "admin", name: "管理者" },
  created: "2026-09-14T02:00:00Z",
};

describe("chatKindOf", () => {
  it("Discord の webhook URL を見分ける", () => {
    expect(chatKindOf("https://discord.com/api/webhooks/123/abc")).toBe("discord");
    expect(chatKindOf("https://discordapp.com/api/webhooks/123/abc")).toBe("discord");
    expect(chatKindOf("https://ptb.discord.com/api/webhooks/123/abc")).toBe("discord");
  });

  it("互換エンドポイント(/slack, /github)には手を出さない", () => {
    // Discord 側があの形式を解釈するので、こちらが変換すると二重になる
    expect(chatKindOf("https://discord.com/api/webhooks/123/abc/slack")).toBe("backlog");
    expect(chatKindOf("https://discord.com/api/webhooks/123/abc/github")).toBe("backlog");
  });

  it("Discord 以外は本家寄りの形のまま", () => {
    expect(chatKindOf("https://hooks.slack.com/services/T/B/x")).toBe("backlog");
    expect(chatKindOf("https://example.local/hook")).toBe("backlog");
  });

  it("似ているだけのドメインに騙されない", () => {
    expect(chatKindOf("https://discord.com.evil.example/api/webhooks/1/a")).toBe("backlog");
    expect(chatKindOf("https://notdiscord.com/api/webhooks/1/a")).toBe("backlog");
  });

  it("URLとして壊れていても落ちない", () => {
    expect(chatKindOf("これはURLではない")).toBe("backlog");
    expect(chatKindOf("")).toBe("backlog");
  });
});

describe("toDiscord", () => {
  it("最上位に content を置かない（置くと Discord が400を返す）", () => {
    const d = toDiscord(base) as unknown as Record<string, unknown>;
    expect(d.content).toBeUndefined();
    expect(Array.isArray(d.embeds)).toBe(true);
  });

  it("課題キーと件名をタイトルにする", () => {
    expect(toDiscord(base).embeds[0].title).toBe(
      "OPS-8 深夜バッチの実行時間が伸びている",
    );
  });

  it("APP_URL があれば課題へのリンクを付ける", () => {
    expect(toDiscord(base, "https://192.168.10.20").embeds[0].url).toBe(
      "https://192.168.10.20/issues/OPS-8",
    );
  });

  it("APP_URL の末尾スラッシュで二重にしない", () => {
    expect(toDiscord(base, "https://192.168.10.20/").embeds[0].url).toBe(
      "https://192.168.10.20/issues/OPS-8",
    );
  });

  it("APP_URL が無ければリンクを付けない", () => {
    expect(toDiscord(base).embeds[0].url).toBeUndefined();
  });

  it("誰が何をしたかを footer に出す", () => {
    expect(toDiscord(base).embeds[0].footer.text).toBe("課題の追加 · 管理者");
  });

  it("コメントがあれば本文にする", () => {
    const p = {
      ...base,
      type: 3, // comment
      content: { ...base.content, comment: { id: 5, content: "確認しました" } },
    };
    expect(toDiscord(p).embeds[0].description).toBe("確認しました");
  });

  it("変更点を field に並べる", () => {
    const p = {
      ...base,
      type: 2,
      content: {
        ...base.content,
        changes: [{ field: "status", old_value: "未対応", new_value: "処理中" }],
      },
    };
    const f = toDiscord(p).embeds[0].fields!;
    expect(f[0].name).toBe("status");
    expect(f[0].value).toBe("未対応 → 処理中");
  });

  it("変更の値が空でも「（なし）」で埋める", () => {
    const p = {
      ...base,
      type: 2,
      content: { ...base.content, changes: [{ field: "assignee", new_value: "山田" }] },
    };
    expect(toDiscord(p).embeds[0].fields![0].value).toBe("（なし） → 山田");
  });

  it("変更が25個を超えても切る（Discordの上限）", () => {
    const changes = Array.from({ length: 40 }, (_, i) => ({
      field: `f${i}`,
      old_value: "a",
      new_value: "b",
    }));
    const p = { ...base, type: 2, content: { ...base.content, changes } };
    expect(toDiscord(p).embeds[0].fields!.length).toBe(25);
  });

  it("長すぎるタイトルと本文を切る（超えると全体が400になる）", () => {
    const p = {
      ...base,
      content: { key_id: 8, summary: "あ".repeat(500), description: "い".repeat(5000) },
    };
    const e = toDiscord(p).embeds[0];
    expect(e.title.length).toBeLessThanOrEqual(256);
    expect(e.description!.length).toBeLessThanOrEqual(4000);
  });

  it("Wikiのように key_id が無くてもページ名で出す", () => {
    const p = { ...base, type: 5, content: { id: 3, name: "開発の進め方" } };
    const e = toDiscord(p).embeds[0];
    expect(e.title).toBe("開発の進め方");
    expect(e.url).toBeUndefined();
  });

  it("送信元が分かるよう username にプロジェクト名を入れる", () => {
    expect(toDiscord(base).username).toBe("Kadai / 運用改善");
  });
});
