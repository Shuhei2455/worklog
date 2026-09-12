import { z } from "zod";
import type { CustomFieldType } from "@prisma/client";

/**
 * カスタム属性。
 *
 * 型は8種（00-spec-verified.md 10.1 で確認済み）。型ごとに追加パラメータが
 * あり、カラムを生やすと8型ぶん散らかるので `settings` の JSONB にまとめてある。
 * 値も `issue_custom_field_values.value` の JSONB。
 *
 * **検証はここに集約する。** 画面・API・CSV取り込みの3か所から同じ値を
 * 受けるので、型ごとの判定が散ると必ず食い違う。
 */

/** 内部の型 → 本家の typeId（10.1） */
export const CUSTOM_FIELD_TYPE_ID: Record<CustomFieldType, number> = {
  text: 1,
  sentence: 2,
  number: 3,
  date: 4,
  single_list: 5,
  multiple_list: 6,
  checkbox: 7,
  radio: 8,
};

export const CUSTOM_FIELD_TYPE_BY_ID = new Map<number, CustomFieldType>(
  Object.entries(CUSTOM_FIELD_TYPE_ID).map(([k, v]) => [v, k as CustomFieldType]),
);

/** 画面に出す日本語 */
export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "文字列",
  sentence: "文章",
  number: "数値",
  date: "日付",
  single_list: "リスト",
  multiple_list: "複数リスト",
  checkbox: "チェックボックス",
  radio: "ラジオ",
};

/** 選択肢を持つ型。項目の管理UIを出すかの判定に使う */
export function hasItems(type: CustomFieldType): boolean {
  return (
    type === "single_list" ||
    type === "multiple_list" ||
    type === "checkbox" ||
    type === "radio"
  );
}

/** 複数選べる型 */
export function isMultiSelect(type: CustomFieldType): boolean {
  return type === "multiple_list" || type === "checkbox";
}

/**
 * 型ごとの追加パラメータ（10.1）。
 *
 * 本家の `min` `max` `initialValue` `unit` などに名前を合わせる。
 * 未指定のものは持たない（null を詰めない）。
 */
export const settingsSchema = z
  .object({
    // 数値型
    min: z.number().nullish(),
    max: z.number().nullish(),
    initialValue: z.number().nullish(),
    unit: z.string().nullish(),
    // 日付型。min/max は上と共用できないので別名にする
    dateMin: z.string().nullish(),
    dateMax: z.string().nullish(),
    /** 1=今日 / 2=今日+initialShift / 3=指定日 */
    initialValueType: z.number().int().min(1).max(3).nullish(),
    initialDate: z.string().nullish(),
    initialShift: z.number().int().nullish(),
    // リスト型
    allowAddItem: z.boolean().nullish(),
    allowInput: z.boolean().nullish(),
  })
  .partial();

export type CustomFieldSettings = z.infer<typeof settingsSchema>;

export type FieldDef = {
  id: number;
  name: string;
  typeId: CustomFieldType;
  required: boolean;
  settings: CustomFieldSettings;
  items: Array<{ id: number; name: string }>;
};

/** 保存する値の形。リスト系は選択肢のIDで持つ（名前を変えても値が追随する） */
export type FieldValue =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "date"; value: string }
  | { kind: "list"; itemIds: number[]; otherValue?: string };

export type ParseResult =
  | { ok: true; value: FieldValue | null }
  | { ok: false; error: string };

/**
 * 入力された文字列を、保存する形に直す。
 *
 * 空文字は「未入力」として null を返す（必須なら呼び出し側で弾く）。
 * **選択肢のIDは、そのカスタム属性に属するものだけを通す。**
 * 他のフィールドの選択肢IDを送られても通してはいけない。
 */
export function parseFieldValue(
  field: FieldDef,
  raw: string | string[] | null | undefined,
  otherValue?: string | null,
): ParseResult {
  const values = Array.isArray(raw) ? raw.filter((v) => v !== "") : raw ? [raw] : [];

  if (values.length === 0) {
    if (field.required) return { ok: false, error: `${field.name}は必須です` };
    return { ok: true, value: null };
  }

  switch (field.typeId) {
    case "text":
    case "sentence": {
      const v = values[0];
      return { ok: true, value: { kind: "text", value: v } };
    }

    case "number": {
      const n = Number(values[0]);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `${field.name}は数値で入力してください` };
      }
      const { min, max } = field.settings;
      if (min != null && n < min) {
        return { ok: false, error: `${field.name}は ${min} 以上にしてください` };
      }
      if (max != null && n > max) {
        return { ok: false, error: `${field.name}は ${max} 以下にしてください` };
      }
      return { ok: true, value: { kind: "number", value: n } };
    }

    case "date": {
      const v = values[0];
      // YYYY-MM-DD だけを受ける。Date にパースできても形が違うものは弾く
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
        return { ok: false, error: `${field.name}は YYYY-MM-DD で入力してください` };
      }
      const { dateMin, dateMax } = field.settings;
      if (dateMin && v < dateMin) {
        return { ok: false, error: `${field.name}は ${dateMin} 以降にしてください` };
      }
      if (dateMax && v > dateMax) {
        return { ok: false, error: `${field.name}は ${dateMax} 以前にしてください` };
      }
      return { ok: true, value: { kind: "date", value: v } };
    }

    default: {
      // リスト系。値は選択肢のID
      const allowed = new Set(field.items.map((i) => i.id));
      const ids: number[] = [];
      for (const v of values) {
        const n = Number(v);
        // そのフィールドの選択肢でなければ通さない
        if (!Number.isInteger(n) || !allowed.has(n)) {
          return { ok: false, error: `${field.name}の選択肢が不正です` };
        }
        ids.push(n);
      }
      if (!isMultiSelect(field.typeId) && ids.length > 1) {
        return { ok: false, error: `${field.name}は1つだけ選んでください` };
      }
      const other = field.settings.allowInput ? (otherValue?.trim() || undefined) : undefined;
      return { ok: true, value: { kind: "list", itemIds: ids, otherValue: other } };
    }
  }
}

/** 保存した値を画面用の文字列にする */
export function formatFieldValue(field: FieldDef, value: unknown): string {
  const v = value as FieldValue | null;
  if (!v) return "";

  switch (v.kind) {
    case "text":
      return v.value;
    case "number":
      return field.settings.unit ? `${v.value} ${field.settings.unit}` : String(v.value);
    case "date":
      return v.value;
    case "list": {
      const names = v.itemIds
        .map((id) => field.items.find((i) => i.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      if (v.otherValue) names.push(v.otherValue);
      return names.join(", ");
    }
  }
}

/**
 * APIで返す形（決定 D24）。
 *
 * 本家のレスポンス例が空配列で中身が分からないため、こちらで決めた形。
 * `fieldTypeId` という名前は本家の他の箇所（`issueTypeId` など）に合わせた。
 */
export function serializeFieldValue(field: FieldDef, value: unknown) {
  const v = value as FieldValue | null;
  const base = {
    id: field.id,
    fieldTypeId: CUSTOM_FIELD_TYPE_ID[field.typeId],
    name: field.name,
  };

  if (!v) return { ...base, value: null };

  if (v.kind === "list") {
    const items = v.itemIds
      .map((id) => field.items.find((i) => i.id === id))
      .filter((i): i is { id: number; name: string } => Boolean(i))
      .map((i) => ({ id: i.id, name: i.name }));
    return {
      ...base,
      value: isMultiSelect(field.typeId) ? items : (items[0] ?? null),
      ...(v.otherValue ? { otherValue: v.otherValue } : {}),
    };
  }

  return { ...base, value: v.value };
}

/**
 * 日付型の初期値を求める（10.1 の initialValueType）。
 *
 * 1=今日 / 2=今日+initialShift / 3=指定日。
 */
export function initialDateFor(
  settings: CustomFieldSettings,
  today = new Date(),
): string | null {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  switch (settings.initialValueType) {
    case 1:
      return iso(today);
    case 2: {
      const d = new Date(today);
      d.setDate(d.getDate() + (settings.initialShift ?? 0));
      return iso(d);
    }
    case 3:
      return settings.initialDate ?? null;
    default:
      return null;
  }
}
