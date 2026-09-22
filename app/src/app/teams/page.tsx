import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { readFlash } from "@/lib/flash";
import { ActionResult, EmptyState, PageTitle, Button } from "@/components/ui";
import {
  createTeam,
  renameTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
} from "./actions";

/**
 * チームの管理（スペース全体）。
 *
 * 本家と同じく、チームはプロジェクトを跨ぐ。プロジェクトへの割り当ては
 * プロジェクト設定側で行う。ここは作成・名前の変更・所属の管理。
 */
export default async function Teams({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  // メッセージは通常フラッシュ（cookie）から来る。
  // 同じURLへ redirect すると画面が飛ぶため（lib/flash.ts）
  const flash = await readFlash("/teams");
  const user = await currentUser();

  // スペース管理者だけ。参加プロジェクトに関係しないのでコンテキストは空
  if (!can(user, "space.edit", {})) notFound();

  const [teams, users] = await Promise.all([
    prisma.team.findMany({
      include: {
        members: { include: { user: true } },
        _count: { select: { projectTeams: true } },
      },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    }),
    prisma.user.findMany({
      where: { disabledAt: null },
      orderBy: { userId: "asc" },
      select: { userId: true, name: true },
    }),
  ]);

  return (
    <Shell user={user} breadcrumbs={[{ label: "チーム" }]}>
      <PageTitle note={<>ユーザーをまとめる単位です。プロジェクトにチーム単位で追加でき、タスクの
        「お知らせ」先にも指定できます。本文では <code>{"<@T{id}>"}</code>{" "}
        でメンションします。</>}>チーム</PageTitle>

      <ActionResult ok={sp.ok ?? flash.ok} error={sp.error ?? flash.error} />

      <form action={createTeam} className="mt-4 flex items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-slate-500">チーム名</span>
          <input
            name="name"
            required
            placeholder="開発"
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <Button variant="primary">
          作成
        </Button>
      </form>

      {teams.length === 0 ? (
        <EmptyState className="mt-4">
          チームがありません
        </EmptyState>
      ) : (
        <ul className="mt-6 space-y-4">
          {teams.map((t) => (
            <li key={t.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <form action={renameTeam} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input
                    name="name"
                    defaultValue={t.name}
                    className="rounded border border-slate-300 px-2 py-1 text-sm font-medium"
                  />
                  <Button variant="secondary" size="xs">
                    名前を変更
                  </Button>
                </form>
                <span className="font-mono text-xs text-slate-400">
                  {"<@T" + t.id + ">"}
                </span>
                <span className="text-xs text-slate-500">
                  {t.members.length} 人 / {t._count.projectTeams} プロジェクト
                </span>
                <span className="flex-1" />
                <form action={deleteTeam}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button variant="danger" size="xs">削除</Button>
                </form>
              </div>

              {t.members.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {t.members.map((m) => (
                    <li
                      key={m.userId}
                      className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs"
                    >
                      {m.user.name}
                      <form action={removeTeamMember}>
                        <input type="hidden" name="teamId" value={t.id} />
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button variant="danger" size="xs" title="チームから外す">×</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              <form action={addTeamMember} className="mt-3 flex items-end gap-2">
                <input type="hidden" name="teamId" value={t.id} />
                <label className="text-sm">
                  <span className="block text-xs text-slate-500">追加するユーザー</span>
                  <input
                    name="userId"
                    required
                    list={`users-${t.id}`}
                    placeholder="ログインID"
                    className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <datalist id={`users-${t.id}`}>
                    {users.map((u) => (
                      <option key={u.userId} value={u.userId}>
                        {u.name}
                      </option>
                    ))}
                  </datalist>
                </label>
                <Button variant="secondary">
                  追加
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
