import { describe, it, expect } from "vitest";
import {
  moveStatus,
  validateStatusOrder,
  assignDisplayOrders,
  displayOrderForNewStatus,
  type OrderableStatus,
} from "./status-order";

/**
 * docs/00-spec-verified.md 1章の制約を検証する。
 * - 標準4状態は並べ替えできない
 * - 追加した状態は Open より前、Closed より後には置けない
 */

const d = (id: number, name: string): OrderableStatus => ({
  id,
  name,
  isDefault: true,
});
const c = (id: number, name: string): OrderableStatus => ({
  id,
  name,
  isDefault: false,
});

/** 標準4状態のみ */
const base = () => [d(1, "未対応"), d(2, "処理中"), d(3, "処理済み"), d(4, "完了")];

/** 標準4状態 + カスタム2件（処理済みと完了の間） */
const withCustom = () => [
  d(1, "未対応"),
  d(2, "処理中"),
  d(3, "処理済み"),
  c(5, "レビュー中"),
  c(6, "保留"),
  d(4, "完了"),
];

const names = (s: OrderableStatus[]) => s.map((x) => x.name).join(" → ");

describe("validateStatusOrder", () => {
  it("標準4状態だけの並びは正しい", () => {
    expect(validateStatusOrder(base())).toBeNull();
  });

  it("カスタムが間に入っていても正しい", () => {
    expect(validateStatusOrder(withCustom())).toBeNull();
  });

  it("未対応が先頭でないと不正", () => {
    const s = [d(2, "処理中"), d(1, "未対応"), d(3, "処理済み"), d(4, "完了")];
    expect(validateStatusOrder(s)).toBe("「未対応」は必ず先頭に置きます");
  });

  it("完了が末尾でないと不正", () => {
    const s = [d(1, "未対応"), d(2, "処理中"), d(4, "完了"), d(3, "処理済み")];
    expect(validateStatusOrder(s)).toBe("「完了」は必ず末尾に置きます");
  });

  it("標準状態どうしの入れ替えは不正", () => {
    // 先頭と末尾は正しいが、処理中と処理済みが入れ替わっている
    const s = [d(1, "未対応"), d(3, "処理済み"), d(2, "処理中"), d(4, "完了")];
    expect(validateStatusOrder(s)).toBe("標準の4状態は並べ替えできません");
  });
});

describe("moveStatus: 標準4状態は動かせない", () => {
  for (const [id, name] of [
    [1, "未対応"],
    [2, "処理中"],
    [3, "処理済み"],
    [4, "完了"],
  ] as const) {
    it(`${name}（id=${id}）は動かせない`, () => {
      const r = moveStatus(withCustom(), id, 1);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("標準の4状態は並べ替えできません");
    });
  }
});

describe("moveStatus: カスタム状態は Open と Closed の間でだけ動く", () => {
  it("カスタムどうしを入れ替えられる", () => {
    const r = moveStatus(withCustom(), 5, 1); // レビュー中を下へ
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(names(r.statuses)).toBe(
        "未対応 → 処理中 → 処理済み → 保留 → レビュー中 → 完了",
      );
    }
  });

  it("カスタムを標準状態より上へ動かせる（Openの直後まで）", () => {
    const r = moveStatus(withCustom(), 5, -2); // レビュー中を2つ上へ
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(names(r.statuses)).toBe(
        "未対応 → レビュー中 → 処理中 → 処理済み → 保留 → 完了",
      );
    }
  });

  it("Open より前には置けない", () => {
    // レビュー中を Open の直後まで上げてから、さらに上へ
    const once = moveStatus(withCustom(), 5, -2);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const r = moveStatus(once.statuses, 5, -1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("「未対応」は必ず先頭に置きます");
  });

  it("Closed より後には置けない", () => {
    // 保留は Closed の直前にいる。さらに下へ動かそうとする
    const r = moveStatus(withCustom(), 6, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("「完了」は必ず末尾に置きます");
  });

  it("リストの外へは動かせない", () => {
    const s = [d(1, "未対応"), c(5, "レビュー中"), d(4, "完了")];
    // 下端を超える移動は、Closed 判定より先に範囲チェックで落ちる
    const r = moveStatus(s, 5, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("これ以上は動かせません");
  });

  it("存在しないidは動かせない", () => {
    const r = moveStatus(withCustom(), 999, 1);
    expect(r.ok).toBe(false);
  });
});

describe("displayOrder の採番", () => {
  it("1000刻みで振り直す", () => {
    expect(assignDisplayOrders(base())).toEqual([
      { id: 1, displayOrder: 1000 },
      { id: 2, displayOrder: 2000 },
      { id: 3, displayOrder: 3000 },
      { id: 4, displayOrder: 4000 },
    ]);
  });

  it("新しい状態は完了の手前に入る", () => {
    const current = [
      { id: 1, displayOrder: 1000 },
      { id: 2, displayOrder: 2000 },
      { id: 3, displayOrder: 3000 },
      { id: 4, displayOrder: 4000 },
    ];
    const order = displayOrderForNewStatus(current);
    expect(order).toBeGreaterThan(3000);
    expect(order).toBeLessThan(4000);
  });
});
