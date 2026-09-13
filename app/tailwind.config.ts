import type { Config } from "tailwindcss";

/**
 * 配色と書体は本家に合わせる（CLAUDE.md の方針変更、2026-09-13）。
 *
 * 値は本家の画面から `getComputedStyle` で採寸したもの
 * （docs/00-spec-verified.md 12章）。利用者が本家を使い慣れているため、
 * 移行時の学習コストを下げることを優先した。
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 文字・リンクのアクセント（#00836b）と、塗りのアクセント（#2c9a7a）は
        // 本家でも別の値。同じにすると選択中の色が濃すぎる
        brand: {
          50: "#eef6f3",
          100: "#d3e8e1",
          // 塗り（選択中のピル、バッジ、主ボタン）
          600: "#2c9a7a",
          // 文字・リンク
          700: "#00836b",
          // 押したとき
          800: "#006b57",
        },
        // 画面の地
        canvas: "#f0f0f0",
        // ヘッダ（淡い緑）
        appbar: "#edf4f0",
        // 本文の文字
        ink: "#222222",
        // 枠線。一般とボタンで濃さが違う
        hairline: "#bdbdbd",
        control: "#adadad",
      },
      fontFamily: {
        // 本家と同じ並び。Open Sans が無い環境ではヒラギノ→Helvetica に落ちる
        sans: [
          "Open Sans",
          "Hiragino Sans",
          "ヒラギノ角ゴシック",
          "Hiragino Kaku Gothic ProN",
          "ヒラギノ角ゴ ProN W3",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        // 本家の基準は 13px / 行の高さ 20px。
        // Tailwind の既定（16px）より小さく、一覧に入る情報量が変わる
        base: ["13px", "20px"],
        sm: ["12px", "18px"],
        xs: ["11px", "16px"],
        lg: ["15px", "22px"],
        xl: ["18px", "26px"],
      },
      borderRadius: {
        // ボタンとラベルはピル型（角丸20px）。ここが見た目のいちばん大きな違い
        pill: "20px",
      },
    },
  },
  plugins: [],
} satisfies Config;
