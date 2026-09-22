import { describe, expect, it } from "vitest";
import { computeProgress, progressTone } from "./project-progress";

/** 状態ID: 1=未対応 2=処理中 3=処理済み 4=完了 */
const open = (count: number) => ({ statusId: 1, count });
const doing = (count: number) => ({ statusId: 2, count });
const done = (count: number) => ({ statusId: 4, count });

describe("computeProgress", () => {
  it("完了率は完了したタスクの割合", () => {
    const p = computeProgress({ byStatus: [open(3), doing(1), done(4)], overdue: 0 });
    expect(p.total).toBe(8);
    expect(p.done).toBe(4);
    expect(p.percent).toBe(50);
  });

  it("進行中は未対応でも完了でもないもの（処理済みを含む）", () => {
    const p = computeProgress({
      byStatus: [open(2), doing(3), { statusId: 3, count: 1 }, done(4)],
      overdue: 0,
    });
    expect(p.notStarted).toBe(2);
    expect(p.inProgress).toBe(4); // 処理中3 + 処理済み1
    expect(p.done).toBe(4);
    expect(p.notStarted + p.inProgress + p.done).toBe(p.total);
  });

  it("プロジェクトに独自の状態（id>=5）があっても進行中に数える", () => {
    const p = computeProgress({ byStatus: [{ statusId: 9, count: 5 }], overdue: 0 });
    expect(p.inProgress).toBe(5);
    expect(p.percent).toBe(0);
  });

  it("タスクが0件でも NaN を出さず 0% にする", () => {
    const p = computeProgress({ byStatus: [], overdue: 0 });
    expect(p.total).toBe(0);
    expect(p.percent).toBe(0);
    expect(Number.isNaN(p.percent)).toBe(false);
  });

  it("完了率は整数に丸める", () => {
    // 1/3 = 33.33...%
    expect(computeProgress({ byStatus: [open(2), done(1)], overdue: 0 }).percent).toBe(33);
    // 2/3 = 66.66...%
    expect(computeProgress({ byStatus: [open(1), done(2)], overdue: 0 }).percent).toBe(67);
  });

  it("全部完了なら100%", () => {
    expect(computeProgress({ byStatus: [done(5)], overdue: 0 }).percent).toBe(100);
  });

  it("予定時間が未入力なら時間の進捗は null（0%と区別する）", () => {
    const p = computeProgress({
      byStatus: [open(1), done(1)],
      overdue: 0,
      hours: { total: 0, done: 0 },
    });
    expect(p.hoursPercent).toBeNull();
  });

  it("予定時間が入っていれば時間ベースの進捗も出す", () => {
    const p = computeProgress({
      byStatus: [open(1), done(1)],
      overdue: 0,
      hours: { total: 10, done: 3 },
    });
    expect(p.hoursPercent).toBe(30);
    // 件数は50%。時間とずれること自体が知りたい情報なので両方持つ
    expect(p.percent).toBe(50);
  });
});

describe("progressTone", () => {
  const of = (i: Parameters<typeof computeProgress>[0]) => progressTone(computeProgress(i));

  it("タスクが無ければ empty", () => {
    expect(of({ byStatus: [], overdue: 0 })).toBe("empty");
  });

  it("期限切れがあれば、進捗率が高くても danger", () => {
    expect(of({ byStatus: [open(1), done(9)], overdue: 1 })).toBe("danger");
  });

  it("全部完了なら done", () => {
    expect(of({ byStatus: [done(3)], overdue: 0 })).toBe("done");
  });

  it("期限切れがあれば100%完了より danger を優先する", () => {
    // 完了済みでも期限を過ぎた未完了課題があるなら、そちらを先に見せる
    expect(of({ byStatus: [done(9), open(1)], overdue: 1 })).toBe("danger");
  });

  it("未着手が7割を超えていたら warn", () => {
    expect(of({ byStatus: [open(8), doing(2)], overdue: 0 })).toBe("warn");
  });

  it("ちょうど7割は warn にしない（超えたときだけ）", () => {
    expect(of({ byStatus: [open(7), doing(3)], overdue: 0 })).toBe("normal");
  });

  it("動いていればnormal", () => {
    expect(of({ byStatus: [open(3), doing(4), done(3)], overdue: 0 })).toBe("normal");
  });
});
