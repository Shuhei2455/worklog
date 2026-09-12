import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextKeyId } from "@/lib/numbering";
import { DEFAULT_PRIORITY_ID, STATUS_ID_OPEN, STATUS_ID_CLOSED } from "@/lib/constants";
import { createNotifications } from "@/lib/notify";
import { enqueueSearch } from "@/lib/queue";
import { dispatchActivity } from "@/lib/dispatch";

/**
 * 課題の作成・更新・削除。
 *
 * 権限チェックは呼び出し側（サーバーアクション）で assertCan を通すこと。
 * ここは業務ルールだけを見る。
 */

export type CreateIssueInput = {
  projectId: number;
  summary: string;
  issueTypeId: number;
  priorityId?: number;
  description?: string;
  statusId?: number;
  assigneeId?: number | null;
  parentIssueId?: number | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  categoryIds?: number[];
  milestoneIds?: number[];
  versionIds?: number[];
  notifiedUserIds?: number[];
  /** カスタム属性の値。{ カスタム属性のid: 保存する形 }（src/lib/custom-field.ts） */
  customFieldValues?: Record<number, unknown>;
  createdBy: number;
};

/** 課題キー。表示は project.key + '-' + keyId */
export function issueKey(projectKey: string, keyId: number) {
  return `${projectKey}-${keyId}`;
}

/**
 * 親子課題は1階層のみ。
 * 「親を持つ課題は親になれない」ので、指定された親が既に子であれば拒否する。
 * 自分自身を親にできないのは DB の CHECK でも縛っているが、
 * ここで弾いた方がメッセージを出せる。
 */
async function assertParentIsValid(
  tx: Prisma.TransactionClient,
  projectId: number,
  parentIssueId: number,
  selfId?: number,
) {
  if (selfId && parentIssueId === selfId) {
    throw new Error("自分自身を親にはできません");
  }
  const parent = await tx.issue.findUnique({ where: { id: parentIssueId } });
  if (!parent) throw new Error("親課題が見つかりません");
  if (parent.projectId !== projectId) {
    throw new Error("別のプロジェクトの課題は親にできません");
  }
  if (parent.parentIssueId != null) {
    throw new Error("親子課題は1階層までです（子課題を親にはできません）");
  }
  if (selfId) {
    const hasChildren = await tx.issue.count({ where: { parentIssueId: selfId } });
    if (hasChildren > 0) {
      throw new Error("子課題を持つ課題は、他の課題の子にできません");
    }
  }
}

export async function createIssue(input: CreateIssueInput) {
  const issue = await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
    });
    if (!project) throw new Error("プロジェクトが見つかりません");

    // チャートがOFFのときは開始日・期限日を入力できない
    // (docs/00-spec-verified.md 2章)
    const startDate = project.chartEnabled ? (input.startDate ?? null) : null;
    const dueDate = project.chartEnabled ? (input.dueDate ?? null) : null;

    if (input.parentIssueId != null) {
      if (!project.subtaskingEnabled) {
        throw new Error("このプロジェクトでは親子課題を使いません");
      }
      await assertParentIsValid(tx, input.projectId, input.parentIssueId);
    }

    // keyId は UPDATE ... RETURNING で進める。アプリ側で MAX+1 を取らない
    const keyId = await nextKeyId(tx, input.projectId);

    const issue = await tx.issue.create({
      data: {
        projectId: input.projectId,
        keyId,
        summary: input.summary,
        description: input.description ?? null,
        issueTypeId: input.issueTypeId,
        statusId: input.statusId ?? STATUS_ID_OPEN,
        priorityId: input.priorityId ?? DEFAULT_PRIORITY_ID,
        assigneeId: input.assigneeId ?? null,
        parentIssueId: input.parentIssueId ?? null,
        startDate,
        dueDate,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        categories: {
          create: (input.categoryIds ?? []).map((categoryId) => ({
            projectId: input.projectId,
            categoryId,
          })),
        },
        milestones: {
          create: (input.milestoneIds ?? []).map((versionId) => ({
            projectId: input.projectId,
            versionId,
          })),
        },
        versions: {
          create: (input.versionIds ?? []).map((versionId) => ({
            projectId: input.projectId,
            versionId,
          })),
        },
      },
    });

    // カスタム属性の値。検証は parseFieldValue() を通したものが渡ってくる
    const cfEntries = Object.entries(input.customFieldValues ?? {});
    if (cfEntries.length > 0) {
      await tx.issueCustomFieldValue.createMany({
        data: cfEntries.map(([customFieldId, value]) => ({
          issueId: issue.id,
          projectId: input.projectId,
          customFieldId: Number(customFieldId),
          value: value as Prisma.InputJsonValue,
        })),
      });
    }

    // 登録者と担当者は自動で参加者になる(docs/00-spec-verified.md 3章)
    const participants = new Set<number>([input.createdBy]);
    if (input.assigneeId) participants.add(input.assigneeId);
    await tx.issueParticipant.createMany({
      data: [...participants].map((userId) => ({ issueId: issue.id, userId })),
      skipDuplicates: true,
    });

    // 活動履歴。作成は changes を持たない
    const activity = await tx.activity.create({
      data: {
        projectId: input.projectId,
        type: "issue_created",
        issueId: issue.id,
        userId: input.createdBy,
      },
    });

    // 「お知らせ」の宛先
    if (input.notifiedUserIds?.length) {
      await tx.activityNotifiedUser.createMany({
        data: input.notifiedUserIds.map((userId) => ({
          activityId: activity.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }

    // 通知は活動履歴と同じトランザクションで作る。
    // ずれると通知だけ残って中身が無い状態になる
    await createNotifications(tx, {
      activityId: activity.id,
      issueId: issue.id,
      projectId: input.projectId,
      actorId: input.createdBy,
      notifiedUserIds: input.notifiedUserIds,
      assigneeId: input.assigneeId ?? null,
      texts: [input.description],
    });

    return { issue, activityId: activity.id };
  });

  // 検索インデックスの更新は非同期。失敗しても課題の作成は成立させる
  await enqueueSearch({ kind: "issue", op: "upsert", id: issue.issue.id });
  // webhook とメールもトランザクションの外で積む
  await dispatchActivity(issue.activityId, input.projectId, "issue_created");
  return issue.issue;
}

/** 変更差分。describeChanges() が日本語に解決する */
export type Change = { field: string; from: string | null; to: string | null };

export type UpdateIssueInput = {
  issueId: number;
  updatedBy: number;
  summary?: string;
  description?: string | null;
  statusId?: number;
  resolutionId?: number | null;
  priorityId?: number;
  issueTypeId?: number;
  assigneeId?: number | null;
  parentIssueId?: number | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  categoryIds?: number[];
  milestoneIds?: number[];
  versionIds?: number[];
  /**
   * 本家は更新と同時にコメントを送れる(docs/00-spec-verified.md 2.2)。
   * その場合 changes と content の両方を持つ1レコードになる。
   * 分けると本家の表示と食い違う。
   */
  comment?: string;
  notifiedUserIds?: number[];
  /**
   * カスタム属性の値。渡したものだけ更新する。
   * 要素に null を入れると「未入力に戻す」（値の行を消す）
   */
  customFieldValues?: Record<number, unknown>;
};

const scalarFields = [
  "summary",
  "description",
  "statusId",
  "resolutionId",
  "priorityId",
  "issueTypeId",
  "assigneeId",
  "parentIssueId",
  "startDate",
  "dueDate",
  "estimatedHours",
  "actualHours",
] as const;

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function updateIssue(input: UpdateIssueInput) {
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.issue.findUnique({
      where: { id: input.issueId },
      include: { categories: true, milestones: true, versions: true },
    });
    if (!before) throw new Error("課題が見つかりません");

    const project = await tx.project.findUniqueOrThrow({
      where: { id: before.projectId },
    });

    if (input.parentIssueId != null) {
      if (!project.subtaskingEnabled) {
        throw new Error("このプロジェクトでは親子課題を使いません");
      }
      await assertParentIsValid(
        tx,
        before.projectId,
        input.parentIssueId,
        before.id,
      );
    }

    // Unchecked 版でないと statusId のようなスカラーの外部キーを直接渡せない。
    // checked 版は status: { connect: ... } を要求する
    const data: Prisma.IssueUncheckedUpdateInput = { updatedBy: input.updatedBy };
    const changes: Change[] = [];

    for (const field of scalarFields) {
      if (!(field in input)) continue;
      const next = (input as Record<string, unknown>)[field];
      // チャートがOFFなら日付は入らない
      if ((field === "startDate" || field === "dueDate") && !project.chartEnabled) {
        continue;
      }
      const prev = (before as unknown as Record<string, unknown>)[field];
      if (toStr(prev) === toStr(next)) continue;
      changes.push({ field, from: toStr(prev), to: toStr(next) });
      (data as Record<string, unknown>)[field] = next;
    }

    // 状態が「完了」になった瞬間を記録する。ガントの表示条件で使う
    if (input.statusId !== undefined && input.statusId !== before.statusId) {
      data.completedAt =
        input.statusId === STATUS_ID_CLOSED ? new Date() : null;
    }

    // 多対多は総入れ替え。差分は id の集合で比較する
    const m2m: Array<[string, number[] | undefined, number[]]> = [
      ["categoryIds", input.categoryIds, before.categories.map((c) => c.categoryId)],
      ["milestoneIds", input.milestoneIds, before.milestones.map((m) => m.versionId)],
      ["versionIds", input.versionIds, before.versions.map((v) => v.versionId)],
    ];
    for (const [field, next, prev] of m2m) {
      if (!next) continue;
      const a = [...prev].sort().join(",");
      const b = [...next].sort().join(",");
      if (a === b) continue;
      changes.push({ field, from: a || null, to: b || null });
    }

    await tx.issue.update({ where: { id: input.issueId }, data });

    if (input.categoryIds) {
      await tx.issueCategory.deleteMany({ where: { issueId: input.issueId } });
      await tx.issueCategory.createMany({
        data: input.categoryIds.map((categoryId) => ({
          issueId: input.issueId,
          projectId: before.projectId,
          categoryId,
        })),
      });
    }
    if (input.milestoneIds) {
      await tx.issueMilestone.deleteMany({ where: { issueId: input.issueId } });
      await tx.issueMilestone.createMany({
        data: input.milestoneIds.map((versionId) => ({
          issueId: input.issueId,
          projectId: before.projectId,
          versionId,
        })),
      });
    }
    if (input.versionIds) {
      await tx.issueVersion.deleteMany({ where: { issueId: input.issueId } });
      await tx.issueVersion.createMany({
        data: input.versionIds.map((versionId) => ({
          issueId: input.issueId,
          projectId: before.projectId,
          versionId,
        })),
      });
    }

    // カスタム属性。渡されたものだけ触る。
    // 差分は `customField_{id}` という field 名で履歴に残す
    // （本家が値を渡すときのパラメータ名と同じ形。11.1）
    if (input.customFieldValues) {
      const prevValues = await tx.issueCustomFieldValue.findMany({
        where: { issueId: input.issueId },
      });
      const prevById = new Map(prevValues.map((v) => [v.customFieldId, v.value]));

      for (const [idStr, next] of Object.entries(input.customFieldValues)) {
        const customFieldId = Number(idStr);
        const prev = prevById.get(customFieldId) ?? null;
        if (JSON.stringify(prev) === JSON.stringify(next ?? null)) continue;

        changes.push({
          field: `customField_${customFieldId}`,
          from: prev === null ? null : JSON.stringify(prev),
          to: next == null ? null : JSON.stringify(next),
        });

        if (next == null) {
          await tx.issueCustomFieldValue.deleteMany({
            where: { issueId: input.issueId, customFieldId },
          });
        } else {
          await tx.issueCustomFieldValue.upsert({
            where: {
              issueId_customFieldId: { issueId: input.issueId, customFieldId },
            },
            create: {
              issueId: input.issueId,
              projectId: before.projectId,
              customFieldId,
              value: next as Prisma.InputJsonValue,
            },
            update: { value: next as Prisma.InputJsonValue },
          });
        }
      }
    }

    const hasComment = Boolean(input.comment?.trim());
    // 何も変わっておらずコメントも無いなら履歴を作らない
    if (changes.length === 0 && !hasComment) return before;

    const activity = await tx.activity.create({
      data: {
        projectId: before.projectId,
        // コメントだけなら comment、変更があれば issue_updated。
        // 両方あるときは変更として扱い、content にコメントを持たせる
        type: changes.length ? "issue_updated" : "comment",
        issueId: before.id,
        userId: input.updatedBy,
        content: hasComment ? input.comment!.trim() : null,
        changes: changes.length ? (changes as unknown as Prisma.InputJsonValue) : undefined,
      },
    });

    if (input.notifiedUserIds?.length) {
      await tx.activityNotifiedUser.createMany({
        data: input.notifiedUserIds.map((userId) => ({
          activityId: activity.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }

    await createNotifications(tx, {
      activityId: activity.id,
      issueId: before.id,
      projectId: before.projectId,
      actorId: input.updatedBy,
      notifiedUserIds: input.notifiedUserIds,
      // 担当者が変わったときだけ、新しい担当者に知らせる
      assigneeId:
        input.assigneeId !== undefined && input.assigneeId !== before.assigneeId
          ? input.assigneeId
          : null,
      texts: [input.comment, input.description],
    });

    // 更新した人・新しい担当者は参加者になる
    const participants = new Set<number>([input.updatedBy]);
    if (input.assigneeId) participants.add(input.assigneeId);
    await tx.issueParticipant.createMany({
      data: [...participants].map((userId) => ({ issueId: before.id, userId })),
      skipDuplicates: true,
    });

    return {
      issue: await tx.issue.findUniqueOrThrow({ where: { id: input.issueId } }),
      activityId: activity.id,
      type: activity.type,
      projectId: before.projectId,
    };
  });

  await enqueueSearch({ kind: "issue", op: "upsert", id: input.issueId });
  if (result && "activityId" in result) {
    await dispatchActivity(result.activityId, result.projectId, result.type);
  }
  return "issue" in result ? result.issue : result;
}

/**
 * 課題の削除。
 *
 * 決定 D13: 子課題は削除せず、親への参照だけ外す。
 * 本家の挙動は未確認だが、子ごと消えると取り返しがつかない。
 */
export async function deleteIssue(issueId: number) {
  await prisma.$transaction(async (tx) => {
    await tx.issue.updateMany({
      where: { parentIssueId: issueId },
      data: { parentIssueId: null },
    });
    await tx.issue.delete({ where: { id: issueId } });
  });
  await enqueueSearch({ kind: "issue", op: "delete", id: issueId });
}
