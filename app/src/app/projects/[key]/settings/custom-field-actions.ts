"use server";

import { revalidatePath } from "next/cache";
import { setFlash } from "@/lib/flash";
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

/**
 * **redirect しない。** 同じURLへ飛ばすと先頭までスクロールが戻り、
 * 「リロードされた」ように見える（CLAUDE.md の規約）。
 * メッセージはフラッシュ（cookie）で運ぶ。
 *
 * 以前は `never` を返していたので `if (cond) return await back(...)` で処理が止まっていた。
 * いまは通常復帰するので、**呼び出し側は必ず `return await back(...)`**。
 */
async function back(key: string, message?: string, isError = false): Promise<void> {
  const path = `/projects/${key}/settings`;
  if (message) await setFlash(path, message, isError);
  revalidatePath(path);
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
  if (!name) return await back(key, "名前を入れてください", true);

  const typeId = CUSTOM_FIELD_TYPE_BY_ID.get(Number(formData.get("typeId")));
  if (!typeId) return await back(key, "型が不正です", true);

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

  // 有効な課題種別。**空なら全種別で有効**（本家と同じ扱い。11.1）。
  // そのプロジェクトの種別だけを通す（他プロジェクトのIDを送られても入れない）
  const projectTypes = await prisma.issueType.findMany({
    where: { projectId: project.id },
    select: { id: true },
  });
  const allowedTypeIds = new Set(projectTypes.map((t) => t.id));
  const applicableIssueTypes = formData
    .getAll("applicableIssueTypes")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && allowedTypeIds.has(n));

  // 選択肢は改行区切りで受ける。型が選択肢を持たないなら無視する
  const itemNames = hasItems(typeId)
    ? String(formData.get("items") ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (hasItems(typeId) && itemNames.length === 0) {
    return await back(key, "選択肢を1つ以上入れてください", true);
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
        applicableIssueTypes,
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

  return await back(key, `カスタム属性「${name}」を追加しました`);
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
  if (!Number.isInteger(id)) return await back(key, "不正なリクエストです", true);

  const field = await prisma.customField.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
    include: { _count: { select: { values: true } } },
  });
  if (!field) return await back(key, "カスタム属性が見つかりません", true);

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
  return await back(key, `「${field!.name}」を削除しました${note}`);
}

/**
 * カスタム属性の名前と説明を直す。
 *
 * 型と選択肢は変えられない（入力済みの値の解釈が変わってしまうため）。
 * 名前だけでも直せないと、打ち間違えたまま使い続けることになる。
 */
export async function updateCustomField(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return await back(key, "不正なリクエストです", true);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return await back(key, "名前を入れてください", true);

  const field = await prisma.customField.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
  });
  if (!field) return await back(key, "カスタム属性が見つかりません", true);

  const dup = await prisma.customField.findFirst({
    where: { projectId: project.id, name, id: { not: id } },
  });
  if (dup) return await back(key, `「${name}」は既にあります`, true);

  await prisma.customField.update({
    where: { projectId_id: { projectId: project.id, id } },
    data: { name, description: description || null },
  });
  return await back(key, `「${name}」を更新しました`);
}

/** 必須かどうかを切り替える */
export async function toggleCustomFieldRequired(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return await back(key, "不正なリクエストです", true);

  const field = await prisma.customField.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
  });
  if (!field) return await back(key, "カスタム属性が見つかりません", true);

  await prisma.customField.update({
    where: { projectId_id: { projectId: project.id, id } },
    data: { required: !field!.required },
  });
  return await back(key, `「${field!.name}」を${field!.required ? "任意" : "必須"}にしました`);
}


/**
 * 有効な課題種別を変える。
 *
 * 空で送ると全種別で有効になる（本家と同じ扱い）。
 * 入力欄を課題種別ごとに出し入れするのは client JS が必要なので、
 * 定義の一覧にチェックボックスを置いて保存する形にしてある。
 */
export async function setCustomFieldIssueTypes(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "project.edit", project.id);

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return await back(key, "不正なリクエストです", true);

  const field = await prisma.customField.findUnique({
    where: { projectId_id: { projectId: project.id, id } },
  });
  if (!field) return await back(key, "カスタム属性が見つかりません", true);

  const projectTypes = await prisma.issueType.findMany({
    where: { projectId: project.id },
    select: { id: true },
  });
  const allowed = new Set(projectTypes.map((t) => t.id));
  const applicableIssueTypes = formData
    .getAll("issueTypeId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && allowed.has(n));

  await prisma.customField.update({
    where: { projectId_id: { projectId: project.id, id } },
    data: { applicableIssueTypes },
  });

  return await back(
    key,
    applicableIssueTypes.length === 0
      ? `「${field!.name}」を全種別で有効にしました`
      : `「${field!.name}」の有効な種別を ${applicableIssueTypes.length} 件にしました`,
  );
}
