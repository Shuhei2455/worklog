import { redirect } from "next/navigation";
import { toLocale, type Locale } from "@/lib/i18n";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { can, type Action, type ActorUser } from "@/lib/permissions";

/**
 * ログイン中のユーザーを取り、権限判定に使える形で返す。
 *
 * 種別や制限はJWTに埋めずここでDBから読む。
 * トークンに埋めると、管理者がユーザーの権限を変更しても
 * 相手がログアウトするまで反映されない。
 */
export async function currentUser(): Promise<
  ActorUser & { name: string; userId: string; locale: Locale }
> {
  const session = await auth();
  const id = session?.uid;
  if (!id) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.disabledAt) redirect("/login");

  return {
    id: user.id,
    name: user.name,
    userId: user.userId,
    userType: user.userType,
    restriction: user.restriction,
    disabledAt: user.disabledAt,
    // 表示言語。画面はこれを見て辞書を切り替える
    locale: toLocale(user.lang),
  };
}

/**
 * プロジェクトに対する権限の文脈を作る。
 *
 * 「参加しているか」「プロジェクト管理者か」は can() の判定に必須。
 * 管理者であっても参加していないプロジェクトは見えないので、
 * ここで参加状況を必ず引く。
 */
export async function projectContext(projectId: number, userId: number) {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  return {
    projectId,
    isMember: member != null,
    isProjectAdmin: member?.isProjectAdmin ?? false,
  };
}

/** 権限が無ければ例外。サーバーアクションの入口で使う */
export async function assertCan(
  actor: ActorUser,
  action: Action,
  projectId?: number,
) {
  const resource = projectId
    ? await projectContext(projectId, actor.id)
    : {};
  if (!can(actor, action, resource)) {
    throw new Error("この操作を行う権限がありません");
  }
  return resource;
}

/**
 * ユーザーが見られるプロジェクトの id 一覧。
 *
 * **一覧クエリではこれを where に注入すること。**
 * 取得後に can() で1件ずつフィルタすると件数とページングが壊れる
 * (docs/01-design.md 5章)。
 *
 * 管理者であっても参加していないプロジェクトは含めない。
 */
export async function visibleProjectIds(userId: number): Promise<number[]> {
  const rows = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}
