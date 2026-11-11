/* 「シートの代わり」のテスト（設計メモ 10節の2）。実行：node --test test/
   1) シートの代わりが、本物の Code.gs と同じ決まりで答えるか
   2) 答えを止める・遅らせる・順番を入れ替える・割り込ませる・壊す・切る ができるか
   3) store.js をつないで動くか（同時編集の場面は store.test.js）
   本物のシートには触らない。職員名・実データ・本物の合言葉は入れない（公開リポジトリ） */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeSheet, requireCodeGs, settle, CODE_GS } = require("./fake-sheet.js");
const { openClient } = require("./harness.js");

const PASS = "testpass-0000";   // テスト用の合言葉（本物ではない）
requireCodeGs();   // 見つからなければ、ここで失敗する（黙って飛ばさない）

function ev(id, name) {
  return { id: id, name: name || "テストの行事", date: "2026-12-12", rainDate: "", updatedAt: "2026-11-10", tasks: [], classes: [] };
}
function post(sheet, op, body, pass) {
  return sheet.fetch("https://example.invalid/exec", {
    method: "POST", body: JSON.stringify(Object.assign({ op: op, pass: pass === undefined ? PASS : pass }, body || {}))
  }).then(r => r.json());
}

/* ===== 1) Code.gs と同じ決まりで答えるか ===== */
test("はじめは行事が空で、版1で保存でき、次は版2になる", async () => {
  const s = createFakeSheet({ pass: PASS });
  assert.deepEqual((await post(s, "load")).events, []);
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") }), { ok: true, rev: 1 });
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 1, data: ev("u1", "名前を変えた") }), { ok: true, rev: 2 });
  const l = await post(s, "load");
  assert.equal(l.events.length, 1);
  assert.equal(l.events[0].rev, 2);
  assert.equal(JSON.parse(l.events[0].data).name, "名前を変えた");
  assert.equal(s.rows()[0]["行事名"], "名前を変えた");
});

test("保存・削除は、鍵を外す前にシートへの書き込みを確定させる（2026-11-11 本物で、2人とも保存できたことになった）", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  await post(s, "deleteEvent", { id: "u1", baseRev: 1 });
  assert.deepEqual(s.lockLog, ["lock", "flush", "release", "lock", "flush", "release"]);
});

test("古い版で保存すると conflict と、いまの版が返る", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  await post(s, "saveEvent", { id: "u1", baseRev: 1, data: ev("u1") });
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 1, data: ev("u1") }), { ok: false, err: "conflict", rev: 2 });
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") }), { ok: false, err: "conflict", rev: 2 });
});

test("消された行事を、版0でない版で保存すると conflict（rev 0）【R5】", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  assert.deepEqual(await post(s, "deleteEvent", { id: "u1", baseRev: 1 }), { ok: true });
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 1, data: ev("u1") }), { ok: false, err: "conflict", rev: 0 });
  // 同じ番号で版0なら保存でき、版は1に戻る（【S1】で新しい番号にする理由）
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") }), { ok: true, rev: 1 });
});

test("消すと「削除済み」へ移る。古い版で消そうとすると conflict。ない行事を消すのは ok", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  await post(s, "saveEvent", { id: "u1", baseRev: 1, data: ev("u1") });
  assert.deepEqual(await post(s, "deleteEvent", { id: "u1", baseRev: 1 }), { ok: false, err: "conflict", rev: 2 });
  assert.deepEqual(await post(s, "deleteEvent", { id: "u1", baseRev: 2 }), { ok: true });
  assert.equal(s.rows().length, 0);
  assert.equal(s.deletedRows().length, 1);
  assert.equal(s.deletedRows()[0]["行事ID"], "u1");
  assert.deepEqual(await post(s, "deleteEvent", { id: "u9", baseRev: 3 }), { ok: true });
});

test("中身が空の行は load から黙って消える／壊れた行は、壊れたまま返る【S4】【R6】", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  await post(s, "saveEvent", { id: "u2", baseRev: 0, data: ev("u2") });
  await post(s, "saveEvent", { id: "u3", baseRev: 0, data: ev("u3") });
  s.blankRow("u2");
  s.breakRow("u3");
  const l = await post(s, "load");
  assert.deepEqual(l.events.map(x => x.id), ["u1", "u3"]);
  assert.throws(() => JSON.parse(l.events[1].data));
  assert.equal(s.rows().length, 3, "シートの行そのものは残っている");
});

test("長い行事（4万5千字を超える）も、欄に分けて元どおりに読める", async () => {
  const s = createFakeSheet({ pass: PASS });
  const e = ev("u1"); e.phrase = "あ".repeat(100000) + "=1";
  assert.equal((await post(s, "saveEvent", { id: "u1", baseRev: 0, data: e })).ok, true);
  assert.deepEqual(JSON.parse((await post(s, "load")).events[0].data), e);
});

test("「=」で始まる行事名・数字だけの番号も、化けずに読める", async () => {
  const s = createFakeSheet({ pass: PASS });
  const e = ev("12345", "=SUM(A1)");
  assert.equal((await post(s, "saveEvent", { id: "12345", baseRev: 0, data: e })).ok, true);
  assert.equal((await post(s, "saveEvent", { id: "12345", baseRev: 1, data: e })).rev, 2);
  assert.deepEqual(JSON.parse((await post(s, "load")).events[0].data), e);
});

test("写真が中に入ったままの行事・番号の食い違い・大きすぎる行事は断られる", async () => {
  const s = createFakeSheet({ pass: PASS });
  const e = ev("u1"); e.logs = [{ id: "l1", photos: ["data:image/jpeg;base64,AAAA"] }];
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 0, data: e }), { ok: false, err: "bad" });
  assert.deepEqual(await post(s, "saveEvent", { id: "u2", baseRev: 0, data: ev("u1") }), { ok: false, err: "bad" });
  const big = ev("u1"); big.phrase = "x".repeat(450001);
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: 0, data: big }), { ok: false, err: "big" });
});

test("写真はドライブに置かれ、番号で取り出せる", async () => {
  const s = createFakeSheet({ pass: PASS });
  const data = "data:image/jpeg;base64," + Buffer.from("jpeg").toString("base64");
  const r = await post(s, "putPhoto", { fy: 2026, eventId: "u1", data: data });
  assert.equal(r.ok, true);
  assert.deepEqual(await post(s, "getPhoto", { id: r.id }), { ok: true, data: data });
  assert.deepEqual(await post(s, "getPhoto", { id: "nai" }), { ok: false, err: "nophoto" });
  assert.deepEqual(await post(s, "putPhoto", { data: "data:image/png;base64,AAAA" }), { ok: false, err: "bad" });
});

test("合言葉：違うと pass、20回を超えると locked。正しい合言葉はロック中でも通る。10分で解ける【S10】", async () => {
  const s = createFakeSheet({ pass: PASS });
  for (let i = 0; i < 21; i++) assert.equal((await post(s, "load", {}, "chigau-0000")).err, "pass");
  assert.equal((await post(s, "load", {}, "chigau-0000")).err, "locked");
  assert.equal((await post(s, "load")).ok, true, "正しい合言葉は通る");
  assert.equal((await post(s, "load", {}, "chigau-0000")).err, "locked", "成功しても回数は消えない");
  s.clock.add(10 * 60 * 1000 + 1);
  assert.equal((await post(s, "load", {}, "chigau-0000")).err, "pass");
});

test("合言葉が8文字未満のシートは nopass", async () => {
  const s = createFakeSheet({ pass: "short" });
  assert.deepEqual(await post(s, "load", {}, "short"), { ok: false, err: "nopass" });
});

test("混雑（ロックが取れない）は busy", async () => {
  const s = createFakeSheet({ pass: PASS }).busy(1);
  assert.equal((await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") })).err, "busy");
  assert.equal((await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") })).ok, true);
});

/* ===== 2) 答えの操り方 ===== */
test("答えを止めて、届く順番を入れ替えられる", async () => {
  const s = createFakeSheet({ pass: PASS }).hold();
  const got = [];
  const p1 = post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") }).then(r => got.push(["1回目", r]));
  const p2 = post(s, "load").then(r => got.push(["2回目", r.events.length]));
  await settle();
  assert.equal(s.pending.length, 2);
  assert.equal(got.length, 0, "止めている間は届かない");
  s.pending[0].run();            // シートは1回目を先に処理する
  s.pending[1].deliver();        // でも、2回目の答えが先に届く
  await p2;
  s.pending[0].deliver();
  await p1;
  assert.deepEqual(got, [["2回目", 1], ["1回目", { ok: true, rev: 1 }]]);
});

test("処理から届くまでの間に、ほかの人の保存を割り込ませられる", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  s.hold();
  const p = post(s, "load");
  await settle();
  s.pending[0].run();                                         // 取り寄せはここで読まれた
  assert.equal(s.other.edit("u1", e => { e.name = "ほかの人"; }).rev, 2);
  s.pending[0].deliver();
  const l = await p;
  assert.equal(l.events[0].rev, 1, "届いた答えは、割り込みの前の中身");
  assert.equal(s.revOf("u1"), 2);
});

test("保存の直前に割り込みを入れて、3回続けてぶつからせられる", async () => {
  const s = createFakeSheet({ pass: PASS });
  await post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  s.interfere(3, e => { e.date = "2027-01-0" + (e.date === "2026-12-12" ? 1 : 2); });
  let base = 1;
  for (let i = 0; i < 3; i++) {
    const r = await post(s, "saveEvent", { id: "u1", baseRev: base, data: ev("u1", "自分") });
    assert.equal(r.err, "conflict");
    base = r.rev;
  }
  assert.deepEqual(await post(s, "saveEvent", { id: "u1", baseRev: base, data: ev("u1", "自分") }), { ok: true, rev: 5 });
});

test("通信が切れる・答えが届かない・壊れた答え・HTTPの失敗", async () => {
  const s = createFakeSheet({ pass: PASS });
  s.offline = true;
  await assert.rejects(post(s, "load"));
  s.offline = false;
  s.hold();
  const a = post(s, "saveEvent", { id: "u1", baseRev: 0, data: ev("u1") });
  const b = s.fetch("x", { method: "POST", body: JSON.stringify({ op: "load", pass: PASS }) });
  const c = s.fetch("x", { method: "POST", body: JSON.stringify({ op: "load", pass: PASS }) });
  await settle();
  s.pending[0].run().drop();                                  // シートには保存されたが、答えは届かない
  await assert.rejects(a);
  assert.equal(s.revOf("u1"), 1);
  s.pending[1].respond("<html>壊れた答え");
  await assert.rejects((await b).json());
  s.pending[2].respond("", { status: 500 });
  assert.equal((await c).ok, false);
});

test("遅らせると、その分だけ待ってから届く", async () => {
  const s = createFakeSheet({ pass: PASS });
  s.delay = 30;
  const t = Date.now();
  await post(s, "load");
  assert.ok(Date.now() - t >= 25);
});

/* ===== 3) いまの store.js をつなぐ ===== */
test("いまの store.js：シートの代わりで、読み込み・保存ができる", async () => {
  const s = createFakeSheet({ pass: PASS });
  const a = openClient(s, "A");
  await assert.rejects(a.Store.load(), x => x.need === "pass");
  a.Store.setPass(PASS);
  const st = await a.Store.load();
  assert.equal(st.events.length, 0);
  st.events.push(ev("u1"));
  a.Store.save(st);
  assert.equal(a.Store.pending(), true);
  assert.equal(a.warnsOnClose(), true, "送る前に閉じると警告");
  await a.idle();
  assert.equal(a.last.k, "saved");
  assert.equal(s.revOf("u1"), 1);
  assert.equal(a.Store.pending(), false);
  assert.equal(a.warnsOnClose(), false);
  assert.ok(a.urls.every(u => u === a.urls[0]) && a.urls.length > 0, "送り先は1つだけ（本物には届かない：fetch はシートの代わり）");
});

test("いまの store.js：通信が切れると止まり、「もう一度送る」で送れる", async () => {
  const s = createFakeSheet({ pass: PASS });
  const a = openClient(s, "A");
  a.Store.setPass(PASS);
  const st = await a.Store.load();
  s.offline = true;
  st.events.push(ev("u1"));
  a.Store.save(st); await a.idle();
  assert.equal(a.last.k, "net");
  assert.equal(s.requests.filter(r => r.op === "saveEvent").length, 3, "3回まで送り直した");
  s.offline = false;
  a.Store.retry(); await a.idle();
  assert.equal(a.last.k, "saved");
  assert.equal(s.revOf("u1"), 1);
});
