/**
 * ワーカーの依存が `/worker/node_modules` に揃っているかをビルド時に確かめる。
 *
 * なぜ要るか:
 *   本番イメージの `/worker` は npm で**手で並べたリスト**から作っている
 *   （pnpm の node_modules はシンボリックリンクの塊で COPY すると壊れるため）。
 *   リストに漏れがあると、**ビルドは通るのにコンテナが起動時に落ちる**。
 *   実際に2回踏んだ: M3-e で `bullmq`、M5 で `zod`（どちらも ERR_MODULE_NOT_FOUND）。
 *
 * やること:
 *   ワーカーの入口から import を実際に辿り、出てきた外部パッケージが
 *   `/worker` から解決できるかを見る。1つでも解決できなければ**ビルドを失敗させる**。
 *
 * `app/src` は丸ごと `/worker` に COPY されているので、
 * **全ファイルを見てはいけない**（react も next も要求されてしまう）。
 * 入口からの到達可能なものだけを見る。
 */

import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";

const ROOT = process.argv[2] ?? "/worker";

/** ワーカー側で実行される入口。docker/*.sh が呼ぶもの */
const ENTRIES = [
  "src/worker/index.ts",
  "src/scripts/reindex.ts",
  "prisma/seed.ts",
  "prisma/set-password.ts",
];

const require_ = createRequire(join(ROOT, "noop.js"));

/** import / export の指定子を拾う。実行はしないので正規表現で足りる */
function specifiersOf(code) {
  const out = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;'"]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s[^;'"]*?from\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) out.push(m[1]);
  }
  return out;
}

/** 相対 / `@/` の指定子を実ファイルに解決する。拡張子は省略されている */
function resolveLocal(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = resolvePath(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolvePath(dirname(fromFile), spec);
  else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.js`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** `@scope/pkg/sub` → `@scope/pkg`、`pkg/sub` → `pkg` */
function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const BUILTIN = /^(node:|fs$|path$|crypto$|os$|url$|util$|stream$|http$|https$|zlib$|buffer$|events$|child_process$|worker_threads$|timers|assert$|net$|tls$|dns$|string_decoder$|querystring$|readline$|process$|module$|perf_hooks$)/;

const seen = new Set();
const external = new Map(); // パッケージ名 → 要求しているファイル
const missingLocal = [];

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);

  let code;
  try {
    code = readFileSync(file, "utf8");
  } catch {
    return;
  }

  for (const spec of specifiersOf(code)) {
    if (BUILTIN.test(spec)) continue;

    if (spec.startsWith(".") || spec.startsWith("@/")) {
      const local = resolveLocal(spec, file);
      if (local) walk(local);
      // 解決できない相対 import は、型だけの参照か書き間違い。
      // 後者ならワーカーが起動時に落ちるので、報告する
      else missingLocal.push(`${spec}  ← ${file.replace(ROOT + "/", "")}`);
      continue;
    }

    const pkg = packageName(spec);
    if (!external.has(pkg)) external.set(pkg, file.replace(ROOT + "/", ""));
  }
}

for (const e of ENTRIES) {
  const f = resolvePath(ROOT, e);
  if (!existsSync(f)) {
    console.error(`[worker-deps] 入口が見つからない: ${e}`);
    process.exit(1);
  }
  walk(f);
}

const missing = [];
for (const [pkg, from] of external) {
  try {
    require_.resolve(pkg);
  } catch {
    // package.json を持たない型だけのパッケージもあるので、実体の有無も見る
    if (!existsSync(join(ROOT, "node_modules", pkg))) missing.push({ pkg, from });
  }
}

console.log(
  `[worker-deps] 入口 ${ENTRIES.length} 件から ${seen.size} ファイルを辿り、` +
    `外部パッケージ ${external.size} 件を検出`,
);
console.log(`[worker-deps] 検出: ${[...external.keys()].sort().join(" ")}`);

if (missingLocal.length > 0) {
  console.error("\n[worker-deps] 解決できない相対 import:");
  for (const m of missingLocal) console.error(`  ${m}`);
}

if (missing.length > 0) {
  console.error("\n[worker-deps] **/worker に入っていないパッケージがある**");
  console.error("  このままだとワーカーが起動時に ERR_MODULE_NOT_FOUND で落ちる。");
  console.error("  docker/app.prod.Dockerfile のワーカー依存の一覧に足すこと:\n");
  for (const { pkg, from } of missing) console.error(`  ${pkg}   ← ${from} が import している`);
  console.error("");
  process.exit(1);
}

if (missingLocal.length > 0) process.exit(1);

console.log("[worker-deps] すべて解決できた");
