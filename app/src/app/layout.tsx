import type { Metadata } from "next";

// アプリ名・配色は本家を模倣しない(CLAUDE.md「名称と意匠は模倣しない」)。
// 仮称「Kadai」。正式名称は職場展開前に決める。
export const metadata: Metadata = {
  title: "Kadai",
  description: "自己ホスト型プロジェクト管理",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
