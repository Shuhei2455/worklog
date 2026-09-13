import type { Metadata } from "next";
import "./globals.css";

// 配色と書体は本家に合わせる(CLAUDE.md、2026-09-13の方針変更)。
// アプリ名は「Kadai」のまま——本家の名前を名乗ると、移設の検証で
// どちらを触っているか分からなくなる。
export const metadata: Metadata = {
  title: "Kadai",
  description: "自己ホスト型プロジェクト管理",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-canvas text-ink">{children}</body>
    </html>
  );
}
