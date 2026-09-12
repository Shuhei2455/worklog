import { STATUS_ID_CLOSED, STATUS_ID_OPEN } from "@/lib/constants";

/**
 * 状態の並べ替え。
 *
 * 本家の制約(docs/00-spec-verified.md 1章):
 * - 標準4状態は削除できない
 * - 標準4状態は並べ替えできない
 * - 追加した状態は Open より前、Closed より後には置けない
 *
 * 目視デバッグに向かないので純関数に切り出して単体テストを書く。
 * UI とサーバーアクションの両方がこれを使う。
 */

export type OrderableStatus = {
  id: number;
  name: string;
  isDefault: boolean;
};

export type MoveResult =
  | { ok: true; statuses: OrderableStatus[] }
  | { ok: false; reason: string };

/**
 * 並びが制約を満たしているか。満たさない理由を返す（満たすなら null）。
 *
 * 標準4状態は「並べ替えできない」ので、相対順序が崩れていないことまで見る。
 * Open が先頭・Closed が末尾なだけでは足りず、
 * 処理中と処理済みが入れ替わっているのも不正。
 */
export function validateStatusOrder(statuses: OrderableStatus[]): string | null {
  if (statuses.length === 0) return "状態が1つもありません";

  const first = statuses[0];
  const last = statuses[statuses.length - 1];

  if (first.id !== STATUS_ID_OPEN) {
    return "「未対応」は必ず先頭に置きます";
  }
  if (last.id !== STATUS_ID_CLOSED) {
    return "「完了」は必ず末尾に置きます";
  }

  // 標準4状態だけ抜き出したとき、id の昇順（=既定の並び）になっているか
  const defaults = statuses.filter((s) => s.isDefault).map((s) => s.id);
  const sorted = [...defaults].sort((a, b) => a - b);
  if (defaults.join(",") !== sorted.join(",")) {
    return "標準の4状態は並べ替えできません";
  }

  return null;
}

/**
 * index 番目の状態を delta だけ動かした並びを返す。
 *
 * 動かせない場合は理由を返す。UI はこの理由をそのまま出す。
 * 「なぜ動かせないのか」が画面に出ないと、制約があること自体に気づけない。
 */
export function moveStatus(
  statuses: OrderableStatus[],
  id: number,
  delta: number,
): MoveResult {
  const index = statuses.findIndex((s) => s.id === id);
  if (index < 0) return { ok: false, reason: "対象の状態が見つかりません" };

  const target = statuses[index];
  if (target.isDefault) {
    return { ok: false, reason: "標準の4状態は並べ替えできません" };
  }

  const to = index + delta;
  if (to < 0 || to >= statuses.length) {
    return { ok: false, reason: "これ以上は動かせません" };
  }

  const next = [...statuses];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);

  const invalid = validateStatusOrder(next);
  if (invalid) return { ok: false, reason: invalid };

  return { ok: true, statuses: next };
}

/**
 * 並びから displayOrder を振り直す。
 *
 * 1000 刻みにするのは、後から間に挿し込むときに再採番を避けるため
 * （ボードの board_order と同じ考え方）。
 */
export function assignDisplayOrders(
  statuses: OrderableStatus[],
): Array<{ id: number; displayOrder: number }> {
  return statuses.map((s, i) => ({ id: s.id, displayOrder: (i + 1) * 1000 }));
}

/**
 * 新しく追加する状態の displayOrder。
 *
 * 追加した状態は Closed より後に置けないので、Closed の1つ手前に入れる。
 */
export function displayOrderForNewStatus(
  statuses: Array<{ id: number; displayOrder: number }>,
): number {
  const closed = statuses.find((s) => s.id === STATUS_ID_CLOSED);
  const beforeClosed = statuses
    .filter((s) => s.id !== STATUS_ID_CLOSED)
    .reduce((max, s) => Math.max(max, s.displayOrder), 0);

  if (!closed) return beforeClosed + 1000;
  // Closed の手前と、その1つ前の状態の中間に入れる
  return Math.floor((beforeClosed + closed.displayOrder) / 2);
}
