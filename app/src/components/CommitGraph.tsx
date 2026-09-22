import { laneColor, type GraphRow } from "@/lib/git-graph";

/**
 * コミット1行分の枝を描く。
 *
 * 行の高さに合わせた縦長のSVGを各行の左に置き、上半分と下半分で
 * 「入ってくる線」と「出ていく線」を描く。行ごとに独立しているので、
 * 一覧の並び替えやページングで崩れない。
 *
 * **ライブラリは入れていない。** 線と丸だけなので素のSVGで足りる。
 */
export function CommitGraph({ row, height = 44 }: { row: GraphRow; height?: number }) {
  const COL = 14; // 列の間隔
  const R = 3.5; // 丸の半径
  const x = (lane: number) => lane * COL + COL / 2;
  const mid = height / 2;
  const width = Math.max(row.width, 1) * COL;

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      aria-hidden="true"
      style={{ minWidth: width }}
    >
      {/* 通過していく枝。この行とは関係ないが、下へ続いているので線を切らさない */}
      {row.activeLanes
        .filter((l) => l !== row.lane)
        .map((l) => (
          <line
            key={`thru-${l}`}
            x1={x(l)}
            y1={0}
            x2={x(l)}
            y2={height}
            stroke={laneColor(l)}
            strokeWidth={1.5}
          />
        ))}

      {/* この行に入ってくる線（上半分） */}
      <line
        x1={x(row.lane)}
        y1={0}
        x2={x(row.lane)}
        y2={mid}
        stroke={laneColor(row.lane)}
        strokeWidth={1.5}
      />

      {/* 親へ出ていく線（下半分）。列をまたぐときは曲げる */}
      {row.edges.map((e, i) =>
        e.from === e.to ? (
          <line
            key={i}
            x1={x(e.from)}
            y1={mid}
            x2={x(e.from)}
            y2={height}
            stroke={laneColor(e.from)}
            strokeWidth={1.5}
          />
        ) : (
          <path
            key={i}
            d={`M ${x(e.from)} ${mid} C ${x(e.from)} ${mid + 12}, ${x(e.to)} ${mid + 4}, ${x(e.to)} ${height}`}
            fill="none"
            stroke={laneColor(e.to)}
            strokeWidth={1.5}
          />
        ),
      )}

      {/* コミットそのもの。マージは中を白く抜いて区別する */}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={R}
        fill={row.edges.length > 1 ? "#ffffff" : laneColor(row.lane)}
        stroke={laneColor(row.lane)}
        strokeWidth={1.5}
      />
    </svg>
  );
}
