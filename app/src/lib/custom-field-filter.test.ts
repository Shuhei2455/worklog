import { describe, expect, it } from "vitest";
import { parseCustomFieldFilters, customFieldWhere } from "./custom-field-filter";

const parse = parseCustomFieldFilters;

describe("parseCustomFieldFilters", () => {
  it("テキストはキーワードとして受ける", () => {
    expect(parse({ customField_1: "ヌーラボ" })).toEqual([
      { fieldId: 1, kind: "text", keyword: "ヌーラボ" },
    ]);
  });

  it("数値は min / max をまとめて範囲にする", () => {
    expect(parse({ customField_2_min: "1000", customField_2_max: "5000" })).toEqual([
      { fieldId: 2, kind: "number", min: 1000, max: 5000 },
    ]);
  });

  it("片側だけの範囲も受ける", () => {
    expect(parse({ customField_2_min: "1000" })).toEqual([
      { fieldId: 2, kind: "number", min: 1000 },
    ]);
    expect(parse({ customField_2_max: "5000" })).toEqual([
      { fieldId: 2, kind: "number", max: 5000 },
    ]);
  });

  it("日付は数値と区別する（ハイフンを含む）", () => {
    expect(parse({ customField_4_min: "2026-09-01", customField_4_max: "2026-09-30" })).toEqual([
      { fieldId: 4, kind: "date", min: "2026-09-01", max: "2026-09-30" },
    ]);
  });

  it("リストは [] 付きで選択肢IDの配列", () => {
    expect(parse({ "customField_3[]": ["10", "11"] })).toEqual([
      { fieldId: 3, kind: "list", itemIds: [10, 11] },
    ]);
  });

  it("[] が無くても、整数だけならリストとして扱う", () => {
    // 本家は customField_3[] だが、[] を付けない実装もあるので拾う
    expect(parse({ customField_3: "12" })).toEqual([
      { fieldId: 3, kind: "list", itemIds: [12] },
    ]);
  });

  it("カンマ区切りでも複数として受ける", () => {
    expect(parse({ "customField_3[]": "10,11,12" })).toEqual([
      { fieldId: 3, kind: "list", itemIds: [10, 11, 12] },
    ]);
  });

  it("複数の属性を同時に指定できる", () => {
    const r = parse({
      customField_1: "ヌーラボ",
      customField_2_min: "1000",
      "customField_3[]": "12",
    });
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.fieldId)).toEqual([1, 2, 3]);
  });

  it("関係ないパラメータは無視する", () => {
    expect(parse({ statusId: "1", keyword: "あ", customFieldFoo: "x" })).toEqual([]);
  });

  it("空の値は条件にしない（フォームの未入力）", () => {
    expect(parse({ customField_1: "", customField_2_min: "  " })).toEqual([]);
  });

  it("壊れた値は落とすが、他の条件は残す", () => {
    const r = parse({ customField_1: "生きてる", "customField_3[]": "abc" });
    // abc はIDにならないのでテキスト扱いに落ちる。1番の条件は残る
    expect(r.some((x) => x.fieldId === 1 && x.kind === "text")).toBe(true);
  });

  it("属性IDの順に並べる（結果を安定させる）", () => {
    const r = parse({ customField_9: "あ", customField_2: "い", customField_5: "う" });
    expect(r.map((x) => x.fieldId)).toEqual([2, 5, 9]);
  });
});

describe("customFieldWhere", () => {
  it("条件ごとに some を分ける（1つにまとめると組み合わせで絞れない）", () => {
    const w = customFieldWhere([
      { fieldId: 1, kind: "text", keyword: "あ" },
      { fieldId: 2, kind: "number", min: 10 },
    ]);
    // 2つの独立した条件になっていること
    expect(w).toHaveLength(2);
    expect(w[0].customFieldValues.some.customFieldId).toBe(1);
    expect(w[1].customFieldValues.some.customFieldId).toBe(2);
  });

  it("テキストは部分一致", () => {
    const w = customFieldWhere([{ fieldId: 1, kind: "text", keyword: "ヌーラボ" }]);
    expect(w[0].customFieldValues.some.value).toEqual({
      path: ["value"],
      string_contains: "ヌーラボ",
    });
  });

  it("数値は gte / lte", () => {
    const w = customFieldWhere([{ fieldId: 2, kind: "number", min: 10, max: 20 }]);
    expect(w[0].customFieldValues.some.value).toEqual({
      path: ["value"],
      gte: 10,
      lte: 20,
    });
  });

  it("片側だけなら片側だけの条件になる", () => {
    const w = customFieldWhere([{ fieldId: 2, kind: "number", min: 10 }]);
    expect(w[0].customFieldValues.some.value).toEqual({ path: ["value"], gte: 10 });
  });

  it("リストは itemIds のいずれかを含む", () => {
    const w = customFieldWhere([{ fieldId: 3, kind: "list", itemIds: [10, 11] }]);
    expect(w[0].customFieldValues.some.OR).toEqual([
      { value: { path: ["itemIds"], array_contains: 10 } },
      { value: { path: ["itemIds"], array_contains: 11 } },
    ]);
  });

  it("条件が無ければ空", () => {
    expect(customFieldWhere([])).toEqual([]);
  });
});
