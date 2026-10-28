/* 行事管理APP｜データの出し入れはこのファイルだけ
   API（Apps Script ウェブアプリのURL）が空のとき：このブラウザに保存する（localStorage）。仮の保存
   API が入っているとき：Googleシート（Apps Script・合言葉で確認）に保存する
   Vercelへ移すときも、このファイルを差し替える
   ※このファイルは公開される。合言葉・職員名・資料の本文・行事のデータは書かない（URLは書いてよい。合言葉がないと読めない） */
(function(){
"use strict";
const API="https://script.google.com/macros/s/AKfycbwmvYzATMo3-81ZO9HgsLftQyNP1i1RqgeREg5j675SCzvQYx6weG-HDQuEEiZCiMgPTg/exec";  /* Apps Script ウェブアプリのURL（2026-10-27 園長の初回作業で公開）。空にするとブラウザ保存に戻る */
const KEY="gyoji-v2-local",PKEY="gyoji-v2-pass",CKEY="gyoji-v2-current";
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};

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
  photoSrc(p){return p}
};

/* ===== Googleシートに保存する版 =====
   - 保存は行事1件ずつ。変わった行事だけを、少し待ってから順番に送る（save() はすぐ "ok" を返す）
   - 行事ごとに「版」を持つ。ほかの人が先に同じ行事を保存していたら、その行事はそれ以上送らず、画面に知らせる
   - 写真は先にGoogleドライブへ送り、行事のデータの中では "drv:写真のID" に置き換える
   - 届かなかったら3回まで送り直し、それでもだめなら画面に知らせる（「もう一度送る」で再開）
   画面への知らせ：Store.onStatus(状態, 説明)。状態は "saving"／"saved"／"conflict"／"net"／"pass"／"big" */
const sent={};      /* 行事ID → {rev, json}：シートにある（と分かっている）版と中身 */
const conflicted={};/* 先に保存されていた行事ID → 行事名 */
const photoCache={},photoWait={},photoGone={};
let state=null,timer=0,busy=false,stopped="",cache={owners:[],docs:null},booted=null;

function call(op,body){
  return fetch(API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},redirect:"follow",
    body:JSON.stringify(Object.assign({op:op,pass:ls.get(PKEY)||""},body||{}))})
    .then(function(r){if(!r.ok)throw new Error("http "+r.status);return r.json()});
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

/* いま送るべきものを1つ選ぶ（写真 → 変わった行事 → 消えた行事 の順） */
function nextJob(){
  if(!state)return null;
  const evs=state.events||[];
  for(const e of evs){
    if(conflicted[e.id])continue;
    for(const l of (e.logs||[]).concat(e.snaps||[]))for(let j=0;j<(l.photos||[]).length;j++){  /* 写真で残す（snaps）と、前に伝達ログへ入れた写真 */
      const p=l.photos[j];
      if(typeof p==="string"&&p.indexOf("data:")===0)return function(){return upPhoto(e,l,j,p)};
    }
  }
  for(const e of evs){
    if(conflicted[e.id])continue;
    const j=JSON.stringify(e),s=sent[e.id];
    if(!s||s.json!==j)return function(){return upEvent(e,j)};
  }
  const ids=new Set(evs.map(e=>e.id));
  for(const id in sent)if(!ids.has(id)&&!conflicted[id])return function(){return delEvent(id)};
  return null;
}
function upPhoto(e,l,j,p){
  return callRetry("putPhoto",{fy:fyOf(e.date),eventId:e.id,data:p}).then(function(r){
    if(!r.ok)return r;
    const k="drv:"+r.id;photoCache[k]=p;
    const at=l.photos.indexOf(p);if(at>=0)l.photos[at]=k;  /* 送っている間に消されていたら置き換えない */
    return r;
  });
}
function upEvent(e,j){
  const s=sent[e.id];
  return callRetry("saveEvent",{id:e.id,baseRev:s?s.rev:0,data:JSON.parse(j)}).then(function(r){
    if(r.ok)sent[e.id]={rev:r.rev,json:j};
    else if(r.err==="conflict")conflicted[e.id]=e.name||"この行事";
    return r;
  });
}
function delEvent(id){
  return callRetry("deleteEvent",{id:id,baseRev:sent[id].rev}).then(function(r){
    if(r.ok)delete sent[id];
    else if(r.err==="conflict")conflicted[id]="消そうとした行事";
    return r;
  });
}
function work(){
  if(busy||stopped)return;
  const job=nextJob();
  if(!job){tell(Object.keys(conflicted).length?"conflict":"saved",conflictMsg());return}
  busy=true;tell("saving");
  job().then(function(r){
    busy=false;
    if(r&&!r.ok){
      if(r.err==="pass"||r.err==="locked"||r.err==="nopass"){stopped="pass";tell("pass","合言葉が通らなくなりました。開き直して、合言葉を入れ直してください。いまの入力は保存されていません。");return}
      if(r.err==="big"){stopped="big";tell("big","行事のデータが大きすぎて保存できません。園長に知らせてください。");return}
      if(r.err!=="conflict"){stopped="net";tell("net","保存できませんでした（"+(r.err||"不明")+"）。");return}
    }
    work();
  }).catch(function(){busy=false;stopped="net";tell("net","保存できていません。通信を確かめて「もう一度送る」を押してください。")});
}
function conflictMsg(){
  const n=Object.keys(conflicted).map(k=>"「"+conflicted[k]+"」").join("");
  return n?n+"は、ほかの人が先に保存していました。あなたがこの行事に入れた分は保存されていません。開き直して、最新の内容に入れ直してください。":"";
}

const Sheet={
  mode:"sheet",
  hasPass(){return !!ls.get(PKEY)},
  setPass(p){ls.set(PKEY,String(p||"").trim())},
  /* この端末から合言葉を消す（共用の端末で使ったあと） */
  forget(){ls.del(PKEY)},
  /* 読み込み。合言葉がない・違うときは {need:"pass", why:"…"} で失敗する */
  load(){
    booted=(ls.get(PKEY)?call("load",{}):Promise.reject({need:"pass",why:""})).then(function(r){
      if(!r.ok){
        if(r.err==="pass"){ls.del(PKEY);throw {need:"pass",why:"合言葉が違います。"}}
        if(r.err==="locked")throw {need:"pass",why:"合言葉の間違いが続いたため、10分ほど受け付けません。時間をおいてください。"};
        if(r.err==="nopass")throw {need:"pass",why:"まだ合言葉が設定されていません（園長がシートの「設定」に入れます）。"};
        throw new Error(r.err);
      }
      const evs=[];
      (r.events||[]).forEach(function(x){try{const e=JSON.parse(x.data);sent[x.id]={rev:x.rev,json:JSON.stringify(e)};evs.push(e)}catch(z){}});
      cache={owners:r.owners||[],docs:r.docs||null};
      return {ver:2,events:evs,currentId:ls.get(CKEY)||""};
    });
    return booted;
  },
  save(s){
    state=s;ls.set(CKEY,s.currentId||"");
    clearTimeout(timer);timer=setTimeout(function(){timer=0;work()},700);
    return "ok";
  },
  /* 「もう一度送る」 */
  retry(){if(stopped==="net"){stopped="";work()}},
  /* まだ送っていないものがあるか（ページを閉じる前の確認用） */
  pending(){return busy||!!timer||!!nextJob()},
  clear(){},
  docs(){return (booted||Promise.resolve()).then(()=>cache.docs,()=>null)},
  owners(){return (booted||Promise.resolve()).then(()=>cache.owners,()=>[])},
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
