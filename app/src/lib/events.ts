/**
 * プロジェクト単位のイベント配信。
 *
 * ボードを複数人で開いているとき、片方の変更をもう片方へ伝える。
 * 伝え方は **Server-Sent Events**。WebSocket は職場のプロキシで詰まる
 * 可能性があるため採用しない(docs/01-design.md 3章)。
 *
 * 配信はアプリのプロセス内で完結させている。
 * TODO(将来): app を複数インスタンスで動かすなら Redis の pub/sub に替える。
 * 職場VMでは1インスタンスの想定なので、今は依存を増やさない。
 *
 * Next.js の dev はモジュールを作り直すので、購読者の一覧は globalThis に置く。
 * ここをモジュール変数にすると、ホットリロードのたびに購読が迷子になる。
 */

export type ProjectEvent =
  | { type: "issue.moved"; issueId: number; statusId: number; by: number }
  | { type: "issue.updated"; issueId: number; by: number }
  | { type: "issue.created"; issueId: number; by: number };

type Subscriber = (event: ProjectEvent) => void;

type Registry = Map<number, Set<Subscriber>>;

const g = globalThis as unknown as { __kadaiEvents?: Registry };
const registry: Registry = (g.__kadaiEvents ??= new Map());

/** 購読する。戻り値を呼ぶと解除される */
export function subscribe(projectId: number, fn: Subscriber): () => void {
  let set = registry.get(projectId);
  if (!set) {
    set = new Set();
    registry.set(projectId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) registry.delete(projectId);
  };
}

/** そのプロジェクトを見ている全員へ流す */
export function publish(projectId: number, event: ProjectEvent): void {
  const set = registry.get(projectId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      // 1人の購読者が壊れても他へは流し続ける
    }
  }
}

/** 動作確認用。いま何人が繋いでいるか */
export function subscriberCount(projectId: number): number {
  return registry.get(projectId)?.size ?? 0;
}
