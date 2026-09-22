import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { EmptyState, PageTitle, Button } from "@/components/ui";
import { AUDIT_ACTIONS, auditLabel } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

const PER_PAGE = 50;

const jst = (d: Date) =>
  d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });

/**
 * 監査ログの閲覧（スペース管理者のみ）。
 *
 * 活動履歴と違い、**管理操作**だけが並ぶ。消えたものの名前は `detail` に
 * 残してあるので、対象が削除済みでも何が起きたか分かる（決定 D25）。
 */
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; userId?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!can(user, "space.edit", {})) notFound();

  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const where: Prisma.AuditLogWhereInput = {
    ...(sp.action ? { action: sp.action } : {}),
    ...(sp.userId ? { userId: Number(sp.userId) } : {}),
  };

  const [logs, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { userId: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({
      orderBy: { userId: "asc" },
      select: { id: true, userId: true, name: true },
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.action) p.set("action", sp.action);
    if (sp.userId) p.set("userId", sp.userId);
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return p.toString();
  };

  return (
    <Shell user={user} breadcrumbs={[{ label: "監査ログ" }]}>
      <PageTitle note={<>権限の変更・削除・APIキーの発行など、<strong>管理操作</strong>の記録です。
        タスクやWikiの中身の変化は各画面の「コメントと変更履歴」にあります。</>}>監査ログ</PageTitle>

      <form className="mt-4 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
        <label>
          <span className="block text-xs text-slate-500">操作</span>
          <select
            name="action"
            defaultValue={sp.action ?? ""}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">すべて</option>
            {Object.entries(AUDIT_ACTIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-slate-500">実行者</span>
          <select
            name="userId"
            defaultValue={sp.userId ?? ""}
            className="mt-1 rounded border border-slate-300 px-2 py-1"
          >
            <option value="">すべて</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.userId}）
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary">
          絞り込む
        </Button>
        {(sp.action || sp.userId) && (
          <Link href="/audit" className="text-xs text-slate-500 hover:underline">
            クリア
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-slate-500">
        {total} 件中 {total === 0 ? 0 : (page - 1) * PER_PAGE + 1}〜
        {Math.min(page * PER_PAGE, total)} 件
      </p>

      {logs.length === 0 ? (
        <EmptyState className="mt-4">
          記録がありません
        </EmptyState>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="px-3 py-2 text-left">日時</th>
                <th className="px-3 py-2 text-left">実行者</th>
                <th className="px-3 py-2 text-left">操作</th>
                <th className="px-3 py-2 text-left">対象</th>
                <th className="px-3 py-2 text-left">詳細</th>
                <th className="px-3 py-2 text-left">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                    {jst(l.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {l.user ? l.user.name : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {auditLabel(l.action)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {l.targetType}
                    {l.targetId ? ` ${l.targetId}` : ""}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">
                    {l.detail ? JSON.stringify(l.detail) : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-slate-400">
                    {l.ipAddress ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lastPage > 1 && (
        <div className="mt-4 flex justify-between text-sm">
          {page > 1 ? (
            <Link
              href={`/audit?${qs({ page: String(page - 1) })}`}
              className="text-brand-700 hover:underline"
            >
              ← 新しい
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate-500">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link
              href={`/audit?${qs({ page: String(page + 1) })}`}
              className="text-brand-700 hover:underline"
            >
              古い →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </Shell>
  );
}
