import { describe, it, expect } from "vitest";
import {
  orderBetween,
  orderForPosition,
  needsRenumber,
  renumber,
  ORDER_STEP,
  type CardRef,
} from "./board-order";

const cards = (...orders: number[]): CardRef[] =>
  orders.map((boardOrder, i) => ({ id: i + 1, boardOrder }));

describe("隣接2件の中間値", () => {
  it("間に入れると中間値になる", () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
  });

  it("先頭に入れると1つ手前になる", () => {
    expect(orderBetween(undefined, 1000)).toBe(0);
  });

  it("末尾に入れると1つ後ろになる", () => {
    expect(orderBetween(3000, undefined)).toBe(4000);
  });

  it("空の列なら基準値", () => {
    expect(orderBetween()).toBe(ORDER_STEP);
  });

  it("何度入れても既存の順序を壊さない", () => {
    // 1000 と 2000 の間に入れ続けても、常に両者の間に収まる
    let lo = 1000;
    const hi = 2000;
    for (let i = 0; i < 20; i++) {
      const mid = orderBetween(lo, hi);
      expect(mid).toBeGreaterThan(lo);
      expect(mid).toBeLessThan(hi);
      lo = mid;
    }
  });
});

describe("位置から order を決める", () => {
  const list = cards(1000, 2000, 3000);

  it("先頭へ", () => {
    expect(orderForPosition(list, 0)).toBe(0);
  });

  it("2番目へ", () => {
    expect(orderForPosition(list, 1)).toBe(1500);
  });

  it("末尾へ", () => {
    expect(orderForPosition(list, 3)).toBe(4000);
  });

  it("空の列へ", () => {
    expect(orderForPosition([], 0)).toBe(ORDER_STEP);
  });
});

describe("桁を使い切ったときの備え", () => {
  it("通常の間隔では再採番しない", () => {
    expect(needsRenumber(1000, 2000)).toBe(false);
  });

  it("差が極小になったら再採番する", () => {
    expect(needsRenumber(1000, 1000 + 1e-9)).toBe(true);
  });

  it("端は再採番の対象にしない", () => {
    // 先頭・末尾は無限に外側へ伸ばせるので詰まらない
    expect(needsRenumber(undefined, 1000)).toBe(false);
    expect(needsRenumber(1000, undefined)).toBe(false);
  });

  it("再採番は1000刻みに戻す", () => {
    expect(renumber([7, 3, 9])).toEqual([
      { id: 7, boardOrder: 1000 },
      { id: 3, boardOrder: 2000 },
      { id: 9, boardOrder: 3000 },
    ]);
  });
});
