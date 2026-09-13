import Link from "next/link";

/**
 * 画面の共通部品。
 *
 * M0〜M5 を積み上げる過程で、同じ見た目を毎回手書きしていた。
 * 副ボタンの指定だけで129箇所あり、M4 で作った Git 系はリンク色が
 * `sky-700`（他は `brand-700`）とずれていた。**同じ意味のものは同じ見た目**に
 * するため、ここに集約する。
 *
 * 配色は独自のまま（CLAUDE.md「意匠は模倣しない」）。`brand` は
 * tailwind.config.ts で定義したニュートラル寄りの青。
 *
 * Client Component にはしない。状態を持たないので、Server Component の
 * ままで足りる（`action` を受けるフォームの中でも使える）。
 */

// ---- ボタン ----------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "danger" | "dangerOutline" | "link";
type ButtonSize = "md" | "sm" | "xs";

// `whitespace-nowrap shrink-0` が要る。inline-flex は縮むので、狭い枠に入れると
// 文字が折り返してボタンだけ背が高くなる（/users の「再設定」が48pxになっていた）
// 本家のボタンは**ピル型**（角丸20px）。ここが見た目のいちばん大きな違いだった
// （docs/00-spec-verified.md 12.2）
const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-pill transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // 塗りは #2c9a7a（brand-600）。本家は文字色のアクセント(#00836b)と別の値
  primary: "bg-brand-600 text-white hover:bg-brand-800",
  // 本家の副ボタンは白背景・枠 #adadad・文字 #222
  secondary: "border border-control bg-white text-ink hover:bg-slate-50",
  // 消す操作。枠は付けない（一覧の行に並ぶことが多く、枠があると重い）
  danger: "text-red-700 hover:underline",
  // 消す操作のうち、押し間違えると困るもの（状態の削除など）は枠を付ける
  dangerOutline:
    "border border-control bg-white text-red-700 enabled:hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40",
  link: "text-brand-700 hover:underline",
};

// 本家の副ボタンは高さ32px。sm をそれに合わせ、md は目立たせる用に少し大きく
const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: "h-9 px-5 text-base",
  sm: "h-8 px-4 text-base",
  xs: "h-6 px-3 text-sm",
};

/** 枠を持たない種別は、サイズの余白を付けない方が行に馴染む */
const BORDERLESS: ReadonlySet<ButtonVariant> = new Set(["danger", "link"]);

export function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizing = BORDERLESS.has(variant)
    ? size === "xs"
      ? "text-xs"
      : "text-sm"
    : BUTTON_SIZE[size];

  return (
    <button
      {...rest}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${sizing} ${className}`}
    />
  );
}

/** ボタンに見せるリンク。遷移なのでボタンにしない（右クリックで開けるように） */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "sm",
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
}) {
  const sizing = BORDERLESS.has(variant)
    ? size === "xs"
      ? "text-xs"
      : "text-sm"
    : BUTTON_SIZE[size];

  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${sizing} ${className}`}
    >
      {children}
    </Link>
  );
}

// ---- 見出しとページの骨格 ---------------------------------------------------

/**
 * ページの見出し。右側に操作を並べられる。
 *
 * 32箇所で `text-xl font-semibold` を手書きしていた。
 */
export function PageTitle({
  children,
  actions,
  note,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** 見出しの下に出す説明。`<strong>` などを含められるよう ReactNode で受ける */
  note?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{children}</h1>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {note && <p className="mt-1 text-sm text-slate-500">{note}</p>}
    </div>
  );
}

/** 設定画面の節。settings/page.tsx にインラインで書いていたものを出した */
export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded border border-hairline bg-white">
      <div className="border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** 枠付きのまとまり。一覧やフォームを囲む */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded border border-hairline bg-white ${className}`}>
      {children}
    </div>
  );
}

// ---- 空状態と通知 ----------------------------------------------------------

/**
 * 何も無いときの表示。
 *
 * 「なし」だけ出す箇所と、枠付きで中央寄せにする箇所が混ざっていた。
 * **一覧が空のときは枠付き**（そこに一覧があると分かる）、
 * 属性の値が空のときは薄い文字だけ、で使い分ける。
 */
export function EmptyState({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`rounded border border-hairline bg-white px-3 py-6 text-center text-sm text-slate-500 ${className}`}
    >
      {children}
    </p>
  );
}

/** 値が未設定であることを示す薄い文字。一覧の中で使う */
export function NoValue({ children = "なし" }: { children?: React.ReactNode }) {
  return <p className="text-xs text-slate-400">{children}</p>;
}

type NoticeTone = "ok" | "error" | "warn";

const NOTICE_TONE: Record<NoticeTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
};

/**
 * 操作の結果や注意。
 *
 * サーバーアクションは `?ok=` / `?error=` で結果を返す作りなので、
 * それをそのまま渡せる形にしてある。
 */
export function Notice({
  tone,
  children,
  className = "",
}: {
  tone: NoticeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`rounded border px-3 py-2 text-sm ${NOTICE_TONE[tone]} ${className}`}
    >
      {children}
    </p>
  );
}

/** `?ok=` / `?error=` をまとめて出す。全画面で同じ並びにする */
export function ActionResult({
  ok,
  error,
}: {
  ok?: string;
  error?: string;
}) {
  if (!ok && !error) return null;
  return (
    <div className="mb-4 space-y-2">
      {ok && <Notice tone="ok">{ok}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

// ---- 表とフォーム ----------------------------------------------------------

/** 一覧の表。ヘッダの見た目を揃える */
export function Table({
  head,
  children,
}: {
  head: React.ReactNode[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded border border-hairline bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline bg-slate-50 text-xs text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** ラベル付きの入力欄。ラベルと入力の間隔を揃える */
export function Field({
  label,
  note,
  className = "",
  children,
}: {
  label: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="block text-xs text-slate-500">
        {label}
        {note && <span className="ml-1 text-slate-400">{note}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/** 入力欄の見た目。`<input>` と `<select>` と `<textarea>` で共通 */
export const inputClass =
  "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-600 focus:outline-none";


// ---- 状態を示すトグル --------------------------------------------------------

type ToneName = "amber" | "emerald" | "brand" | "slate";

const TOGGLE_ON: Record<ToneName, string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-800",
  brand: "border-brand-600 bg-brand-600 text-white",
  slate: "border-slate-400 bg-slate-100 text-slate-700",
};

/**
 * 押すと状態が変わるチップ。
 *
 * ★・ウォッチ・必須/任意・課題連携ON/OFF など、**いまの状態を見せつつ押せる**もの。
 * 普通のボタンと同じ見た目にすると「押せること」は伝わっても
 * 「いまどっちか」が分からないので、別部品にしてある。
 *
 * 高さは Button と揃える（同じ行に並ぶため）。
 */
export function ToggleChip({
  on,
  tone = "brand",
  size = "sm",
  className = "",
  ...rest
}: {
  on: boolean;
  tone?: ToneName;
  size?: "sm" | "xs";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizing = size === "xs" ? "h-6 px-3 text-sm" : "h-8 px-4 text-base";
  const state = on
    ? TOGGLE_ON[tone]
    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50";

  return (
    <button
      {...rest}
      aria-pressed={on}
      className={`${BUTTON_BASE} border ${state} ${sizing} ${className}`}
    />
  );
}


/**
 * 選択中を示すピル（リンク版）。
 *
 * タイムスケール・グルーピング・タグの絞り込み・PRの状態など、
 * **URLで切り替える選択肢**に使う。ToggleChip はフォーム送信の
 * ボタンなので、遷移のこちらとは別にしてある。
 */
export function PillLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-pill border px-3 text-sm transition-colors ${
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-control bg-white text-ink hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}


// ---- 状態のラベル ------------------------------------------------------------

/**
 * 状態のラベル。
 *
 * 本家は**塗りのピル**（白文字・12px・角丸20px・余白 1px 6px）で、
 * 色は状態ごとに違う（docs/00-spec-verified.md 12.1）。
 * こちらは「小さい丸＋文字」で描いていたので、本家に合わせた。
 *
 * 4色とも白文字を前提に選ばれているため、文字は常に白にする。
 */
export function StatusLabel({
  name,
  color,
  className = "",
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-pill px-[6px] py-px text-sm text-white ${className}`}
      style={{ background: color }}
    >
      {name}
    </span>
  );
}
