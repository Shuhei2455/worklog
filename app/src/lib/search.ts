import { MeiliSearch } from "meilisearch";

/**
 * 全文検索（Meilisearch）。
 *
 * 日本語をゼロ設定で分かち書きできるので採用している(docs/01-design.md 3章)。
 *
 * **キーワード検索は二段構え。** Meilisearch でIDを引き、そのIDでDBを絞る。
 * 検索結果をそのまま画面に出さないのは、権限とフィルタをDB側で一度に
 * 効かせるため。Meilisearch 側に権限を持たせると二重管理になる。
 */

const globalForSearch = globalThis as unknown as { meili?: MeiliSearch };

export const meili =
  globalForSearch.meili ??
  new MeiliSearch({
    host: process.env.MEILI_URL || "http://meilisearch:7700",
    apiKey: process.env.MEILI_MASTER_KEY,
  });

if (process.env.NODE_ENV !== "production") globalForSearch.meili = meili;

export const ISSUE_INDEX = "issues";
export const WIKI_INDEX = "wikis";

export type IssueDoc = {
  id: number;
  projectId: number;
  /** 表示用。検索結果からリンクを作るのに使う */
  projectKey: string;
  keyId: number;
  summary: string;
  description: string;
  /** コメントも検索対象にする。本家も課題の検索でコメントを拾う */
  comments: string;
};

export type WikiDoc = {
  id: number;
  projectId: number;
  projectKey: string;
  name: string;
  content: string;
  tags: string[];
};

/**
 * インデックスの設定。**起動時に1度だけ流す。**
 *
 * `projectId` を filterable にしておかないと、
 * 参加しているプロジェクトだけに絞れない。
 */
export async function ensureIndexes(): Promise<void> {
  for (const uid of [ISSUE_INDEX, WIKI_INDEX]) {
    try {
      await meili.createIndex(uid, { primaryKey: "id" });
    } catch {
      // 既にあるなら何もしない
    }
  }
  await meili.index(ISSUE_INDEX).updateSettings({
    filterableAttributes: ["projectId"],
    searchableAttributes: ["summary", "description", "comments"],
    // 件名の一致を本文より強く見る
    rankingRules: ["words", "typo", "proximity", "attribute", "exactness"],
  });
  await meili.index(WIKI_INDEX).updateSettings({
    filterableAttributes: ["projectId", "tags"],
    searchableAttributes: ["name", "content", "tags"],
  });
}

/** 参加しているプロジェクトに絞る filter 式 */
function projectFilter(projectIds: number[]): string {
  if (projectIds.length === 0) return "projectId = -1"; // 何にも当たらない式
  return `projectId IN [${projectIds.join(",")}]`;
}

/** 課題を検索してIDだけ返す。DB側で権限と他の条件をかける */
export async function searchIssueIds(
  keyword: string,
  visibleProjectIds: number[],
  limit = 200,
): Promise<number[]> {
  const res = await meili.index(ISSUE_INDEX).search(keyword, {
    filter: projectFilter(visibleProjectIds),
    limit,
    attributesToRetrieve: ["id"],
  });
  return res.hits.map((h) => (h as { id: number }).id);
}

export async function searchWikis(
  keyword: string,
  visibleProjectIds: number[],
  limit = 50,
) {
  const res = await meili.index(WIKI_INDEX).search(keyword, {
    filter: projectFilter(visibleProjectIds),
    limit,
    attributesToHighlight: ["name", "content"],
  });
  return res.hits as unknown as Array<WikiDoc & { _formatted?: Partial<WikiDoc> }>;
}

/** Meilisearch に繋がるか。繋がらなくてもアプリは動くべき */
export async function searchAvailable(): Promise<boolean> {
  try {
    await meili.health();
    return true;
  } catch {
    return false;
  }
}
