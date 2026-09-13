"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { CUSTOM_FIELD_TYPE_BY_ID, settingsSchema, hasItems } from "@/lib/custom-field";
import { audit } from "@/lib/audit";

/**
 * カスタム属性の定義の管理。
 *
 * **ここは "use server" のファイル。非同期関数しかエクスポートできない**
 * （CLAUDE.md）。定数と純関数は src/lib/custom-field.ts にある。
 */

async function projectByKey(key: string) {
  const project = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!project) redirect("/");
  return project;
}

function back(key: string, message?: string, isError = false): never {
  const q = message
    ? `?${isError ? "error" : "ok"}=${encodeURIComponent(message)}`
    : "";
  revalidatePath(`/projects/${key}/settings`);
  redirect(`/projects/${key}/settings${q}`);
}

/**
 * カスタム属性を追加する。
 *
 * id はプロジェクト内の連番。他のマスタと同じく、projects の行をロックした
 * トランザクション内で MAX+1 を取る（決定 D6 の方式。課題の keyId と違い
 * 作成頻度が低く管理者しか触らないので、ロック待ちは問題にならない）。
 */
export async function addCustomField(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) back(key, "名前を入れてください", true);

  const typeId = CUSTOM_FIELD_TYPE_BY_ID.get(Number(formData.get("typeId")));
  if (!typeId) back(key, "型が不正です", true);

  const required = formData.get("required") === "on";
  const description = String(formData.get("description") ?? "").trim();

  // 型ごとの追加パラメータ。空欄は持たない
  const num = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    return s || undefined;
  };

  const settings = settingsSchema.parse({
    min: num(formData.get("min")),
    max: num(formData.get("max")),
    initialValue: num(formData.get("initialValue")),
    unit: str(formData.get("unit")),
    dateMin: str(formData.get("dateMin")),
    dateMax: str(formData.get("dateMax")),
    initialValueType: num(formData.get("initialValueType")),
    initialDate: str(formData.get("initialDate")),
    initialShift: num(formData.get("initialShift")),
    allowAddItem: formData.get("allowAddItem") === "on" ? true : undefined,
    allowInput: formData.get("allowInput") === "on" ? true : undefined,
  });

  // 選択肢は改行区切りで受ける。型が選択肢を持たないなら無視する
  const itemNames = hasItems(typeId)
    ? String(formData.get("items") ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (hasItems(typeId) && itemNames.length === 0) {
    back(key, "選択肢を1つ以上入れてください", true);
  }

  await prisma.$transaction(async (tx) => {
    // 同時に追加されても id が衝突しないよう、**プロジェクトの行**をロックする。
    // 集計の SELECT に FOR UPDATE は付けられない
    // （PostgreSQL: FOR UPDATE is not allowed with aggregate functions）。
    // ロックする対象は「採番の基準になる行」なので projects でよい
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id} FOR UPDATE`;

    const [{ next, order }] = await tx.$queryRaw<
      Array<{ next: number; order: number }>
    >`
      SELECT COALESCE(MAX(id), 0) + 1 AS next,
             COALESCE(MAX(display_order), 0) + 1 AS order
      FROM custom_fields WHERE project_id = ${project.id}
    `;

    await tx.customField.create({
      data: {
        projectId: project.id,
        id: Number(next),
        typeId,
        name,
        description: description || null,
        required,
        applicableIssueTypes: [],
        settings,
        displayOrder: Number(order),
      },
    });

    for (const [i, itemName] of itemNames.entries()) {
      await tx.customFieldItem.create({
        data: {
          projectId: project.id,
          customFieldId: Number(next),
          name: itemName,
          displayOrder: i + 1,
        },
      });
    }
  });

  back(key, `カスタム属性「${name}」を追加しました`);
}

/**
 * カスタム属性を削除する。
 *
 * **入力済みの値も一緒に消える**（issue_custom_field_values は
 * カスケード削除）。取り返しがつかないので、件数を数えて知らせる。
 */
export async function deleteCustomField(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(key, "不正なリクエストです", true);

  const field = await prisma.customField.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
    include: { _count: { select: { values: true } } },
  });
  if (!field) back(key, "カスタム属性が見つかりません", true);

  // 入力済みの値も一緒に消えるので、何を消したかを残す
  await audit(actor.id, {
    action: "customField.delete",
    targetType: "customField",
    targetId: `${project.key}#${id}`,
    detail: { name: field!.name, valueCount: field!._count.values },
  });

  await prisma.customField.delete({
    where: { projectId_id: { projectId: project.id, id } },
  });

  const note =
    field!._count.values > 0
      ? `（入力済みの値 ${field!._count.values} 件も削除しました）`
      : "";
  back(key, `「${field!.name}」を削除しました${note}`);
}

/** 必須かどうかを切り替える */
export async function toggleCustomFieldRequired(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) back(key, "不正なリクエストです", true);

  const field = await prisma.customField.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
  });
  if (!field) back(key, "カスタム属性が見つかりません", true);

  await prisma.customField.update({
    where: { projectId_id: { projectId: project.id, id } },
    data: { required: !field!.required },
  });
  back(key, `「${field!.name}」を${field!.required ? "任意" : "必須"}にしました`);
}
