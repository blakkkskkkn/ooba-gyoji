/* 行事管理APP｜混ぜる部品（2026-11-10 作成。設計メモ「同時編集の設計メモ」4節）
   土台（最後にシートと一致していた中身）・自分（いまの画面）・相手（シートの最新）の3つから、
   1つの行事の中身を作る。画面にもシートにも触らない、ほかとつながらない部品。

   使い方：Merge.event(土台, 自分, 相手, {order:["クラス名",…]})
     → 混ぜられた：{ok:true, value:結果, conflicts:[控えの元], notes:[知らせ]}
     → 混ぜずに止める：{ok:false, stop:{at:"場所", why:"理由"}}
   Merge.check(行事) → 形がおかしいところ（{at, why}）。問題なければ null
   ※ 決まり：同じ欄を2人が別々に変えたら相手（先に保存された方）を残し、自分の値は conflicts に入れる */
(function (root) {
  "use strict";

  /* ===== データの場所ごとの表（設計メモ4-1【S6】）=====
     V＝ひとつの値（d は項目がないときの初めの値）／O＝まとまり／L＝行の一覧（id で対応づけ）
     S＝チェックの集まり（クラス順に整える）／Q＝並びのある値の一覧（写真・配置の人）
     M＝名前つきの値の集まり（鍵＝時間帯のID）／X＝混ぜない（最終更新）
     表にない項目が出てきたら、混ぜずに止める。index.html で項目を足したら、ここも足す */
  const V = d => ({ t: "V", d: d });
  const O = f => ({ t: "O", f: f });
  const L = f => ({ t: "L", f: Object.assign({ id: V("") }, f) });
  const S = () => ({ t: "S" });
  const Q = () => ({ t: "Q" });
  const M = d => ({ t: "M", d: d });
  const X = () => ({ t: "X" });
  const T = "";  // 文の初めの値

  const SCHEMA = O({
    id: V(T), name: V(T), date: V(T), rainDate: V(T), updatedAt: X(),
    purpose: O({ who: V(T), what: V(T), why: V(T) }),
    success: O({ child: V(T), parent: V(T), staff: V(T) }),
    delegate: O({ ok: V(T), ask: V(T) }),
    team: L({ name: V(T), role: V(T) }),
    lead: V(T), commander: V(T), photographer: V("unset"),
    classes: S(),
    kids: L({ cls: V(T), growth: V(T), daily: V(T) }),
    checks: L({ cat: V(T), group: V("every"), text: V(T), done: V(false), note: V(T), ref: V(T), ai: V(false), custom: V(false) }),
    tasks: L({ cat: V(T), title: V(T), owner: V(T), start: V(T), due: V(T), status: V("未着手"), fromRetro: V(false) }),
    staff: O({ "正規": V(0), "有期": V(0), "パート": V(0) }),
    places: L({ name: V(T), need: V(0), custom: V(false), who: Q() }),
    care: L({ cls: V(T), initial: V(T), plan: V(T), person: V(T) }),
    familyLimit: V(T), childcare: V(T),
    orders: L({ name: V(T), to: V(T), due: V(T), amount: V(0), state: V("未発注") }),
    budget: V(0),
    overtime: L({ label: V(T), hours: V(0) }),
    rate: V(0),
    notices: L({ what: V(T), when: V(T), drafter: V(T), one: V(T), ok: V(false) }),
    phrase: V(T),
    logs: L({ when: V(T), where: V("個別"), from: V(T), to: V(T), one: V(T), ref: V(T), ok: V(false), photos: Q() }),
    snaps: L({ when: V(T), what: V(T), photos: Q() }),
    retros: L({ cat: V(T), fact: V(T), did: V(T), who: V(T), weeks: V(T), what: V(T) }),
    prevTaskCount: V(T),
    day: O({
      slots: L({ name: V(T), from: V(T), to: V(T), cls: S() }),
      posts: L({ name: V(T), kind: V(T), need: M(T), custom: V(false) }),
      rows: L({ name: V(T), in: V(T), out: V(T), cells: M(T) })
    }),
    prog: O({
      org: V(T), title: V(T),
      parts: L({ name: V(T), cls: S(), meet: V(T), from: V(T), to: V(T), items: L({ title: V(T), cls: V(T), kind: V(T) }) })
    })
  });

  /* ===== 道具 ===== */
  const ABSENT = { absent: true };                       // 名前つきの値の集まりで「鍵がない」
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const isScalar = v => v === null || ["string", "number", "boolean"].indexOf(typeof v) >= 0;
  /* 同じ値か。シートを通ると NaN が null になるので、JSONにしたときの形で比べる */
  const same = (a, b) => a === b || stable(a) === stable(b);
  function stable(v) {
    if (v === ABSENT) return "\u0000absent";
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (isObj(v)) return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  class Stop extends Error { constructor(at, why) { super(why); this.at = at; this.why = why; } }
  const at = (p, k) => p ? p + "." + k : String(k);
  const atId = (p, id) => p + "[" + id + "]";

  /* ===== 形を調べる（読み込んだとき・保存する前・混ぜる前）【R12】【R6】 ===== */
  function checkNode(sc, v, p) {
    if (v === undefined) return;
    switch (sc.t) {
      case "V": case "X":
        if (!isScalar(v)) throw new Stop(p, "ひとつの値のはずが、別の形になっています");
        return;
      case "O":
        if (!isObj(v)) throw new Stop(p, "まとまりのはずが、別の形になっています");
        Object.keys(v).forEach(k => {
          if (!has(sc.f, k)) throw new Stop(at(p, k), "表にない項目です（混ぜ方が決まっていません）");
          checkNode(sc.f[k], v[k], at(p, k));
        });
        return;
      case "L": {
        if (!Array.isArray(v)) throw new Stop(p, "一覧のはずが、別の形になっています");
        const seen = {};
        v.forEach((it, i) => {
          if (!isObj(it)) throw new Stop(p + "[" + i + "]", "行の形がおかしいです");
          const id = it.id;
          if (typeof id !== "string" || !id) throw new Stop(p + "[" + i + "]", "行に番号がありません");
          if (seen[id]) throw new Stop(atId(p, id), "同じ番号の行が2つあります");
          seen[id] = true;
          checkNode(O(sc.f), it, atId(p, id));
        });
        return;
      }
      case "S": case "Q": {
        if (!Array.isArray(v)) throw new Stop(p, "一覧のはずが、別の形になっています");
        const seen = {};
        v.forEach((x, i) => {
          if (typeof x !== "string") throw new Stop(p + "[" + i + "]", "文字のはずが、別の形になっています");
          if (seen[x]) throw new Stop(p, "同じ値が2つあります");
          seen[x] = true;
        });
        return;
      }
      case "M":
        if (!isObj(v)) throw new Stop(p, "名前つきの値の集まりのはずが、別の形になっています");
        Object.keys(v).forEach(k => { if (!isScalar(v[k])) throw new Stop(at(p, k), "ひとつの値のはずが、別の形になっています"); });
        return;
    }
  }
  function check(ev) {
    try {
      if (!isObj(ev)) return { at: "", why: "行事の形がおかしいです" };
      if (typeof ev.id !== "string" || !ev.id) return { at: "id", why: "行事に番号がありません" };
      checkNode(SCHEMA, ev, "");
      return null;
    } catch (z) {
      if (z instanceof Stop) return { at: z.at, why: z.why };
      throw z;
    }
  }

  /* ===== 混ぜる ===== */
  function mergeEvent(base, mine, theirs, opts) {
    const ctx = { conflicts: [], notes: [], order: (opts && opts.order) || [] };
    try {
      [["土台", base], ["自分", mine], ["相手", theirs]].forEach(x => {
        const bad = check(x[1]);
        if (bad) throw new Stop(bad.at, x[0] + "：" + bad.why);
      });
      if (base.id !== mine.id || mine.id !== theirs.id) throw new Stop("id", "別の行事どうしは混ぜられません");
      const value = mergeO(SCHEMA, base, mine, theirs, "", ctx);
      return { ok: true, value: value, conflicts: ctx.conflicts, notes: ctx.notes };
    } catch (z) {
      if (z instanceof Stop) return { ok: false, stop: { at: z.at, why: z.why } };
      throw z;
    }
  }

  function mergeNode(sc, b, m, t, p, ctx) {
    switch (sc.t) {
      case "V": return mergeV(sc, b, m, t, p, ctx);
      case "X": return mergeX(b, m, t);
      case "O": return mergeO(sc, b, m, t, p, ctx);
      case "L": return mergeL(sc, b, m, t, p, ctx);
      case "S": return mergeS(b, m, t, ctx);
      case "Q": return mergeQ(b, m, t);
      case "M": return mergeM(sc, b, m, t, p, ctx);
    }
    throw new Stop(p, "混ぜ方が決まっていません");
  }

  /* 4-2 ひとつの値。項目がないときは初めの値があったものとみなす */
  function mergeV(sc, b, m, t, p, ctx) {
    const d = sc.d;
    const B = b === undefined ? d : b, Mi = m === undefined ? d : m, Th = t === undefined ? d : t;
    if (same(Mi, B)) return clone(Th);
    if (same(Th, B)) return clone(Mi);
    if (same(Mi, Th)) return clone(Th);
    ctx.conflicts.push({ at: p, base: clone(B), mine: clone(Mi), theirs: clone(Th) });
    return clone(Th);
  }

  /* 最終更新は混ぜない（保存するときに今日の日付を入れる）【R14】。ここでは新しい方を仮に置く */
  function mergeX(b, m, t) {
    const a = [m, t].filter(x => typeof x === "string").sort();
    return a.length ? a[a.length - 1] : clone(m === undefined ? t : m);
  }

  /* 4-3 まとまり。片方にだけ新しくできたまとまりは、空のまとまりが土台だったとみなす。
     土台にあった項目が片方から消えているのは、ふつうの操作では起きないので止める（AI判断） */
  function mergeO(sc, b, m, t, p, ctx) {
    const B = b === undefined ? {} : b, Mi = m === undefined ? {} : m, Th = t === undefined ? {} : t;
    const out = {};
    const keys = [];
    [Th, Mi, B].forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));
    keys.forEach(k => {
      const kp = at(p, k);
      if (!has(sc.f, k)) throw new Stop(kp, "表にない項目です（混ぜ方が決まっていません）");
      const s = sc.f[k];
      if (b !== undefined && has(B, k) && s.t !== "V" && s.t !== "X") {
        if ((m !== undefined && !has(Mi, k)) || (t !== undefined && !has(Th, k))) throw new Stop(kp, "土台にあった項目が消えています");
      }
      const r = mergeNode(s, B[k], Mi[k], Th[k], kp, ctx);
      if (r !== undefined) out[k] = r;
    });
    return out;
  }

  /* 4-4 行の一覧 */
  function mergeL(sc, b, m, t, p, ctx) {
    const B = b || [], Mi = m || [], Th = t || [];
    const ix = a => { const o = {}; a.forEach(it => { o[it.id] = it; }); return o; };
    const bI = ix(B), mI = ix(Mi), tI = ix(Th);
    const itemSc = O(sc.f);
    const items = {};      // 残す行：id → 中身
    const keptFrom = {};   // 消されたが入力があって残した行：id → 残した側（"mine"／"theirs"）
    const ids = [];
    [Th, Mi, B].forEach(a => a.forEach(it => { if (ids.indexOf(it.id) < 0) ids.push(it.id); }));
    ids.forEach(id => {
      const ip = atId(p, id), inB = has(bI, id), inM = has(mI, id), inT = has(tI, id);
      if (inM && inT) { items[id] = mergeO(itemSc, inB ? bI[id] : undefined, mI[id], tI[id], ip, ctx); return; }
      if (!inB) { items[id] = clone(inM ? mI[id] : tI[id]); return; }        // 片方が足した行
      if (inM && !inT) {                                                      // 相手が消した
        if (same(mI[id], bI[id])) return;
        items[id] = clone(mI[id]); keptFrom[id] = "mine";
        ctx.notes.push({ kind: "keptDeleted", deletedBy: "theirs", at: ip, id: id });
        return;
      }
      if (inT && !inM) {                                                      // 自分が消した
        if (same(tI[id], bI[id])) return;
        items[id] = clone(tI[id]); keptFrom[id] = "theirs";
        ctx.notes.push({ kind: "keptDeleted", deletedBy: "mine", at: ip, id: id });
      }
      // 両方とも消した → なし
    });
    const order = arrange(B.map(x => x.id), Mi.map(x => x.id), Th.map(x => x.id), Object.keys(items), keptFrom);
    return order.map(id => items[id]);
  }

  /* 4-4 の並び【R13】【S8】。ids は番号の並び。keep は残す番号。
     keptFrom は「消されたが残した行」がどちらの画面の並びに従うか */
  function arrange(bIds, mIds, tIds, keep, keptFrom) {
    const keepSet = {}; keep.forEach(id => { keepSet[id] = true; });
    const bSet = toSet(bIds);
    const reordered = side => {
      const sSet = toSet(side);
      const x = bIds.filter(id => sSet[id]), y = side.filter(id => bSet[id]);
      return x.join("\u0001") !== y.join("\u0001");
    };
    const mineFirst = reordered(mIds) && !reordered(tIds);       // 自分だけが並べ替えた
    const primary = mineFirst ? mIds : tIds, other = mineFirst ? tIds : mIds;
    const otherName = mineFirst ? "theirs" : "mine";
    const otherSet = toSet(other), tSet = toSet(tIds);
    const out = primary.filter(id => keepSet[id]);
    const placed = toSet(out);
    const addedBy = id => bSet[id] ? null : (tSet[id] ? "theirs" : "mine");
    // もう片方の画面の順に、まだ置いていない行を入れる
    other.forEach((id, k) => {
      if (!keepSet[id] || placed[id]) return;
      if (keptFrom[id] && keptFrom[id] !== otherName) return;
      let pos = -1, below = false;
      if (k === 0) pos = 0;                                    // 先頭に足した → 先頭
      else {
        const ui = out.indexOf(other[k - 1]);
        if (ui >= 0) pos = ui + 1;                             // すぐ上の行の後ろ
        else {
          // すぐ上の行が相手側で消されていた → すぐ下の行の前（これから入れる行は飛ばして探す）
          for (let j = k + 1; j < other.length; j++) {
            const di = out.indexOf(other[j]);
            if (di >= 0) { pos = di; below = true; break; }
            if (keepSet[other[j]] && !placed[other[j]] && otherSet[other[j]]) continue;
            break;
          }
        }
      }
      if (pos < 0) pos = out.length;                           // 上も下も見つからない → 最後
      // 同じ場所に入るときは、相手（先に保存した方）が足した行を先にする
      if (otherName === "mine") { while (pos < out.length && addedBy(out[pos]) === "theirs") pos++; }
      else if (below) { while (pos > 0 && addedBy(out[pos - 1]) === "mine") pos--; }
      out.splice(pos, 0, id);
      placed[id] = true;
    });
    // 念のため：どちらの並びにも入れられなかった行は最後に
    keep.forEach(id => { if (!placed[id]) { out.push(id); placed[id] = true; } });
    return out;
    function toSet(a) { const o = {}; a.forEach(x => { o[x] = true; }); return o; }
  }

  /* 4-5 チェックの集まり：入れた・外したをそれぞれ反映し、クラス順に整える */
  function mergeS(b, m, t, ctx) {
    if (b === undefined && m === undefined && t === undefined) return undefined;
    const B = b || [], Mi = m === undefined ? B : m, Th = t === undefined ? B : t;
    const out = B.slice();
    const add = x => { if (out.indexOf(x) < 0) out.push(x); };
    const rm = x => { const i = out.indexOf(x); if (i >= 0) out.splice(i, 1); };
    Th.forEach(x => { if (B.indexOf(x) < 0) add(x); });
    Mi.forEach(x => { if (B.indexOf(x) < 0) add(x); });
    B.forEach(x => { if (Th.indexOf(x) < 0 || Mi.indexOf(x) < 0) rm(x); });
    const ord = ctx.order;
    const rank = x => { const i = ord.indexOf(x); return i < 0 ? ord.length : i; };
    return out.map((x, i) => [x, i]).sort((a, c) => rank(a[0]) - rank(c[0]) || a[1] - c[1]).map(a => a[0]);
  }

  /* 写真・配置の人：値そのものを番号にした行の一覧として、4-4 の決まりで混ぜる（中身を直すことはない） */
  function mergeQ(b, m, t) {
    if (b === undefined && m === undefined && t === undefined) return undefined;
    const B = b || [], Mi = m || [], Th = t || [];
    const keep = [];
    const all = [];
    [Th, Mi, B].forEach(a => a.forEach(x => { if (all.indexOf(x) < 0) all.push(x); }));
    all.forEach(x => {
      const inB = B.indexOf(x) >= 0, inM = Mi.indexOf(x) >= 0, inT = Th.indexOf(x) >= 0;
      if (inB ? (inM && inT) : (inM || inT)) keep.push(x);
    });
    return arrange(B, Mi, Th, keep, {});
  }

  /* 4-3 名前つきの値の集まり：片方が鍵を消し、もう片方が触っていない → 消す。もう片方が値を変えた → 残す */
  function mergeM(sc, b, m, t, p, ctx) {
    if (b === undefined && m === undefined && t === undefined) return undefined;
    const B = b || {}, Mi = m || {}, Th = t || {};
    const out = {};
    const keys = [];
    [Th, Mi, B].forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));
    keys.forEach(k => {
      const bv = has(B, k) ? B[k] : ABSENT, mv = has(Mi, k) ? Mi[k] : ABSENT, tv = has(Th, k) ? Th[k] : ABSENT;
      let r;
      if (same(mv, bv)) r = tv;
      else if (same(tv, bv)) r = mv;
      else if (same(mv, tv)) r = tv;
      else if (mv === ABSENT) r = tv;          // 自分が消し、相手が変えた → 残す
      else if (tv === ABSENT) r = mv;          // 相手が消し、自分が変えた → 残す
      else {
        ctx.conflicts.push({ at: at(p, k), base: bv === ABSENT ? sc.d : clone(bv), mine: clone(mv), theirs: clone(tv) });
        r = tv;
      }
      if (r !== ABSENT) out[k] = clone(r);
    });
    return out;
  }

  /* ===== 番号のない行に番号をつける（設計メモ5節【S5】）=====
     同じ中身からは、だれが何回つけても同じ番号になる（全員の画面で食い違わない）。
     mode "load"：その一覧の行に番号が1つもなく、行事のどこにも m: の番号がない（＝はじめの一回）→ 何行目か（m:場所:何行目）
     それ以外（番号のある行とない行がまじる・はじめの一回のあと）→ 行の中身の指紋（h:場所:指紋）。同じ中身の行が2つあれば ~2 をつける
     番号がすでにある行には触らない。行事をその場で書き換えて返す */
  function fingerprint(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  const hasId = it => typeof it.id === "string" && it.id !== "";
  function hasM(v) {
    if (Array.isArray(v)) return v.some(hasM);
    if (isObj(v)) return (typeof v.id === "string" && v.id.indexOf("m:") === 0) || Object.keys(v).some(k => hasM(v[k]));
    return false;
  }
  function numberNode(sc, v, p, first) {
    if (sc.t === "O" && isObj(v)) { Object.keys(v).forEach(k => { if (has(sc.f, k)) numberNode(sc.f[k], v[k], at(p, k), first); }); return; }
    if (sc.t !== "L" || !Array.isArray(v)) return;
    const rows = v.filter(isObj);
    const used = {};
    rows.forEach(it => { if (hasId(it)) used[it.id] = true; });
    const none = rows.length > 0 && !rows.some(hasId);
    v.forEach((it, i) => {
      if (!isObj(it) || hasId(it)) return;
      let id;
      if (first && none) id = "m:" + p.replace(/\./g, "_") + ":" + i;   /* 入力先の指定は「.」区切りなので、番号に「.」を入れない */
      else {
        const rest = {}; Object.keys(it).forEach(k => { if (k !== "id") rest[k] = it[k]; });
        const b = "h:" + p + ":" + fingerprint(stable(rest));
        id = b; for (let n = 2; used[id]; n++) id = b + "~" + n;
      }
      used[id] = true;
      it.id = id;
    });
    v.forEach(it => { if (isObj(it)) numberNode(O(sc.f), it, p, first); });
  }
  function number(ev, mode) {
    if (!isObj(ev)) return ev;
    numberNode(SCHEMA, ev, "", mode === "load" && !hasM(ev));
    return ev;
  }

  const api = { event: mergeEvent, check: check, number: number, same: same, SCHEMA: SCHEMA };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Merge = api;
})(typeof window !== "undefined" ? window : this);
