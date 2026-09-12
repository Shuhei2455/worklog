import { describe, it, expect } from "vitest";
import {
  parseIssueFilter,
  buildIssueWhere,
  buildIssueOrderBy,
  DEFAULT_SORT,
  DEFAULT_COUNT,
  PARENT_CHILD,
} from "./issue-filter";

/** 参加しているプロジェクト */
const VISIBLE = [1, 2, 3];
const f = (params: Record<string, string | string[] | undefined> = {}) =>
  parseIssueFilter(params);

describe("パラメータの正規化", () => {
  it("空でも既定値が入る", () => {
    const p = f();
    expect(p.sort).toBe(DEFAULT_SORT);
    expect(p.order).toBe("desc");
    expect(p.count).toBe(DEFAULT_COUNT);
    expect(p.offset).toBe(0);
  });

  it("カンマ区切りでも配列でも数値配列になる", () => {
    expect(f({ statusId: "1,2,3" }).statusId).toEqual([1, 2, 3]);
    expect(f({ statusId: ["1", "2"] }).statusId).toEqual([1, 2]);
  });

  it("数値でない値は捨てる", () => {
    expect(f({ statusId: "1,abc,3" }).statusId).toEqual([1, 3]);
  });

  it("count は 100 までに丸める", () => {
    // 上限超えは zod が弾き、既定に寄る
    expect(f({ count: "500" }).count).toBe(DEFAULT_COUNT);
    expect(f({ count: "50" }).count).toBe(50);
  });

  it("未知の sort は既定に寄る", () => {
    expect(f({ sort: "nonsense" }).sort).toBe(DEFAULT_SORT);
  });

  it("壊れた日付は無視する", () => {
    expect(f({ dueDateSince: "not-a-date" }).dueDateSince).toBeUndefined();
    expect(f({ dueDateSince: "2026-01-31" }).dueDateSince).toBeInstanceOf(Date);
  });
});

describe("権限条件の注入", () => {
  it("プロジェクト指定が無ければ参加中のプロジェクトだけになる", () => {
    const w = buildIssueWhere(f(), VISIBLE);
    expect(w.projectId).toEqual({ in: VISIBLE });
  });

  it("未参加のプロジェクトを指定しても混ざらない", () => {
    // 9 は参加していない
    const w = buildIssueWhere(f({ projectId: "2,9" }), VISIBLE);
    expect(w.projectId).toEqual({ in: [2] });
  });

  it("参加が0件なら何も出ない", () => {
    const w = buildIssueWhere(f(), []);
    expect(w.projectId).toEqual({ in: [] });
  });
});

describe("条件の組み立て", () => {
  it("スカラー条件は in で入る", () => {
    const w = buildIssueWhere(f({ statusId: "1,2", priorityId: "2" }), VISIBLE);
    expect(w.statusId).toEqual({ in: [1, 2] });
    expect(w.priorityId).toEqual({ in: [2] });
  });

  it("多対多は中間テーブル越しに絞る", () => {
    const w = buildIssueWhere(
      f({ categoryId: "5", milestoneId: "7", versionId: "8" }),
      VISIBLE,
    );
    expect(w.categories).toEqual({ some: { categoryId: { in: [5] } } });
    expect(w.milestones).toEqual({ some: { versionId: { in: [7] } } });
    expect(w.versions).toEqual({ some: { versionId: { in: [8] } } });
  });

  it("担当者に 0 を混ぜると未割り当ても含む", () => {
    const w = buildIssueWhere(f({ assigneeId: "0,4" }), VISIBLE);
    expect(w.OR).toEqual([{ assigneeId: { in: [4] } }, { assigneeId: null }]);
  });

  it("担当者が 0 だけなら未割り当てのみ", () => {
    const w = buildIssueWhere(f({ assigneeId: "0" }), VISIBLE);
    expect(w.assigneeId).toBeNull();
  });

  it("日付は範囲に畳まれる", () => {
    const w = buildIssueWhere(
      f({ dueDateSince: "2026-01-01", dueDateUntil: "2026-01-31" }),
      VISIBLE,
    );
    expect(w.dueDate).toHaveProperty("gte");
    expect(w.dueDate).toHaveProperty("lte");
  });

  it("片側だけの日付も効く", () => {
    const w = buildIssueWhere(f({ createdSince: "2026-01-01" }), VISIBLE);
    expect(w.createdAt).toHaveProperty("gte");
    expect(w.createdAt).not.toHaveProperty("lte");
  });
});

describe("parentChild の5パターン", () => {
  it("0=すべて は条件を足さない", () => {
    const w = buildIssueWhere(f({ parentChild: String(PARENT_CHILD.all) }), VISIBLE);
    expect(w.parentIssueId).toBeUndefined();
    expect(w.children).toBeUndefined();
  });

  it("1=子課題のみ", () => {
    const w = buildIssueWhere(f({ parentChild: "1" }), VISIBLE);
    expect(w.parentIssueId).toEqual({ not: null });
  });

  it("2=親課題のみ", () => {
    const w = buildIssueWhere(f({ parentChild: "2" }), VISIBLE);
    expect(w.children).toEqual({ some: {} });
  });

  it("3=子課題以外", () => {
    const w = buildIssueWhere(f({ parentChild: "3" }), VISIBLE);
    expect(w.parentIssueId).toBeNull();
  });

  it("4=子課題を持たない", () => {
    const w = buildIssueWhere(f({ parentChild: "4" }), VISIBLE);
    expect(w.children).toEqual({ none: {} });
  });
});

describe("添付・共有ファイルの有無", () => {
  it("あり", () => {
    const w = buildIssueWhere(f({ attachment: "true" }), VISIBLE);
    expect(w.attachments).toEqual({ some: {} });
  });
  it("なし", () => {
    const w = buildIssueWhere(f({ attachment: "false" }), VISIBLE);
    expect(w.attachments).toEqual({ none: {} });
  });
  it("未指定なら条件を足さない", () => {
    const w = buildIssueWhere(f(), VISIBLE);
    expect(w.attachments).toBeUndefined();
  });
});

describe("キーワード", () => {
  it("Meilisearch のID が来たらそれで絞る", () => {
    const w = buildIssueWhere(f({ keyword: "バグ" }), VISIBLE, [10, 11]);
    expect(w.id).toEqual({ in: [10, 11] });
    expect(w.AND).toBeUndefined();
  });

  it("ID が無いときは件名と詳細の部分一致にフォールバックする", () => {
    const w = buildIssueWhere(f({ keyword: "バグ" }), VISIBLE);
    expect(w.AND).toBeDefined();
    expect(w.id).toBeUndefined();
  });
});

describe("並び替え", () => {
  it("既定は updated の降順", () => {
    expect(buildIssueOrderBy(f())).toEqual([{ updatedAt: "desc" }, { id: "desc" }]);
  });

  it("sort と order が反映される", () => {
    expect(buildIssueOrderBy(f({ sort: "dueDate", order: "asc" }))).toEqual([
      { dueDate: "asc" },
      { id: "asc" },
    ]);
  });

  it("同値でぶれないよう必ず一意キーを最後に足す", () => {
    // ページングで取りこぼさないために必要
    for (const sort of ["summary", "status", "priority", "assignee"]) {
      const ob = buildIssueOrderBy(f({ sort }));
      expect(ob[ob.length - 1]).toEqual({ id: "desc" });
    }
  });
});
