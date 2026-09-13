import Link from "next/link";
import { signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { visibleProjectIds } from "@/lib/session";

/** 全画面共通の外枠。ヘッダーとパンくずだけ */
export async function Shell({
  user,
  breadcrumbs = [],
  children,
}: {
  user: { name: string; id?: number; userType?: "admin" | "member" | "guest" };
  breadcrumbs?: Array<{ label: string; href?: string }>;
  children: React.ReactNode;
}) {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // 未読の通知数。参加していないプロジェクトのぶんは数えない
  let unread = 0;
  if (user.id) {
    const visible = await visibleProjectIds(user.id);
    unread = await prisma.notification.count({
      where: { userId: user.id, readAt: null, activity: { projectId: { in: visible } } },
    });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <Link href="/" className="text-lg font-semibold text-brand-700">
            Kadai
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-slate-500 hover:text-brand-700"
          >
            ダッシュボード
          </Link>
          <Link
            href="/search"
            className="text-sm text-slate-500 hover:text-brand-700"
          >
            検索
          </Link>
          <Link
            href="/notifications"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700"
          >
            通知
            {unread > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">
                {unread}
              </span>
            )}
          </Link>
          <nav className="flex-1 text-sm text-slate-500">
            {breadcrumbs.map((b, i) => (
              <span key={i}>
                <span className="mx-2 text-slate-300">/</span>
                {b.href ? (
                  <Link href={b.href} className="hover:text-brand-700">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-slate-700">{b.label}</span>
                )}
              </span>
            ))}
          </nav>
          <span className="text-sm text-slate-600">{user.name}</span>
          {/* スペース管理者だけに出す。チームはプロジェクトを跨ぐ設定 */}
          {user.userType === "admin" && (
            <>
              <Link
                href="/teams"
                className="text-sm text-slate-500 hover:text-brand-700"
              >
                チーム
              </Link>
              <Link
                href="/audit"
                className="text-sm text-slate-500 hover:text-brand-700"
              >
                監査ログ
              </Link>
            </>
          )}
          {/* 個人設定。どちらもURLを直打ちしないと辿れない状態だった */}
          <Link
            href="/settings/password"
            className="text-sm text-slate-500 hover:text-brand-700"
          >
            パスワード
          </Link>
          <Link
            href="/settings/api"
            className="text-sm text-slate-500 hover:text-brand-700"
          >
            APIキー
          </Link>
          <Link
            href="/settings/git"
            className="text-sm text-slate-500 hover:text-brand-700"
          >
            Git
          </Link>
          <form action={logout}>
            <button className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
              ログアウト
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
