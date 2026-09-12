import { describe, it, expect } from "vitest";
import { pullRequestQuery, pullRequestWhere } from "./pull-request-filter";

const q = (s: string) => pullRequestQuery(new URLSearchParams(s));

describe("pullRequestQuery", () => {
  it("既定値は count=20 / offset=0", () => {
    expect(q("")).toEqual({
      statusId: [],
      assigneeId: [],
      issueId: [],
      createdUserId: [],
      offset: 0,
      count: 20,
    });
  });

  it("本家の配列記法 name[] を受ける", () => {
    expect(q("statusId[]=1&statusId[]=3").statusId).toEqual([1, 3]);
  });

  it("括弧なしの name も受ける", () => {
    expect(q("issueId=5").issueId).toEqual([5]);
  });

  it("count は 1〜100 に収める", () => {
    expect(q("count=1").count).toBe(1);
    expect(q("count=100").count).toBe(100);
    expect(q("count=101").count).toBe(20); // 範囲外は既定値に落とす
    expect(q("count=0").count).toBe(20);
  });

  it("壊れた値は**その項目だけ**既定値に落ちる（M1のバグの再発防止）", () => {
    // 1つ壊れた値で全部の条件が消えると、見えてはいけないものが出る
    const out = q("statusId[]=abc&issueId[]=7&count=xyz");
    expect(out.statusId).toEqual([]);
    expect(out.issueId).toEqual([7]);
    expect(out.count).toBe(20);
  });
});

describe("pullRequestWhere", () => {
  it("リポジトリだけで絞る", () => {
    expect(pullRequestWhere(3, q(""))).toEqual({ repositoryId: 3 });
  });

  it("statusId を内部の文字列に戻す（決定 D20 の逆写像）", () => {
    expect(pullRequestWhere(3, q("statusId[]=1"))).toEqual({
      repositoryId: 3,
      state: { in: ["open"] },
    });
    expect(pullRequestWhere(3, q("statusId[]=2&statusId[]=3"))).toEqual({
      repositoryId: 3,
      state: { in: ["closed", "merged"] },
    });
  });

  it("知らない statusId は条件にしない（全部返す）", () => {
    expect(pullRequestWhere(3, q("statusId[]=9"))).toEqual({ repositoryId: 3 });
  });

  it("担当者・課題・作成者で絞る", () => {
    expect(
      pullRequestWhere(3, q("assigneeId[]=2&issueId[]=10&createdUserId[]=1")),
    ).toEqual({
      repositoryId: 3,
      assigneeId: { in: [2] },
      issueId: { in: [10] },
      createdById: { in: [1] },
    });
  });

  it("リポジトリの条件は必ず残る（他リポジトリのPRが混ざらない）", () => {
    const where = pullRequestWhere(42, q("statusId[]=1&assigneeId[]=2"));
    expect(where.repositoryId).toBe(42);
  });
});
