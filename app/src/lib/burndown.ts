import { STATUS_ID_CLOSED } from "@/lib/constants";

/**
 * バーンダウンチャート。
 *
 * 決定 D26: マイルストーン単位。縦軸は**残り課題数**と**残り予定時間**の
 * 2本立て、横軸はマイルストーンの開始日〜終了日。理想線は初日の残量から
 * 終了日のゼロへの直線。
 *
 * 本家の計算式は非公開なので、これはこちらの定義。予定時間が未入力の課題が
 * 多い運用でも読めるように、件数ベースも並べる（時間だけだと全部0になる）。
 *
 * **過去の残量は活動履歴から復元する。** 日次のスナップショットを持たないので、
 * 「完了になった日」を活動履歴の状態変更から逆算する。スナップショットの
 * テーブルを増やすより、既にある履歴を使う方が運用が楽（M5の時点では
 * 課題数が少なく、計算量も問題にならない）。
 */

export type BurndownIssue = {
  id: number;
  /**
   * 完了になった日時。未完了なら null。
   * 「いま完了しているか」は別に持たない——この値の有無で判定できるため
   * （completedAtFrom が未完了なら null を返す）
   */
  completedAt: Date | null;
  /** 予定時間。未入力は 0 として扱う */
  estimatedHours: number;
  /** 課題が作られた日時。開始日より後に作られた課題は、その日から積む */
  createdAt: Date;
};

export type BurndownPoint = {
  /** YYYY-MM-DD */
  date: string;
  /** その日の終わりに残っている課題数 */
  remainingCount: number;
  /** その日の終わりに残っている予定時間 */
  remainingHours: number;
  /** 理想線（課題数） */
  idealCount: number;
  /** 理想線（予定時間） */
  idealHours: number;
  /** 未来の日付か。実績線はここで止める */
  future: boolean;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** 日付だけにそろえる。時刻が混ざると比較がずれる */
function atUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * 期間の日付を並べる。
 *
 * 終了日を含む。開始日が終了日より後なら空を返す（設定の誤り）。
 */
export function datesBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const end = atUtcDay(to).getTime();
  for (let d = atUtcDay(from); d.getTime() <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

export function buildBurndown(
  issues: BurndownIssue[],
  range: { start: Date; end: Date },
  today = new Date(),
): BurndownPoint[] {
  const days = datesBetween(range.start, range.end);
  if (days.length === 0) return [];

  const totalCount = issues.length;
  const totalHours = issues.reduce((sum, i) => sum + i.estimatedHours, 0);
  const lastIndex = days.length - 1;
  const todayKey = dayKey(atUtcDay(today));

  return days.map((d, index) => {
    const key = dayKey(d);
    const endOfDay = new Date(d.getTime() + 86_400_000 - 1);

    // その日までに作られていて、その日までに完了していない課題が「残り」
    const remaining = issues.filter((i) => {
      if (i.createdAt > endOfDay) return false;
      if (!i.completedAt) return true;
      return i.completedAt > endOfDay;
    });

    // 理想線は初日に全量、終了日に0。日数が1日なら初日=0にする
    const ratio = lastIndex === 0 ? 0 : 1 - index / lastIndex;

    return {
      date: key,
      remainingCount: remaining.length,
      remainingHours: Math.round(
        remaining.reduce((sum, i) => sum + i.estimatedHours, 0) * 10,
      ) / 10,
      idealCount: Math.round(totalCount * ratio * 10) / 10,
      idealHours: Math.round(totalHours * ratio * 10) / 10,
      future: key > todayKey,
    };
  });
}

/**
 * 活動履歴から「完了になった日時」を決める。
 *
 * `issues.completed_at` は**最後に完了になった時刻**しか持たない
 * （状態を戻すと null に戻る）。過去の残量を出すにはそれで足りるが、
 * 完了→未対応→完了 と動いた課題では、最初に完了した日が失われている。
 * 履歴がある場合はそちらを優先する。
 */
export function completedAtFrom(
  issue: { statusId: number; completedAt: Date | null },
  /** その課題の状態変更の履歴。古い順 */
  statusChanges: Array<{ to: number | null; at: Date }>,
): Date | null {
  // いま完了していないなら、残りとして数える
  if (issue.statusId !== STATUS_ID_CLOSED) return null;

  // 完了に変わった最後の記録を使う。履歴が無ければ completed_at
  const lastClosed = [...statusChanges]
    .reverse()
    .find((c) => c.to === STATUS_ID_CLOSED);
  return lastClosed?.at ?? issue.completedAt;
}

/**
 * 縦軸の目盛りの値を返す（大きい順）。
 *
 * 以前は 0/0.25/0.5/0.75/1 の位置に `max*(1-r)` を四捨五入して置いていた。
 * **max が小さいと同じ数字が並ぶ**（max=1 なら 1,1,1,0,0）。
 * 対象0件のマイルストーンを開くと必ずこうなっていた。
 *
 * max が目盛りの数より小さいときは、整数を1つずつ置く。
 */
export function axisTicks(max: number, count = 5): number[] {
  const m = Math.max(0, Math.floor(max));
  if (m <= 0) return [0];
  if (m < count) {
    // 0..m を1つずつ。大きい順にする
    return Array.from({ length: m + 1 }, (_, i) => m - i);
  }
  const step = m / (count - 1);
  const values = Array.from({ length: count }, (_, i) => Math.round(m - step * i));
  // 丸めで重複したら潰す
  return [...new Set(values)];
}
