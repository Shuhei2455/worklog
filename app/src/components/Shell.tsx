import Link from "next/link";
import { Button } from "@/components/ui";
import { signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { visibleProjectIds } from "@/lib/session";
import { translator, type Locale } from "@/lib/i18n";
import { ProjectSidebar, type ProjectNavKey, type ProjectNavShow } from "./ProjectSidebar";

/**
 * 全画面共通の外枠。
 *
 * 本家と同じ骨格にしてある（docs/00-spec-verified.md 12.2）:
 *
 *   global-header  全幅 x 50px   bg #edf4f0
 *   core-wrapper
 *     ├ project-nav   200px幅   bg #4caf93   ← プロジェクト内の画面のみ
 *     └ content-outer
 *         ├ content-header  49px  bg 白
 *         └ content-main
 *
 * プロジェクトに属さない画面（ダッシュボード・ユーザー管理など）は
 * サイドバーを出さず、コンテンツを全幅で使う。
 */
export async function Shell({
  user,
  breadcrumbs = [],
  project,
  children,
}: {
  user: {
    name: string;
    id?: number;
    userType?: "admin" | "member" | "guest";
    locale?: Locale;
  };
  breadcrumbs?: Array<{ label: string; href?: string }>;
  /** プロジェクト内の画面なら渡す。サイドバーと content-header に使う */
  project?: {
    key: string;
    name: string;
    current: ProjectNavKey;
    show: ProjectNavShow;
  };
  children: React.ReactNode;
}) {
  const t = translator(user.locale ?? "ja");

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

  const headerLink = "text-base text-ink/80 hover:text-brand-700";

  return (
    <div className="min-h-screen">
      {/* ---- グローバルヘッダ（50px・#edf4f0） ---- */}
      <header className="relative flex min-h-[50px] items-center gap-3 bg-appbar px-3 md:h-[50px] md:gap-4 md:px-4">
        <Link href="/" className="text-lg font-semibold text-brand-700">
          {t("app.name")}
        </Link>

        <nav className="hidden items-center gap-4 md:flex">
          <Link href="/dashboard" className={headerLink}>
            {t("nav.dashboard")}
          </Link>
          <Link href="/" className={headerLink}>
            {t("nav.projects")}
          </Link>
          <Link href="/search" className={headerLink}>
            {t("nav.search")}
          </Link>
          <Link href="/notifications" className={`flex items-center gap-1 ${headerLink}`}>
            {t("nav.notifications")}
            {unread > 0 && (
              <span className="rounded-pill bg-red-600 px-1.5 text-sm text-white">
                {unread}
              </span>
            )}
          </Link>
        </nav>

        <details className="relative md:hidden">
          <summary className="flex h-9 cursor-pointer list-none items-center rounded border border-brand-700/30 px-3 font-semibold text-brand-700">
            <span className="mr-2 text-lg leading-none" aria-hidden="true">☰</span>
            <span>メニュー</span>
          </summary>
          <div className="absolute left-0 top-11 z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded border border-slate-200 bg-white p-2 shadow-lg">
            <nav className="grid gap-1">
              <Link href="/dashboard" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.dashboard")}</Link>
              <Link href="/" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.projects")}</Link>
              <Link href="/search" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.search")}</Link>
              <Link href="/notifications" className="rounded px-3 py-2 text-base hover:bg-brand-50">
                <span className="mr-2">{t("nav.notifications")}</span>
                {unread > 0 && <span className="rounded-pill bg-red-600 px-1.5 text-sm text-white">{unread}</span>}
              </Link>
              {user.userType === "admin" && (
                <>
                  <Link href="/users" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.users")}</Link>
                  <Link href="/teams" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.teams")}</Link>
                  <Link href="/audit" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.audit")}</Link>
                </>
              )}
              <Link href="/settings/password" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.password")}</Link>
              <Link href="/settings/api" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.apiKey")}</Link>
              <Link href="/settings/git" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("nav.git")}</Link>
              <Link href="/settings/language" className="rounded px-3 py-2 text-base hover:bg-brand-50">{t("common.language")}</Link>
              <form action={logout} className="border-t border-slate-200 pt-2">
                <Button variant="secondary" className="w-full">{t("common.logout")}</Button>
              </form>
            </nav>
          </div>
        </details>

        <span className="flex-1" />

        <span className="hidden text-base text-ink md:block">{user.name}</span>

        {/* スペース管理者だけに出す。チームはプロジェクトを跨ぐ設定 */}
        {user.userType === "admin" && (
          <>
            <Link href="/users" className={`hidden md:block ${headerLink}`}>
              {t("nav.users")}
            </Link>
            <Link href="/teams" className={`hidden md:block ${headerLink}`}>
              {t("nav.teams")}
            </Link>
            <Link href="/audit" className={`hidden md:block ${headerLink}`}>
              {t("nav.audit")}
            </Link>
          </>
        )}
        <Link href="/settings/language" className={`hidden md:block ${headerLink}`}>
          {t("common.language")}
        </Link>
        <Link href="/settings/password" className={`hidden md:block ${headerLink}`}>
          {t("nav.password")}
        </Link>
        <Link href="/settings/api" className={`hidden md:block ${headerLink}`}>
          {t("nav.apiKey")}
        </Link>
        <Link href="/settings/git" className={`hidden md:block ${headerLink}`}>
          {t("nav.git")}
        </Link>
        <form action={logout} className="hidden md:block">
          <Button variant="secondary">{t("common.logout")}</Button>
        </form>
      </header>

      {/* ---- サイドバー＋コンテンツ ---- */}
      {/* スマホではプロジェクトメニューを本文の上に積む。
          横並びのままだと、開閉メニューが本文と同じ行に入って画面から溢れる */}
      <div className="flex min-h-[calc(100vh-50px)] flex-col md:flex-row">
        {project && (
          <ProjectSidebar
            projectKey={project.key}
            projectName={project.name}
            current={project.current}
            show={project.show}
            locale={user.locale ?? "ja"}
          />
        )}

        <div className="min-w-0 flex-1">
          {/* content-header。本家はプロジェクト名を出す（49px・白） */}
          {(project || breadcrumbs.length > 0) && (
            <header className="flex min-h-[49px] flex-wrap items-center gap-2 border-b border-hairline bg-white px-3 py-2 md:h-[49px] md:flex-nowrap md:px-5 md:py-0">
              {project ? (
                <>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-600">
                    {project.key}
                  </span>
                  <span className="font-semibold">{project.name}</span>
                </>
              ) : (
                <nav className="flex items-center text-base text-slate-500">
                  {breadcrumbs.map((b, i) => (
                    <span key={i} className="flex items-center">
                      {i > 0 && <span className="mx-2 text-slate-300">/</span>}
                      {b.href ? (
                        <Link href={b.href} className="hover:text-brand-700">
                          {b.label}
                        </Link>
                      ) : (
                        <span className="text-ink">{b.label}</span>
                      )}
                    </span>
                  ))}
                </nav>
              )}
            </header>
          )}

          <main className="px-3 py-4 md:px-5 md:py-5">{children}</main>
        </div>
      </div>
    </div>
  );
}
