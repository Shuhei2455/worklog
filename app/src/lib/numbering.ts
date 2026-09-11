import type { Prisma } from "@prisma/client";

/**
 * 採番まわり。**必ずトランザクション内で呼ぶこと。**
 */

/**
 * 課題キーの連番(keyId)を1つ進めて返す。
 *
 * アプリ側で MAX+1 を取ってはいけない。同時作成で必ず衝突する
 * (docs/01-design.md 5章)。UPDATE ... RETURNING で原子的に進める。
 *
 * 課題の INSERT と同一トランザクションで実行すること。
 * 削除による欠番は許容する(決定 D2)。
 */
export async function nextKeyId(
  tx: Prisma.TransactionClient,
  projectId: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ last_issue_no: number }[]>`
    UPDATE projects
       SET last_issue_no = last_issue_no + 1
     WHERE id = ${projectId}
    RETURNING last_issue_no
  `;
  if (rows.length === 0) {
    throw new Error(`プロジェクトが見つかりません: id=${projectId}`);
  }
  return rows[0].last_issue_no;
}

/** プロジェクト単位マスタのテーブル名。id がプロジェクト内で1始まりのもの */
export type MasterTable =
  | "statuses"
  | "issue_types"
  | "categories"
  | "versions"
  | "custom_fields";

const MASTER_TABLES: Record<MasterTable, true> = {
  statuses: true,
  issue_types: true,
  categories: true,
  versions: true,
  custom_fields: true,
};

/**
 * プロジェクト単位マスタの次の id を返す(決定 D6)。
 *
 * 本家は各プロジェクトの Open が必ず id=1 なので、通常の autoincrement は使えない
 * (2つ目のプロジェクトの Open が id=5 になり API 互換が壊れる)。
 *
 * keyId と違ってカウンタ列は持たず、プロジェクト行をロックしたうえで MAX+1 を取る。
 * マスタの作成は管理者しか行わず頻度も低いので、ロック待ちは問題にならない。
 * カウンタ列を5本生やすより、テーブルの実態と一致していて間違いが起きにくい。
 */
export async function nextMasterId(
  tx: Prisma.TransactionClient,
  table: MasterTable,
  projectId: number,
): Promise<number> {
  // テーブル名は識別子なのでパラメータ化できない。呼び出し側から任意の文字列が
  // 来ないよう、ホワイトリストで照合してから埋め込む
  if (!MASTER_TABLES[table]) {
    throw new Error(`未知のマスタテーブル: ${table}`);
  }

  // プロジェクト行を掴んで、同じプロジェクトへの同時採番を直列化する
  await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;

  const rows = await tx.$queryRawUnsafe<{ next: number }[]>(
    `SELECT COALESCE(MAX(id), 0) + 1 AS next FROM "${table}" WHERE project_id = $1`,
    projectId,
  );
  return Number(rows[0].next);
}
