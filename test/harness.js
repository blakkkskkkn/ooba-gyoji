/* store.js を、このMacの中で「1人分の画面」として動かす道具（設計メモ 10節の2・3）
   - fetch は「シートの代わり」につなぐ。この中には本物の fetch がないので、本物のシートには届かない
   - 時計は偽物：700ミリ秒の待ちや送り直しの待ちを、実際には待たずに進める
   - 端末の保存（localStorage）も人ごとに別。full:true で「容量がいっぱい」にできる（【S7】用）
   使い方：const a = openClient(sheet, "A"); a.Store.setPass("…"); await a.Store.load(); a.Store.save(s); await a.idle(); */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { settle } = require("./fake-sheet.js");

const STORE_JS = path.join(__dirname, "..", "store.js");
const MERGE_JS = path.join(__dirname, "..", "merge.js");

function openClient(sheet, who, opts) {
  opts = opts || {};
  const mem = opts.storage || new Map();       // 同じ端末で開き直すときは、前の storage を渡す
  const localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => {
      if (client.full) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      mem.set(k, String(v));
    },
    removeItem: k => { mem.delete(k); }
  };
  let now = 0, seq = 0;
  const timers = [];
  const listeners = {};
  const urls = [];
  const fetchFn = (url, init) => { urls.push(url); return sheet.client(who)(url, init); };
  /* ブラウザと同じく、window ＝ いちばん外側（store.js の中の「Store」は window.Store のこと） */
  const ctx = vm.createContext({
    localStorage, fetch: fetchFn, console,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    setTimeout(fn, ms) { const id = ++seq; timers.push({ id, at: now + (Number(ms) || 0), fn }); return id; },
    clearTimeout(id) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); }
  });
  ctx.window = ctx;
  /* index.html と同じ順：merge.js → store.js */
  vm.runInContext(fs.readFileSync(MERGE_JS, "utf8"), ctx, { filename: "merge.js" });
  vm.runInContext(fs.readFileSync(STORE_JS, "utf8"), ctx, { filename: "store.js" });

  const client = {
    who, storage: mem, urls, full: !!opts.full,
    Store: ctx.Store,
    window: ctx,
    statuses: [],
    get last() { return this.statuses[this.statuses.length - 1] || null; },
    get now() { return now; },
    /* 時計を進めて、待ちがなくなるまで動かす。シートが答えを止めている（hold）ときは、そこで止まる */
    async idle(limit) {
      for (let i = 0; i < (limit || 2000); i++) {
        await settle();
        if (!timers.length) { await settle(); if (!timers.length) return; continue; }
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers.shift();
        now = Math.max(now, t.at);
        t.fn();
      }
      throw new Error(who + "：待ちが終わりません");
    },
    /* 時計を ms だけ進める（その間に来る待ちだけ動かす） */
    async tick(ms) {
      const until = now + ms;
      for (;;) {
        await settle();
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        if (!timers.length || timers[0].at > until) break;
        const t = timers.shift(); now = t.at; t.fn();
      }
      now = until;
      await settle();
    },
    /* ページを閉じようとしたとき、警告が出るか */
    warnsOnClose() {
      let warned = false;
      const e = { preventDefault() { warned = true; }, set returnValue(v) { warned = true; } };
      (listeners.beforeunload || []).forEach(f => f(e));
      return warned;
    },
    /* 画面に戻ったとき（ほかのアプリ・タブから戻った） */
    fire(type, e) { (listeners[type] || []).forEach(f => f(e || {})); }
  };
  client.Store.onStatus = (k, m) => { client.statuses.push({ k, m }); };
  client.changes = [];
  client.Store.onChange = info => { client.changes.push(JSON.parse(JSON.stringify(info))); };
  client.composing = false;                                  // 日本語の変換中
  client.Store.canApply = () => !client.composing;
  let nid = 0;
  client.Store.newId = () => "n" + who + (++nid);
  return client;
}

module.exports = { openClient, STORE_JS };
