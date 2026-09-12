import {
  hasItems,
  isMultiSelect,
  initialDateFor,
  formatFieldValue,
  type FieldDef,
} from "@/lib/custom-field";

/**
 * カスタム属性の入力欄。
 *
 * 課題の追加画面と詳細画面の両方で使う。名前は本家と同じ
 * `customField_{id}` / `customField_{id}_otherValue`（11.1）にしてあるので、
 * フォームの中身をそのまま API に投げても通る。
 */
export function CustomFieldInputs({
  fields,
  values,
}: {
  fields: Array<FieldDef & { description: string | null }>;
  /** 既存の値（更新時）。{ カスタム属性のid: 保存されている値 } */
  values?: Record<number, unknown>;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const name = `customField_${f.id}`;
        const current = values?.[f.id] as
          | { kind: string; value?: unknown; itemIds?: number[]; otherValue?: string }
          | undefined;

        return (
          <div key={f.id}>
            <label className="block text-sm">
              <span className="text-xs text-slate-500">
                {f.name}
                {f.required && <span className="ml-1 text-red-600">*</span>}
              </span>
              {f.description && (
                <span className="ml-2 text-xs text-slate-400">{f.description}</span>
              )}

              {f.typeId === "sentence" ? (
                <textarea
                  name={name}
                  rows={3}
                  required={f.required}
                  defaultValue={(current?.value as string) ?? ""}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              ) : f.typeId === "text" ? (
                <input
                  name={name}
                  required={f.required}
                  defaultValue={(current?.value as string) ?? ""}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              ) : f.typeId === "number" ? (
                <span className="mt-1 flex items-center gap-1">
                  <input
                    name={name}
                    type="number"
                    step="any"
                    required={f.required}
                    min={f.settings.min ?? undefined}
                    max={f.settings.max ?? undefined}
                    defaultValue={
                      (current?.value as number | undefined) ??
                      f.settings.initialValue ??
                      ""
                    }
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  {f.settings.unit && (
                    <span className="text-xs text-slate-500">{f.settings.unit}</span>
                  )}
                </span>
              ) : f.typeId === "date" ? (
                <input
                  name={name}
                  type="date"
                  required={f.required}
                  min={f.settings.dateMin ?? undefined}
                  max={f.settings.dateMax ?? undefined}
                  defaultValue={
                    (current?.value as string | undefined) ??
                    initialDateFor(f.settings) ??
                    ""
                  }
                  className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              ) : isMultiSelect(f.typeId) ? (
                // 複数リストとチェックボックス。同名で複数送る
                <span className="mt-1 flex flex-wrap gap-3">
                  {f.items.map((i) => (
                    <label key={i.id} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        name={name}
                        value={i.id}
                        defaultChecked={current?.itemIds?.includes(i.id) ?? false}
                      />
                      {i.name}
                    </label>
                  ))}
                </span>
              ) : f.typeId === "radio" ? (
                <span className="mt-1 flex flex-wrap gap-3">
                  {f.items.map((i) => (
                    <label key={i.id} className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name={name}
                        value={i.id}
                        required={f.required}
                        defaultChecked={current?.itemIds?.includes(i.id) ?? false}
                      />
                      {i.name}
                    </label>
                  ))}
                </span>
              ) : (
                // リスト（単一選択）
                <select
                  name={name}
                  required={f.required}
                  defaultValue={current?.itemIds?.[0] ?? ""}
                  className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="">未選択</option>
                  {f.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              )}
            </label>

            {/* 「その他」の自由入力。許可されている型だけ出す */}
            {hasItems(f.typeId) && f.settings.allowInput && (
              <label className="mt-1 block text-sm">
                <span className="text-xs text-slate-400">その他</span>
                <input
                  name={`${name}_otherValue`}
                  defaultValue={current?.otherValue ?? ""}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 読み取り専用の表示。課題の属性一覧に並べる */
export function CustomFieldValues({
  fields,
  values,
}: {
  fields: FieldDef[];
  values: Record<number, unknown>;
}) {
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((f) => (
        <div
          key={f.id}
          className="flex justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0"
        >
          <dt className="text-xs text-slate-500">{f.name}</dt>
          <dd className="text-right">
            {formatFieldValue(f, values[f.id] ?? null) || "未設定"}
          </dd>
        </div>
      ))}
    </>
  );
}
