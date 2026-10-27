/* 行事管理APP｜データの出し入れはこのファイルだけ
   いま：このブラウザに保存する（localStorage）。Googleシートにつなぐまでの仮の保存
   v2（B②）：Googleシート（Apps Script・合言葉で確認）に切り替える。切り替えるのはこのファイルだけ
   Vercelへ移すときも、このファイルを差し替える
   ※このファイルは公開される。合言葉・職員名・資料の本文・行事のデータは書かない */
(function(){
"use strict";
const KEY="gyoji-v2-local";
window.Store={
  /* "local"＝このブラウザに保存。シート版は "sheet" にする（「全部消す」ボタンは local のときだけ出る） */
  mode:"local",
  /* 全データを読む。形は {ver:2, events:[…], currentId:"…"}。まだ何もなければ null */
  load(){
    try{const t=localStorage.getItem(KEY);return Promise.resolve(t?JSON.parse(t):null)}
    catch(e){return Promise.resolve(null)}
  },
  /* 全データを保存する。結果はすぐ返す："ok"／"full"（容量がいっぱい）／"off"（保存できない）
     シート版では送信を順番待ちに入れて "ok" を返し、届かなかったときは画面に知らせる作りにする */
  save(s){
    try{localStorage.setItem(KEY,JSON.stringify(s));return "ok"}
    catch(e){return (e&&(e.name==="QuotaExceededError"||e.code===22||e.code===1014))?"full":"off"}
  },
  /* このブラウザの保存を消す（local のときだけ使う） */
  clear(){try{localStorage.removeItem(KEY)}catch(e){}},
  /* 資料の本文。公開ファイルには置かないので、いまは null（画面は「まだ読み込まれていません」と出す）
     シート版の形：{must:"<h2 id=\"top\">…", check:"…", kangae:"…", guide:"…"}
     見出しの id（g1〜g5・g_check・k_start・k_proc・k_after）は「迷ったら」のリンク先なので、同じ id を付ける */
  docs(){return Promise.resolve(null)},
  /* 職員の呼び名リスト（「誰が」の入力候補）。シート版では「設定」から読む。いまは空 */
  owners(){return Promise.resolve([])}
};
})();
