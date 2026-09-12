import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 本家の配色は使わない(CLAUDE.md「意匠は模倣しない」)。
        // 独自にニュートラル寄りの青を基調にする
        brand: {
          50: "#eff5ff",
          100: "#dbe7fe",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
