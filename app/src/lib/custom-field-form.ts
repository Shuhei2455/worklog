import { prisma } from "@/lib/db";
import {
  parseFieldValue,
  type FieldDef,
  type CustomFieldSettings,
} from "@/lib/custom-field";

/**
 * フォーム（または API のパラメータ）からカスタム属性の値を読み取る。
 *
 * **画面・API・CSV取り込みの3経路が同じここを通る。** 検証が散ると、
 * 画面では弾かれるのに API からは入る、という食い違いが起きる。
 *
 * 受け取る名前は本家と同じ `customField_{id}` と
 * `customField_{id}_otherValue`（00-spec-verified.md 11.1）。
 */

export type FieldDefWithMeta = FieldDef & {
  description: string | null;
  applicableIssueTypes: number[];
  displayOrder: number;
};

/** プロジェクトのカスタム属性の定義を読む */
export async function loadFieldDefs(projectId: number): Promise<FieldDefWithMeta[]> {
  const fields = await prisma.customField.findMany({
    where: { projectId },
    include: { items: { orderBy: { displayOrder: "asc" } } },
    orderBy: { displayOrder: "asc" },
  });

  return fields.map((f) => ({
    id: f.id,
    name: f.name,
    typeId: f.typeId,
    required: f.required,
    settings: (f.settings ?? {}) as CustomFieldSettings,
    items: f.items.map((i) => ({ id: i.id, name: i.name })),
    description: f.description,
    applicableIssueTypes: f.applicableIssueTypes,
    displayOrder: f.displayOrder,
  }));
}

/** その課題種別で有効な定義だけに絞る。空配列は「全種別で有効」 */
export function applicableTo(
  defs: FieldDefWithMeta[],
  issueTypeId: number,
): FieldDefWithMeta[] {
  return defs.filter(
    (d) => d.applicableIssueTypes.length === 0 || d.applicableIssueTypes.includes(issueTypeId),
  );
}

export type ReadResult =
  | { ok: true; values: Record<number, unknown> }
  | { ok: false; error: string };

/**
 * フォームから値を取り出して検証する。
 *
 * `mode: "partial"` は更新用。フォームに出ていない属性は触らない
 * （未入力と区別する必要がある）。`"full"` は作成用で、全属性を見る。
 */
export function readFieldValues(
  defs: FieldDefWithMeta[],
  formData: FormData,
  mode: "full" | "partial" = "full",
): ReadResult {
  const values: Record<number, unknown> = {};

  for (const def of defs) {
    const name = `customField_${def.id}`;
    if (mode === "partial" && !formData.has(name)) continue;

    // 複数選択は同名で複数届く
    const raw = formData.getAll(name).map((v) => String(v));
    const other = formData.get(`${name}_otherValue`);

    const parsed = parseFieldValue(
      def,
      raw,
      other === null ? null : String(other),
    );
    if (!parsed.ok) return { ok: false, error: parsed.error };

    // 更新のときは null も「未入力に戻す」として渡す必要がある
    if (parsed.value === null && mode === "full") continue;
    values[def.id] = parsed.value;
  }

  return { ok: true, values };
}
