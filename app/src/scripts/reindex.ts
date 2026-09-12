import { prisma } from "@/lib/db";
import { enqueueSearch, redis } from "@/lib/queue";
import { ensureIndexes } from "@/lib/search";

/**
 * 全プロジェクトの検索インデックスを作り直す。
 *
 * Meilisearch のデータはバックアップに含めていない（DBから作り直せるため。
 * scripts/backup.sh の方針）。移設や復元のあとはインデックスが空なので、
 * これを流して作り直す。
 *
 * 実際の登録は worker が行う。ここはジョブを積むだけなので、
 * 戻ってきてもまだ終わっていない。worker のログで件数を確認する。
 *
 * 使い方:
 *   開発: docker compose exec app pnpm reindex
 *   本番: docker compose -f docker-compose.prod.yml run --rm reindex
 */
/**
 * Redis が繋がるまで待つ。
 *
 * 接続は `enableOfflineQueue: false` で作ってある（Redisが落ちていても
 * 画面の操作を止めないための設定）。その代わり、接続が出来上がる前に
 * コマンドを投げると即座に失敗する。長く動き続けるアプリでは問題にならないが、
 * 起動してすぐ終わるスクリプトでは毎回これを踏む。
 */
async function waitForRedis(timeoutMs = 15000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (redis.status !== "ready") {
    if (Date.now() > until) {
      throw new Error(`Redis に繋がりません（status=${redis.status}）`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  // enqueueSearch は Redis が落ちていても黙って捨てる（画面の操作を
  // 止めないための仕様）。このスクリプトでそれをやられると
  // 「積んだつもりで空のまま」になるので、先に繋がるか確かめる
  await waitForRedis();

  // filterable の設定を先に入れる。無いと権限で絞り込めない
  await ensureIndexes();
  console.log("[reindex] インデックスの設定を適用しました");

  const projects = await prisma.project.findMany({
    select: { id: true, key: true, name: true },
    orderBy: { id: "asc" },
  });

  if (projects.length === 0) {
    console.log("[reindex] プロジェクトがありません");
    return;
  }

  for (const p of projects) {
    await enqueueSearch({ kind: "reindex-project", id: p.id });
    console.log(`[reindex] ${p.key} (${p.name}) を積みました`);
  }

  console.log(
    `[reindex] ${projects.length} 件のプロジェクトを積みました。` +
      "登録の完了は worker のログで確認してください",
  );
}

main()
  .catch((e) => {
    console.error("[reindex] 失敗しました:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    // BullMQ の Redis 接続が開いたままだと終了しない
    process.exit(0);
  });
