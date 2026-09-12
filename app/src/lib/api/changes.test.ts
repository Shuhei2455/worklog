import { describe, it, expect } from "vitest";
import { toBacklogChanges } from "./changes";

/**
 * 本家の形は `[{ field, new_value, old_value, type }]`
 * （00-spec-verified.md 9.4。Get Project Recent Updates のレスポンス例で確認）。
 * ここがずれると、本家向けに作られた webhook の受け側が動かない。
 */
describe("toBacklogChanges", () => {
  it("キー名を本家の形に直す", () => {
    expect(toBacklogChanges([{ field: "statusId", from: "1", to: "3" }])).toEqual([
      { field: "status", new_value: "3", old_value: "1", type: "standard" },
    ]);
  });

  it("未設定は null ではなく空文字で出す", () => {
    expect(
      toBacklogChanges([{ field: "assigneeId", from: null, to: "5" }]),
    ).toEqual([
      { field: "assignee", new_value: "5", old_value: "", type: "standard" },
    ]);
    expect(
      toBacklogChanges([{ field: "dueDate", from: "2026-09-01", to: null }]),
    ).toEqual([
      { field: "dueDate", new_value: "", old_value: "2026-09-01", type: "standard" },
    ]);
  });

  it("複数項目の順序を保つ", () => {
    const out = toBacklogChanges([
      { field: "summary", from: "前", to: "後" },
      { field: "milestoneIds", from: null, to: "2" },
    ]);
    expect(out.map((c) => c.field)).toEqual(["summary", "milestone"]);
  });

  it("知らないフィールドは内部名のまま出す（黙って落とさない）", () => {
    expect(
      toBacklogChanges([{ field: "customField_7", from: "a", to: "b" }]),
    ).toEqual([
      { field: "customField_7", new_value: "b", old_value: "a", type: "standard" },
    ]);
  });

  it("changes が無い活動では空配列", () => {
    expect(toBacklogChanges(null)).toEqual([]);
    expect(toBacklogChanges(undefined)).toEqual([]);
    // JSONB に "null" が入っている行が実際にある
    expect(toBacklogChanges("null")).toEqual([]);
    expect(toBacklogChanges([])).toEqual([]);
  });

  it("壊れた要素は飛ばす", () => {
    expect(
      toBacklogChanges([null, { field: "statusId", from: "1", to: "2" }, 42]),
    ).toEqual([{ field: "status", new_value: "2", old_value: "1", type: "standard" }]);
  });
});
