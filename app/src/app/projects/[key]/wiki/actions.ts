"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser, assertCan } from "@/lib/session";
import { createNotifications } from "@/lib/notify";
import { enqueueSearch } from "@/lib/queue";

/** Wiki のサーバーアクション。入口で必ず assertCan を通す */

async function projectByKey(key: string) {
  const p = await prisma.project.findUnique({ where: { key } });
  if (!p) throw new Error(`プロジェクトが見つかりません: ${key}`);
  if (!p.wikiEnabled) throw new Error("このプロジェクトでは Wiki を使いません");
  return p;
}

const parseTags = (raw: string) =>
  [...new Set(raw.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean))];

export async function createWiki(key: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "wiki.edit", project.id);

  const name = String(formData.get("name") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!name) {
    redirect(`/projects/${key}/wiki/new?error=${encodeURIComponent("ページ名を入力してください")}`);
  }

  const dup = await prisma.wikiPage.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
  });
  if (dup) {
    redirect(`/projects/${key}/wiki/new?error=${encodeURIComponent(`同じ名前のページがあります: ${name}`)}`);
  }

  const created = await prisma.$transaction(async (tx) => {
    const page = await tx.wikiPage.create({
      data: {
        projectId: project.id,
        name,
        content,
        createdBy: actor.id,
        updatedBy: actor.id,
        revision: 1,
        tags: { create: parseTags(String(formData.get("tags") ?? "")).map((tag) => ({ tag })) },
      },
    });
    // 履歴は全文スナップショット。差分保存にするほどの量ではない
    await tx.wikiRevision.create({
      data: { wikiPageId: page.id, content, userId: actor.id },
    });
    const activity = await tx.activity.create({
      data: {
        projectId: project.id,
        type: "wiki_created",
        wikiPageId: page.id,
        userId: actor.id,
        content: name,
      },
    });
    await createNotifications(tx, {
      activityId: activity.id,
      projectId: project.id,
      actorId: actor.id,
      texts: [content],
    });
    return page;
  });

  await enqueueSearch({ kind: "wiki", op: "upsert", id: created.id });
  revalidatePath(`/projects/${key}/wiki`);
  redirect(`/projects/${key}/wiki/${encodeURIComponent(name)}`);
}

/**
 * 更新。楽観ロックで競合を警告する(決定 D16)。
 *
 * 本家の更新APIに楽観ロック用の引数は無く、後勝ちと思われる。
 * ただし設計書が「楽観ロック＋競合警告」を求めているのでそちらに従う。
 */
export async function updateWiki(key: string, name: string, formData: FormData) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "wiki.edit", project.id);

  const page = await prisma.wikiPage.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
  });
  if (!page) throw new Error("ページが見つかりません");

  const baseRevision = Number(formData.get("revision"));
  const content = String(formData.get("content") ?? "");
  const newName = String(formData.get("name") ?? name).trim() || name;
  const tags = parseTags(String(formData.get("tags") ?? ""));

  // 開いている間に他の人が保存していたら、上書きせずに知らせる
  if (Number.isInteger(baseRevision) && baseRevision !== page.revision) {
    redirect(
      `/projects/${key}/wiki/${encodeURIComponent(name)}/edit?conflict=1&base=${baseRevision}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.wikiPage.update({
      where: { id: page.id },
      data: {
        name: newName,
        content,
        updatedBy: actor.id,
        revision: { increment: 1 },
      },
    });
    await tx.wikiTag.deleteMany({ where: { wikiPageId: page.id } });
    if (tags.length) {
      await tx.wikiTag.createMany({
        data: tags.map((tag) => ({ wikiPageId: page.id, tag })),
      });
    }
    await tx.wikiRevision.create({
      data: { wikiPageId: page.id, content, userId: actor.id },
    });
    const activity = await tx.activity.create({
      data: {
        projectId: project.id,
        type: "wiki_updated",
        wikiPageId: page.id,
        userId: actor.id,
        content: newName,
      },
    });
    await createNotifications(tx, {
      activityId: activity.id,
      projectId: project.id,
      actorId: actor.id,
      texts: [content],
    });
  });

  await enqueueSearch({ kind: "wiki", op: "upsert", id: page.id });
  revalidatePath(`/projects/${key}/wiki`);
  redirect(`/projects/${key}/wiki/${encodeURIComponent(newName)}`);
}

export async function deleteWiki(key: string, name: string) {
  const actor = await currentUser();
  const project = await projectByKey(key);
  await assertCan(actor, "wiki.edit", project.id);

  const page = await prisma.wikiPage.findUnique({
    where: { projectId_name: { projectId: project.id, name } },
  });
  await prisma.wikiPage.deleteMany({
    where: { projectId: project.id, name },
  });
  if (page) await enqueueSearch({ kind: "wiki", op: "delete", id: page.id });
  revalidatePath(`/projects/${key}/wiki`);
  redirect(`/projects/${key}/wiki`);
}
