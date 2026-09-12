import { describe, it, expect } from "vitest";
import { parseIssueKeys, commitCommentBody } from "./commit-link";

describe("parseIssueKeys", () => {
  it("1件拾う", () => {
    expect(parseIssueKeys("AA-1 ログイン画面を直した")).toEqual([
      { key: "AA-1", projectKey: "AA", keyId: 1 },
    ]);
  });

  it("複数あれば全部拾う（決定 D19）", () => {
    const out = parseIssueKeys("AA-1 と BB-23 をまとめて直した。AA-4 も関係する");
    expect(out.map((o) => o.key)).toEqual(["AA-1", "BB-23", "AA-4"]);
  });

  it("同じキーが何度も出ても1件", () => {
    const out = parseIssueKeys("AA-1 を直した\n\nAA-1 の再現手順も書いた");
    expect(out.map((o) => o.key)).toEqual(["AA-1"]);
  });

  it("文中・括弧内・行頭行末でも拾う", () => {
    expect(parseIssueKeys("fix(AA-7): 落ちる").map((o) => o.key)).toEqual(["AA-7"]);
    expect(parseIssueKeys("対応: AA-8").map((o) => o.key)).toEqual(["AA-8"]);
    expect(parseIssueKeys("AA-9\n詳細は後で").map((o) => o.key)).toEqual(["AA-9"]);
  });

  it("アンダースコアを含むプロジェクトキーも拾う（決定 D1 の範囲）", () => {
    expect(parseIssueKeys("A_B2-15 対応").map((o) => o.key)).toEqual(["A_B2-15"]);
  });

  it("小文字のキーは拾わない（プロジェクトキーは英大文字始まり）", () => {
    expect(parseIssueKeys("aa-1 を直した")).toEqual([]);
  });

  it("前後にくっついている文字列は拾わない", () => {
    // ブランチ名やファイル名の一部を課題キーと誤認すると、
    // 関係のない課題にコメントが付いてしまう
    expect(parseIssueKeys("foo-AA-1 を直した")).toEqual([]);
    expect(parseIssueKeys("AA-1x を直した")).toEqual([]);
    expect(parseIssueKeys("AA-1-2 を直した")).toEqual([]);
  });

  it("数字でない・ハイフンが無いものは拾わない", () => {
    expect(parseIssueKeys("AA- を直した")).toEqual([]);
    expect(parseIssueKeys("AA1 を直した")).toEqual([]);
  });

  it("UTF-8 のような字面も形が同じなので拾う（実在判定は呼び出し側）", () => {
    // ここは字面だけを見る関数。キーの形に合うものは全部返し、
    // 実際にその課題があるかはDBを引いて絞る（無ければ何も起きない）。
    // 正規表現側で弾こうとすると、本物のプロジェクトキーまで落としてしまう
    expect(parseIssueKeys("UTF-8 に変えた").map((o) => o.key)).toEqual(["UTF-8"]);
  });

  it("プロジェクトキーの長さ上限(10文字)を超えるものは拾わない", () => {
    expect(parseIssueKeys("ABCDEFGHIJK-1")).toEqual([]);
    expect(parseIssueKeys("ABCDEFGHIJ-1").map((o) => o.key)).toEqual(["ABCDEFGHIJ-1"]);
  });

  it("空のメッセージ", () => {
    expect(parseIssueKeys("")).toEqual([]);
  });
});

describe("commitCommentBody", () => {
  it("出どころの行とメッセージ本文を並べる", () => {
    const body = commitCommentBody("web", "7c96c42abcdef", "AA-1 直した\n\n詳細");
    expect(body).toBe("web に `7c96c42` がプッシュされました。\n\nAA-1 直した\n\n詳細");
  });

  it("URLは埋め込まない（ホスト名が変わると壊れるため）", () => {
    const body = commitCommentBody("web", "abc1234", "修正");
    expect(body).not.toMatch(/https?:\/\//);
  });
});
