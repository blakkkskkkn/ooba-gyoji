/* 行事管理APP｜データの出し入れはこのファイルだけ
   API（Apps Script ウェブアプリのURL）が空のとき：このブラウザに保存する（localStorage）。仮の保存
   API が入っているとき：Googleシート（Apps Script・合言葉で確認）に保存する
   Vercelへ移すときも、このファイルを差し替える
   ※このファイルは公開される。合言葉・職員名・資料の本文・行事のデータは書かない（URLは書いてよい。合言葉がないと読めない） */
(function(){
"use strict";
const API="https://script.google.com/macros/s/AKfycbwmvYzATMo3-81ZO9HgsLftQyNP1i1RqgeREg5j675SCzvQYx6weG-HDQuEEiZCiMgPTg/exec";  /* Apps Script ウェブアプリのURL（2026-10-27 園長の初回作業で公開）。空にするとブラウザ保存に戻る */
const KEY="gyoji-v2-local",PKEY="gyoji-v2-pass",CKEY="gyoji-v2-current",HKEY="gyoji-v2-hikae";
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(e){return false}},del(k){try{localStorage.removeItem(k)}catch(e){}}};

/* ===== このブラウザに保存する版 ===== */
const Local={
  mode:"local",
  /* 全データを読む。形は {ver:2, events:[…], currentId:"…"}。まだ何もなければ null */
  load(){
    try{const t=localStorage.getItem(KEY);return Promise.resolve(t?JSON.parse(t):null)}
    catch(e){return Promise.resolve(null)}
  },
  /* 全データを保存する。結果はすぐ返す："ok"／"full"（容量がいっぱい）／"off"（保存できない） */
  save(s){
    try{localStorage.setItem(KEY,JSON.stringify(s));return "ok"}
    catch(e){return (e&&(e.name==="QuotaExceededError"||e.code===22||e.code===1014))?"full":"off"}
  },
  /* このブラウザの保存を消す（local のときだけ使う） */
  clear(){ls.del(KEY)},
  /* 資料の本文。公開ファイルには置かないので null（画面は「まだ読み込まれていません」と出す） */
  docs(){return Promise.resolve(null)},
  /* 職員の呼び名リスト（「誰が」の入力候補）。ブラウザ保存では空 */
  owners(){return Promise.resolve([])},
  photoSrc(p){return p},
  /* 同時編集の道具（ブラウザ保存では1人なので何もしない） */
  refresh(){},hikae(){return []},missing(){return []}
};

/* ===== Googleシートに保存する版（同時編集つき。設計メモ「同時編集の設計メモ」3〜8節） =====
   - 保存は行事1件ずつ。変わった行事だけを、少し待ってから送る（save() はすぐ "ok" を返す）
   - 行事ごとに3つを分けて持つ【S3】
       保存済み（sent）：最後に保存が成功した中身と版。「まだ送っていない変更があるか」はこれと比べる
       混ぜる土台（base）：次に混ぜるときの土台と、保存するときに付ける版。取り寄せた最新と混ぜたら、その最新へ進める
       いまの画面（state）：送りたい中身。index.html の S.events と同じ一覧（ここで書き換えると画面のデータも変わる）
   - ほかの人が先に保存していたら（conflict）、最新を取り寄せて、土台・自分・相手を混ぜて（merge.js）、送り直す。
     3回混ぜてもまたぶつかったら「保存できていません」として残す【R4】
   - 取り寄せ（load）は土台を勝手に書き換えない【R1】。保存・取り寄せ・写真送りは、すべて1本の順番待ちで1つずつ行う【R2】
     混ぜるのは答えが届いたその場で行い、すぐ画面のデータに入れる（間に入力がはさまらないので、届いた時点の画面が「自分」になる【R3】）
   - 写真は先にGoogleドライブへ送り、行事のデータの中では "drv:写真のID" に置き換える【R9】
   画面との約束（index.html が入れる）：
     Store.onStatus(状態, 説明)  … 帯の表示。状態は saving／saved／merged／net／pass／big／stuck／missing／halted／badrow／hikae-lost
     Store.onChange(知らせ)      … 混ぜた・足した結果を画面のデータに入れたので、描き直してほしい。
                                   知らせ＝{changed:[行事ID], added:[…], cancelled:[消すのをやめた行事ID], notes:[消された行を残した等], hikae:[新しい控え]}
     Store.canApply()            … いま画面のデータを入れ替えてよいか（日本語の変換中は false）。false の間は待つ
     Store.beforeApply()         … 画面のデータを入れ替える直前（入力中の欄とカーソルを、行の番号で覚えておく）
     Store.prepare(行事, 場面)   … 番号のない行に番号をつける（設計メモ5節）。場面は "load"（起動時）／"fetch"（取り寄せた最新）。なければそのまま
                                   番号をつけた中身を「混ぜる土台」にし、「保存済み」はシートのままにする（＝番号をつけた版を、すぐ保存する【S5】）
     Store.order                 … クラスの並び（チェックの集まりを並べる順）
     Store.newId()               … 新しい行事番号（「新しい行事として保存し直す」用） */
const sent={},base={},tries={};
const missing={};   /* 行事ID → 行事名：シートの一覧から消えた（自動では消さない【S4】） */
const stuck={};     /* 行事ID → 行事名：3回混ぜてもぶつかった【R4】 */
const halted={};    /* 行事ID → {name, at, why}：形がおかしく、自動で混ぜずに止めた【R6】【R12】 */
const broken={};    /* 行事ID → true：シートの行が読めない（ほかの人が消したとは見なさない） */
const photoCache={},photoWait={},photoGone={};
let state=null,timer=0,busy=false,stopped="",cache={owners:[],docs:null},booted=null,wantFetch=false,hikaeLost=false;
const TIMEOUT=60000;   /* 答えが60秒来なければ、届かなかったものとして扱う（順番待ちが止まったままにならないように） */

function call(op,body){
  let tm=0;
  const req=fetch(API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},redirect:"follow",
    body:JSON.stringify(Object.assign({op:op,pass:ls.get(PKEY)||""},body||{}))})
    .then(function(r){if(!r.ok)throw new Error("http "+r.status);return r.json()});
  const late=new Promise(function(_,no){tm=setTimeout(function(){no(new Error("timeout"))},TIMEOUT)});
  return Promise.race([req,late]).then(function(r){clearTimeout(tm);return r},function(e){clearTimeout(tm);throw e});
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
/* 通信の失敗・混雑は送り直す。合言葉・版の食い違いなどの答えはそのまま返す */
function callRetry(op,body){
  let n=0;
  const go=function(){return call(op,body).then(function(r){if(r&&r.err==="busy")throw new Error("busy");return r})
    .catch(function(e){if(++n>=3)throw e;return wait(n*2500).then(go)})};
  return go();
}
const tell=(k,m)=>{try{if(Store.onStatus)Store.onStatus(k,m||"")}catch(e){}};
const fyOf=d=>{const m=/^(\d{4})-(\d{2})/.exec(d||"");if(!m){const t=new Date();return t.getMonth()>=3?t.getFullYear():t.getFullYear()-1}return Number(m[2])>=4?Number(m[1]):Number(m[1])-1};
const clone=v=>JSON.parse(JSON.stringify(v));
const nameOf=e=>(e&&e.name)||"この行事";
const unsent=e=>{const s=sent[e.id];return !s||s.json!==JSON.stringify(e)};
const blocked=id=>!!(missing[id]||stuck[id]||halted[id]||broken[id]);
const Mg=()=>(typeof Merge!=="undefined"?Merge:null);

/* ===== 取り寄せ（混ぜる用。土台には触らない【R1】）=====
   答え：{ok, byId:{行事ID:{rev, json, data}}, bad:{行事ID:理由}}。読めない行・同じ番号の行は bad に入れ、その行事だけ混ぜない【R6】 */
function fetchLatest(){
  return callRetry("load",{}).then(function(r){
    if(!r.ok)return r;
    const byId={},bad={};
    (r.events||[]).forEach(function(x){
      const id=String(x.id);
      if(byId[id]||bad[id]){delete byId[id];bad[id]="同じ番号の行事が2つあります";return}
      let d;try{d=JSON.parse(x.data)}catch(z){bad[id]="中身が読めません";return}
      if(!d||typeof d!=="object"||Array.isArray(d)||String(d.id)!==id){bad[id]="中身の形がおかしいです";return}
      byId[id]={rev:Number(x.rev)||0,json:JSON.stringify(d),data:d};
    });
    cache={owners:r.owners||cache.owners,docs:r.docs||cache.docs};
    return {ok:true,byId:byId,bad:bad};
  });
}
const fetchAbsorb=()=>fetchLatest().then(function(L){return L.ok?absorb(L).then(()=>({ok:true})):L});

/* ===== 取り寄せた最新を、画面のデータに入れる（設計メモ 3-3・4-7）===== */
function whenCanApply(){
  const can=()=>{try{return !Store.canApply||Store.canApply()!==false}catch(e){return true}};
  return new Promise(function(ok){(function look(){if(can())ok();else setTimeout(look,300)})()});
}
function prep(e,when){try{return Store.prepare?Store.prepare(e,when)||e:e}catch(z){return e}}
/* 形の検査（読み込んだとき・取り込むとき・保存する前。設計メモ5節【R12】）。おかしければ、その行事は止めて帯で知らせる。答え：止めたら true */
function badShape(e){const M=Mg();return M?M.check(e):null}
function haltIfBad(id,e,when){
  const bad=badShape(e);if(!bad)return false;
  halted[id]={name:nameOf(e),at:bad.at,why:when+"："+bad.why,shape:true};
  return true;
}
function absorb(L){
  return whenCanApply().then(function(){
    try{if(Store.beforeApply)Store.beforeApply()}catch(e){}
    const evs=state.events,info={changed:[],added:[],cancelled:[],notes:[],hikae:[]};
    const at={};evs.forEach(function(e,i){at[e.id]=i});
    Object.keys(L.bad).forEach(function(id){broken[id]=true});
    Object.keys(L.byId).forEach(function(id){
      const t=L.byId[id],b=base[id];
      const td=prep(t.data,"fetch"),tb={rev:t.rev,json:JSON.stringify(td)};   /* 相手にも番号をつけてから比べる */
      delete broken[id];
      if(id in at){
        delete missing[id];
        const i=at[id],mine=evs[i];
        if(b&&b.rev===t.rev)return;                                     /* ほかの人は直していない */
        if(!b){halted[id]={name:nameOf(mine),at:"",why:"同じ番号の行事が、シートにもあります"};return}
        if(!unsent(mine)&&sent[id].rev===b.rev){                        /* 自分は何も変えていない → 相手の最新をそのまま */
          if(haltIfBad(id,td,"シートの最新"))return;                     /* 形のおかしい最新は画面に入れない（いまの画面のまま止める） */
          evs[i]=td;sent[id]={rev:t.rev,json:t.json};base[id]=tb;delete halted[id];info.changed.push(id);return;
        }
        const M=Mg();
        if(!M){halted[id]={name:nameOf(mine),at:"",why:"混ぜる部品（merge.js）が読み込まれていません"};return}
        const r=M.event(JSON.parse(b.json),prep(clone(mine),"fetch"),td,{order:Store.order||[]});
        if(!r.ok){halted[id]={name:nameOf(mine),at:r.stop.at,why:r.stop.why};return}
        delete halted[id];
        evs[i]=r.value;base[id]=tb;info.changed.push(id);
        r.notes.forEach(function(n){info.notes.push(Object.assign({eventId:id,eventName:nameOf(r.value)},n))});
        r.conflicts.forEach(function(c){info.hikae.push(addHikae(id,nameOf(r.value),c))});
      }else if(b){                                                      /* 自分が消そうとしている行事 */
        if(b.rev===t.rev)return;                                        /* 相手は直していない → このまま消す */
        if(haltIfBad(id,td,"シートの最新"))return;                       /* 形がおかしい → 画面に入れず、消すのも止める */
        evs.push(td);at[id]=evs.length-1;sent[id]={rev:t.rev,json:t.json};base[id]=tb;info.cancelled.push(id);
      }else{                                                            /* ほかの人が新しく作った行事 */
        if(badShape(td)){broken[id]=true;return}                        /* 形がおかしい → 読めない行事として知らせる（画面に入れない） */
        evs.push(td);at[id]=evs.length-1;sent[id]={rev:t.rev,json:t.json};base[id]=tb;info.added.push(id);
      }
    });
    Object.keys(base).forEach(function(id){
      if(L.byId[id]||L.bad[id])return;
      if(id in at)missing[id]=nameOf(evs[at[id]]);                     /* 自動では消さない【S4】 */
      else{delete base[id];delete sent[id]}                             /* 自分もほかの人も消した */
    });
    if(info.hikae.length)saveHikae();
    if(info.changed.length||info.added.length||info.cancelled.length){
      tell("merged","ほかの人の入力を取り込みました");
      try{if(Store.onChange)Store.onChange(info)}catch(e){}
    }
    return info;
  });
}

/* ===== 控え（同じ欄でぶつかったときの「あなたの入力」。この端末に残す【R7】）===== */
let hikae=(function(){try{const a=JSON.parse(ls.get(HKEY)||"[]");return Array.isArray(a)?a:[]}catch(e){return []}})();
let hikaeN=0;
/* 同じ端末でタブを2つ開いていても、ほかのタブの控えを上書きで消さない：
   書く前・見せる前に端末の控えを読み直して合わせる。選んで片づけた控えの番号は DKEY に残し、ほかのタブが書き戻さないようにする */
const DKEY=HKEY+"-done";
let dropped={};
function readArr(k){try{const a=JSON.parse(ls.get(k)||"[]");return Array.isArray(a)?a:[]}catch(e){return []}}
function syncHikae(){
  readArr(DKEY).forEach(k=>{if(typeof k==="string")dropped[k]=true});
  hikae=hikae.filter(h=>!dropped[h.key]);
  readArr(HKEY).forEach(x=>{if(x&&x.key&&!dropped[x.key]&&!hikae.some(y=>y.key===x.key))hikae.push(x)});
}
function removeHikae(pred){hikae.forEach(h=>{if(pred(h))dropped[h.key]=true});hikae=hikae.filter(h=>!pred(h))}
/* 同じ欄で何回ぶつかっても、選ぶまでは前の控えを消さない（同じ入力・同じ相手の値の控えは1つにまとめる） */
function addHikae(id,name,c){
  const dup=hikae.find(x=>x.eventId===id&&x.at===c.at&&sameV(x.mine,c.mine)&&sameV(x.theirs,c.theirs));
  if(dup)return dup;
  const key="h"+Date.now().toString(36)+(hikaeN++).toString(36)+Math.random().toString(36).slice(2,6);
  const h={key:key,eventId:id,eventName:name,at:c.at,base:c.base,mine:c.mine,theirs:c.theirs};
  hikae=hikae.concat([h]);
  return h;
}
/* 書けたかを読み直して確かめる【S7】 */
function saveHikae(){
  syncHikae();
  let ok;
  if(hikae.length){const t=JSON.stringify(hikae);ok=ls.set(HKEY,t)&&ls.get(HKEY)===t}
  else{ls.del(HKEY);ok=true}
  const d=Object.keys(dropped);if(d.length)ls.set(DKEY,JSON.stringify(d.slice(-300)));
  hikaeLost=!ok;
  return ok;
}
/* 「tasks[u11].title」のような場所を、行事の中でたどる（set のときは値を入れる） */
function steps(p){const a=[];String(p).replace(/\[([^\]]*)\]|([^.[\]]+)/g,function(_,id,k){a.push(id!==undefined?{id:id}:{k:k});return ""});return a}
function walk(e,p,set,val){
  const s=steps(p);let o=e;
  for(let i=0;i<s.length;i++){
    const last=i===s.length-1,st=s[i];
    if(st.id!==undefined){
      if(!Array.isArray(o))return {gone:true};
      const j=o.findIndex(x=>x&&x.id===st.id);
      if(j<0)return {gone:true};
      if(last){if(set)o[j]=val;return {value:o[j]}}
      o=o[j];
    }else{
      if(o===null||typeof o!=="object")return {gone:true};
      if(last){if(set)o[st.k]=val;return {value:o[st.k]}}
      if(!(st.k in o))return {gone:true};
      o=o[st.k];
    }
  }
  return {value:o};
}
const sameV=(a,b)=>JSON.stringify(a===undefined?null:a)===JSON.stringify(b===undefined?null:b);

/* ===== 順番待ち：いま行うことを1つ選ぶ（取り寄せ → 写真 → 変わった行事 → 消えた行事）===== */
function nextJob(){
  if(!state)return null;
  if(wantFetch)return function(){wantFetch=false;return fetchAbsorb()};
  const evs=state.events||[];
  for(const e of evs){
    if(blocked(e.id))continue;
    for(const l of (e.logs||[]).concat(e.snaps||[]))for(const p of (l.photos||[])){  /* 写真で残す（snaps）と、前に伝達ログへ入れた写真 */
      if(typeof p==="string"&&p.indexOf("data:")===0)return function(){return upPhoto(e,p)};
    }
  }
  for(const e of evs){
    if(blocked(e.id))continue;
    if(unsent(e))return function(){return upEvent(e)};
  }
  const ids=new Set(evs.map(e=>e.id));
  for(const id in base)if(!ids.has(id)&&!blocked(id))return function(){return delEvent(id)};
  return null;
}
/* 写真：送り終わったら、その時点の画面のデータの中から同じ写真を探して置き換える（途中で混ぜて一覧が作り直されても届くように）【R9】 */
function upPhoto(e,p){
  return callRetry("putPhoto",{fy:fyOf(e.date),eventId:e.id,data:p}).then(function(r){
    if(!r.ok)return r;
    const k="drv:"+r.id;photoCache[k]=p;
    (state.events||[]).forEach(function(x){(x.logs||[]).concat(x.snaps||[]).forEach(function(l){
      const a=l.photos||[],at=a.indexOf(p);if(at>=0)a[at]=k;            /* 送っている間に消されていたら置き換えない */
    })});
    return r;
  });
}
function upEvent(e){
  if(haltIfBad(e.id,e,"保存する前の検査"))return Promise.resolve({ok:true});   /* 形のおかしい中身はシートに送らない（入力は画面に残す） */
  const id=e.id,j=JSON.stringify(e),b=base[id];
  return callRetry("saveEvent",{id:id,baseRev:b?b.rev:0,data:JSON.parse(j)}).then(function(r){
    if(r.ok){sent[id]=base[id]={rev:r.rev,json:j};tries[id]=0;return r}
    if(r.err!=="conflict")return r;
    tries[id]=(tries[id]||0)+1;
    if(tries[id]>3){stuck[id]=nameOf(e);return {ok:true}}               /* 3回混ぜてもぶつかった【R4】 */
    return fetchAbsorb();
  });
}
function delEvent(id){
  return callRetry("deleteEvent",{id:id,baseRev:base[id].rev}).then(function(r){
    if(r.ok){delete sent[id];delete base[id];return r}
    if(r.err!=="conflict")return r;
    return fetchAbsorb();                                               /* 相手が直していた → 消すのをやめる */
  });
}
function work(){
  if(busy||stopped)return;
  const job=nextJob();
  if(!job){tell.apply(null,restState());return}
  busy=true;tell("saving");
  job().then(function(r){
    busy=false;
    if(r&&!r.ok){
      if(r.err==="pass"||r.err==="locked"||r.err==="nopass"){stopped="pass";tell("pass","合言葉が通らなくなりました。開き直して、合言葉を入れ直してください。いまの入力は保存されていません。");return}
      if(r.err==="big"){stopped="big";tell("big","行事のデータが大きすぎて保存できません。園長に知らせてください。");return}
      stopped="net";tell("net","保存できませんでした（"+(r.err||"不明")+"）。");return;
    }
    work();
  }).catch(function(){busy=false;stopped="net";tell("net","保存できていません。通信を確かめて「もう一度送る」を押してください。")});
}
const names=o=>Object.keys(o).map(k=>"「"+(typeof o[k]==="string"?o[k]:o[k].name)+"」").join("");
/* 送るものがないときの帯（問題が残っていれば、それを出す） */
function restState(){
  if(Object.keys(stuck).length)return ["stuck",names(stuck)+"は、ほかの人の保存と何度もぶつかり、保存できていません。入力はこの画面に残っています。「もう一度送る」を押してください。"];
  if(Object.keys(missing).length)return ["missing",names(missing)+"は、シートに見当たりません（ほかの人が消したか、シートの行が壊れた可能性）。「この画面からも消す」か「新しい行事として保存し直す」を選んでください。"];
  if(Object.keys(halted).length)return ["halted",names(halted)+"は、データの形がおかしいところがあるため、自動で混ぜる・保存するのを止めています。入力はこの画面に残っています。園長に知らせてください。"];
  if(hikaeLost)return ["hikae-lost","ぶつかった入力の控えを、この端末に残せませんでした。閉じると消えます。"];
  if(Object.keys(broken).length)return ["badrow","シートに読めない行事があります（"+Object.keys(broken).length+"件）。園長に知らせてください。"];
  return ["saved",""];
}
function kick(){clearTimeout(timer);timer=0;work()}

const Sheet={
  mode:"sheet",
  hasPass(){return !!ls.get(PKEY)},
  setPass(p){ls.set(PKEY,String(p||"").trim())},
  /* この端末から合言葉を消す（共用の端末で使ったあと） */
  forget(){ls.del(PKEY)},
  /* 読み込み。合言葉がない・違うときは {need:"pass", why:"…"} で失敗する。
     読めない行事は黙って捨てず、帯で知らせる（その行事は、ほかの人が消したとは見なさない）【R6】 */
  load(){
    booted=(ls.get(PKEY)?fetchLatest():Promise.reject({need:"pass",why:""})).then(function(r){
      if(!r.ok){
        if(r.err==="pass"){ls.del(PKEY);throw {need:"pass",why:"合言葉が違います。"}}
        if(r.err==="locked")throw {need:"pass",why:"合言葉の間違いが続いたため、10分ほど受け付けません。時間をおいてください。"};
        if(r.err==="nopass")throw {need:"pass",why:"まだ合言葉が設定されていません（園長がシートの「設定」に入れます）。"};
        throw new Error(r.err);
      }
      const evs=[];
      Object.keys(r.byId).forEach(function(id){
        const t=r.byId[id],d=prep(t.data,"load");
        if(badShape(d)){broken[id]=true;return}                         /* 形がおかしい行事は画面に入れず、読めない行事として知らせる【R6】【R12】 */
        sent[id]={rev:t.rev,json:t.json};base[id]={rev:t.rev,json:JSON.stringify(d)};evs.push(d);
      });
      Object.keys(r.bad).forEach(function(id){broken[id]=true});
      if(Object.keys(broken).length||Object.keys(halted).length)setTimeout(function(){tell.apply(null,restState())},0);
      /* 画面は、この events の一覧をそのまま使う（index.html の S.events）。save() の前に取り寄せても混ぜられるように覚えておく */
      state={ver:2,events:evs,currentId:ls.get(CKEY)||""};
      /* 番号をつけた行事は、すぐ保存する（消えない番号にする【S5】） */
      if(evs.some(e=>!blocked(e.id)&&unsent(e))){clearTimeout(timer);timer=setTimeout(function(){timer=0;work()},700)}
      return state;
    });
    return booted;
  },
  save(s){
    state=s;ls.set(CKEY,s.currentId||"");
    clearTimeout(timer);timer=setTimeout(function(){timer=0;work()},700);
    return "ok";
  },
  /* 画面に戻ったとき・「最新にする」：最新を取り寄せて混ぜる。重なったら1回にまとめる */
  refresh(){if(!state)return;wantFetch=true;if(stopped==="net")stopped="";kick()},
  /* 「もう一度送る」：通信の失敗・何度もぶつかった行事を、もう一度送る */
  retry(){
    Object.keys(stuck).forEach(function(id){delete stuck[id];tries[id]=0});
    if(stopped==="net"||stopped==="big")stopped="";                  /* 大きすぎて止まった場合も、減らしたあとに送り直せる */
    /* 形がおかしくて止めた行事は、いまの形を調べ直す。直っていれば止めを解く（まだおかしければ、保存する前の検査でまた止まる） */
    if(state)(state.events||[]).forEach(function(e){if(e&&halted[e.id]&&halted[e.id].shape&&!badShape(e))delete halted[e.id]});
    if(state)wantFetch=true;
    kick();
  },
  /* まだ送っていないもの・解決していないものがあるか（ページを閉じる前の確認用） */
  pending(){
    if(busy||!!timer||hikae.length||hikaeLost)return true;
    if(!state)return false;
    return !!nextJob()||(state.events||[]).some(e=>blocked(e.id)&&unsent(e))||Object.keys(stuck).length>0||Object.keys(missing).length>0;
  },
  clear(){},
  docs(){return (booted||Promise.resolve()).then(()=>cache.docs,()=>null)},
  owners(){return (booted||Promise.resolve()).then(()=>cache.owners,()=>[])},

  /* ===== シートから消えた行事【S4】 ===== */
  missing(){return Object.keys(missing).map(id=>({id:id,name:missing[id]}))},
  /* 「この画面からも消す」 */
  dropMissing(id){
    if(!missing[id]||!state)return false;
    const i=state.events.findIndex(e=>e.id===id);if(i>=0)state.events.splice(i,1);
    delete missing[id];delete base[id];delete sent[id];delete tries[id];
    syncHikae();removeHikae(h=>h.eventId===id);saveHikae();
    kick();return true;
  },
  /* 「新しい行事として保存し直す」：新しい行事番号をつけて版0で保存する【R5】【S1】。答えは新しい番号 */
  saveAsNew(id){
    if(!missing[id]||!state||!Store.newId)return "";
    const e=state.events.find(x=>x.id===id);if(!e)return "";
    const nid=Store.newId();
    e.id=nid;
    delete missing[id];delete base[id];delete sent[id];delete tries[id];
    hikae.forEach(h=>{if(h.eventId===id)h.eventId=nid});saveHikae();
    if(state.currentId===id)state.currentId=nid;
    kick();return nid;
  },

  /* ===== 控え【R7】 ===== */
  hikae(){syncHikae();return clone(hikae)},
  /* 「自分の方にする」【S9】：欄のいまの値が、控えを作ったときの相手の値と同じなら、自分の値を入れる。
     答え：{ok:true}／{ask:true, now:いまの値, mine:自分の値}（その後さらに誰かが直した。force で入れる）／{gone:true}（行が消えた） */
  keepMine(key,force){
    syncHikae();const h=hikae.find(x=>x.key===key);if(!h||!state)return {gone:true};
    const e=state.events.find(x=>x.id===h.eventId);if(!e)return {gone:true};
    const cur=walk(e,h.at,false);if(cur.gone)return {gone:true};
    if(!force&&!sameV(cur.value,h.theirs))return {ask:true,now:clone(cur.value===undefined?null:cur.value),mine:clone(h.mine)};
    walk(e,h.at,true,clone(h.mine));
    removeHikae(x=>x.key===key);saveHikae();
    Sheet.save(state);
    return {ok:true};
  },
  /* 「捨てる」 */
  dropHikae(key){syncHikae();removeHikae(x=>x.key===key);saveHikae();if(state&&!busy&&!timer)tell.apply(null,restState());return true},

  /* 写真の表示元。"drv:…" はドライブから取り寄せ、届いたら Store.onPhoto(キー, 画像) で知らせる */
  photoSrc(p){
    if(typeof p!=="string"||p.indexOf("drv:")!==0)return p;
    if(photoCache[p])return photoCache[p];
    if(!photoWait[p]&&!photoGone[p]){
      photoWait[p]=callRetry("getPhoto",{id:p.slice(4)}).then(function(r){
        if(r.ok){photoCache[p]=r.data;try{if(Store.onPhoto)Store.onPhoto(p,r.data)}catch(e){}}else photoGone[p]=1;
      }).catch(function(){}).then(function(){delete photoWait[p]});
    }
    return "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  }
};

window.Store=API?Sheet:Local;
if(API)window.addEventListener("beforeunload",function(e){if(Sheet.pending()){e.preventDefault();e.returnValue=""}});
})();
