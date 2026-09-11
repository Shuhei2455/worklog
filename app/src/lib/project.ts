import { prisma } from "@/lib/db";
import {
  DEFAULT_ISSUE_TYPES,
  DEFAULT_STATUSES,
  PROJECT_KEY_PATTERN,
} from "@/lib/constants";

export type CreateProjectInput = {
  key: string;
  name: string;
  description?: string;
  createdBy: number;
};

/**
 * プロジェクトを作る。
 *
 * 標準4状態と既定の課題種別は、プロジェクト作成と**同一トランザクション**で入れる。
 * 状態が1つも無いプロジェクトが一瞬でも存在すると、その間に課題を作られたとき
 * status_id の参照先が無くなる。
 */
export async function createProject(input: CreateProjectInput) {
  if (!PROJECT_KEY_PATTERN.test(input.key)) {
    throw new Error(
      `プロジェクトキーの形式が不正です: ${input.key}（英大文字で始まる1〜10文字、英大文字・数字・_）`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
      },
    });

    // id は固定値をそのまま入れる。決定 D6 により各プロジェクトで 1..4 になる
    await tx.status.createMany({
      data: DEFAULT_STATUSES.map((s) => ({
        projectId: project.id,
        id: s.id,
        name: s.name,
        color: s.color,
        displayOrder: s.displayOrder,
        isDefault: true,
      })),
    });

    await tx.issueType.createMany({
      data: DEFAULT_ISSUE_TYPES.map((t) => ({
        projectId: project.id,
        id: t.id,
        name: t.name,
        color: t.color,
        displayOrder: t.displayOrder,
      })),
    });

    // 作成者は自動でプロジェクト管理者として参加する
    await tx.projectMember.create({
      data: {
        projectId: project.id,
        userId: input.createdBy,
        isProjectAdmin: true,
      },
    });

    return project;
  });
}
