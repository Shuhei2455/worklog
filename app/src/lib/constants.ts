/**
 * スペース共通の固定値。
 *
 * 優先度と完了理由は本家でもスペース共通でプロジェクト単位ではないため、
 * テーブルを作らずアプリ内定数として持つ(docs/01-design.md 4.2)。
 * 値の根拠は docs/00-spec-verified.md 1章。
 */

/** 優先度。3段階で、id=1 は欠番。この欠番も含めて本家と揃える */
export const PRIORITIES = [
  { id: 2, name: "High", label: "高" },
  { id: 3, name: "Normal", label: "中" },
  { id: 4, name: "Low", label: "低" },
] as const;

export const PRIORITY_IDS = PRIORITIES.map((p) => p.id);

/**
 * 優先度IDから表示名を引く。
 *
 * キーを number にしているのは、`PRIORITIES` が `as const` のため
 * `new Map(...)` だとキーが `2 | 3 | 4` に狭まり、DBから来た number を
 * 渡せなくなるから（本番ビルドの型チェックだけで落ちる）。
 */
export const PRIORITY_LABEL: Map<number, string> = new Map(
  PRIORITIES.map((p) => [p.id, p.label]),
);
export const DEFAULT_PRIORITY_ID = 3; // 中

/** 完了理由。id が 0 始まりである点に注意 */
export const RESOLUTIONS = [
  { id: 0, name: "Fixed", label: "対応済み" },
  { id: 1, name: "Won't Fix", label: "対応しない" },
  { id: 2, name: "Invalid", label: "無効" },
  { id: 3, name: "Duplication", label: "重複" },
  { id: 4, name: "Cannot Reproduce", label: "再現しない" },
] as const;

/**
 * 標準4状態。全プロジェクトに自動で入る。
 *
 * - 削除できない / 並べ替えできない
 * - 追加した状態は Open より前、Closed より後には置けない
 *   (docs/00-spec-verified.md 1章)
 *
 * 色は本家の配色を写さず独自に選んだ(決定 D4)。
 * 白背景でコントラスト比 4.5:1 以上になる濃さにしてある。
 * displayOrder は 1000 刻み(決定 D5)。本家で判明しているのは Open=1000 のみで、
 * 並べ替え制約は相対比較で足りるため実値を合わせる必要はない。
 */
export const DEFAULT_STATUSES = [
  { id: 1, name: "未対応", color: "#6b7280", displayOrder: 1000 },
  { id: 2, name: "処理中", color: "#1d4ed8", displayOrder: 2000 },
  { id: 3, name: "処理済み", color: "#0f766e", displayOrder: 3000 },
  { id: 4, name: "完了", color: "#15803d", displayOrder: 4000 },
] as const;

/** 「未対応」と「完了」の id。並べ替え制約の判定に使う */
export const STATUS_ID_OPEN = 1;
export const STATUS_ID_CLOSED = 4;

/**
 * プロジェクト作成時に入れる課題種別(決定 D8)。
 * 本家が何を自動生成するかは未確認。運用上この4つがあれば足りる。
 */
export const DEFAULT_ISSUE_TYPES = [
  { id: 1, name: "タスク", color: "#3b82f6", displayOrder: 1000 },
  { id: 2, name: "バグ", color: "#dc2626", displayOrder: 2000 },
  { id: 3, name: "要望", color: "#7c3aed", displayOrder: 3000 },
  { id: 4, name: "その他", color: "#64748b", displayOrder: 4000 },
] as const;

/** プロジェクトキーの文字種(決定 D1)。DBの CHECK 制約と同じ式にする */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,9}$/;
