import { describe, it, expect } from "vitest";
import { layoutCommits } from "./git-graph";

/**
 * 枝の配置は目で見て確かめにくい。形の分かっている履歴を作って突き合わせる。
 *
 * 入力は新しい順（APIが返す順）。
 */

describe("一直線の履歴", () => {
  it("全部おなじ列に乗る", () => {
    const rows = layoutCommits([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.width === 1)).toBe(true);
  });

  it("最初のコミットで列が閉じる", () => {
    const rows = layoutCommits([{ sha: "a", parents: [] }]);
    expect(rows[0].edges).toEqual([]);
  });
});

describe("マージ", () => {
  //   m      ← 2つの親を持つ
  //   |\
  //   | f    ← 枝
  //   b |
  //   |/
  //   a
  const history = [
    { sha: "m", parents: ["b", "f"] },
    { sha: "f", parents: ["a"] },
    { sha: "b", parents: ["a"] },
    { sha: "a", parents: [] },
  ];

  it("マージは別の列へ線を出す", () => {
    const rows = layoutCommits(history);
    const m = rows[0];
    expect(m.lane).toBe(0);
    // 第1親は同じ列、第2親は新しい列
    expect(m.edges).toEqual([
      { from: 0, to: 0 },
      { from: 0, to: 1 },
    ]);
    expect(m.width).toBe(2);
  });

  it("枝は自分の列に乗る", () => {
    const rows = layoutCommits(history);
    expect(rows.find((r) => r.sha === "f")!.lane).toBe(1);
    expect(rows.find((r) => r.sha === "b")!.lane).toBe(0);
  });

  it("合流したら列を使い回す", () => {
    // f と b の親はどちらも a。a の行では1列に集約されている
    const rows = layoutCommits(history);
    const a = rows.find((r) => r.sha === "a")!;
    expect(a.activeLanes).toEqual([a.lane]);
    expect(a.width).toBe(1);
  });
});

describe("列の使い回し", () => {
  it("閉じた列は次の枝が再利用する", () => {
    //  d        lane0
    //  c        lane0   ← b(lane1) はここで閉じている
    //  |
    //  b        lane1
    //  a        lane0
    const rows = layoutCommits([
      { sha: "d", parents: ["c"] },
      { sha: "c", parents: ["a"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    // b は c と繋がらない独立した枝なので、空いている列に乗る
    expect(rows.find((r) => r.sha === "b")!.lane).toBe(1);
    // a で合流して1列に戻る
    expect(rows.find((r) => r.sha === "a")!.width).toBe(1);
  });

  it("枝が増えても列は青天井に増えない", () => {
    // 同じ親を持つ枝が3本。合流後は1列に戻る
    const rows = layoutCommits([
      { sha: "x", parents: ["root"] },
      { sha: "y", parents: ["root"] },
      { sha: "z", parents: ["root"] },
      { sha: "root", parents: [] },
    ]);
    expect(Math.max(...rows.map((r) => r.width))).toBeLessThanOrEqual(3);
    expect(rows.find((r) => r.sha === "root")!.width).toBe(1);
  });
});

describe("履歴の途中で切れている場合", () => {
  it("親が一覧に無くても落ちない（ページングの末尾）", () => {
    const rows = layoutCommits([
      { sha: "b", parents: ["a"] },
      // a は次のページにある
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].edges).toEqual([{ from: 0, to: 0 }]);
  });

  it("空の入力", () => {
    expect(layoutCommits([])).toEqual([]);
  });
});
