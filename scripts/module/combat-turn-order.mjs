/**
 * @fileoverview カット進行の手番順を決める純ロジック(Foundry 非依存・テスト対象。フェーズ13-2)。
 * 正本: Combat_Flow.md §3(セットアップ末の優先順位)・§4(イニシアチブプロセス)。
 *
 * 手番順は CSカレントの高い順。CSカレントが等しい場合の優先順位は Combat_Flow §3:
 *   ① CSベースが高い順
 *   ② ゲスト→キャスト→トループの順
 *   ③ キャスト同士の話し合い(自動化できないため本ロジックでは扱わない)
 *   ④ RL の左隣から右回り(FVTT ではユーザー順で代替)
 * ③は卓の判断に委ね、②④＋最終タイブレーク(id)で決定的に並べる。並び順の手動入れ替えは
 * トラッカー UI 側(13-4)で行える前提。
 *
 * **エキストラは手番を持たない**(2026-07-21 ユーザー裁定): エキストラは行動できず、戦闘に
 * 巻き込まれ攻撃されればその場で死ぬだけの存在(護衛 HO で護りきる対象になりうるが手番はない)。
 * よって手番順・次の手番の判定からは種別で除外する(トラッカーには対象として残りうるが行動しない)。
 *
 * 参加者は Foundry 非依存の素データ:
 *   { id, csCurrent, csBase, actorType, userOrder, ar }
 * (Combatant 側でこの形へ写像する。csCurrent=表示中の CS 実効値=displayTotal)。
 */

/** 種別の優先順位(小さいほど先に手番)。ゲスト→キャスト→トループ(Combat_Flow §3②)。 */
export const TURN_TYPE_ORDER = { guest: 0, cast: 1, troop: 2 };

/** 手番を持てる種別か(エキストラは行動できないので false・2026-07-21 裁定)。 */
export function isActable(participant) {
  return participant?.actorType !== "extra";
}

/** 種別の順位(未知種別は最下位扱い)。 */
function typeRank(actorType) {
  const rank = TURN_TYPE_ORDER[actorType];
  return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
}

/**
 * 手番順の比較関数。負ならば a が先(先に手番を行う)。
 * CSカレント降順 → CSベース降順 → 種別順 → ユーザー順 → id 昇順。
 */
function compareTurnOrder(a, b) {
  return (
    (b.csCurrent ?? 0) - (a.csCurrent ?? 0) ||
    (b.csBase ?? 0) - (a.csBase ?? 0) ||
    typeRank(a.actorType) - typeRank(b.actorType) ||
    (a.userOrder ?? 0) - (b.userOrder ?? 0) ||
    String(a.id).localeCompare(String(b.id))
  );
}

/**
 * 参加者を手番順に並べた新しい配列を返す(先頭＝先に手番)。入力は破壊しない。
 * 手番を持てない種別(エキストラ)は除外する。
 * @param {Array<{id:string, csCurrent?:number, csBase?:number, actorType?:string, userOrder?:number, ar?:number}>} participants
 * @returns {Array} 手番順に並んだ参加者(エキストラを除く)
 */
export function resolveTurnOrder(participants) {
  return participants.filter(isActable).sort(compareTurnOrder);
}

/**
 * 次にメインプロセスを行える1体を返す(CSカレント最大かつ AR≥1・Combat_Flow §4)。
 * 該当が無ければ null(全員 AR0 等＝メインプロセスを行える者がいない)。
 * 行動不能による AR−1 の確認は本ロジックでは扱わない(進行管理側=13-3)。
 * @param {Array} participants
 * @returns {object|null}
 */
export function nextActiveMain(participants) {
  return resolveTurnOrder(participants).find(p => (p.ar ?? 0) >= 1) ?? null;
}
