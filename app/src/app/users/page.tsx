import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, toRoleType } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PASSWORD_MIN_LENGTH } from "@/lib/password";
import {
  createUser,
  updateUser,
  toggleUserDisabled,
  resetUserPassword,
} from "./actions";

const USER_TYPES = [
  { value: "admin", label: "管理者" },
  { value: "member", label: "一般ユーザー" },
  { value: "guest", label: "ゲスト" },
];

const RESTRICTIONS = [
  { value: "none", label: "制限なし" },
  { value: "issue_create_only", label: "登録のみ" },
  { value: "issue_view_only", label: "閲覧のみ" },
];

const jst = (d: Date | null) =>
  d ? d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) : "—";

/**
 * ユーザーの管理（スペース管理者のみ）。
 *
 * 権限は「種別 × 制限 × プロジェクト管理者」の3軸（00-spec-verified.md 7章）。
 * ここで触るのは前の2つ。プロジェクト管理者はプロジェクト設定側。
 */
export default async function Users({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!can(user, "space.edit", {})) notFound();

  const users = await prisma.user.findMany({
    orderBy: [{ disabledAt: "asc" }, { userId: "asc" }],
    include: { _count: { select: { projectMembers: true } } },
  });

  return (
    <Shell user={user} breadcrumbs={[{ label: "ユーザー" }]}>
      <h1 className="text-xl font-semibold">ユーザー</h1>
      <p className="mt-1 text-sm text-slate-500">
        権限は「種別 × 制限 × プロジェクト管理者」の3軸です。ここで触るのは
        前の2つで、プロジェクト管理者は各プロジェクトの設定で付けます。
        <strong>削除はできません</strong>（活動履歴から参照されるため、
        無効化で止めます）。
      </p>

      {sp.ok && (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {sp.ok}
        </p>
      )}
      {sp.error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </p>
      )}

      {/* ---- 追加 ---- */}
      <form
        action={createUser}
        className="mt-4 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3"
      >
        <label className="text-sm">
          <span className="block text-xs text-slate-500">ログインID</span>
          <input
            name="userId"
            required
            placeholder="tanaka"
            className="mt-1 w-32 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">名前</span>
          <input
            name="name"
            required
            placeholder="田中"
            className="mt-1 w-28 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">メール</span>
          <input
            name="email"
            type="email"
            required
            placeholder="tanaka@example.local"
            className="mt-1 w-52 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">初期パスワード</span>
          <input
            name="password"
            type="password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            className="mt-1 w-40 rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">種別</span>
          <select
            name="userType"
            defaultValue="member"
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            {USER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500">制限</span>
          <select
            name="restriction"
            defaultValue="none"
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            {RESTRICTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button className="h-8 rounded bg-brand-700 px-4 text-sm text-white hover:bg-brand-800">
          追加
        </button>
      </form>

      {/* ---- 一覧 ---- */}
      <div className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="px-3 py-2 text-left">ログインID</th>
              <th className="px-3 py-2 text-left">名前</th>
              <th className="px-3 py-2 text-left">メール</th>
              <th className="px-3 py-2 text-left">種別 / 制限</th>
              <th className="px-3 py-2 text-left">roleType</th>
              <th className="px-3 py-2 text-left">参加</th>
              <th className="px-3 py-2 text-left">最終ログイン</th>
              <th className="px-3 py-2 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className={`border-b border-slate-100 last:border-0 ${
                  u.disabledAt ? "bg-slate-50 text-slate-400" : ""
                }`}
              >
                <td className="px-3 py-2 font-mono text-xs">{u.userId}</td>
                <td className="px-3 py-2">
                  {u.name}
                  {u.disabledAt && (
                    <span className="ml-1 rounded bg-slate-200 px-1 text-xs">無効</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{u.email}</td>
                <td className="px-3 py-2">
                  <form action={updateUser} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={u.id} />
                    <select
                      name="userType"
                      defaultValue={u.userType}
                      className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                    >
                      {USER_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      name="restriction"
                      defaultValue={u.restriction}
                      className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                    >
                      {RESTRICTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button className="rounded border border-slate-300 px-1.5 py-0.5 text-xs hover:bg-slate-50">
                      保存
                    </button>
                  </form>
                </td>
                {/* API が返す値。ゲストは区別されない（7章） */}
                <td className="px-3 py-2 text-xs">{toRoleType(u)}</td>
                <td className="px-3 py-2 text-xs">{u._count.projectMembers}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {jst(u.lastLoginAt)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={toggleUserDisabled}>
                      <input type="hidden" name="id" value={u.id} />
                      <button
                        className={`text-xs hover:underline ${
                          u.disabledAt ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        {u.disabledAt ? "有効化" : "無効化"}
                      </button>
                    </form>
                    <form action={resetUserPassword} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <input
                        type="password"
                        name="password"
                        placeholder="新しいパスワード"
                        minLength={PASSWORD_MIN_LENGTH}
                        className="w-32 rounded border border-slate-300 px-1 py-0.5 text-xs"
                      />
                      <button className="text-xs text-brand-700 hover:underline">
                        再設定
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
