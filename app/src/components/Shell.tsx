import Link from "next/link";
import { signOut } from "@/auth";

/** 全画面共通の外枠。ヘッダーとパンくずだけ */
export function Shell({
  user,
  breadcrumbs = [],
  children,
}: {
  user: { name: string };
  breadcrumbs?: Array<{ label: string; href?: string }>;
  children: React.ReactNode;
}) {
  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
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
