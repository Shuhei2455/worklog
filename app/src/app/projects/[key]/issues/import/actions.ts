"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { createIssue } from "@/lib/issue";
import { decodeCsv } from "@/lib/csv";
import { csvToIssues, type ImportMasters } from "@/lib/issue-csv";
import { loadFieldDefs } from "@/lib/custom-field-form";
import { audit } from "@/lib/audit";

/**
 * CSVの取り込み。
 *
 * **1件でもエラーがあれば何も取り込まない。** 半分だけ入った状態は、
 * やり直しが一番面倒になる（どこまで入ったかを人が数える羽目になる）。
 *
 * 検証だけして結果を見せる「確認」と、実際に入れる「実行」の2段にしてある。
 * 受け入れ条件が「既存のExcel課題表を1つ取り込めた」なので、
 * 列の対応が合っているかを人が目で見られることが要る。
 */

async function loadMasters(projectId: number): Promise<ImportMasters> {
  const [statuses, issueTypes, members, categories, versions, issues, fields] =
    await Promise.all([
      prisma.status.findMany({ where: { projectId }, orderBy: { displayOrder: "asc" } }),
      prisma.issueType.findMany({ where: { projectId }, orderBy: { displayOrder: "asc" } }),
      prisma.projectMember.findMany({ where: { projectId }, include: { user: true } }),
      prisma.category.findMany({ where: { projectId } }),
      prisma.version.findMany({ where: { projectId } }),
      prisma.issue.findMany({
        where: { projectId },
        select: { id: true, keyId: true, project: { select: { key: true } } },
      }),
      loadFieldDefs(projectId),
    ]);

  return {
    statuses: new Map(statuses.map((s) => [s.name, s.id])),
    issueTypes: new Map(issueTypes.map((t) => [t.name, t.id])),
    // 担当者は表示名で引く。CSVに書くのは人の名前なので
    users: new Map(members.map((m) => [m.user.name, m.userId])),
    categories: new Map(categories.map((c) => [c.name, c.id])),
    versions: new Map(versions.map((v) => [v.name, v.id])),
    issueKeys: new Map(issues.map((i) => [`${i.project.key}-${i.keyId}`, i.id])),
    fields,
  };
}

/** アップロードされたCSVを読んで、結果を画面に返すためにURLへ載せる */
export async function previewImport(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
  if (!project) redirect("/");
  await assertCan(actor, "issue.create", project.id);

  const file = formData.get("file");
  const path = `/projects/${key}/issues/import`;
  if (!(file instanceof File) || file.size === 0) {
    redirect(`${path}?error=${encodeURIComponent("ファイルを選んでください")}`);
  }

  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const { text, encoding } = decodeCsv(bytes);
  const masters = await loadMasters(project.id);
  const result = csvToIssues(text, masters);

  // 結果はURLに載せない（長すぎる）。セッションも使わず、
  // 確認画面でもう一度ファイルを受け取る方式にする。
  // 代わりに件数とエラーだけを渡す
  const summary = {
    encoding,
    total: result.issues.length,
    errors: result.errors.slice(0, 20),
    errorCount: result.errors.length,
    ignored: result.ignoredColumns,
    preview: result.issues.slice(0, 5).map((i) => i.summary),
  };
  redirect(`${path}?result=${encodeURIComponent(JSON.stringify(summary))}`);
}

/**
 * 取り込みを実行する。
 *
 * 確認のときと同じファイルをもう一度受け取って読み直す。
 * 読んだ結果を持ち回すより、同じ入力から同じ結果が出ることを前提にした方が
 * 状態が減って安全（間に定義が変わっていれば、ここでもエラーになる）。
 */
export async function runImport(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
  if (!project) redirect("/");
  await assertCan(actor, "issue.create", project.id);

  const file = formData.get("file");
  const path = `/projects/${key}/issues/import`;
  if (!(file instanceof File) || file.size === 0) {
    redirect(`${path}?error=${encodeURIComponent("ファイルを選んでください")}`);
  }

  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const { text } = decodeCsv(bytes);
  const masters = await loadMasters(project.id);
  const result = csvToIssues(text, masters);

  if (result.errors.length > 0) {
    redirect(
      `${path}?error=${encodeURIComponent(
        `${result.errors.length} 件のエラーがあるため取り込みませんでした`,
      )}`,
    );
  }
  if (result.issues.length === 0) {
    redirect(`${path}?error=${encodeURIComponent("取り込む行がありません")}`);
  }

  // 1件ずつ createIssue を通す。keyId の採番・活動履歴・通知・検索インデックスを
  // 同じ経路に乗せるため（直接 insert すると履歴も通知も作られない）
  let created = 0;
  for (const row of result.issues) {
    await createIssue({
      projectId: project.id,
      summary: row.summary,
      description: row.description ?? undefined,
      issueTypeId: row.issueTypeId,
      statusId: row.statusId,
      priorityId: row.priorityId,
      assigneeId: row.assigneeId,
      startDate: row.startDate,
      dueDate: row.dueDate,
      categoryIds: row.categoryIds,
      milestoneIds: row.milestoneIds,
      versionIds: row.versionIds,
      customFieldValues: row.customFieldValues,
      createdBy: actor.id,
    });
    created++;
  }

  await audit(actor.id, {
    action: "issue.import",
    targetType: "project",
    targetId: project.key,
    detail: { count: created, fileName: (file as File).name },
  });

  revalidatePath(`/projects/${key}/issues`);
  redirect(
    `/projects/${key}/issues?ok=${encodeURIComponent(`${created} 件を取り込みました`)}`,
  );
}
