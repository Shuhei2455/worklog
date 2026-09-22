import { describe, it, expect } from "vitest";
import { buildBurndown, datesBetween, completedAtFrom, axisTicks } from "./burndown";
import { STATUS_ID_CLOSED, STATUS_ID_OPEN } from "@/lib/constants";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const issue = (over: Partial<Parameters<typeof buildBurndown>[0][number]> = {}) => ({
  id: 1,
  completedAt: null,
  estimatedHours: 0,
  createdAt: d("2026-09-01"),
  ...over,
});

describe("datesBetween", () => {
  it("終了日を含む", () => {
    expect(datesBetween(d("2026-09-01"), d("2026-09-03")).map((x) => x.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("同じ日なら1日", () => {
    expect(datesBetween(d("2026-09-01"), d("2026-09-01"))).toHaveLength(1);
  });

  it("開始が終了より後なら空（設定の誤り）", () => {
    expect(datesBetween(d("2026-09-05"), d("2026-09-01"))).toEqual([]);
  });

  it("月をまたぐ", () => {
    expect(datesBetween(d("2026-09-29"), d("2026-10-02"))).toHaveLength(4);
  });
});

describe("buildBurndown", () => {
  const range = { start: d("2026-09-01"), end: d("2026-09-05") };

  it("1件も完了していなければ残りは一定", () => {
    const out = buildBurndown([issue({ id: 1 }), issue({ id: 2 })], range, d("2026-09-05"));
    expect(out.map((p) => p.remainingCount)).toEqual([2, 2, 2, 2, 2]);
  });

  it("完了した日から残りが減る", () => {
    const out = buildBurndown(
      [
        issue({ id: 1, completedAt: new Date("2026-09-03T10:00:00Z") }),
        issue({ id: 2 }),
      ],
      range,
      d("2026-09-05"),
    );
    // 3日の終わりには完了しているので、3日から1件
    expect(out.map((p) => p.remainingCount)).toEqual([2, 2, 1, 1, 1]);
  });

  it("期間の途中で作られたタスクは、その日から積む", () => {
    const out = buildBurndown(
      [issue({ id: 1 }), issue({ id: 2, createdAt: d("2026-09-04") })],
      range,
      d("2026-09-05"),
    );
    expect(out.map((p) => p.remainingCount)).toEqual([1, 1, 1, 2, 2]);
  });

  it("予定時間でも積む。未入力は0として扱う", () => {
    const out = buildBurndown(
      [
        issue({ id: 1, estimatedHours: 8 }),
        issue({ id: 2, estimatedHours: 0 }),
        issue({
          id: 3,
          estimatedHours: 4,
          completedAt: new Date("2026-09-02T09:00:00Z"),
        }),
      ],
      range,
      d("2026-09-05"),
    );
    expect(out[0].remainingHours).toBe(12);
    expect(out[1].remainingHours).toBe(8); // 2日に4hぶんが完了
    expect(out[4].remainingHours).toBe(8);
  });

  it("理想線は初日に全量・終了日に0", () => {
    const out = buildBurndown([issue({ id: 1 }), issue({ id: 2 })], range, d("2026-09-05"));
    expect(out[0].idealCount).toBe(2);
    expect(out[4].idealCount).toBe(0);
    // 5日間なら中日は半分
    expect(out[2].idealCount).toBe(1);
  });

  it("1日だけの期間でも落ちない", () => {
    const out = buildBurndown([issue()], { start: d("2026-09-01"), end: d("2026-09-01") }, d("2026-09-01"));
    expect(out).toHaveLength(1);
    expect(out[0].idealCount).toBe(0);
  });

  it("未来の日に印を付ける（実績線をそこで止めるため）", () => {
    const out = buildBurndown([issue()], range, d("2026-09-03"));
    expect(out.map((p) => p.future)).toEqual([false, false, false, true, true]);
  });

  it("タスクが0件なら全部0", () => {
    const out = buildBurndown([], range, d("2026-09-05"));
    expect(out.every((p) => p.remainingCount === 0 && p.idealCount === 0)).toBe(true);
  });

  it("期間が不正なら空", () => {
    expect(buildBurndown([issue()], { start: d("2026-09-10"), end: d("2026-09-01") })).toEqual([]);
  });
});

describe("completedAtFrom", () => {
  it("未完了なら null", () => {
    expect(
      completedAtFrom({ statusId: STATUS_ID_OPEN, completedAt: null }, []),
    ).toBeNull();
  });

  it("完了に戻した履歴があれば、その最後の時刻を使う", () => {
    const at1 = new Date("2026-09-02T00:00:00Z");
    const at2 = new Date("2026-09-04T00:00:00Z");
    expect(
      completedAtFrom({ statusId: STATUS_ID_CLOSED, completedAt: at2 }, [
        { to: STATUS_ID_CLOSED, at: at1 },
        { to: STATUS_ID_OPEN, at: new Date("2026-09-03T00:00:00Z") },
        { to: STATUS_ID_CLOSED, at: at2 },
      ]),
    ).toEqual(at2);
  });

  it("履歴が無ければ completed_at を使う", () => {
    const at = new Date("2026-09-05T00:00:00Z");
    expect(
      completedAtFrom({ statusId: STATUS_ID_CLOSED, completedAt: at }, []),
    ).toEqual(at);
  });

  it("完了しているのに時刻が分からなければ null（残りとして数える）", () => {
    expect(
      completedAtFrom({ statusId: STATUS_ID_CLOSED, completedAt: null }, []),
    ).toBeNull();
  });
});

describe("axisTicks", () => {
  it("目盛りの数より max が小さければ整数を1つずつ（重複しない）", () => {
    expect(axisTicks(1)).toEqual([1, 0]);
    expect(axisTicks(3)).toEqual([3, 2, 1, 0]);
  });

  it("0件なら 0 だけ", () => {
    expect(axisTicks(0)).toEqual([0]);
  });

  it("十分大きければ5段階", () => {
    expect(axisTicks(20)).toEqual([20, 15, 10, 5, 0]);
  });

  it("割り切れなくても重複を出さない", () => {
    for (const m of [5, 6, 7, 11, 13, 17, 23, 100]) {
      const t = axisTicks(m);
      expect(new Set(t).size).toBe(t.length);
      expect(t[0]).toBe(m);
      expect(t[t.length - 1]).toBe(0);
    }
  });

  it("常に大きい順", () => {
    for (const m of [1, 4, 9, 50]) {
      const t = axisTicks(m);
      expect([...t].sort((a, b) => b - a)).toEqual(t);
    }
  });
});
