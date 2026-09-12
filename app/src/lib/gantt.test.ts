import { describe, it, expect } from "vitest";
import {
  resolveGanttBar,
  defaultGanttStart,
  barOffset,
  type GanttIssueInput,
} from "./gantt";
import { STATUS_ID_OPEN, STATUS_ID_CLOSED } from "./constants";

/**
 * docs/00-spec-verified.md 5章の表をそのまま検証する。
 *
 * ここは過去に2回間違えている箇所:
 * - v1設計: 「開始日と期限日が揃った課題だけ」と誤っていた
 * - v2設計: 「4パターン」かつ「マイルストーンと完了日が並列」と誤っていた
 *
 * 正しくは5通り＋非表示の6分岐で、マイルストーンが完了日より優先される。
 */

const d = (s: string) => new Date(s + "T00:00:00");

const issue = (o: Partial<GanttIssueInput> = {}): GanttIssueInput => ({
  startDate: null,
  dueDate: null,
  statusId: STATUS_ID_OPEN,
  completedAt: null,
  ...o,
});

describe("表示条件の6分岐", () => {
  it("1. 開始日と期限日の両方あり → 期間の帯", () => {
    const bar = resolveGanttBar(
      issue({ startDate: d("2026-09-01"), dueDate: d("2026-09-10") }),
    );
    expect(bar).toEqual({ from: d("2026-09-01"), to: d("2026-09-10"), kind: "range" });
  });

  it("2. 開始日のみ → 開始日の位置にだけ帯", () => {
    const bar = resolveGanttBar(issue({ startDate: d("2026-09-01") }));
    expect(bar).toEqual({ from: d("2026-09-01"), to: d("2026-09-01"), kind: "startOnly" });
  });

  it("3. 期限日のみ → 期限日の位置にだけ帯", () => {
    const bar = resolveGanttBar(issue({ dueDate: d("2026-09-20") }));
    expect(bar).toEqual({ from: d("2026-09-20"), to: d("2026-09-20"), kind: "dueOnly" });
  });

  it("4. 日付なし・マイルストーンに終了日あり → 終了日に帯", () => {
    const bar = resolveGanttBar(
      issue({ milestoneReleaseDueDates: [d("2026-10-31")] }),
    );
    expect(bar).toEqual({ from: d("2026-10-31"), to: d("2026-10-31"), kind: "milestone" });
  });

  it("5. 日付なし・マイルストーンに終了日なし・完了 → 完了日に帯", () => {
    const bar = resolveGanttBar(
      issue({
        statusId: STATUS_ID_CLOSED,
        completedAt: d("2026-09-05"),
        // 終了日の無いマイルストーンが付いている状態
        milestoneReleaseDueDates: [null, undefined],
      }),
    );
    expect(bar).toEqual({ from: d("2026-09-05"), to: d("2026-09-05"), kind: "completed" });
  });

  it("6. どれにも当たらなければ表示しない", () => {
    expect(resolveGanttBar(issue())).toBeNull();
  });
});

describe("マイルストーンは完了日より優先される", () => {
  // v2設計が「並列」と誤っていた箇所。
  // 並列だと思って実装すると、終了日のあるマイルストーンを持つ完了課題が
  // 完了日の位置に出てしまう
  it("完了していてもマイルストーンの終了日が優先", () => {
    const bar = resolveGanttBar(
      issue({
        statusId: STATUS_ID_CLOSED,
        completedAt: d("2026-09-05"),
        milestoneReleaseDueDates: [d("2026-10-31")],
      }),
    );
    expect(bar?.kind).toBe("milestone");
    expect(bar?.from).toEqual(d("2026-10-31"));
  });

  it("マイルストーンが無くても完了していれば出る", () => {
    const bar = resolveGanttBar(
      issue({ statusId: STATUS_ID_CLOSED, completedAt: d("2026-09-05") }),
    );
    expect(bar?.kind).toBe("completed");
  });

  it("完了していても completedAt が無ければ出ない", () => {
    const bar = resolveGanttBar(issue({ statusId: STATUS_ID_CLOSED }));
    expect(bar).toBeNull();
  });

  it("完了以外の状態では完了日を見ない", () => {
    const bar = resolveGanttBar(
      issue({ statusId: STATUS_ID_OPEN, completedAt: d("2026-09-05") }),
    );
    expect(bar).toBeNull();
  });
});

describe("日付が優先される", () => {
  it("開始日があればマイルストーンより優先", () => {
    const bar = resolveGanttBar(
      issue({
        startDate: d("2026-09-01"),
        milestoneReleaseDueDates: [d("2026-10-31")],
      }),
    );
    expect(bar?.kind).toBe("startOnly");
  });

  it("期限日があれば完了日より優先", () => {
    const bar = resolveGanttBar(
      issue({
        dueDate: d("2026-09-20"),
        statusId: STATUS_ID_CLOSED,
        completedAt: d("2026-09-05"),
      }),
    );
    expect(bar?.kind).toBe("dueOnly");
  });
});

describe("端の扱い", () => {
  it("期限が開始より前でも帯が裏返らない", () => {
    const bar = resolveGanttBar(
      issue({ startDate: d("2026-09-10"), dueDate: d("2026-09-01") }),
    );
    expect(bar?.from).toEqual(d("2026-09-01"));
    expect(bar?.to).toEqual(d("2026-09-10"));
  });

  it("マイルストーンが複数なら最も早い終了日を使う（決定 D15）", () => {
    const bar = resolveGanttBar(
      issue({
        milestoneReleaseDueDates: [d("2026-12-31"), d("2026-10-31"), null],
      }),
    );
    expect(bar?.from).toEqual(d("2026-10-31"));
  });

  it("時刻が入っていても日付だけで判定する", () => {
    const bar = resolveGanttBar(
      issue({ startDate: new Date("2026-09-01T23:45:00") }),
    );
    expect(bar?.from.getHours()).toBe(0);
  });
});

describe("表示開始日の既定", () => {
  it("当日の1週間前", () => {
    expect(defaultGanttStart(d("2026-09-12"))).toEqual(d("2026-09-05"));
  });

  it("月をまたいでも正しい", () => {
    expect(defaultGanttStart(d("2026-09-03"))).toEqual(d("2026-08-27"));
  });
});

describe("描画用の位置計算", () => {
  it("表示開始日からの日数と幅を返す", () => {
    const bar = resolveGanttBar(
      issue({ startDate: d("2026-09-10"), dueDate: d("2026-09-12") }),
    )!;
    expect(barOffset(bar, d("2026-09-05"))).toEqual({ offsetDays: 5, spanDays: 3 });
  });

  it("1日だけの帯も幅が 0 にならない", () => {
    const bar = resolveGanttBar(issue({ dueDate: d("2026-09-05") }))!;
    expect(barOffset(bar, d("2026-09-05"))).toEqual({ offsetDays: 0, spanDays: 1 });
  });

  it("表示開始日より前の帯は負のオフセットになる", () => {
    const bar = resolveGanttBar(issue({ dueDate: d("2026-09-01") }))!;
    expect(barOffset(bar, d("2026-09-05")).offsetDays).toBe(-4);
  });
});
