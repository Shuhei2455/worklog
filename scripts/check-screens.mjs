#!/usr/bin/env node
/**
 * 画面を実際に開いて確かめる検査。
 *
 * 静的検査（check-consistency.mjs）はコードの繋ぎ目しか見ない。
 * **既定値の選び方・データが空のとき・権限の分離**は動かさないと分からない。
 * これまでのバグでは、バーンダウンの既定が空のマイルストーンだった件などが該当する
 * （docs/06-verification-plan.md の B1・B2・B4）。
 *
 *   pnpm check:screens
 *
 * **ライブラリを足していない。** fetch と Cookie の手当てだけで足りる。
 * レイアウトの崩れ（文字の重なり・見切れ）だけはブラウザが要るので
 * check-layout.mjs に分けてある。
 *
 * 前提: 開発スタックが起動していて、demo:seed 済みであること。
 */

const BASE = process.env.CHECK_BASE ?? "http://localhost:8088";
const PASSWORD = process.env.CHECK_PASSWORD ?? "kadai-demo-2026";

const findings = [];
function fail(check, message, detail, level = "要対応") {
  findings.push({ check, message, detail, level });
}

// ---- Cookie を持つ最小の HTTP クライアント --------------------------------

function makeClient() {
  const jar = new Map();
  const cookieHeader = () =>
    [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  /**
   * 1回だけ投げる。
   *
   * **開発サーバはルートごとに都度コンパイルする**ので、初回は十数秒かかる。
   * 待たずに切ると「壊れている」と誤って報告してしまうため、
   * 余裕をもって待ち、接続が切れたら数回やり直す。
   */
  async function once(path, init) {
    return fetch(BASE + path, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { ...(init.headers ?? {}), cookie: cookieHeader() },
    });
  }

  async function req(path, init = {}) {
    let res;
    for (let i = 0; ; i++) {
      try {
        res = await once(path, init);
        break;
      } catch (e) {
        // 落ちたのがアプリの不具合なのか、混んでいるだけなのかは区別できない。
        // 数回やり直して、それでも駄目なら報告する
        if (i >= 2) throw new Error(`${path}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    // Set-Cookie を拾う。getSetCookie は Node 20+ にある
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return res;
  }

  return {
    req,
    async get(path) {
      const res = await req(path);
      // Next のリダイレクトは1段だけ追う
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (loc) return req(loc.startsWith("http") ? new URL(loc).pathname : loc);
      }
      return res;
    },
    async login(userId) {
      const csrfRes = await req("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const body = new URLSearchParams({ csrfToken, userId, password: PASSWORD });
      await req("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const s = await (await req("/api/auth/session")).json();
      return s?.user?.name ?? null;
    },
  };
}

/** HTMLからタグを外して本文だけにする。判定を素朴に保つ */
function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BROKEN = /Application error|server-side exception|Unhandled Runtime Error/;

// ---- 対象の画面 ------------------------------------------------------------

const ROUTES = (p) => [
  ["/", "プロジェクト一覧"],
  ["/dashboard", "ダッシュボード"],
  ["/notifications", "通知"],
  ["/search", "検索"],
  ["/settings/language", "表示言語"],
  ["/settings/password", "パスワード"],
  ["/settings/api", "APIキー"],
  ["/settings/git", "Git設定"],
  [`/projects/${p}/issues`, "課題一覧"],
  [`/projects/${p}/issues/new`, "課題の追加"],
  [`/projects/${p}/issues/import`, "CSV取り込み"],
  [`/projects/${p}/board`, "ボード"],
  [`/projects/${p}/gantt`, "ガント"],
  [`/projects/${p}/burndown`, "バーンダウン"],
  [`/projects/${p}/wiki`, "Wiki"],
  [`/projects/${p}/wiki/new`, "Wiki追加"],
  [`/projects/${p}/files`, "ファイル"],
  [`/projects/${p}/settings`, "プロジェクト設定"],
];

// ---- B1 すべての画面が壊れずに開く ----------------------------------------

async function b1_open(c) {
  for (const [path, label] of ROUTES("WEB")) {
    const res = await c.get(path);
    const body = text(await res.text());
    if (res.status !== 200) {
      fail("B1 表示", `${label} が開かない`, `${path} → HTTP ${res.status}`);
    } else if (BROKEN.test(body)) {
      fail("B1 表示", `${label} でエラー画面が出ている`, path);
    }
  }
  for (const [path, label] of [
    ["/issues/WEB-1", "課題詳細"],
    ["/users", "ユーザー管理"],
    ["/teams", "チーム管理"],
    ["/audit", "監査ログ"],
  ]) {
    const res = await c.get(path);
    if (res.status !== 200 || BROKEN.test(text(await res.text()))) {
      fail("B1 表示", `${label} が開かない`, `${path} → HTTP ${res.status}`);
    }
  }
}

// ---- B2 データが空でも壊れないか -------------------------------------------
//
// バーンダウンの既定が「対象0件のマイルストーン」で空グラフになっていた件が
// この種類。課題もマイルストーンも無いプロジェクト(INF)で全画面を開く。
async function b2_empty(c) {
  for (const [path, label] of ROUTES("INF")) {
    if (!path.includes("/projects/")) continue;
    const res = await c.get(path);
    const body = text(await res.text());
    if (res.status !== 200) {
      fail("B2 空データ", `${label} が開かない（課題0件のプロジェクト）`, `${path} → HTTP ${res.status}`);
      continue;
    }
    if (BROKEN.test(body)) {
      fail("B2 空データ", `${label} でエラー画面（課題0件のプロジェクト）`, path);
      continue;
    }
    // 「0」や「NaN」「Invalid Date」が出ていないか
    if (/NaN|Invalid Date|undefined/.test(body)) {
      fail("B2 空データ", `${label} に NaN / Invalid Date / undefined が出ている`, path);
    }
  }
}

// ---- B4 参加していないプロジェクトが見えていないか --------------------------
//
// M4で実際に権限漏れを出している。人ごとに開いて、
// 見えてはいけないプロジェクト名が本文に出ていないかを突き合わせる。
const MEMBERSHIP = {
  kobayashi: ["サイトリニューアル"],
  suzuki: ["社内ポータル刷新"],
  watanabe: ["運用改善", "基盤移行"],
};
const ALL_PROJECT_NAMES = [
  "社内ポータル刷新",
  "運用改善",
  "デザインシステム構築",
  "サイトリニューアル",
  "基盤移行",
];

async function b4_permissions() {
  for (const [userId, allowed] of Object.entries(MEMBERSHIP)) {
    const c = makeClient();
    const name = await c.login(userId);
    if (!name) {
      fail("B4 権限", `${userId} でログインできない`, "demo:seed 済みか確認する");
      continue;
    }
    for (const path of ["/", "/dashboard", "/search?q=%E8%AA%B2%E9%A1%8C"]) {
      const body = text(await (await c.get(path)).text());
      for (const proj of ALL_PROJECT_NAMES) {
        if (allowed.includes(proj)) continue;
        if (body.includes(proj)) {
          fail(
            "B4 権限",
            `${userId} に、参加していない「${proj}」が見えている`,
            `${path}（参加: ${allowed.join("・")}）`,
          );
        }
      }
    }
  }
}

// ---- B6 管理者向けの導線が一般ユーザーに出ていないか ------------------------

async function b6_adminLinks() {
  // 一般ユーザー（制限なし）と、管理者の両方を見る。
  // **「出ない」ことだけ確かめると、検査が壊れていても気づけない**ので、
  // 管理者には出ることも一緒に確かめる
  const cases = [
    { userId: "sato", admin: false },
    { userId: "admin", admin: true },
  ];
  for (const { userId, admin } of cases) {
    const c = makeClient();
    const name = await c.login(userId);
    if (!name) {
      fail("B6 管理導線", `${userId} でログインできない`, "demo:seed 済みか確認する");
      continue;
    }
    const html = await (await c.get("/dashboard")).text();
    // ヘッダのリンクそのものを見る
    const hasLinks = ["/users", "/teams", "/audit"].filter((p) =>
      new RegExp(`href="${p}"`).test(html),
    );
    if (admin && hasLinks.length < 3) {
      fail(
        "B6 管理導線",
        "管理者に管理メニューが出ていない（検査が壊れている可能性もある）",
        `出ているもの: ${hasLinks.join(", ") || "なし"}`,
      );
    }
    if (!admin && hasLinks.length > 0) {
      fail("B6 管理導線", `一般ユーザーに管理メニューが出ている`, hasLinks.join(", "));
    }

    // 直接叩いても入れないこと（一般ユーザーのみ）
    if (!admin) {
      for (const path of ["/users", "/teams", "/audit"]) {
        const res = await c.get(path);
        if (res.status === 200 && !BROKEN.test(text(await res.text()))) {
          fail("B6 管理導線", `一般ユーザーが ${path} を開けてしまう`, `HTTP ${res.status}`);
        }
      }
    }
  }
}

// ---- 実行 ------------------------------------------------------------------

const CHECKS = [
  ["B1 全画面が開く", async (c) => b1_open(c)],
  ["B2 空データ", async (c) => b2_empty(c)],
  ["B4 権限の分離", async () => b4_permissions()],
  ["B6 管理導線", async () => b6_adminLinks()],
];

const admin = makeClient();
const who = await admin.login("admin");
if (!who) {
  console.error(`${BASE} に admin でログインできません。`);
  console.error("開発スタックが起動しているか、demo:seed 済みかを確認してください。");
  process.exit(2);
}
console.log(`== 画面の検査（${BASE} / ${who} でログイン） ==\n`);

for (const [name, fn] of CHECKS) {
  const before = findings.length;
  await fn(admin);
  const n = findings.length - before;
  console.log(`  ${n === 0 ? "OK" : `${n}件`}  ${name}`);
}

const must = findings.filter((f) => f.level === "要対応");
if (must.length > 0) {
  console.log(`\n== 要対応 ${must.length} 件 ==\n`);
  for (const f of must) {
    console.log(`[${f.check}] ${f.message}`);
    console.log(`    ${f.detail}\n`);
  }
} else {
  console.log("\n要対応の指摘はありません。");
  console.log("（レイアウトの崩れは check-layout.mjs で見ます）");
}
process.exit(must.length > 0 ? 1 : 0);
