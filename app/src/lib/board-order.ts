/**
 * ボードのカードの並び順。
 *
 * 本家は「上から順に着手する」運用を想定していて、カードの並び順を
 * 自由に変えられて保存される(docs/00-spec-verified.md 6章)。
 *
 * `board_order` は float で持ち、**隣接2件の中間値**を入れる。
 * 整数の連番にすると1件動かすたびに列全体を再採番することになり、
 * 同時に操作されたときに競合する。
 */

/** 間隔の基準。末尾に足すときはこの値ずつ進める */
export const ORDER_STEP = 1000;

/**
 * `prev` と `next` の間に入る値を返す。
 *
 * - 先頭に入れる: `prev` を undefined にする
 * - 末尾に入れる: `next` を undefined にする
 * - 空の列に入れる: 両方 undefined
 */
export function orderBetween(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return ORDER_STEP;
  if (prev === undefined) return next! - ORDER_STEP;
  if (next === undefined) return prev + ORDER_STEP;
  return (prev + next) / 2;
}

/**
 * float の中間値は繰り返すと桁を使い切る。
 * 隣との差がこれを下回ったら、その列だけ再採番する。
 *
 * 1000 から始めて半分にし続けると、倍精度の仮数部が尽きるのは
 * 50回ほど先。実運用ではまず起きないが、起きたときに壊れないようにしておく。
 */
export const MIN_GAP = 1e-6;

export function needsRenumber(prev?: number, next?: number): boolean {
  if (prev === undefined || next === undefined) return false;
  return Math.abs(next - prev) < MIN_GAP;
}

/** 列の全カードを 1000 刻みで振り直す */
export function renumber(ids: number[]): Array<{ id: number; boardOrder: number }> {
  return ids.map((id, i) => ({ id, boardOrder: (i + 1) * ORDER_STEP }));
}

export type CardRef = { id: number; boardOrder: number };

/**
 * カードを「列の index 番目」に移動したときの新しい order を計算する。
 *
 * `cards` は移動先の列の現在の並び（boardOrder 昇順）。
 * 同じ列の中で動かす場合は、移動するカード自身を除いた並びを渡すこと。
 */
export function orderForPosition(cards: CardRef[], index: number): number {
  const prev = index > 0 ? cards[index - 1]?.boardOrder : undefined;
  const next = cards[index]?.boardOrder;
  return orderBetween(prev, next);
}
