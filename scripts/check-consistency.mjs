#!/usr/bin/env node
/**
 * 画面とコードの「繋ぎ目」を機械的に突き合わせる検査。
 *
 * **なぜ要るか。**
 * 単体テストが448件通っていても、画面を見ると問題が出た。
 * これまでのバグ11件を分類したところ8件が単体テストの外側で、
 * うち4件は「部品はあるのに使っていない」「書き写しの取りこぼし」だった
 * （docs/06-verification-plan.md）。
 *
 * この手の抜けは**コードを読めば機械的に分かる**。実行は数秒なので毎回回す。
 *
 *   pnpm check
 *
 * 見つけたら終了コード1。検査が通っても「バグが無い」ことにはならない
 * （本家との一致・意匠・業務としての正しさは判定できない）。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "app");
const SRC = join(APP, "src");

// ---- 小物 -----------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const read = (f) => readFileSync(f, "utf8");

/**
 * コメントを外した中身。
 *
 * 最初の実行で、A3 の指摘2件が**この検査自身の説明コメント**を拾ったものだった。
 * 利用者に見える文字列だけを相手にする。
 */
const readCode = (f) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
const rel = (f) => relative(APP, f);

const findings = [];

/**
 * 重要度を分ける。
 *
 * **全部を失敗にすると検査が読み飛ばされる。**
 * `要対応` だけ終了コード1にし、`参考` は出すだけにする
 * （判断が要るもの・運用しだいのものを混ぜない）。
 */
function fail(check, message, detail, level = "要対応") {
  findings.push({ check, message, detail, level });
}

// ---- A1 サイドバーを渡し忘れている画面 ------------------------------------
//
// プロジェクトの中身を出す画面は、左のナビを出したままにする。
// 以前は20画面のうち12で渡し忘れており、詳細に入るとナビが消えていた。
function a1_sidebar() {
  const pages = ALL.filter(
    (f) =>
      /\/page\.tsx$/.test(f) &&
      (/\/app\/projects\//.test(f) || /\/app\/issues\/\[issueKey\]\//.test(f)),
  );
  for (const f of pages) {
    const s = read(f);
    if (!s.includes("<Shell")) continue;
    if (!/project=\{/.test(s)) {
      fail("A1 サイドバー", "Shell に project= を渡していない（ナビが消える）", rel(f));
    }
  }
}

// ---- A2 マスタのCRUDが揃っているか ----------------------------------------
//
// 「作れるが直せない」と、入力を間違えたときに詰む。
// マイルストーンの開始日がまさにこれで、作成時に入れ損ねると直す手段が無かった。
const MASTERS = [
  { name: "バージョン/マイルストーン", verb: "Version" },
  { name: "カテゴリー", verb: "Category" },
  { name: "課題種別", verb: "IssueType" },
  { name: "状態", verb: "Status" },
  { name: "カスタム属性", verb: "CustomField" },
  { name: "Webhook", verb: "Webhook" },
  { name: "チーム", verb: "Team" },
  { name: "ユーザー", verb: "User" },
];

/**
 * 意図的に作っていないもの。理由を書いておかないと、毎回同じ指摘が出て
 * 検査そのものが読み飛ばされるようになる。
 */
const EXPECTED_MISSING = {
  "ユーザー:delete": "削除せず無効化する方針（活動履歴が残るため。01-design.md）",
};

function a2_crud() {
  const actionFiles = ALL.filter((f) => /\/actions\.ts$/.test(f) || /-actions\.ts$/.test(f));
  const src = actionFiles.map(readCode).join("\n");

  // 動詞のゆれを吸収する。`toggle◯◯Required` のような
  // **一部の値だけを変えるもの**は update とみなさない
  // （名前を直せないと「作れるが直せない」状態のままになる）
  const VERBS = {
    add: ["add", "create"],
    update: ["update", "rename"],
    delete: ["delete", "remove"],
  };

  for (const m of MASTERS) {
    const missing = [];
    for (const [kind, prefixes] of Object.entries(VERBS)) {
      const found = prefixes.some((p) =>
        new RegExp(`export async function ${p}${m.verb}\\b`).test(src),
      );
      if (!found) missing.push(kind);
    }
    for (const kind of missing) {
      const reason = EXPECTED_MISSING[`${m.name}:${kind}`];
      if (reason) continue;
      if (kind === "update") {
        fail("A2 CRUD", `${m.name}: **作れるが直せない**（名前を変える手段が無い）`, `update${m.verb}() を足す`);
      } else {
        fail(
          "A2 CRUD",
          `${m.name}: ${kind} が無い`,
          "参照中の課題の扱いを決める必要がある（TODO(要確認)）",
          "参考",
        );
      }
    }
  }
}

// ---- A3 案内文が指す画面に、その入力欄があるか ------------------------------
//
// 「プロジェクト設定で入れてください」と書いた時点で、
// そこに入力欄があることが約束になる。守れていないと利用者は詰む。
//
// 画面の名前 → その画面のファイル
const SCREEN_FILES = {
  プロジェクト設定: ["src/app/projects/[key]/settings/page.tsx"],
  個人設定: ["src/app/settings/api/page.tsx", "src/app/settings/password/page.tsx"],
};

/**
 * 案内文に出る項目名 → その画面にあるべき入力欄の `name`。
 *
 * **ラベルの文字列を探すだけでは駄目だった。**
 * 最初は対象ファイルに「開始日」という文字があるかを見ていたが、
 * 「開始日なし」という別の表示文言に当たって通過してしまい、
 * 入力欄を消しても検出できなかった（実際に試して気づいた）。
 * 入力欄そのものを見る。
 */
const FIELD_INPUTS = {
  開始日: ["startDate"],
  終了日: ["releaseDueDate", "endDate"],
  期限日: ["dueDate"],
  予定時間: ["estimatedHours"],
  実績時間: ["actualHours"],
  名前: ["name"],
  説明: ["description"],
  パスワード: ["password"],
};

function a3_guidance() {
  for (const f of ALL) {
    const s = readCode(f);
    for (const [screen, files] of Object.entries(SCREEN_FILES)) {
      let i = -1;
      while ((i = s.indexOf(screen, i + 1)) !== -1) {
        // 案内文は1文に収まる。前後120字だけ見る
        const around = s.slice(Math.max(0, i - 120), i + 120);
        if (!/(入れて|設定して|追加して)/.test(around)) continue;
        const targets = files.map((p) => read(join(APP, p)));
        for (const [label, names] of Object.entries(FIELD_INPUTS)) {
          if (!around.includes(label)) continue;
          const re = new RegExp(`name=["'](${names.join("|")})["']`);
          if (!targets.some((t) => re.test(t))) {
            fail(
              "A3 案内文",
              `「${screen}」で「${label}」を入れるよう案内しているが、その画面に入力欄が無い`,
              `${rel(f)} → ${files.join(", ")} に name="${names[0]}" が要る`,
            );
          }
        }
      }
    }
  }
}

// ---- A4 利用者が書いた本文が Markdown を通っているか ------------------------
//
// 部品はあるのに繋いでいない、という抜け。
// 課題の詳細とコメントが素のテキストで出ており、`- [ ] やること` が生で見えていた。
const CONTENT_FIELDS = [
  { expr: "issue.description", what: "課題の詳細" },
  { expr: "page.content", what: "Wikiの本文" },
  { expr: "pr.body", what: "プルリクの説明" },
];

function a4_markdown() {
  for (const f of ALL) {
    if (!/\/page\.tsx$/.test(f)) continue;
    const s = read(f);
    for (const { expr, what } of CONTENT_FIELDS) {
      // JSX の中で素の値として出しているか（{issue.description} のような形）
      const re = new RegExp(`\\{\\s*${expr.replace(".", "\\.")}\\s*\\}`);
      if (!re.test(s)) continue;
      // 編集画面は textarea に入れているだけなので対象外。
      // ここを弾かないと「Wikiの編集画面がMarkdownを通していない」と言い出す
      if (/<textarea/.test(s) && /\/edit\/|\/new\//.test(f)) continue;
      // 同じファイルで Markdown を使っていれば通っているとみなす
      if (!s.includes("<Markdown>")) {
        fail(
          "A4 Markdown",
          `${what} を素のテキストで出している（Markdown を通していない）`,
          rel(f),
        );
      }
    }
  }
}

// ---- A5 期限日の色分けが画面で揃っているか ---------------------------------
//
// ダッシュボードでは期限切れを赤くしているのに、課題一覧では色が無かった。
// 同じ意味のものが画面ごとに違うと、利用者は「この画面では出ない」と誤解する。
function a5_overdue() {
  for (const f of ALL) {
    if (!/\/page\.tsx$/.test(f) && !/Client\.tsx$/.test(f)) continue;
    const s = read(f);
    // 期限日を表示している画面か
    if (!/dueDate/.test(s)) continue;
    // 一覧・ボード・ダッシュボードのように「並べて見せる」画面だけを対象にする。
    // 課題詳細は1件なので色分けの必要が薄い
    // ガントは帯の位置に使うだけで日付を文字で出さない。
    // board/page.tsx はデータを渡すだけで描くのは BoardClient
    if (!/(issues\/page\.tsx|BoardClient\.tsx|dashboard\/page\.tsx)/.test(f)) continue;
    const hasOverdue = /text-red|overdue/.test(s);
    if (!hasOverdue) {
      fail("A5 期限切れの色", "期限日を出しているが、期限切れを色で示していない", rel(f));
    }
  }
}

// ---- A6 作ったアクションが画面から呼ばれているか ----------------------------
//
// A2 は「アクションがあるか」しか見ない。**アクションだけ足して画面に繋ぎ忘れる**と
// A2 は通るのに利用者は何もできない。今回いちばん多かった抜け方なので、
// 到達できるかまで見る。
function a6_unreachable() {
  const actionFiles = ALL.filter((f) => /\/actions\.ts$/.test(f) || /-actions\.ts$/.test(f));
  const pageSrc = ALL.filter((f) => /\.tsx$/.test(f)).map(readCode).join("\n");

  for (const f of actionFiles) {
    const names = [...readCode(f).matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    for (const n of names) {
      // import されているか、JSX で参照されているか
      const used = new RegExp(`\\b${n}\\b`).test(pageSrc);
      if (!used) {
        fail(
          "A6 未接続",
          `${n}() を作ったが、どの画面からも呼ばれていない`,
          rel(f),
        );
      }
    }
  }
}

// ---- 実行 ------------------------------------------------------------------

const CHECKS = [
  ["A1 サイドバー", a1_sidebar],
  ["A2 CRUD", a2_crud],
  ["A3 案内文", a3_guidance],
  ["A4 Markdown", a4_markdown],
  ["A5 期限切れの色", a5_overdue],
  ["A6 未接続のアクション", a6_unreachable],
];

console.log(`== 繋ぎ目の検査（対象 ${ALL.length} ファイル） ==\n`);
for (const [name, fn] of CHECKS) {
  const before = findings.length;
  fn();
  const n = findings.length - before;
  console.log(`  ${n === 0 ? "OK" : `${n}件`}  ${name}`);
}

const must = findings.filter((f) => f.level === "要対応");
const info = findings.filter((f) => f.level !== "要対応");

if (must.length > 0) {
  console.log(`\n== 要対応 ${must.length} 件 ==\n`);
  for (const f of must) {
    console.log(`[${f.check}] ${f.message}`);
    console.log(`    ${f.detail}\n`);
  }
}
if (info.length > 0) {
  console.log(`== 参考 ${info.length} 件（判断が要るもの） ==\n`);
  for (const f of info) {
    console.log(`[${f.check}] ${f.message}`);
    console.log(`    ${f.detail}\n`);
  }
}
if (must.length === 0) {
  console.log("要対応の指摘はありません。");
  console.log("（本家との一致・意匠・業務としての正しさは判定していません）");
}
process.exit(must.length > 0 ? 1 : 0);
