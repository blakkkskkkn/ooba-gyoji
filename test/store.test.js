/* store.js の同時編集のテスト（設計メモ 10節の3）。実行：node --test test/*.test.js
   「シートの代わり」（本物の Code.gs をこのMacの中で動かしたもの）に、何人分かの画面をつないで確かめる。
   本物のシートには触らない。職員名・実データ・本物の合言葉は入れない（公開リポジトリ） */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeSheet, requireCodeGs, CODE_GS } = require("./fake-sheet.js");
const { openClient } = require("./harness.js");

const PASS = "testpass-0000";   // テスト用の合言葉（本物ではない）
requireCodeGs();   // 見つからなければ、ここで失敗する（黙って飛ばさない）
const J = v => JSON.parse(JSON.stringify(v));
/* store.js は別の囲いの中で動くので、形だけで比べる */
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);

function ev(id) {
  return {
    id: id, name: "テストの行事", date: "2026-12-12", rainDate: "", updatedAt: "2026-11-10", phrase: "", budget: 0,
    classes: ["いちご組", "りんご組"],
    tasks: [
      { id: "t1", cat: "物", title: "看板", owner: "", status: "未着手" },
      { id: "t2", cat: "人", title: "配置", owner: "", status: "未着手" },
      { id: "t3", cat: "金", title: "発注", owner: "", status: "未着手" }
    ],
    logs: []
  };
}
/* シートに行事を置き、n 人がそれを開いた状態にする */
async function setup(n, opts) {
  const s = createFakeSheet({ pass: PASS });
  (opts && opts.events || [ev("u1")]).forEach(e => s.other.save(e));
  const cs = [];
  for (let i = 0; i < n; i++) {
    const c = openClient(s, "ABCDEFG"[i], opts && opts.client);
    c.Store.setPass(PASS);
    c.st = await c.Store.load();
    c.E = id => c.st.events.find(e => e.id === (id || "u1"));
    c.edit = (fn, id) => { fn(c.E(id)); c.Store.save(c.st); };
    cs.push(c);
  }
  return { s, cs };
}
const onSheet = (s, id) => s.events()[id || "u1"].data;

/* ===== ぶつかったら混ぜる ===== */
test("2人が別の欄を直す → 両方とも残る。あとの人の画面にも先の人の入力が出る", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.name = "Aの名前"; });
  b.edit(e => { e.date = "2027-01-15"; });
  await a.idle(); await b.idle();
  assert.equal(b.last.k, "saved");
  assert.equal(onSheet(s).name, "Aの名前");
  assert.equal(onSheet(s).date, "2027-01-15");
  assert.equal(b.E().name, "Aの名前", "Bの画面のデータにもAの入力が入った");
  deq(b.changes.map(c => c.changed), [["u1"]], "画面に描き直しを頼んだ");
  assert.equal(b.Store.hikae().length, 0);
  assert.equal(s.revOf("u1"), 3);
});

test("2人が同じ欄を直す → 先に保存した方が残り、あとの人には控え。「自分の方にする」で戻せる", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.tasks[0].title = "Aの看板"; });
  b.edit(e => { e.tasks[0].title = "Bの看板"; });
  await a.idle(); await b.idle();
  assert.equal(onSheet(s).tasks[0].title, "Aの看板");
  assert.equal(b.E().tasks[0].title, "Aの看板", "欄には相手の値を出す【S2】");
  const h = b.Store.hikae();
  assert.equal(h.length, 1);
  deq([h[0].at, h[0].mine, h[0].theirs, h[0].base], ["tasks[t1].title", "Bの看板", "Aの看板", "看板"]);
  assert.equal(b.warnsOnClose(), true, "控えが残っている間は、閉じる前に警告");
  deq(b.Store.keepMine(h[0].key), { ok: true });
  await b.idle();
  assert.equal(onSheet(s).tasks[0].title, "Bの看板");
  assert.equal(b.Store.hikae().length, 0);
  assert.equal(b.warnsOnClose(), false);
});

test("「捨てる」で控えが消える", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.phrase = "A"; }); b.edit(e => { e.phrase = "B"; });
  await a.idle(); await b.idle();
  const h = b.Store.hikae();
  b.Store.dropHikae(h[0].key);
  assert.equal(b.Store.hikae().length, 0);
  assert.equal(onSheet(s).phrase, "A");
  assert.equal(b.warnsOnClose(), false);
});

test("4人が同時に、それぞれ別の欄を直す → 4人分すべて残る", async () => {
  const { s, cs } = await setup(4);
  cs[0].edit(e => { e.name = "A"; });
  cs[1].edit(e => { e.date = "2027-02-02"; });
  cs[2].edit(e => { e.tasks[1].owner = "C"; });
  cs[3].edit(e => { e.classes = ["いちご組"]; });
  await Promise.all(cs.map(c => c.idle()));
  for (const c of cs) await c.idle();
  const d = onSheet(s);
  deq([d.name, d.date, d.tasks[1].owner, d.classes], ["A", "2027-02-02", "C", ["いちご組"]]);
  cs.forEach(c => assert.equal(c.Store.hikae().length, 0));
});

test("片方が行を足し、もう片方が別の行を消す → 両方反映", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.tasks.splice(1, 0, { id: "tA", cat: "物", title: "Aが足した", owner: "", status: "未着手" }); });
  b.edit(e => { e.tasks = e.tasks.filter(t => t.id !== "t3"); });
  await a.idle(); await b.idle();
  deq(onSheet(s).tasks.map(t => t.id), ["t1", "tA", "t2"]);
});

test("片方が行を消し、もう片方がその行を直す → 行は残り、知らせが出る", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.tasks = e.tasks.filter(t => t.id !== "t2"); });
  b.edit(e => { e.tasks[1].owner = "B"; });
  await a.idle(); await b.idle();
  deq(onSheet(s).tasks.map(t => t.id), ["t1", "t2", "t3"]);
  assert.equal(onSheet(s).tasks[1].owner, "B");
  const n = b.changes[0].notes;
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, "keptDeleted");
});

test("自分が何も変えていないときは、相手の最新をそのまま採用し、送り返さない", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.name = "A"; }); await a.idle();
  const before = s.requests.length;
  b.Store.refresh(); await b.idle();
  assert.equal(b.E().name, "A");
  deq(s.requests.slice(before).map(r => r.op), ["load"]);
  assert.equal(b.Store.pending(), false);
});

test("ほかの人が新しく作った行事は、画面に戻ったときに一覧に足される", async () => {
  const { s, cs: [a] } = await setup(1);
  s.other.save(ev("u2"));
  a.Store.save(a.st);
  a.Store.refresh(); await a.idle();
  deq(a.st.events.map(e => e.id).sort(), ["u1", "u2"]);
  deq(a.changes[0].added, ["u2"]);
});

test("画面に戻ったのが重なっても、取り寄せは1回にまとまる", async () => {
  const { s, cs: [a] } = await setup(1);
  a.Store.save(a.st);
  s.hold();
  a.Store.refresh(); a.Store.refresh();
  await a.tick(10);
  a.Store.refresh();
  s.auto(); await s.flush(); await a.idle();
  const loads = s.requests.filter(r => r.op === "load" && r.who === "A").length;
  assert.equal(loads, 1 + 2, "起動時1回＋処理中に来た分をまとめた1回");
});

/* ===== 行事を消す・消された ===== */
test("自分が消そうとした行事を、相手が直していた → 消すのをやめ、相手の最新を出す", async () => {
  const { s, cs: [a, b] } = await setup(2);
  b.edit(e => { e.name = "Bが直した"; }); await b.idle();
  a.st.events.splice(0, 1); a.Store.save(a.st); await a.idle();
  assert.equal(s.rows().length, 1, "シートから消えていない");
  assert.equal(a.E().name, "Bが直した");
  deq(a.changes[0].cancelled, ["u1"]);
  assert.equal(a.Store.pending(), false);
});

test("相手が直していない行事は、ふつうに消せる", async () => {
  const { s, cs: [a] } = await setup(1);
  a.st.events.splice(0, 1); a.Store.save(a.st); await a.idle();
  assert.equal(s.rows().length, 0);
  assert.equal(s.deletedRows().length, 1);
});

test("ほかの人が消した行事を直した → 自動では消さず「見当たりません」。新しい番号で保存し直せる【S4】【R5】【S1】", async () => {
  const { s, cs: [a, b, c] } = await setup(3);
  a.st.events.splice(0, 1); a.Store.save(a.st); await a.idle();
  b.edit(e => { e.name = "Bが直した"; }); await b.idle();
  assert.equal(b.last.k, "missing");
  assert.equal(b.E().name, "Bが直した", "画面には残っている");
  deq(b.Store.missing(), [{ id: "u1", name: "Bが直した" }]);
  assert.equal(b.warnsOnClose(), true);
  const nid = b.Store.saveAsNew("u1"); await b.idle();
  assert.equal(nid, "nB1");
  assert.equal(s.events()[nid].rev, 1);
  assert.equal(s.events()[nid].data.name, "Bが直した");
  assert.equal(s.events().u1, undefined, "消された番号では保存し直さない");
  assert.equal(b.last.k, "saved");
  // 消される前から開きっぱなしの C が保存しても、混ぜずに上書きはされない
  c.edit(e => { e.date = "2027-03-03"; }); await c.idle();
  assert.equal(c.last.k, "missing");
  assert.equal(s.events().u1, undefined);
  assert.equal(s.events()[nid].data.date, "2026-12-12");
});

test("「この画面からも消す」で、見当たらない行事を画面から消せる", async () => {
  const { s, cs: [a, b] } = await setup(2);
  s.other.remove("u1");
  b.edit(e => { e.name = "B"; }); await b.idle();
  assert.equal(b.Store.dropMissing("u1"), true);
  await b.idle();
  assert.equal(b.st.events.length, 0);
  assert.equal(b.Store.pending(), false);
  assert.equal(b.last.k, "saved");
  assert.equal(s.rows().length, 0, "シートに戻ってこない");
});

test("シートの行の中身が空になった（一覧から消えた）→ 画面からは消さない【S4】", async () => {
  const { s, cs: [a] } = await setup(1);
  s.blankRow("u1");
  a.Store.save(a.st); a.Store.refresh(); await a.idle();
  assert.equal(a.st.events.length, 1);
  assert.equal(a.last.k, "missing");
});

test("シートの行が壊れた → 起動時は黙って捨てず知らせる。開いていた人も「消された」とは見なさない【R6】", async () => {
  const { s, cs: [a] } = await setup(1, { events: [ev("u1"), ev("u2")] });
  s.breakRow("u2");
  a.edit(e => { e.name = "直した"; }, "u2");
  a.Store.refresh(); await a.idle();
  assert.equal(a.st.events.length, 2, "画面には残る");
  assert.equal(a.last.k, "badrow");
  assert.equal(a.Store.missing().length, 0);
  assert.equal(a.Store.pending(), true, "送れていない入力があるので、閉じる前に警告");
  const b = openClient(s, "B"); b.Store.setPass(PASS);
  const st = await b.Store.load(); await b.idle();
  deq(st.events.map(e => e.id), ["u1"]);
  assert.equal(b.last.k, "badrow");
});

/* ===== 何度もぶつかる・待っている間 ===== */
test("保存し直しが2回続けてぶつかっても、偽の控えは出ない【S3】", async () => {
  const { s, cs: [b] } = await setup(1);
  let n = 0;
  s.interfere(2, e => { e.phrase = "ほかの人" + (++n); });
  b.edit(e => { e.name = "B"; }); await b.idle();
  assert.equal(b.last.k, "saved");
  deq([onSheet(s).name, onSheet(s).phrase], ["B", "ほかの人2"]);
  assert.equal(b.Store.hikae().length, 0);
  assert.equal(b.E().phrase, "ほかの人2");
});

test("3回混ぜてもぶつかる → 「保存できていません」で残し、「もう一度送る」で送れる【R4】", async () => {
  const { s, cs: [b] } = await setup(1);
  let n = 0;
  s.interfere(4, e => { e.phrase = "ほかの人" + (++n); });
  b.edit(e => { e.name = "B"; }); await b.idle();
  assert.equal(b.last.k, "stuck");
  assert.equal(b.E().name, "B", "入力は画面に残る");
  assert.equal(b.warnsOnClose(), true);
  assert.equal(s.requests.filter(r => r.op === "saveEvent").length, 4);
  b.Store.retry(); await b.idle();
  assert.equal(b.last.k, "saved");
  deq([onSheet(s).name, onSheet(s).phrase], ["B", "ほかの人4"]);
  assert.equal(b.warnsOnClose(), false);
});

test("取り寄せの答えを待っている間に打った文字も、混ぜて保存される【R3】", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.name = "A"; }); await a.idle();
  b.edit(e => { e.date = "2027-01-01"; });
  s.hold();
  await b.tick(800);                                          // B の保存が出る → ぶつかる
  s.pending[0].deliver(); await b.tick(1);
  assert.equal(s.pending[1].op, "load", "最新を取り寄せ中");
  b.edit(e => { e.phrase = "待っている間に打った"; });           // 答えが届く前に打つ
  s.auto(); await s.flush(); await b.idle();
  const d = onSheet(s);
  deq([d.name, d.date, d.phrase], ["A", "2027-01-01", "待っている間に打った"]);
});

test("日本語の変換中は画面のデータを入れ替えず、確定してから混ぜる", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.name = "A"; }); await a.idle();
  b.edit(e => { e.date = "2027-01-01"; });
  b.composing = true;
  await b.tick(5000);
  assert.equal(b.E().name, "テストの行事", "変換中は入れ替えない");
  b.edit(e => { e.phrase = "変換して確定した"; });
  b.composing = false;
  await b.idle();
  const d = onSheet(s);
  deq([d.name, d.date, d.phrase], ["A", "2027-01-01", "変換して確定した"]);
  assert.equal(b.E().name, "A");
});

test("写真を送っている途中に取り寄せて混ぜても、写真は1回だけ送られ、置き換えが届く【R9】", async () => {
  const { s, cs: [a] } = await setup(1);
  const photo = "data:image/jpeg;base64," + Buffer.from("jpeg").toString("base64");
  a.edit(e => { e.logs.push({ id: "l1", when: "", one: "", photos: [photo] }); });
  s.hold();
  await a.tick(800);
  assert.equal(s.pending[0].op, "putPhoto");
  s.other.edit("u1", e => { e.name = "ほかの人"; });
  a.Store.refresh();                                          // 写真を送っている途中に画面へ戻った
  s.auto(); await s.flush(); await a.idle();
  assert.equal(s.requests.filter(r => r.op === "putPhoto").length, 1);
  const d = onSheet(s);
  assert.equal(d.name, "ほかの人");
  assert.equal(d.logs[0].photos.length, 1);
  assert.match(d.logs[0].photos[0], /^drv:/);
  assert.equal(a.E().logs[0].photos[0], d.logs[0].photos[0]);
});

/* ===== 控え ===== */
test("開き直しても、控えは残っている【R7】", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.phrase = "A"; }); b.edit(e => { e.phrase = "B"; });
  await a.idle(); await b.idle();
  const b2 = openClient(s, "B", { storage: b.storage });
  b2.Store.setPass(PASS); await b2.Store.load();
  assert.equal(b2.Store.hikae().length, 1);
  assert.equal(b2.Store.hikae()[0].mine, "B");
  assert.equal(b2.warnsOnClose(), true);
});

test("控えを端末に残せない → 知らせて、閉じる前に警告【S7】", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.phrase = "A"; }); await a.idle();
  b.full = true;
  b.edit(e => { e.phrase = "B"; }); await b.idle();
  assert.equal(b.last.k, "hikae-lost");
  assert.equal(b.warnsOnClose(), true);
  assert.equal(b.Store.hikae().length, 1, "画面の中には持っている");
});

test("古い控えで「自分の方にする」→ その後さらに直されていたら聞き直す。行が消えていたら知らせる【S9】", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.tasks[0].title = "A"; e.tasks[1].title = "A2"; }); await a.idle();
  b.edit(e => { e.tasks[0].title = "B"; e.tasks[1].title = "B2"; }); await b.idle();
  const [h1, h2] = b.Store.hikae();
  s.other.edit("u1", e => { e.tasks[0].title = "C"; e.tasks.splice(1, 1); });
  b.Store.refresh(); await b.idle();
  deq(b.Store.keepMine(h1.key), { ask: true, now: "C", mine: "B" });
  deq(b.Store.keepMine(h2.key), { gone: true });
  deq(b.Store.keepMine(h1.key, true), { ok: true });
  await b.idle();
  assert.equal(onSheet(s).tasks[0].title, "B");
});

/* ===== 形がおかしいとき ===== */
test("番号のない行が来たら、番号をつける部品（prepare）がないと止める。あれば混ぜる【S5】【R12】", async () => {
  const { s, cs: [a, b] } = await setup(2);
  s.other.edit("u1", e => { e.orders = [{ name: "記念品" }]; });   // 古いページの人が番号なしの行を足した
  b.edit(e => { e.name = "B"; }); await b.idle();
  assert.equal(b.last.k, "halted");
  assert.equal(b.E().name, "B", "入力は残る");
  assert.equal(onSheet(s).name, "テストの行事", "混ぜずに上書きしていない");
  b.Store.prepare = e => { (e.orders || []).forEach((o, i) => { if (!o.id) o.id = "h:orders:" + i; }); return e; };
  b.Store.retry(); await b.idle();
  assert.equal(b.last.k, "saved");
  assert.equal(onSheet(s).name, "B");
});

/* ===== 番号のない古いデータ（設計メモ5節【S5】） ===== */
function oldEvent() {
  return {
    id: "u1", name: "古い行事", date: "2026-12-12", updatedAt: "2026-11-01",
    team: [{ name: "職員A", role: "統括" }, { name: "職員B", role: "" }],
    orders: [{ name: "記念品", to: "", due: "", amount: 100, state: "未発注" }],
    tasks: [{ id: "u5", cat: "物", title: "看板", owner: "", status: "未着手" }]
  };
}
const usePrepare = c => { c.Store.prepare = (e, when) => c.window.Merge.number(e, when); };

test("番号のない古い行事を2人が同時に開く → 2人とも同じ番号をつけて保存し、行は増えない・控えも出ない", async () => {
  const s = createFakeSheet({ pass: PASS });
  s.other.save(oldEvent());
  const a = openClient(s, "A"), b = openClient(s, "B");
  [a, b].forEach(c => { usePrepare(c); c.Store.setPass(PASS); });
  const sa = await a.Store.load(), sb = await b.Store.load();
  deq(sa.events[0].team.map(x => x.id), ["m:team:0", "m:team:1"]);
  sa.events[0].team[0].role = "Aが直した"; a.Store.save(sa);
  sb.events[0].orders[0].amount = 200; b.Store.save(sb);
  await a.idle(); await b.idle();
  const d = onSheet(s);
  deq(d.team.map(x => [x.id, x.role]), [["m:team:0", "Aが直した"], ["m:team:1", ""]]);
  deq(d.orders.map(x => [x.id, x.amount]), [["m:orders:0", 200]]);
  assert.equal(b.Store.hikae().length, 0);
  assert.equal(b.last.k, "saved");
});

test("番号をつけて保存したあと、古いページの人が番号なしの行を足す → 中身の指紋の番号で混ざる", async () => {
  const s = createFakeSheet({ pass: PASS });
  s.other.save(oldEvent());
  const a = openClient(s, "A"); usePrepare(a); a.Store.setPass(PASS);
  a.st = await a.Store.load(); a.Store.save(a.st); await a.idle();
  assert.equal(onSheet(s).team[0].id, "m:team:0", "はじめの一回の番号が保存された");
  s.other.edit("u1", e => { e.orders.push({ name: "追加の品", to: "", due: "", amount: 50, state: "未発注" }); });
  a.st.events[0].name = "Aが直した名前"; a.Store.save(a.st); await a.idle();
  const d = onSheet(s);
  assert.equal(d.name, "Aが直した名前");
  assert.equal(d.orders.length, 2);
  assert.match(d.orders[1].id, /^h:orders:/);
  assert.equal(a.last.k, "saved");
});

/* ===== コードのレビュー（2026-11-10）で見つかった抜け ===== */
test("形のおかしい行事は、読み込んでも画面に入れず「読めない行事」として知らせる。ほかの行事は保存できる【R6】【R12】", async () => {
  const s = createFakeSheet({ pass: PASS });
  const bad = ev("u1"); bad.tasks = "一覧のはずが文字"; s.other.save(bad);
  const dup = ev("u2"); dup.tasks = [{ id: "t1", title: "x" }, { id: "t1", title: "y" }]; s.other.save(dup);
  s.other.save(ev("u3"));
  const a = openClient(s, "A"); a.Store.setPass(PASS);
  const st = await a.Store.load(); await a.idle();
  deq(st.events.map(e => e.id), ["u3"], "壊れた中身は画面のデータに入れない（画面が開けなくならないように）");
  assert.equal(a.last.k, "badrow");
  const r1 = s.revOf("u1"), r2 = s.revOf("u2");
  st.events[0].name = "直した"; a.Store.save(st); await a.idle();
  assert.equal(onSheet(s, "u3").name, "直した");
  assert.equal(s.revOf("u1"), r1, "消しにも行かない");
  assert.equal(s.revOf("u2"), r2);
  s.other.edit("u1", e => { e.tasks = []; });            // ほかの人が直した
  a.Store.refresh(); await a.idle();
  assert.ok(st.events.some(e => e.id === "u1"), "直ったら画面に入る");
});

test("取り寄せた最新の形がおかしいときは、いまの画面の中身を残して止める【R12】", async () => {
  const { s, cs: [a] } = await setup(1);
  s.other.edit("u1", e => { e.tasks = "文字"; });
  a.Store.refresh(); await a.idle();
  assert.equal(a.E().tasks.length, 3, "画面の中身は壊れた最新で置き換えない");
  assert.equal(a.last.k, "halted");
  a.edit(e => { e.name = "A"; }); await a.idle();
  assert.equal(onSheet(s).tasks, "文字", "混ぜずに上書きもしない");
});

test("保存する前に番号が重なっていたら、送らずに止める【R12】", async () => {
  const { s, cs: [a] } = await setup(1);
  const r = s.revOf("u1");
  a.edit(e => { e.tasks[1].id = "t1"; });
  await a.idle();
  assert.equal(a.last.k, "halted");
  assert.equal(s.revOf("u1"), r);
  assert.equal(a.warnsOnClose(), true);
});

test("同じ欄で2回ぶつかっても、選ぶまでは1回目の控えも残る【R7】", async () => {
  const { s, cs: [a, b] } = await setup(2);
  a.edit(e => { e.phrase = "A1"; }); await a.idle();
  b.edit(e => { e.phrase = "B1"; }); await b.idle();
  a.Store.refresh(); await a.idle();
  a.edit(e => { e.phrase = "A2"; }); await a.idle();
  b.edit(e => { e.phrase = "B2"; }); await b.idle();
  deq(b.Store.hikae().map(h => h.mine), ["B1", "B2"]);
  assert.equal(onSheet(s).phrase, "A2");
  const [h1, h2] = b.Store.hikae();
  assert.notEqual(h1.key, h2.key);
  deq(b.Store.keepMine(h1.key), { ask: true, now: "A2", mine: "B1" }, "古い控えは聞き直す");
  deq(b.Store.keepMine(h2.key), { ok: true });
  await b.idle();
  assert.equal(onSheet(s).phrase, "B2");
  deq(b.Store.hikae().map(h => h.mine), ["B1"], "選んでいない控えは残る");
});

test("番号のない古い行事は、開いただけで番号つきで保存される（何も直さなくても）【S5】", async () => {
  const s = createFakeSheet({ pass: PASS });
  s.other.save(oldEvent());
  const r = s.revOf("u1");
  const a = openClient(s, "A"); usePrepare(a); a.Store.setPass(PASS);
  await a.Store.load(); await a.idle();
  assert.equal(s.revOf("u1"), r + 1);
  deq(onSheet(s).team.map(x => x.id), ["m:team:0", "m:team:1"]);
  assert.equal(a.last.k, "saved");
  assert.equal(a.warnsOnClose(), false);
});

test("同じ端末でタブを2つ開いていても、ほかのタブの控えを消さない。片づけた控えは書き戻されない【R7】", async () => {
  const s = createFakeSheet({ pass: PASS });
  s.other.save(ev("u1"));
  const mem = new Map();
  const a = openClient(s, "A"), b = openClient(s, "B", { storage: mem }), c = openClient(s, "C", { storage: mem });
  for (const x of [a, b, c]) { x.Store.setPass(PASS); x.st = await x.Store.load(); }
  const E = x => x.st.events[0];
  E(a).phrase = "A1"; a.Store.save(a.st); await a.idle();
  E(b).phrase = "B1"; b.Store.save(b.st); await b.idle();
  a.Store.refresh(); await a.idle(); E(a).budget = 5; a.Store.save(a.st); await a.idle();
  E(c).budget = 7; c.Store.save(c.st); await c.idle();
  deq(JSON.parse(mem.get("gyoji-v2-hikae")).map(h => h.mine).sort(), [7, "B1"].sort(), "端末に両方残る");
  const hb = b.Store.hikae().find(h => h.mine === "B1");
  b.Store.dropHikae(hb.key);
  E(c).name = "Cの名前"; c.Store.save(c.st); await c.idle();
  c.Store.dropHikae("ない番号");
  deq(JSON.parse(mem.get("gyoji-v2-hikae")).map(h => h.mine), [7], "Bで捨てた控えを、Cが書き戻さない");
  deq(c.Store.hikae().map(h => h.mine), [7]);
});

test("形がおかしくて止まった行事は、直して「もう一度送る」を押すと送れる【レビュー指摘3】", async () => {
  const { s, cs: [a] } = await setup(1);
  a.edit(e => { e.tasks[1].id = "t1"; }); await a.idle();
  assert.equal(a.last.k, "halted");
  a.edit(e => { e.tasks[1].id = "t2"; e.name = "直した"; }); await a.idle();
  assert.equal(onSheet(s).name, "テストの行事", "押すまでは止まったまま（勝手に再開しない）");
  a.Store.retry(); await a.idle();
  assert.equal(a.last.k, "saved");
  assert.equal(onSheet(s).name, "直した");
});
test("形がまだおかしければ、「もう一度送る」を押しても止まったまま、シートは変わらない【レビュー指摘3】", async () => {
  const { s, cs: [a] } = await setup(1);
  const r = s.revOf("u1");
  a.edit(e => { e.tasks[1].id = "t1"; }); await a.idle();
  a.Store.retry(); await a.idle();
  assert.equal(a.last.k, "halted");
  assert.equal(s.revOf("u1"), r);
});
test("大きすぎて止まっても、減らして「もう一度送る」を押すと送れる【レビュー指摘4】", async () => {
  const { s, cs: [a] } = await setup(1);
  a.edit(e => { e.phrase = "あ".repeat(500000); }); await a.idle();
  assert.equal(a.last.k, "big");
  a.edit(e => { e.phrase = "短い"; }); await a.idle();
  a.Store.retry(); await a.idle();
  assert.equal(a.last.k, "saved");
  assert.equal(onSheet(s).phrase, "短い");
});
