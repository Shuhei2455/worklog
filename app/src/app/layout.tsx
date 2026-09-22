import type { Metadata } from "next";
import "./globals.css";

// 配色と書体は本家に合わせる(CLAUDE.md、2026-09-13の方針変更)。
// アプリ名は「Worklog」（2026-09-22 にユーザーの指示で Kadai から改名）。
// 本家の名前を名乗らない方針は変わらない——どちらを触っているか
// 分からなくなると、移設の検証で実際に困る。
export const metadata: Metadata = {
  title: "Worklog",
  description: "自己ホスト型プロジェクト管理",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-canvas text-ink">{children}</body>
    </html>
  );
}
