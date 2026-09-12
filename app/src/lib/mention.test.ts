import { describe, it, expect } from "vitest";
import { parseMentions, resolveMentionTargets, renderMentions } from "./mention";

/**
 * docs/00-spec-verified.md 3.1 の記法を検証する。
 * 前の版は「`@ユーザー` 記法」と誤っていた箇所。
 */

describe("記法の解析", () => {
  it("ユーザー・チーム・プロジェクトを拾う", () => {
    expect(parseMentions("<@U5> <@T3> <@project> 確認お願いします")).toEqual([
      { kind: "user", id: 5 },
      { kind: "team", id: 3 },
      { kind: "project" },
    ]);
  });

  it("重複は1つにまとめる", () => {
    expect(parseMentions("<@U5> と <@U5>")).toEqual([{ kind: "user", id: 5 }]);
  });

  it("@ユーザー名 はメンションではない", () => {
    // ここが前の版の誤り。普通の @ 始まりの文字列は拾わない
    expect(parseMentions("@yamada さん確認お願いします")).toEqual([]);
    expect(parseMentions("@管理者")).toEqual([]);
  });

  it("似た形でも記法に合わなければ拾わない", () => {
    expect(parseMentions("<@5>")).toEqual([]);
    expect(parseMentions("<@Uabc>")).toEqual([]);
    expect(parseMentions("<@U>")).toEqual([]);
    expect(parseMentions("< @U5 >")).toEqual([]);
  });

  it("空やnullでも落ちない", () => {
    expect(parseMentions("")).toEqual([]);
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions(undefined)).toEqual([]);
  });

  it("文中に埋まっていても拾う", () => {
    expect(parseMentions("対応は<@U12>にお願いします。")).toEqual([
      { kind: "user", id: 12 },
    ]);
  });
});

describe("通知先の解決", () => {
  const ctx = {
    memberIds: [1, 2, 3],
    teamMembers: new Map([
      [3, [2, 3, 99]], // 99 はプロジェクト未参加
    ]),
  };

  it("参加しているユーザーだけ通知する", () => {
    expect(resolveMentionTargets([{ kind: "user", id: 2 }], ctx)).toEqual([2]);
  });

  it("参加していないユーザーは通知しない", () => {
    // 本家も「プロジェクトのメンバーでないユーザーは通知されない」
    expect(resolveMentionTargets([{ kind: "user", id: 99 }], ctx)).toEqual([]);
  });

  it("存在しないIDは無視する（エラーにしない）", () => {
    expect(resolveMentionTargets([{ kind: "user", id: 12345 }], ctx)).toEqual([]);
  });

  it("チームは所属ユーザーに展開し、未参加者は落とす", () => {
    expect(resolveMentionTargets([{ kind: "team", id: 3 }], ctx).sort()).toEqual([2, 3]);
  });

  it("存在しないチームは無視する", () => {
    expect(resolveMentionTargets([{ kind: "team", id: 404 }], ctx)).toEqual([]);
  });

  it("<@project> は参加者全員", () => {
    expect(resolveMentionTargets([{ kind: "project" }], ctx).sort()).toEqual([1, 2, 3]);
  });

  it("複数のメンションは重複を除いてまとめる", () => {
    const r = resolveMentionTargets(
      [{ kind: "user", id: 2 }, { kind: "team", id: 3 }],
      ctx,
    );
    expect(r.sort()).toEqual([2, 3]);
  });
});

describe("表示用の置き換え", () => {
  const names = {
    users: new Map([[5, "山田"]]),
    teams: new Map([[3, "開発チーム"]]),
  };

  it("名前に置き換える", () => {
    expect(renderMentions("<@U5> 確認お願いします", names)).toBe(
      "@山田 確認お願いします",
    );
  });

  it("チームとプロジェクトも置き換える", () => {
    expect(renderMentions("<@T3> <@project>", names)).toBe(
      "@開発チーム @プロジェクト全員",
    );
  });

  it("解決できないIDは記法のまま残す", () => {
    // 消すと誰に向けた文だったのか読めなくなる
    expect(renderMentions("<@U999> 確認", names)).toBe("<@U999> 確認");
  });
});
