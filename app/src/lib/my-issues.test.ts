import { describe, expect, it } from "vitest";
import { dueDateWhere, startOfDay, toDueFilter, toRoleFilter } from "./my-issues";

const today = new Date("2026-09-13T15:30:00");

describe("toDueFilter / toRoleFilter", () => {
  it("知らない値は既定に落とす（URLを直接叩かれても壊れない）", () => {
    expect(toDueFilter("nope")).toBe("all");
    expect(toDueFilter(undefined)).toBe("all");
    expect(toRoleFilter("nope")).toBe("assigned");
  });

  it("正しい値はそのまま通す", () => {
    expect(toDueFilter("overdue")).toBe("overdue");
    expect(toDueFilter("within4days")).toBe("within4days");
    expect(toRoleFilter("created")).toBe("created");
  });
});

describe("dueDateWhere", () => {
  it("全てのときは条件を出さない（期限なしのタスクも残す）", () => {
    expect(dueDateWhere("all", today)).toEqual({});
  });

  it("期限切れは今日を含めない", () => {
    const w = dueDateWhere("overdue", today);
    expect(w.dueDate?.lt).toEqual(new Date("2026-09-13T00:00:00"));
    expect(w.dueDate?.lte).toBeUndefined();
  });

  it("今日までは今日を含める", () => {
    expect(dueDateWhere("today", today).dueDate?.lte).toEqual(
      new Date("2026-09-13T00:00:00"),
    );
  });

  it("4日以内は4日後まで", () => {
    expect(dueDateWhere("within4days", today).dueDate?.lte).toEqual(
      new Date("2026-09-17T00:00:00"),
    );
  });

  it("実行時刻に影響されない（同じ日なら同じ境界）", () => {
    const morning = dueDateWhere("today", new Date("2026-09-13T00:01:00"));
    const night = dueDateWhere("today", new Date("2026-09-13T23:59:00"));
    expect(morning).toEqual(night);
  });

  it("月をまたぐ4日以内", () => {
    expect(dueDateWhere("within4days", new Date("2026-09-29T10:00:00")).dueDate?.lte).toEqual(
      new Date("2026-10-03T00:00:00"),
    );
  });
});

describe("startOfDay", () => {
  it("元の Date を壊さない", () => {
    const d = new Date("2026-09-13T15:30:00");
    startOfDay(d);
    expect(d.getHours()).toBe(15);
  });
});
