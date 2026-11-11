/* 混ぜる部品のテスト（設計メモ 10節の1）。実行：node --test test/
   本物のシートには触らない。職員名・実データは入れない（公開リポジトリ） */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Merge = require("../merge.js");

const CLASSES = ["いちご組", "りんご組", "さくらんぼ組", "みかん組", "ぶどう組", "すいか組"];
const OPT = { order: CLASSES };
const cp = v => JSON.parse(JSON.stringify(v));

/* index.html の newEvent と同じ形（番号のない一覧には、読み込み時につける番号 m:場所:何行目 を入れた形） */
function newEvent() {
  const checks = [];
  for (let n = 1; n <= 3; n++) checks.push({ id: "c" + n, cat: "人", group: "every", text: "確認" + n, done: false, note: "", ref: "must", ai: false });
  return {
    id: "u1", name: "冬の行事", date: "2026-12-12", rainDate: "", updatedAt: "2026-11-10",
    purpose: { who: "", what: "", why: "" }, success: { child: "", parent: "", staff: "" }, delegate: { ok: "", ask: "" },
    team: [], lead: "", commander: "", photographer: "unset", classes: CLASSES.slice(),
    kids: CLASSES.map((c, i) => ({ id: "m:kids:" + i, cls: c, growth: "", daily: "" })),
    checks: checks, tasks: [],
    staff: { "正規": 0, "有期": 0, "パート": 0 },
    places: ["受付・案内", "司令塔"].map((n, i) => ({ id: "m:places:" + i, name: n, need: 0 })),
    care: [], familyLimit: "", childcare: "", orders: [], budget: 0, overtime: [], rate: 0,
    notices: [], phrase: "", logs: [], snaps: [], retros: [], prevTaskCount: ""
  };
}
/* 各タブを一通り使った行事 */
function fullEvent() {
  const e = newEvent();
  e.team.push({ id: "u10", name: "職員A", role: "統括" });
  e.tasks.push({ id: "u11", cat: "物", title: "看板", owner: "職員A", start: "2026-11-20", due: "2026-11-30", status: "未着手" });
  e.tasks.push({ id: "u12", cat: "人", title: "配置", owner: "職員B", start: "2026-11-21", due: "2026-12-01", status: "進行中", fromRetro: true });
  e.tasks.push({ id: "u13", cat: "金", title: "発注", owner: "職員C", start: "2026-11-22", due: "2026-12-02", status: "完了" });
  e.checks.push({ id: "u14", cat: "物", group: "every", text: "足した確認", done: false, note: "", ref: "", custom: true });
  e.places[0].who = ["職員A", "職員B"];
  e.places.push({ id: "u15", name: "足した配置", need: 1, custom: true });
  e.care.push({ id: "u16", cls: "いちご組", initial: "", plan: "", person: "" });
  e.orders.push({ id: "u17", name: "記念品", to: "", due: "", amount: 1000, state: "未発注" });
  e.overtime.push({ id: "u18", label: "準備", hours: 1 });
  e.notices.push({ id: "u19", what: "お知らせ", when: "", drafter: "", one: "", ok: false });
  e.logs.push({ id: "u20", when: "2026-11-10", where: "個別", from: "職員A", to: "職員B", one: "伝えた", ref: "", ok: false, photos: ["drv:a"] });
  e.snaps.push({ id: "u21", when: "2026-11-10", what: "準備", photos: ["drv:b", "drv:c"] });
  e.retros.push({ id: "u22", cat: "人", fact: "", did: "", who: "職員A", weeks: 2, what: "早めに" });
  e.day = {
    slots: [{ id: "u30", name: "1部", from: "9:00", to: "10:00", cls: ["いちご組"] }, { id: "u31", name: "2部", from: "10:00", to: "11:00", cls: [] }],
    posts: [{ id: "m:day.posts:0", name: "クラス", kind: "cls", need: { u30: 2 } }, { id: "u32", name: "足した持ち場", kind: "ba", need: {}, custom: true }],
    rows: [{ id: "u33", name: "職員A", in: "8:30", out: "17:00", cells: { u30: "受付", u31: "→" } }]
  };
  e.prog = { org: "", title: "", parts: [{ id: "u40", name: "第1部", cls: ["いちご組"], meet: "", from: "9:00", to: "10:00", items: [{ id: "u41", title: "体操", cls: "いちご組", kind: "体操" }] }] };
  return e;
}
const ok = r => { assert.equal(r.ok, true, r.stop && (r.stop.at + "：" + r.stop.why)); return r; };
const ids = a => a.map(x => x.id);

/* ===== 表を通るか【S6】 ===== */
test("ひな形の行事と、各タブを使った行事が表を通る", () => {
  assert.equal(Merge.check(newEvent()), null);
  assert.equal(Merge.check(fullEvent()), null);
});
test("同じ中身どうしなら、そのまま", () => {
  const e = fullEvent();
  const r = ok(Merge.event(cp(e), cp(e), cp(e), OPT));
  assert.deepEqual(r.value, e); assert.equal(r.conflicts.length, 0);
});

/* ===== 4-2 ひとつの値 ===== */
const V42 = [
  ["どちらも変えていない", "a", "a", "a", "a", false],
  ["自分だけ", "a", "b", "a", "b", false],
  ["相手だけ", "a", "a", "c", "c", false],
  ["両方とも同じ値に", "a", "b", "b", "b", false],
  ["両方とも別の値に → 相手、自分は控え", "a", "b", "c", "c", true],
  ["空欄も値（自分が消した）", "a", "", "a", "", false],
  ["空欄も値（自分が消し、相手が直した）", "a", "", "c", "c", true]
];
V42.forEach(([name, b, m, t, want, conflict]) => test("4-2 " + name, () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  B.name = b; Mi.name = m; T.name = t;
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.value.name, want);
  assert.equal(r.conflicts.length, conflict ? 1 : 0);
  if (conflict) assert.deepEqual(r.conflicts[0], { at: "name", base: b, mine: m, theirs: t });
}));
test("4-2 0 も値として比べる", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  B.budget = 5000; Mi.budget = 0;
  assert.equal(ok(Merge.event(B, Mi, T, OPT)).value.budget, 0);
});
test("4-2 項目がないときは初めの値があったとみなす", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  delete B.rainDate; delete T.rainDate; Mi.rainDate = "2026-12-13";
  assert.equal(ok(Merge.event(B, Mi, T, OPT)).value.rainDate, "2026-12-13");
});
test("4-2 NaN（シートを通ると null）を変更と見間違えない", () => {
  const B = fullEvent(); B.retros[0].weeks = null;
  const Mi = cp(B); Mi.retros[0].weeks = NaN;
  const T = cp(B); T.retros[0].what = "相手が直した";
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.conflicts.length, 0); assert.equal(r.value.retros[0].what, "相手が直した");
});
test("最終更新は混ぜない（控えにしない）【R14】", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  Mi.updatedAt = "2026-11-11"; T.updatedAt = "2026-11-12";
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.conflicts.length, 0); assert.equal(r.value.updatedAt, "2026-11-12");
});

/* ===== 4-3 まとまり・名前つきの値の集まり ===== */
test("4-3 まとまりの中は項目ごと（違う欄なら両方残る）", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  Mi.purpose.who = "子ども"; T.purpose.why = "育ち";
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.deepEqual(r.value.purpose, { who: "子ども", what: "", why: "育ち" });
});
test("4-3 片方にだけ新しくできたまとまり（当日の動きを初めて開いた）", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  Mi.day = { slots: [{ id: "u1a", name: "1部", from: "", to: "", cls: [] }], posts: [], rows: [] };
  T.prog = { org: "", title: "運動会", parts: [] };
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.value.day.slots[0].name, "1部"); assert.equal(r.value.prog.title, "運動会");
});
test("4-3 両方が初めて開いて別々に足した", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  Mi.day = { slots: [{ id: "uM", name: "自分", from: "", to: "", cls: [] }], posts: [], rows: [] };
  T.day = { slots: [{ id: "uT", name: "相手", from: "", to: "", cls: [] }], posts: [], rows: [] };
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.deepEqual(ids(r.value.day.slots), ["uT", "uM"]);
});
test("4-3 マス：違うマスなら両方", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.day.rows[0].cells.u30 = "園庭"; T.day.rows[0].cells.u31 = "ホール";
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.deepEqual(r.value.day.rows[0].cells, { u30: "園庭", u31: "ホール" });
});
test("4-3 マス：同じマスを別々に → 相手、自分は控え", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.day.rows[0].cells.u30 = "園庭"; T.day.rows[0].cells.u30 = "ホール";
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.value.day.rows[0].cells.u30, "ホール");
  assert.deepEqual(r.conflicts, [{ at: "day.rows[u33].cells.u30", base: "受付", mine: "園庭", theirs: "ホール" }]);
});
test("4-3 マス：片方が鍵を消し、もう片方が触っていない → 消す", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  delete T.day.rows[0].cells.u31;
  assert.deepEqual(ok(Merge.event(B, Mi, T, OPT)).value.day.rows[0].cells, { u30: "受付" });
});
test("4-3 マス：片方が消し、もう片方が変えた → 残す（控えにしない）", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  delete T.day.rows[0].cells.u31; Mi.day.rows[0].cells.u31 = "日誌";
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.value.day.rows[0].cells.u31, "日誌"); assert.equal(r.conflicts.length, 0);
});
test("4-3 持ち場の必要人数：両方が同じ鍵を別々に足した → 相手、自分は控え", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.day.posts[0].need.u31 = 1; T.day.posts[0].need.u31 = 3;
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.equal(r.value.day.posts[0].need.u31, 3);
  assert.deepEqual(r.conflicts, [{ at: "day.posts[m:day.posts:0].need.u31", base: "", mine: 1, theirs: 3 }]);
});

/* ===== 4-4 行の一覧 ===== */
const task = (id, title) => ({ id: id, cat: "物", title: title || id, owner: "", start: "", due: "2026-12-01", status: "未着手" });
function withTasks(list) { const e = newEvent(); e.tasks = list.map(x => typeof x === "string" ? task(x) : x); return e; }
const run = (b, m, t) => ok(Merge.event(withTasks(b), withTasks(m), withTasks(t), OPT));

test("4-4 片方が足した行 → 残す（両方が足したら両方）", () => {
  const r = run(["A", "B"], ["A", "B", "M"], ["A", "B", "T"]);
  assert.deepEqual(ids(r.value.tasks), ["A", "B", "T", "M"]);
});
test("4-4 片方が消し、もう片方が触っていない → 消す", () => {
  assert.deepEqual(ids(run(["A", "B", "C"], ["A", "C"], ["A", "B", "C"]).value.tasks), ["A", "C"]);
  assert.deepEqual(ids(run(["A", "B", "C"], ["A", "B", "C"], ["A", "C"]).value.tasks), ["A", "C"]);
});
test("4-4 相手が消し、自分が直した → 残して知らせる（位置は自分の画面の上下で）【S8】", () => {
  const b = ["A", "B", "C"], m = [task("A"), task("B", "直した"), task("C")], t = ["A", "C"];
  const r = run(b, m, t);
  assert.deepEqual(ids(r.value.tasks), ["A", "B", "C"]);
  assert.equal(r.value.tasks[1].title, "直した");
  assert.deepEqual(r.notes, [{ kind: "keptDeleted", deletedBy: "theirs", at: "tasks[B]", id: "B" }]);
});
test("4-4 自分が消し、相手が直した → 残して知らせる", () => {
  const r = run(["A", "B", "C"], ["A", "C"], [task("A"), task("B", "直した"), task("C")]);
  assert.deepEqual(ids(r.value.tasks), ["A", "B", "C"]);
  assert.equal(r.notes[0].deletedBy, "mine");
});
test("4-4 両方が消した → なし", () => {
  assert.deepEqual(ids(run(["A", "B"], ["A"], ["A"]).value.tasks), ["A"]);
});
test("4-4 両方が直した → 行の中の項目ごと", () => {
  const b = withTasks(["A"]), m = cp(b), t = cp(b);
  m.tasks[0].owner = "職員A"; t.tasks[0].status = "完了";
  const r = ok(Merge.event(b, m, t, OPT));
  assert.equal(r.value.tasks[0].owner, "職員A"); assert.equal(r.value.tasks[0].status, "完了");
});
test("4-4 両方が同じ行の同じ欄を直した → 控えの場所に行の番号が入る", () => {
  const b = withTasks(["A"]), m = cp(b), t = cp(b);
  m.tasks[0].title = "自分"; t.tasks[0].title = "相手";
  const r = ok(Merge.event(b, m, t, OPT));
  assert.deepEqual(r.conflicts, [{ at: "tasks[A].title", base: "A", mine: "自分", theirs: "相手" }]);
});

/* ===== 4-4 並び【R13】 ===== */
test("並び1：相手だけが並べ替えた → 相手の並び", () => {
  assert.deepEqual(ids(run(["A", "B", "C"], ["A", "B", "C"], ["C", "A", "B"]).value.tasks), ["C", "A", "B"]);
});
test("並び1：自分だけが並べ替えた → 自分の並び", () => {
  // 相手が足した T は、相手の画面ですぐ上にあった C の後ろ
  assert.deepEqual(ids(run(["A", "B", "C"], ["C", "B", "A"], ["A", "B", "C", "T"]).value.tasks), ["C", "T", "B", "A"]);
});
test("並び1：両方が並べ替えた → 相手の並び", () => {
  assert.deepEqual(ids(run(["A", "B", "C"], ["C", "B", "A"], ["B", "A", "C"]).value.tasks), ["B", "A", "C"]);
});
test("並び2：自分が足した行は、自分の画面ですぐ上にあった行の後ろ", () => {
  assert.deepEqual(ids(run(["A", "B", "C"], ["A", "M", "B", "C"], ["C", "B", "A"]).value.tasks), ["C", "B", "A", "M"]);
});
test("並び3：先頭に足した → 先頭", () => {
  assert.deepEqual(ids(run(["A", "B"], ["M", "A", "B"], ["A", "B", "T"]).value.tasks), ["M", "A", "B", "T"]);
});
test("並び3：すぐ上の行が相手側で消されていた → すぐ下の行の前", () => {
  assert.deepEqual(ids(run(["A", "B", "C"], ["A", "B", "M", "C"], ["A", "C"]).value.tasks), ["A", "M", "C"]);
});
test("並び3：上も下も見つからない → 最後", () => {
  assert.deepEqual(ids(run(["A", "B", "C"], ["A", "B", "M", "C"], ["A"]).value.tasks), ["A", "M"]);
});
test("並び4：同じ場所に複数 → その人の画面の順。両方が同じ場所なら相手が先", () => {
  assert.deepEqual(ids(run(["A", "B"], ["A", "M1", "M2", "B"], ["A", "T1", "T2", "B"]).value.tasks), ["A", "T1", "T2", "M1", "M2", "B"]);
});
test("並び4：自分だけが並べ替え、両方が同じ場所に足した → それでも相手が先", () => {
  assert.deepEqual(ids(run(["A", "B"], ["B", "A", "M"], ["A", "T", "B"]).value.tasks), ["B", "A", "T", "M"]);
});
test("並び5：同じ入力からは、いつも同じ並び", () => {
  const args = [["A", "B", "C"], ["A", "M", "C"], ["C", "A", "T", "B"]];
  const a = ids(run(...args).value.tasks), b = ids(run(...args).value.tasks);
  assert.deepEqual(a, b);
});

/* ===== 4-5 チェックの集まり ===== */
test("4-5 片方が入れ、片方が別のクラスを外した → 両方反映、クラス順", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  B.classes = ["りんご組", "みかん組"];
  Mi.classes = ["りんご組", "みかん組", "いちご組"];
  T.classes = ["りんご組"];
  assert.deepEqual(ok(Merge.event(B, Mi, T, OPT)).value.classes, ["いちご組", "りんご組"]);
});
test("4-5 部の出るクラス・時間帯のクラスも同じ", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.prog.parts[0].cls.push("すいか組"); T.prog.parts[0].cls = [];
  Mi.day.slots[1].cls.push("みかん組"); T.day.slots[1].cls.push("いちご組");
  const r = ok(Merge.event(B, Mi, T, OPT));
  assert.deepEqual(r.value.prog.parts[0].cls, ["すいか組"]);
  assert.deepEqual(r.value.day.slots[1].cls, ["いちご組", "みかん組"]);
});

/* ===== 写真・配置の人 ===== */
test("写真：片方が足し、片方が別の写真を消した", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.snaps[0].photos.push("drv:m"); T.snaps[0].photos = ["drv:c"];
  assert.deepEqual(ok(Merge.event(B, Mi, T, OPT)).value.snaps[0].photos, ["drv:c", "drv:m"]);
});
test("写真：送る前の仮番号も、ふつうの値として扱う", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.snaps[0].photos.push("tmp:1");
  assert.deepEqual(ok(Merge.event(B, Mi, T, OPT)).value.snaps[0].photos, ["drv:b", "drv:c", "tmp:1"]);
});
test("配置の人：両方が足した", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.places[0].who.push("職員C"); T.places[0].who.push("職員D");
  assert.deepEqual(ok(Merge.event(B, Mi, T, OPT)).value.places[0].who, ["職員A", "職員B", "職員D", "職員C"]);
});

/* ===== 止める（表にない・番号が重なる・読めない）【R8】【R12】【R6】 ===== */
test("表にない項目があれば、混ぜずに止める", () => {
  const B = newEvent(), Mi = newEvent(), T = newEvent();
  T.newField = "x";
  const r = Merge.event(B, Mi, T, OPT);
  assert.equal(r.ok, false); assert.equal(r.stop.at, "newField");
});
test("行の中の、表にない項目でも止める", () => {
  const B = withTasks(["A"]), Mi = cp(B), T = cp(B);
  Mi.tasks[0].memo = "x";
  assert.equal(Merge.event(B, Mi, T, OPT).stop.at, "tasks[A].memo");
});
test("同じ番号の行が2つあれば止める", () => {
  const B = withTasks(["A", "B"]), Mi = cp(B), T = withTasks(["A", "A"]);
  const r = Merge.event(B, Mi, T, OPT);
  assert.equal(r.ok, false); assert.match(r.stop.why, /同じ番号/);
});
test("番号のない行があれば止める", () => {
  const B = newEvent(), Mi = cp(B), T = cp(B);
  T.orders.push({ name: "番号なし", to: "", due: "", amount: 0, state: "未発注" });
  assert.match(Merge.event(B, Mi, T, OPT).stop.why, /番号がありません/);
});
test("形がおかしい（一覧のはずが文字）なら止める", () => {
  const B = newEvent(), Mi = cp(B), T = cp(B);
  T.tasks = "壊れた";
  assert.equal(Merge.event(B, Mi, T, OPT).ok, false);
});
test("土台にあった『当日の動き』が片方から丸ごと消えていたら止める（AI判断）", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  delete T.day;
  assert.match(Merge.event(B, Mi, T, OPT).stop.why, /消えています/);
});
test("別の行事どうしは混ぜない", () => {
  const B = newEvent(), Mi = cp(B), T = cp(B); T.id = "u2";
  assert.equal(Merge.event(B, Mi, T, OPT).ok, false);
});
test("入力を書き換えない（土台・自分・相手はそのまま）", () => {
  const B = fullEvent(), Mi = cp(B), T = cp(B);
  Mi.tasks[0].title = "自分"; T.tasks[0].title = "相手"; T.tasks.push(task("T"));
  const b0 = cp(B), m0 = cp(Mi), t0 = cp(T);
  ok(Merge.event(B, Mi, T, OPT));
  assert.deepEqual(B, b0); assert.deepEqual(Mi, m0); assert.deepEqual(T, t0);
});

/* ===== 4人分を順に混ぜる ===== */
test("4人が違う欄・違う行を直し、順に保存した → 全員分が残る", () => {
  const base = fullEvent();
  const people = [0, 1, 2, 3].map(() => cp(base));
  people[0].name = "1人目が直した";
  people[1].tasks.push(task("P2"));
  people[2].tasks = people[2].tasks.filter(x => x.id !== "u12");
  people[3].day.rows[0].cells.u31 = "日誌";
  // シートには1人目がそのまま保存。2〜4人目は、ぶつかって混ぜてから保存
  let sheet = people[0];
  for (let k = 1; k < 4; k++) sheet = ok(Merge.event(base, people[k], sheet, OPT)).value;
  assert.equal(sheet.name, "1人目が直した");
  assert.deepEqual(ids(sheet.tasks), ["u11", "u13", "P2"]);
  assert.equal(sheet.day.rows[0].cells.u31, "日誌");
});
test("【S3】保存し直しが2回続けてぶつかっても、前回取り込んだ相手の値を自分の変更と見間違えない", () => {
  const base = withTasks(["A"]);
  const me = cp(base); me.tasks[0].owner = "自分";
  const t1 = cp(base); t1.tasks[0].title = "相手1";
  const r1 = ok(Merge.event(base, me, t1, OPT));        // 1回目：混ぜる土台を t1 へ進める
  const t2 = cp(t1); t2.tasks[0].title = "相手2";       // その間に、別の人がさらに直した
  const r2 = ok(Merge.event(t1, r1.value, t2, OPT));    // 2回目は t1 を土台に
  assert.equal(r2.conflicts.length, 0);
  assert.equal(r2.value.tasks[0].title, "相手2"); assert.equal(r2.value.tasks[0].owner, "自分");
});

/* ===== ばらばらの直し方を多数試す（片方が触っていなければ、もう片方がそのまま残る） ===== */
function rnd(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
function edit(e, r, tag) {
  const n = 1 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) {
    const c = Math.floor(r() * 8), L = e.tasks;
    if (c === 0) e.name = tag + k;
    else if (c === 1) L.push(task(tag + "n" + k));
    else if (c === 2 && L.length) L.splice(Math.floor(r() * L.length), 1);
    else if (c === 3 && L.length) L[Math.floor(r() * L.length)].title = tag + "t" + k;
    else if (c === 4 && L.length > 1) L.reverse();
    else if (c === 5) e.day.rows[0].cells.u31 = tag + k;
    else if (c === 6) e.classes = e.classes.filter((_, i) => r() < 0.7);
    else e.snaps[0].photos.push(tag + "p" + k);
  }
  return e;
}
test("ばらばらの直し方500通り：片方だけが直したら、その中身になる／結果は表を通る", () => {
  const r = rnd(7);
  for (let i = 0; i < 500; i++) {
    const b = fullEvent(), m = edit(cp(b), r, "m" + i), t = edit(cp(b), r, "t" + i);
    assert.deepEqual(ok(Merge.event(b, cp(b), t, OPT)).value, t);
    assert.deepEqual(ok(Merge.event(b, m, cp(b), OPT)).value, m);
    const x = ok(Merge.event(b, m, t, OPT));
    assert.equal(Merge.check(x.value), null);
    assert.deepEqual(ok(Merge.event(b, m, t, OPT)).value, x.value);   // 同じ入力 → 同じ結果
  }
});

/* ===== 番号のない行に番号をつける（設計メモ5節【S5】） ===== */
function bare() {
  return {
    id: "u1", name: "古い行事", date: "2026-12-12",
    team: [{ name: "職員A", role: "統括" }, { name: "職員B", role: "" }],
    tasks: [{ id: "u5", cat: "物", title: "看板", owner: "", status: "未着手" }],
    orders: [], places: [{ name: "受付", need: 1, who: ["職員A"] }],
    prog: { org: "", title: "", parts: [{ name: "第1部", cls: [], items: [{ title: "うた" }, { title: "うた" }] }] }
  };
}
test("はじめの一回：番号のない一覧は「何行目か」の番号。番号のある行には触らない", () => {
  const e = Merge.number(bare(), "load");
  assert.deepEqual(e.team.map(x => x.id), ["m:team:0", "m:team:1"]);
  assert.equal(e.tasks[0].id, "u5");
  assert.equal(e.places[0].id, "m:places:0");
  assert.equal(e.prog.parts[0].id, "m:prog_parts:0", "番号に「.」は入れない（入力先の指定が「.」区切りのため）");
  assert.deepEqual(e.prog.parts[0].items.map(x => x.id), ["m:prog_parts_items:0", "m:prog_parts_items:1"]);
  assert.equal(Merge.check(e), null, "番号をつけたら形の検査を通る");
});
test("同じ中身からは、何回つけても同じ番号（全員の画面で食い違わない）", () => {
  assert.deepEqual(Merge.number(bare(), "load"), Merge.number(bare(), "load"));
  assert.deepEqual(Merge.number(bare(), "fetch"), Merge.number(bare(), "fetch"));
  const once = Merge.number(bare(), "load");
  assert.deepEqual(Merge.number(cp(once), "load"), once, "2回目は何も変わらない");
});
test("はじめの一回のあと（どこかに m: がある）・取り寄せた最新では、中身の指紋の番号。同じ中身は ~2", () => {
  const e = Merge.number(bare(), "load");
  e.orders.push({ name: "記念品", amount: 100 });                  // 古いページの人が足した
  e.team.push({ name: "職員C", role: "" });
  Merge.number(e, "load");
  assert.match(e.orders[0].id, /^h:orders:[0-9a-z]+$/);
  assert.match(e.team[2].id, /^h:team:/);
  const f = Merge.number(bare(), "fetch");
  assert.match(f.team[0].id, /^h:team:/);
  const items = f.prog.parts[0].items.map(x => x.id);
  assert.equal(items[1], items[0] + "~2");
  assert.equal(Merge.check(f), null);
});
test("指紋の番号は、行が詰まっても同じ行に同じ番号がつく（古いページで行を消したとき）", () => {
  const a = { id: "u1", orders: [{ name: "A" }, { name: "B" }, { name: "C" }] };
  const b = { id: "u1", orders: [{ name: "A" }, { name: "C" }] };
  Merge.number(a, "fetch"); Merge.number(b, "fetch");
  assert.equal(b.orders[1].id, a.orders[2].id);
});

test("はじめの一回でつけた番号に「.」が入らない（入力先の指定「day.rows.0.cells.番号」が分かれないように）", () => {
  const e = bare();
  e.day = { slots: [{ name: "1部" }, { name: "2部" }], posts: [], rows: [{ name: "A", cells: {} }] };
  Merge.number(e, "load");
  e.day.slots.forEach(x => assert.equal(x.id.indexOf("."), -1, x.id));
  assert.equal(new Set(e.day.slots.map(x => x.id)).size, 2);
});
