import { describe, it, expect } from "vitest";
import {
  parseFieldValue,
  formatFieldValue,
  serializeFieldValue,
  initialDateFor,
  hasItems,
  isMultiSelect,
  CUSTOM_FIELD_TYPE_ID,
  type FieldDef,
} from "./custom-field";

const def = (over: Partial<FieldDef> = {}): FieldDef => ({
  id: 1,
  name: "顧客名",
  typeId: "text",
  required: false,
  settings: {},
  items: [],
  ...over,
});

describe("型の対応", () => {
  it("本家の typeId と一致する（10.1）", () => {
    expect(CUSTOM_FIELD_TYPE_ID).toEqual({
      text: 1,
      sentence: 2,
      number: 3,
      date: 4,
      single_list: 5,
      multiple_list: 6,
      checkbox: 7,
      radio: 8,
    });
  });

  it("選択肢を持つ型と複数選べる型", () => {
    expect(hasItems("single_list")).toBe(true);
    expect(hasItems("radio")).toBe(true);
    expect(hasItems("text")).toBe(false);
    expect(isMultiSelect("multiple_list")).toBe(true);
    expect(isMultiSelect("checkbox")).toBe(true);
    expect(isMultiSelect("single_list")).toBe(false);
    expect(isMultiSelect("radio")).toBe(false);
  });
});

describe("parseFieldValue", () => {
  it("空は未入力として null", () => {
    expect(parseFieldValue(def(), "")).toEqual({ ok: true, value: null });
    expect(parseFieldValue(def(), null)).toEqual({ ok: true, value: null });
    expect(parseFieldValue(def(), [])).toEqual({ ok: true, value: null });
  });

  it("必須なら空を弾く", () => {
    expect(parseFieldValue(def({ required: true }), "")).toEqual({
      ok: false,
      error: "顧客名は必須です",
    });
  });

  it("文字列", () => {
    expect(parseFieldValue(def(), "ヌーラボ")).toEqual({
      ok: true,
      value: { kind: "text", value: "ヌーラボ" },
    });
  });

  it("数値は範囲を見る", () => {
    const f = def({ typeId: "number", settings: { min: 1, max: 10 } });
    expect(parseFieldValue(f, "5")).toEqual({
      ok: true,
      value: { kind: "number", value: 5 },
    });
    expect(parseFieldValue(f, "0").ok).toBe(false);
    expect(parseFieldValue(f, "11").ok).toBe(false);
    expect(parseFieldValue(f, "abc")).toEqual({
      ok: false,
      error: "顧客名は数値で入力してください",
    });
  });

  it("日付は YYYY-MM-DD だけ通す", () => {
    const f = def({ typeId: "date" });
    expect(parseFieldValue(f, "2026-09-13")).toEqual({
      ok: true,
      value: { kind: "date", value: "2026-09-13" },
    });
    // Date.parse は通るが形が違うものは弾く
    expect(parseFieldValue(f, "2026/09/13").ok).toBe(false);
    expect(parseFieldValue(f, "2026-13-99").ok).toBe(false);
  });

  it("日付の範囲", () => {
    const f = def({ typeId: "date", settings: { dateMin: "2026-01-01", dateMax: "2026-12-31" } });
    expect(parseFieldValue(f, "2025-12-31").ok).toBe(false);
    expect(parseFieldValue(f, "2027-01-01").ok).toBe(false);
    expect(parseFieldValue(f, "2026-06-01").ok).toBe(true);
  });

  it("リストは選択肢のIDで持つ", () => {
    const f = def({
      typeId: "single_list",
      items: [
        { id: 11, name: "A社" },
        { id: 12, name: "B社" },
      ],
    });
    expect(parseFieldValue(f, "12")).toEqual({
      ok: true,
      value: { kind: "list", itemIds: [12] },
    });
  });

  it("**他のフィールドの選択肢IDは通さない**", () => {
    // 通すと、別のカスタム属性の選択肢を値にできてしまう
    const f = def({ typeId: "single_list", items: [{ id: 11, name: "A社" }] });
    expect(parseFieldValue(f, "99")).toEqual({
      ok: false,
      error: "顧客名の選択肢が不正です",
    });
  });

  it("単一選択の型に複数送られたら弾く", () => {
    const f = def({
      typeId: "radio",
      items: [
        { id: 1, name: "はい" },
        { id: 2, name: "いいえ" },
      ],
    });
    expect(parseFieldValue(f, ["1", "2"]).ok).toBe(false);
  });

  it("複数リストは複数通る", () => {
    const f = def({
      typeId: "multiple_list",
      items: [
        { id: 1, name: "東京" },
        { id: 2, name: "大阪" },
      ],
    });
    expect(parseFieldValue(f, ["1", "2"])).toEqual({
      ok: true,
      value: { kind: "list", itemIds: [1, 2] },
    });
  });

  it("その他欄は allowInput のときだけ拾う", () => {
    const items = [{ id: 1, name: "東京" }];
    const off = def({ typeId: "single_list", items });
    expect(parseFieldValue(off, "1", "京都")).toEqual({
      ok: true,
      value: { kind: "list", itemIds: [1] },
    });
    const on = def({ typeId: "single_list", items, settings: { allowInput: true } });
    expect(parseFieldValue(on, "1", "京都")).toEqual({
      ok: true,
      value: { kind: "list", itemIds: [1], otherValue: "京都" },
    });
  });
});

describe("formatFieldValue", () => {
  it("数値は単位を付ける", () => {
    const f = def({ typeId: "number", settings: { unit: "円" } });
    expect(formatFieldValue(f, { kind: "number", value: 1200 })).toBe("1200 円");
  });

  it("リストは選択肢名を並べる", () => {
    const f = def({
      typeId: "multiple_list",
      items: [
        { id: 1, name: "東京" },
        { id: 2, name: "大阪" },
      ],
    });
    expect(formatFieldValue(f, { kind: "list", itemIds: [2, 1] })).toBe("大阪, 東京");
  });

  it("消えた選択肢は飛ばす", () => {
    const f = def({ typeId: "single_list", items: [{ id: 1, name: "東京" }] });
    expect(formatFieldValue(f, { kind: "list", itemIds: [99] })).toBe("");
  });

  it("未入力は空文字", () => {
    expect(formatFieldValue(def(), null)).toBe("");
  });
});

describe("serializeFieldValue（決定 D24）", () => {
  it("単一リストはオブジェクト、複数リストは配列", () => {
    const single = def({ typeId: "single_list", items: [{ id: 5, name: "A社" }] });
    expect(serializeFieldValue(single, { kind: "list", itemIds: [5] })).toEqual({
      id: 1,
      fieldTypeId: 5,
      name: "顧客名",
      value: { id: 5, name: "A社" },
    });

    const multi = def({
      typeId: "multiple_list",
      items: [
        { id: 5, name: "A社" },
        { id: 6, name: "B社" },
      ],
    });
    expect(serializeFieldValue(multi, { kind: "list", itemIds: [5, 6] })).toEqual({
      id: 1,
      fieldTypeId: 6,
      name: "顧客名",
      value: [
        { id: 5, name: "A社" },
        { id: 6, name: "B社" },
      ],
    });
  });

  it("未入力は value が null", () => {
    expect(serializeFieldValue(def(), null)).toEqual({
      id: 1,
      fieldTypeId: 1,
      name: "顧客名",
      value: null,
    });
  });
});

describe("initialDateFor（10.1 の initialValueType）", () => {
  const today = new Date("2026-09-13T00:00:00Z");

  it("1=今日", () => {
    expect(initialDateFor({ initialValueType: 1 }, today)).toBe("2026-09-13");
  });

  it("2=今日+シフト", () => {
    expect(initialDateFor({ initialValueType: 2, initialShift: 7 }, today)).toBe(
      "2026-09-20",
    );
    expect(initialDateFor({ initialValueType: 2, initialShift: -3 }, today)).toBe(
      "2026-09-10",
    );
  });

  it("3=指定日", () => {
    expect(
      initialDateFor({ initialValueType: 3, initialDate: "2026-10-01" }, today),
    ).toBe("2026-10-01");
  });

  it("未設定なら初期値なし", () => {
    expect(initialDateFor({}, today)).toBeNull();
  });
});
