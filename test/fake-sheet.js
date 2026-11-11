/* 「シートの代わり」（設計メモ 10節の2）。このMacの中だけで動く。本物のシートには触らない
   作り：本物の Code.gs（Apps Script）をそのまま読み込み、Googleの部品（シート・ロック・キャッシュ・ドライブ）だけを
         メモリの中の偽物に差し替えて動かす。版の決まり・空の行を抜くところまで、本物と同じ答えになる
   Code.gs は公開リポジトリに入れない約束なので、置き場を環境変数 GYOJI_CODE_GS で毎回指定する
     例：GYOJI_CODE_GS=/どこか/Code.gs node --test test/*.test.js（指定がない・見つからないときは、テストを失敗にする）

   使い方：
     const sheet = createFakeSheet({ pass: "テスト用の合言葉" });
     sheet.fetch(url, {method:"POST", body}) … store.js の fetch の代わり（client("A") で人ごとに名前をつけられる）
   答えの操り方：
     hold()／auto()            … 答えを止める（届いた依頼は pending にたまる）／止めずに返す
     pending[i].run()           … シートがその依頼を処理する（ここで版が進む）
     pending[i].deliver()       … 処理した答えを画面へ届ける（run していなければ先に run する）
     pending[i].drop()          … 通信が切れたことにする（run 済みでも答えは届かない）
     pending[i].respond(text, {status}) … 壊れた答え・HTTPの失敗を返す
     flush()                    … たまっている依頼を、届いた順にすべて処理して届ける
     delay = ミリ秒              … auto のとき、答えを遅らせる
     other.save(行事)／other.edit(id, 直し方)／other.remove(id) … ほかの人の保存を、通信を通さず割り込ませる
     interfere(n, 直し方)       … 次の n 回の saveEvent の直前に、ほかの人の保存を割り込ませる（連続のぶつかり）
     busy(n)                    … 次の n 回の保存・削除を「混雑（busy）」にする
     offline = true             … fetch が失敗する（通信が切れている）
     breakRow(id, 中身)／blankRow(id) … シートの行を壊す／中身を空にする（load から黙って消える）
     clock.add(ミリ秒)          … 合言葉の締め出し（10分）を進める */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CODE_GS = process.env.GYOJI_CODE_GS || "";

function codeGsFound() { if (!CODE_GS) return false; try { fs.accessSync(CODE_GS); return true; } catch (z) { return false; } }
/* 見つからないときに、テストを黙って飛ばさず、失敗にする（合格に見えて、実は動いていないのを防ぐ） */
function requireCodeGs() {
  if (!codeGsFound()) throw new Error(CODE_GS ? "Code.gs が見つかりません：" + CODE_GS : "環境変数 GYOJI_CODE_GS に Code.gs の置き場を入れてから動かしてください");
}

/* ===== Googleの部品の偽物 ===== */
/* シートに書いた値は、本物と同じように化ける：「'」で始まる文字は「'」が消える、数字だけの文字は数になる
   （日付らしい文字は本物では日付になるが、Code.gs は日付の欄を読まないので文字のままにしている） */
function cellValue(v) {
  if (typeof v !== "string") return v;
  if (v.charAt(0) === "'") return v.slice(1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((n, r) => Math.max(n, r.length), 0); }
  getRange(a, b, c, d) {
    if (typeof a === "string") {                         // "C2" の形
      const m = /^([A-Z])(\d+)$/.exec(a);
      return this.getRange(Number(m[2]), m[1].charCodeAt(0) - 64, 1, 1);
    }
    const sh = this, row = a, col = b, nr = c || 1, nc = d || 1;
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const r = sh.rows[row - 1 + i] || [], line = [];
          for (let j = 0; j < nc; j++) { const v = r[col - 1 + j]; line.push(v === undefined || v === null ? "" : v); }
          out.push(line);
        }
        return out;
      },
      setValues(vals) {
        for (let i = 0; i < nr; i++) {
          const r = sh.rows[row - 1 + i] || (sh.rows[row - 1 + i] = []);
          for (let j = 0; j < nc; j++) r[col - 1 + j] = cellValue(vals[i][j]);
        }
        for (let i = 0; i < sh.rows.length; i++) if (!sh.rows[i]) sh.rows[i] = [];
        return this;
      },
      setValue(v) { return this.setValues([[v]]); },
      setFontWeight() { return this; }
    };
  }
  appendRow(vals) { this.rows.push(vals.map(cellValue)); }
  deleteRow(n) { this.rows.splice(n - 1, 1); }
  setFrozenRows() {}
}
class FakeBook {
  constructor() { this.sheets = [new FakeSheet("シート1")]; }
  getId() { return "fake-book"; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}
function iter(a) { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; }
class FakeFolder {
  constructor(drive, name, parent) { this.drive = drive; this.id = "fold" + (++drive.n); this.name = name; this.parent = parent; drive.byId[this.id] = this; }
  getId() { return this.id; }
  getParents() { return iter(this.parent ? [this.parent] : []); }
  getFoldersByName(n) { return iter(Object.values(this.drive.byId).filter(x => x instanceof FakeFolder && x.parent === this && x.name === n)); }
  createFolder(n) { return new FakeFolder(this.drive, n, this); }
  createFile(a, b) {
    const f = typeof a === "string" ? { name: a, bytes: Buffer.from(String(b)) } : { name: a.name, bytes: a.bytes };
    const id = "file" + (++this.drive.n), folder = this;
    const file = { getId: () => id, getName: () => f.name, getParents: () => iter([folder]), getBlob: () => ({ getBytes: () => f.bytes }) };
    this.drive.byId[id] = file;
    return file;
  }
}
function tokyoParts(d) {
  const p = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return p;
}

/* ===== シートの代わりを作る ===== */
function createFakeSheet(opts) {
  opts = opts || {};
  if (!codeGsFound()) throw new Error("Code.gs が見つかりません：" + CODE_GS);
  const book = new FakeBook();
  const props = {};
  const clock = { t: Date.UTC(2026, 10, 10, 0, 0, 0), add(ms) { this.t += ms; }, now() { return this.t; } };
  const cache = {};
  const drive = { n: 0, byId: {} };
  let busyLeft = 0;
  const logs = [];
  const lockLog = [];   // 鍵をかける・書き込みを確定する・鍵を外す の順番の記録
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now()); } static now() { return clock.now(); } }

  const G = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book,
      openById: () => book,
      flush() { lockLog.push("flush"); },
      getUi() { throw new Error("画面なし"); }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: {
      getScriptCache: () => ({
        get(k) { const c = cache[k]; return c && c.until > clock.now() ? c.v : null; },
        put(k, v, sec) { cache[k] = { v: String(v), until: clock.now() + (sec || 600) * 1000 }; }
      })
    },
    LockService: { getScriptLock: () => ({ tryLock() { if (busyLeft > 0) { busyLeft--; return false; } lockLog.push("lock"); return true; }, releaseLock() { lockLog.push("release"); } }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput(t) { const o = { t: String(t), setMimeType() { return o; }, getContent() { return o.t; } }; return o; }
    },
    DriveApp: {
      createFolder: n => new FakeFolder(drive, n, null),
      getFolderById(id) { const f = drive.byId[id]; if (!(f instanceof FakeFolder)) throw new Error("no folder"); return f; },
      getFileById(id) { const f = drive.byId[id]; if (!f || f instanceof FakeFolder) throw new Error("no file"); return f; }
    },
    Utilities: {
      formatDate(d, tz, f) {
        const p = tokyoParts(d);
        return f.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute).replace("ss", p.second)
          .replace(/\bM\b/, String(Number(p.month)));
      },
      base64Decode: s => Buffer.from(s, "base64"),
      base64Encode: b => Buffer.from(b).toString("base64"),
      newBlob: (bytes, type, name) => ({ bytes: Buffer.from(bytes), type, name })
    },
    Logger: { log: m => { logs.push(String(m)); } },
    Date: FakeDate
  };
  const ctx = vm.createContext(G);
  vm.runInContext(fs.readFileSync(CODE_GS, "utf8"), ctx, { filename: "Code.gs" });
  vm.runInContext("setup()", ctx);
  const cfg = book.getSheetByName("設定");
  cfg.rows[1][1] = opts.pass === undefined ? "testpass-0000" : opts.pass;
  cfg.rows[2][1] = opts.owners || "";

  /* シートが依頼を1つ処理する（Code.gs の doPost そのもの） */
  function serve(bodyText) {
    return vm.runInContext("doPost", ctx)({ postData: { contents: bodyText } }).getContent();
  }
  const passOf = () => String(cfg.rows[1][1]);
  /* 通信を通さずに、シートへ直接頼む（ほかの人の操作） */
  function direct(op, body) { return JSON.parse(serve(JSON.stringify(Object.assign({ op: op, pass: passOf() }, body || {})))); }
  function revOf(id) { const r = direct("load").events.find(x => x.id === id); return r ? r.rev : 0; }

  const sheet = {
    CODE_GS, book, clock, logs, lockLog,
    mode: "auto", delay: 0, offline: false,
    pending: [],
    requests: [],      // 届いた依頼の記録（op・誰から）
    interfering: [],
    /* 止める。それまでに届け終わった依頼は pending から外す（このあと来る依頼が pending[0] から並ぶ） */
    hold() { this.mode = "hold"; this.pending = this.pending.filter(x => !x.done); return this; },
    auto() { this.mode = "auto"; return this; },
    busy(n) { busyLeft = n; return this; },
    interfere(n, fn) { for (let i = 0; i < n; i++) this.interfering.push(fn); return this; },
    /* たまっている依頼を、届いた順に処理して届ける。届けたあとに新しく来た依頼も続けて処理する */
    async flush() {
      for (let k = 0; k < 1000; k++) {
        await settle();
        const p = this.pending.find(x => !x.done);
        if (!p) return;
        p.deliver();
      }
      throw new Error("flush が終わりません");
    },
    client(who) { return (url, init) => request(who, url, init); },
    fetch: null,

    /* シートの中身（テストで確かめる用） */
    rows() {
      const sh = book.getSheetByName("行事"), h = sh.rows[0];
      return sh.rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i] === undefined ? "" : r[i]; }); return o; });
    },
    deletedRows() {
      const sh = book.getSheetByName("削除済み"), h = sh.rows[0];
      return sh.rows.slice(1).map(r => { const o = {}; h.forEach((k, i) => { o[k] = r[i] === undefined ? "" : r[i]; }); return o; });
    },
    /* シートにある行事（読めるものだけ）：id → {rev, data} */
    events() {
      const o = {};
      direct("load").events.forEach(x => { try { o[x.id] = { rev: x.rev, data: JSON.parse(x.data) }; } catch (z) { o[x.id] = { rev: x.rev, broken: x.data }; } });
      return o;
    },
    direct,
    revOf,
    other: {
      /* ほかの人が、その行事をいまの版の上に保存する */
      save(ev) { return direct("saveEvent", { id: ev.id, baseRev: revOf(ev.id), data: ev }); },
      /* ほかの人が、シートの最新を開いて直して保存する */
      edit(id, fn) {
        const cur = sheet.events()[id];
        if (!cur || !cur.data) throw new Error("その行事はシートにありません：" + id);
        const ev = JSON.parse(JSON.stringify(cur.data));
        const r = fn(ev);
        return direct("saveEvent", { id: id, baseRev: cur.rev, data: r || ev });
      },
      remove(id) { return direct("deleteEvent", { id: id, baseRev: revOf(id) }); }
    },
    /* シートの行を壊す（中身を読めない文字にする）／中身を空にする（load から黙って消える） */
    breakRow(id, text) { setData(id, text === undefined ? "|{壊れた中身" : "|" + text); },
    blankRow(id) { setData(id, ""); }
  };
  sheet.fetch = sheet.client("");

  function setData(id, first) {
    const sh = book.getSheetByName("行事"), h = sh.rows[0];
    const r = sh.rows.find((x, i) => i > 0 && String(x[0]) === String(id));
    if (!r) throw new Error("その行事はシートにありません：" + id);
    h.forEach((k, i) => { if (/^データ\d+$/.test(k)) r[i] = k === "データ1" ? first : ""; });
  }

  function request(who, url, init) {
    const body = init && init.body;
    let op = "";
    try { op = JSON.parse(body).op; } catch (z) {}
    sheet.requests.push({ who, op });
    if (sheet.offline) return Promise.reject(new TypeError("Failed to fetch"));
    let resolve, reject;
    const pr = new Promise((a, b) => { resolve = a; reject = b; });
    const p = {
      who, op, body: (() => { try { return JSON.parse(body); } catch (z) { return null; } })(),
      ran: false, done: false, answer: null,
      run() {
        if (p.ran) return p;
        if (op === "saveEvent" && sheet.interfering.length) {
          const fn = sheet.interfering.shift();
          sheet.other.edit(p.body.id, fn);
        }
        p.answer = serve(body); p.ran = true;
        return p;
      },
      deliver() { if (p.done) return p; p.run(); p.done = true; resolve(response(p.answer, 200)); return p; },
      drop() { if (p.done) return p; p.done = true; reject(new TypeError("Failed to fetch")); return p; },
      respond(text, o) { if (p.done) return p; p.done = true; resolve(response(text, (o && o.status) || 200)); return p; }
    };
    sheet.pending.push(p);
    if (sheet.mode === "auto") {
      if (sheet.delay > 0) setTimeout(() => { p.deliver(); }, sheet.delay);
      else setImmediate(() => { p.deliver(); });
    }
    return pr;
  }
  return sheet;
}
function response(text, status) {
  return {
    ok: status >= 200 && status < 300, status,
    json() { return new Promise((a, b) => { try { a(JSON.parse(text)); } catch (z) { b(z); } }); },
    text() { return Promise.resolve(String(text)); }
  };
}
/* 待っている約束（Promise）がすべて進むまで待つ */
async function settle(n) { for (let i = 0; i < (n || 20); i++) await new Promise(r => setImmediate(r)); }

module.exports = { createFakeSheet, codeGsFound, requireCodeGs, settle, CODE_GS };
