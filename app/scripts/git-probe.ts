/**
 * Git連携の疎通確認。トークンを画面に出さずに、繋がるかだけを見る。
 *
 *   docker compose exec -T app pnpm tsx scripts/git-probe.ts [owner/repo]
 */
import { gitProvider } from "../src/lib/git";

async function main() {
  const p = gitProvider();
  if (!p) {
    console.log("提供元が未設定です（GIT_PROVIDER / GITHUB_TOKEN を確認）");
    process.exit(1);
  }
  console.log(`提供元: ${p.name}`);

  const repos = await p.listRepos();
  console.log(`見えるリポジトリ: ${repos.length} 件`);
  for (const r of repos.slice(0, 10)) {
    console.log(`  ${r.owner}/${r.name}  (既定ブランチ ${r.defaultBranch}${r.private ? " / 非公開" : ""})`);
  }

  const target = process.argv[2] ?? (repos[0] ? `${repos[0].owner}/${repos[0].name}` : null);
  if (!target) return;
  const [owner, name] = target.split("/");
  const ref = { owner, name };
  console.log(`\n--- ${target} ---`);

  const commits = await p.listCommits(ref, { limit: 3 });
  console.log(`コミット ${commits.length} 件`);
  for (const c of commits) {
    console.log(`  ${c.sha.slice(0, 7)} ${c.message.split("\n")[0].slice(0, 50)} (${c.authorName})`);
  }

  const entries = await p.listContents(ref);
  console.log(`ルート直下: ${entries.length} 件  ${entries.slice(0, 6).map((e) => e.name).join(", ")}`);

  const pulls = await p.listPulls(ref, { state: "all" });
  console.log(`PR ${pulls.length} 件`);
  for (const pr of pulls.slice(0, 5)) {
    console.log(`  #${pr.number} ${pr.title.slice(0, 40)} [${pr.state}${pr.merged ? "/マージ済" : ""}]`);
  }
}

main().catch((e) => {
  console.error("失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
});
