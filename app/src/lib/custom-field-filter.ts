/**
 * カスタム属性での絞り込み。
 *
 * 本家の仕様（2026-09-17 に一次情報で確認。docs/00-spec-verified.md 2.2）:
 *
 * | 型 | パラメータ | 値 |
 * |---|---|---|
 * | テキスト(1) / 文章(2) | `customField_${id}` | キーワード |
 * | 数値(3) | `customField_${id}_min` / `_max` | 数値 |
 * | 日付(4) | `customField_${id}_min` / `_max` | 日付 |
 * | リスト(5) / 複数リスト(6) | `customField_${id}[]` | 選択肢のID |
 *
 * **チェックボックス(7)とラジオ(8)は公式に記載が無い**（`TODO(要確認)`）。
 * どちらも選択肢を持つのでリストと同じ形で受けるが、確認できていない。
 *
 * パラメータ名が動的なので、`issueFilterSchema`（固定のzodオブジェクト）では
 * 受けられない。ここで別に切り出す。
 */

export type CustomFieldFilter =
  /** テキスト。キーワードでの部分一致 */
  | { fieldId: number; kind: "text"; keyword: string }
  /** 数値の範囲。min か max のどちらかだけでもよい */
  | { fieldId: number; kind: "number"; min?: number; max?: number }
  /** 日付の範囲。値は `YYYY-MM-DD` のまま持つ（保存も文字列のため） */
  | { fieldId: number; kind: "date"; min?: string; max?: string }
  /** 選択肢のID。いずれかに当たれば該当 */
  | { fieldId: number; kind: "list"; itemIds: number[] };

/** `customField_12` `customField_12_min` `customField_12[]` を分解する */
const PARAM_RE = /^customField_(\d+)(?:_(min|max))?(\[\])?$/;

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(","));
}

/**
 * URLクエリからカスタム属性の条件を取り出す。
 *
 * **壊れた値は黙って落とす。** 他の条件と同じ扱いにする
 * （1つ壊れているだけで一覧が出ないのは実用的でない）。
 *
 * 型は値の形から決める。`_min`/`_max` が付いていれば範囲、
 * 数値に見えれば数値の範囲、そうでなければ日付として扱う。
 * リストは `[]` が付くか、値が全部整数のとき。
 */
export function parseCustomFieldFilters(
  params: Record<string, string | string[] | undefined>,
): CustomFieldFilter[] {
  // 同じ属性の min と max は1つにまとめる
  const ranges = new Map<number, { min?: string; max?: string }>();
  const out: CustomFieldFilter[] = [];

  for (const [key, raw] of Object.entries(params)) {
    const m = PARAM_RE.exec(key);
    if (!m) continue;
    const fieldId = Number(m[1]);
    const bound = m[2] as "min" | "max" | undefined;
    const isArrayParam = Boolean(m[3]);
    const values = asArray(raw).map((v) => v.trim()).filter((v) => v !== "");
    if (values.length === 0) continue;

    if (bound) {
      const r = ranges.get(fieldId) ?? {};
      r[bound] = values[0];
      ranges.set(fieldId, r);
      continue;
    }

    // `[]` 付き、または値が全部整数ならリストの選択肢IDとみなす。
    // 本家は `customField_${id}[]` だが、`[]` を付けずに送る実装もあるので拾う
    const allInts = values.every((v) => /^\d+$/.test(v));
    if (isArrayParam || (allInts && values.length > 0)) {
      const itemIds = values.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (itemIds.length > 0) {
        out.push({ fieldId, kind: "list", itemIds });
        continue;
      }
    }
    out.push({ fieldId, kind: "text", keyword: values[0] });
  }

  for (const [fieldId, r] of ranges) {
    const nMin = r.min !== undefined ? Number(r.min) : undefined;
    const nMax = r.max !== undefined ? Number(r.max) : undefined;
    const numeric =
      (r.min === undefined || (r.min !== "" && !Number.isNaN(nMin))) &&
      (r.max === undefined || (r.max !== "" && !Number.isNaN(nMax)));
    // 日付は `2026-09-01` のようにハイフンを含む。数値には見えない
    const looksDate = [r.min, r.max].some((v) => v !== undefined && /\d{4}-\d{2}-\d{2}/.test(v));
    if (looksDate || !numeric) {
      const f: CustomFieldFilter = { fieldId, kind: "date" };
      if (r.min !== undefined) f.min = r.min;
      if (r.max !== undefined) f.max = r.max;
      out.push(f);
    } else {
      const f: CustomFieldFilter = { fieldId, kind: "number" };
      if (nMin !== undefined) f.min = nMin;
      if (nMax !== undefined) f.max = nMax;
      out.push(f);
    }
  }

  return out.sort((a, b) => a.fieldId - b.fieldId);
}

/**
 * Prisma の `where` 断片に変換する。
 *
 * **条件ごとに `some` を重ねる。** 1つの `some` に全部入れると
 * 「どれか1行が全条件を満たす」になってしまい、
 * 属性Aと属性Bの組み合わせで絞れない（別々の行に入っているため）。
 */
export function customFieldWhere(filters: CustomFieldFilter[]) {
  return filters.map((f) => {
    switch (f.kind) {
      case "text":
        return {
          customFieldValues: {
            some: {
              customFieldId: f.fieldId,
              // JSONB の `value.value` に対する部分一致。
              // 本家は「キーワード」としか書いていない（2.2 の TODO）
              value: { path: ["value"], string_contains: f.keyword },
            },
          },
        };
      case "number":
        return {
          customFieldValues: {
            some: {
              customFieldId: f.fieldId,
              value: {
                path: ["value"],
                ...(f.min !== undefined ? { gte: f.min } : {}),
                ...(f.max !== undefined ? { lte: f.max } : {}),
              },
            },
          },
        };
      case "date":
        return {
          customFieldValues: {
            some: {
              customFieldId: f.fieldId,
              // 日付は `YYYY-MM-DD` の文字列で保存しているので、
              // 辞書順の比較がそのまま日付の前後になる
              value: {
                path: ["value"],
                ...(f.min !== undefined ? { gte: f.min } : {}),
                ...(f.max !== undefined ? { lte: f.max } : {}),
              },
            },
          },
        };
      case "list":
        return {
          customFieldValues: {
            some: {
              customFieldId: f.fieldId,
              // itemIds は配列。いずれかを含むか見る
              OR: f.itemIds.map((id) => ({
                value: { path: ["itemIds"], array_contains: id },
              })),
            },
          },
        };
    }
  });
}
