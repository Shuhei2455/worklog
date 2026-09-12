import { describe, it, expect } from "vitest";
import { describeChanges, summarizeChanges } from "./describe-changes";

const lookups = {
  statuses: new Map([
    [1, "未対応"],
    [2, "処理中"],
    [4, "完了"],
  ]),
  issueTypes: new Map([[2, "バグ"]]),
  users: new Map([
    [1, "管理者"],
    [7, "山田"],
  ]),
  categories: new Map([
    [1, "画面"],
    [2, "DB"],
  ]),
  versions: new Map([[3, "v1.0"]]),
  issues: new Map([[100, "TEST-1"]]),
};

describe("id を名前に解決する", () => {
  it("状態", () => {
    const r = describeChanges([{ field: "statusId", from: "1", to: "2" }], lookups);
    expect(r).toEqual([{ label: "状態", from: "未対応", to: "処理中" }]);
  });

  it("担当者（未設定からの変更）", () => {
    const r = describeChanges([{ field: "assigneeId", from: null, to: "7" }], lookups);
    expect(r).toEqual([{ label: "担当者", from: null, to: "山田" }]);
  });

  it("優先度は定数から引く", () => {
    const r = describeChanges([{ field: "priorityId", from: "3", to: "2" }], lookups);
    expect(r).toEqual([{ label: "優先度", from: "中", to: "高" }]);
  });

  it("完了理由は id=0 も引ける", () => {
    // 完了理由は 0 始まり。0 を falsy として扱うと「対応済み」が消える
    const r = describeChanges([{ field: "resolutionId", from: null, to: "0" }], lookups);
    expect(r).toEqual([{ label: "完了理由", from: null, to: "対応済み" }]);
  });

  it("親課題は課題キーで出す", () => {
    const r = describeChanges([{ field: "parentIssueId", from: null, to: "100" }], lookups);
    expect(r[0].to).toBe("TEST-1");
  });
});

describe("複数値", () => {
  it("カテゴリーは名前を並べる", () => {
    const r = describeChanges([{ field: "categoryIds", from: "1", to: "1,2" }], lookups);
    expect(r).toEqual([{ label: "カテゴリー", from: "画面", to: "画面、DB" }]);
  });

  it("全部外すと未設定になる", () => {
    const r = describeChanges([{ field: "categoryIds", from: "1,2", to: null }], lookups);
    expect(r[0].to).toBeNull();
  });

  it("マイルストーンと発生バージョンは同じ辞書を引く", () => {
    // versions テーブルが両方を兼ねているため
    const a = describeChanges([{ field: "milestoneIds", from: null, to: "3" }], lookups);
    const b = describeChanges([{ field: "versionIds", from: null, to: "3" }], lookups);
    expect(a[0]).toEqual({ label: "マイルストーン", from: null, to: "v1.0" });
    expect(b[0]).toEqual({ label: "発生バージョン", from: null, to: "v1.0" });
  });
});

describe("壊れた入力でも落ちない", () => {
  it("配列でなければ空", () => {
    expect(describeChanges(null)).toEqual([]);
    expect(describeChanges({})).toEqual([]);
    expect(describeChanges("x")).toEqual([]);
  });

  it("field が無い要素は捨てる", () => {
    const r = describeChanges([{ from: "a", to: "b" }, { field: "summary", from: "旧", to: "新" }]);
    expect(r).toHaveLength(1);
  });

  it("未知のフィールドはフィールド名のまま出す", () => {
    // changes は JSONB で後からフィールドが増える。落とさないことが大事
    const r = describeChanges([{ field: "somethingNew", from: "1", to: "2" }]);
    expect(r).toEqual([{ label: "somethingNew", from: "1", to: "2" }]);
  });

  it("辞書に無い id は #id で出す", () => {
    const r = describeChanges([{ field: "statusId", from: "1", to: "99" }], lookups);
    expect(r[0].to).toBe("#99");
  });
});

describe("詳細は中身を出さない", () => {
  it("本家も差分表示しないので、変更があったことだけ示す", () => {
    const r = describeChanges([{ field: "description", from: "長い文章", to: "もっと長い文章" }]);
    expect(r).toEqual([{ label: "詳細", from: "（変更前）", to: "（変更後）" }]);
  });
});

describe("1行にまとめる", () => {
  it("通知の件名で使う形", () => {
    const d = describeChanges(
      [
        { field: "statusId", from: "1", to: "2" },
        { field: "assigneeId", from: null, to: "7" },
      ],
      lookups,
    );
    expect(summarizeChanges(d)).toBe(
      "状態を未対応から処理中に変更、担当者を未設定から山田に変更",
    );
  });

  it("空なら空文字", () => {
    expect(summarizeChanges([])).toBe("");
  });
});
