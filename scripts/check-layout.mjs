#!/usr/bin/env node
/**
 * 画面のレイアウト崩れを見つける。
 *
 * ガントの日付が隣と重なっていた件がこの種類。
 * **文字の重なりと見切れは、実際に描かせて座標を測らないと分からない。**
 * 静的検査でもHTMLの取得でも捕まらない（docs/06-verification-plan.md の B3）。
 *
 *   pnpm check:layout
 *
 * 前提: ヘッドレスChrome が --remote-debugging-port=9222 で動いていること。
 *
 * **ライブラリは足していない。** CDP は WebSocket 越しのJSONやり取りなので、
 * 必要な範囲だけ手で書いてある（puppeteer を入れるほどの用事がない）。
 */

import { createHash, randomBytes } from "node:crypto";
import { connect } from "node:net";

const BASE = process.env.CHECK_BASE ?? "http://localhost:8088";
const PASSWORD = process.env.CHECK_PASSWORD ?? "kadai-demo-2026";
const DEVTOOLS = process.env.CHECK_DEVTOOLS ?? "127.0.0.1:9222";

// ---- 最小のWebSocketクライアント -------------------------------------------

function wsConnect(url) {
  const { hostname, port, pathname, search } = new URL(url);
  const key = randomBytes(16).toString("base64");
  const sock = connect({ host: hostname, port: Number(port) });

  return new Promise((resolve, reject) => {
    sock.on("error", reject);
    sock.on("connect", () => {
      sock.write(
        `GET ${pathname}${search} HTTP/1.1\r\n` +
          `Host: ${hostname}:${port}\r\n` +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });

    let buf = Buffer.alloc(0);
    let upgraded = false;
    const waiters = new Map();
    let nextId = 1;

    const expect = createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");

    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) return;
        const head = buf.slice(0, end).toString();
        if (!head.includes(expect)) return reject(new Error("WebSocketの握手に失敗"));
        buf = buf.slice(end + 4);
        upgraded = true;
        resolve(api);
      }
      // フレームを取り出す。CDP はテキストフレームしか送ってこない
      for (;;) {
        if (buf.length < 2) return;
        const len0 = buf[1] & 0x7f;
        let off = 2;
        let len = len0;
        if (len0 === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len0 === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len).toString();
        buf = buf.slice(off + len);
        try {
          const msg = JSON.parse(payload);
          const w = waiters.get(msg.id);
          if (w) {
            waiters.delete(msg.id);
            w(msg);
          }
        } catch {
          // CDP のイベントは使わないので読み飛ばす
        }
      }
    });

    function send(method, params = {}) {
      const id = nextId++;
      const body = JSON.stringify({ id, method, params });
      const data = Buffer.from(body);
      // クライアント → サーバはマスク必須
      const mask = randomBytes(4);
      const head = [];
      head.push(0x81);
      if (data.length < 126) head.push(0x80 | data.length);
      else if (data.length < 65536) head.push(0x80 | 126, data.length >> 8, data.length & 0xff);
      else throw new Error("送るJSONが大きすぎる");
      const masked = Buffer.from(data);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
      sock.write(Buffer.concat([Buffer.from(head), mask, masked]));
      return new Promise((res) => waiters.set(id, res));
    }

    const api = {
      send,
      close: () => sock.destroy(),
      async evaluate(expression) {
        const r = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        return r?.result?.result?.value;
      },
    };
  });
}

// ---- ページを開く -----------------------------------------------------------

async function pageTarget() {
  const list = await (await fetch(`http://${DEVTOOLS}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("ページのターゲットが見つからない");
  return page.webSocketDebuggerUrl;
}

async function goto(cdp, path, budget = 25_000) {
  await cdp.send("Page.navigate", { url: BASE + path });
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  // 固定で待つと遅い画面を取りこぼす。文字数が落ち着くまで待つ
  while (Date.now() - t0 < budget) {
    await new Promise((r) => setTimeout(r, 300));
    const n = await cdp.evaluate("document.body ? document.body.innerText.length : -1");
    if (typeof n !== "number") continue;
    if (n === last && n > 0) {
      if (++stable >= 2) break;
    } else stable = 0;
    last = n;
  }
}

// ---- 判定 -------------------------------------------------------------------

/**
 * 文字の重なりと見切れを見る。
 *
 * - 重なり: 隣り合う小さな文字要素の矩形が重なっていないか
 * - 見切れ: `scrollWidth > clientWidth` かつ overflow が hidden
 *
 * 余白の詰まりや「なんとなく変」は判定しない（人が見る）。
 */
const PROBE = `
(() => {
  const leaves = [...document.querySelectorAll('div,span,td,th,li,p,a')]
    .filter(e => e.children.length === 0 && e.innerText && e.innerText.trim());

  const cut = [];
  const overlap = [];

  const noTitle = [];
  for (const e of leaves) {
    const cs = getComputedStyle(e);
    const hidden = cs.overflow === 'hidden' || cs.overflowX === 'hidden';
    if (!hidden) continue;
    if (!(e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)) continue;
    // 省略記号つきの truncate は意図した表現。黙って消えるものだけを問題にする
    if (cs.textOverflow === 'ellipsis') {
      // ただし全文を確かめる手段が無いのは不親切。title か中のリンクがあるか見る
      if (!e.title && !e.closest('[title]') && !e.querySelector('a')) {
        noTitle.push(e.innerText.trim().slice(0, 24));
      }
      continue;
    }
    cut.push(e.innerText.trim().slice(0, 24));
  }

  // 同じ親を持つ兄弟どうしだけを見る。離れた要素は比べない
  const byParent = new Map();
  for (const e of leaves) {
    const p = e.parentElement;
    if (!p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(e);
  }
  for (const [, sibs] of byParent) {
    if (sibs.length < 2) continue;
    const boxes = sibs.map(e => {
      const r = e.getBoundingClientRect();
      // 文字の実幅で見る（セルより文字がはみ出すことがある）
      const w = Math.max(r.width, e.scrollWidth);
      return { l: r.left + (r.width - w) / 2, r: r.left + (r.width + w) / 2,
               t: r.top, b: r.bottom, s: e.innerText.trim().slice(0, 16) };
    }).filter(b => b.r > b.l && b.b > b.t);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const dx = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const dy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (dx > 1 && dy > 1) overlap.push(a.s + ' ↔ ' + b.s);
      }
    }
  }
  return { cut: [...new Set(cut)].slice(0, 8), overlap: [...new Set(overlap)].slice(0, 8),
           noTitle: [...new Set(noTitle)].slice(0, 8) };
})()
`;

// ---- 実行 -------------------------------------------------------------------

const SCREENS = [
  ["/dashboard", "ダッシュボード"],
  ["/", "プロジェクト一覧"],
  ["/projects/WEB/issues", "課題一覧"],
  ["/projects/WEB/board", "ボード"],
  ["/projects/WEB/gantt?scale=day", "ガント（日）"],
  ["/projects/WEB/gantt?scale=week", "ガント（週）"],
  ["/projects/WEB/burndown", "バーンダウン"],
  ["/projects/WEB/settings", "プロジェクト設定"],
  ["/issues/WEB-1", "課題詳細"],
  ["/users", "ユーザー管理"],
];

const findings = [];

const cdp = await wsConnect(await pageTarget());
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1400,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

// ログイン
await goto(cdp, "/login");
await cdp.evaluate(`
  (() => {
    const u = document.querySelector('input[name=userId]');
    if (!u) return 'already';
    u.value = 'admin';
    document.querySelector('input[name=password]').value = ${JSON.stringify(PASSWORD)};
    u.closest('form').requestSubmit();
    return 'sent';
  })()
`);
await new Promise((r) => setTimeout(r, 8000));

console.log(`== レイアウトの検査（${BASE}） ==\n`);
for (const [path, label] of SCREENS) {
  await goto(cdp, path);
  const r = await cdp.evaluate(PROBE);
  const must = (r?.cut?.length ?? 0) + (r?.overlap?.length ?? 0);
  const info = r?.noTitle?.length ?? 0;
  console.log(`  ${must === 0 ? "OK" : `${must}件`}  ${label}${info ? `（参考 ${info}件）` : ""}`);
  for (const c of r?.cut ?? []) findings.push({ label, kind: "見切れ", detail: c, level: "要対応" });
  for (const o of r?.overlap ?? []) findings.push({ label, kind: "重なり", detail: o, level: "要対応" });
  for (const t of r?.noTitle ?? [])
    findings.push({ label, kind: "省略", detail: `${t}（title が無く全文を確かめられない）`, level: "参考" });
}
cdp.close();

const must = findings.filter((f) => f.level === "要対応");
const info = findings.filter((f) => f.level !== "要対応");
if (must.length > 0) {
  console.log(`\n== 要対応 ${must.length} 件 ==\n`);
  for (const f of must) console.log(`[${f.kind}] ${f.label}: ${f.detail}`);
}
if (info.length > 0) {
  console.log(`\n== 参考 ${info.length} 件 ==\n`);
  for (const f of info) console.log(`[${f.kind}] ${f.label}: ${f.detail}`);
}
if (must.length === 0) {
  console.log("\n要対応の指摘はありません。");
  console.log("（余白の詰まりや「なんとなく変」は判定していません）");
}
process.exit(must.length > 0 ? 1 : 0);
