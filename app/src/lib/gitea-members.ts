import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import {
  giteaEnabled,
  giteaOrgOf,
  giteaLoginOf,
  ensureGiteaUser,
  addOrgMember,
  removeOrgMember,
  listOrgMembers,
  giteaServiceLogin,
} from "@/lib/gitea";

/**
 * プロジェクトのメンバーを Gitea の organization に合わせる。
 *
 * **`git.access` を持つ人だけを入れる。** 参加ユーザーを全員入れていた
 * 時期があり、「閲覧のみ」のユーザーが Gitea から直接クローンできる状態に
 * なっていた（7.1のマトリクスでは Git のアクセスは × ）。
 * アプリ側で画面を隠しても、Gitea 側の権限が開いていれば意味がない。
 *
 * 毎回まるごと突き合わせる方式にしてある。差分だけを追うと、
 * ユーザーの制限を変えたときに取りこぼす（制限の変更はメンバーの
 * 増減ではないので、差分の契機が無い）。5〜20人なら毎回引いても安い。
 */
export async function syncOrgMembers(projectId: number): Promise<{
  added: string[];
  removed: string[];
}> {
  const result = { added: [] as string[], removed: [] as string[] };
  if (!giteaEnabled()) return result;

  // リポジトリが1つも無ければ organization を作る必要もない
  const repoCount = await prisma.repository.count({ where: { projectId } });
  if (repoCount === 0) return result;

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: true },
  });

  const allowed = members.filter((m) =>
    can(m.user, "git.access", {
      projectId,
      isMember: true,
      isProjectAdmin: m.isProjectAdmin,
    }),
  );

  const org = await giteaOrgOf(projectId);

  // 入れるべき人を入れる
  const allowedLogins = new Set<string>();
  for (const m of allowed) {
    await ensureGiteaUser(m.userId);
    const login = await giteaLoginOf(m.userId);
    allowedLogins.add(login);
    await addOrgMember(org, login);
  }

  // いてはいけない人を外す。
  // アプリが API を叩くためのアカウントは外さない（外すと操作できなくなる）
  const service = await giteaServiceLogin();
  for (const login of await listOrgMembers(org)) {
    if (login === service) continue;
    if (allowedLogins.has(login)) continue;
    await removeOrgMember(org, login);
    result.removed.push(login);
  }

  result.added = [...allowedLogins];
  return result;
}
