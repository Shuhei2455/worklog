/**
 * コミットの並びから、枝の分かれ方を描くための配置を出す。
 *
 * `git log --graph` と同じ考え方。**列（レーン）を使い回す**のが要点で、
 * 枝ごとに新しい列を増やし続けると、履歴が長いプロジェクトで横に伸びて読めなくなる。
 *
 * 描画そのものは画面側に任せ、ここは純粋な計算だけにする。
 * 目で見て正しさを確かめにくい種類なので、テストで押さえる（CLAUDE.md）。
 */

export type GraphInput = { sha: string; parents: string[] };

export type GraphRow = {
  sha: string;
  /** このコミットが乗る列。0 が左端 */
  lane: number;
  /** この行で線が通っている列（このコミット自身の列を含む） */
  activeLanes: number[];
  /** この行から下へ伸びる線。from はこのコミットの列、to は親が乗る列 */
  edges: Array<{ from: number; to: number }>;
  /** 使われている列の数。SVGの幅を決めるのに使う */
  width: number;
};

/**
 * @param commits 新しい順（APIが返す順）。親は後ろに来る前提
 */
export function layoutCommits(commits: GraphInput[]): GraphRow[] {
  // lanes[i] = その列が次に待っているコミットのsha。空きは null
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  const firstFree = (): number => {
    const i = lanes.indexOf(null);
    if (i !== -1) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const c of commits) {
    // この commit を待っている列があればそこに乗る。無ければ新しい枝の先頭
    let lane = lanes.indexOf(c.sha);
    if (lane === -1) {
      lane = firstFree();
    }

    // 同じ commit を複数の列が待っていることがある（複数の枝が合流した先）。
    // 1本に集約し、残りは空ける
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === c.sha) lanes[i] = null;
    }

    const edges: Array<{ from: number; to: number }> = [];

    if (c.parents.length === 0) {
      // 最初のコミット。ここで列を空ける
      lanes[lane] = null;
    } else {
      // 第1親はそのまま同じ列を引き継ぐ（まっすぐ下に伸びる）
      lanes[lane] = c.parents[0];
      edges.push({ from: lane, to: lane });

      // 第2親以降はマージ。既にその親を待つ列があれば合流、無ければ新しい列
      for (const p of c.parents.slice(1)) {
        let target = lanes.indexOf(p);
        if (target === -1) {
          target = firstFree();
          lanes[target] = p;
        }
        edges.push({ from: lane, to: target });
      }
    }

    const activeLanes: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null || i === lane) activeLanes.push(i);
    }

    rows.push({
      sha: c.sha,
      lane,
      activeLanes,
      edges,
      // 末尾の空き列は数えない
      width: lanes.reduce((max, v, i) => (v !== null ? i + 1 : max), lane + 1),
    });
  }

  return rows;
}

/** 列ごとの色。増やしすぎても見分けられないので循環させる */
export const LANE_COLORS = [
  "#2c9a7a",
  "#4488c5",
  "#ed8077",
  "#a1af2f",
  "#9b7bd4",
  "#e0993e",
] as const;

export const laneColor = (lane: number): string =>
  LANE_COLORS[lane % LANE_COLORS.length];
