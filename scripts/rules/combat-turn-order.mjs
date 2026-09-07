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
 * トラッカーの表示ソート(`TnxCombat._sortCombatants`)にも使う。エキストラは typeRank の
 * フォールバック(最下位)で末尾に並ぶ(表示には残す。手番判定は resolveTurnOrder/isActable が除外)。
 */
export function compareTurnOrder(a, b) {
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
 * 行動できない者(cantAct=戦闘不能系タグ/脱落マーク)は候補にならない。
 * 該当が無ければ null(全員 AR0 等＝メインプロセスを行える者がいない)。
 * @param {Array} participants
 * @returns {object|null}
 */
export function nextActiveMain(participants) {
  return resolveTurnOrder(participants).find(p => (p.ar ?? 0) >= 1 && !p.cantAct) ?? null;
}

/**
 * イニシアチブプロセスの確認(Combat_Flow §4)。次のメイン行動者を決め、その確認の過程で
 * 「最も CSカレントが高い者が行えない場合、このタイミングで AR を −1」を適用する:
 * メインより上位に来た行動不能者(AR≥1)が各1回 AR−1 の対象になる(確認は次点へ進む)。
 * @param {Array} participants
 * @returns {{mainId: string|null, penalizedIds: string[]}}
 */
export function confirmMain(participants) {
  const penalizedIds = [];
  for (const p of resolveTurnOrder(participants)) {
    if ((p.ar ?? 0) < 1) continue;
    if (p.cantAct) { penalizedIds.push(p.id); continue; }
    return { mainId: p.id, penalizedIds };
  }
  return { mainId: null, penalizedIds };
}

// ─── サブターン内のスポット走査(フェーズ13-4・サブターンモデル) ─────────────────
// キャラクターにはプロセスごとに行動権がある(Combat_Flow「トラッカー上の表現」)。
// セットアップ/イニシアチブ/クリンナップの各サブターン内では、行動できるキャラを CS順に
// 「スポット」が巡り、「次へ」で次のキャラへ行動権を渡す。スポットはメインの資格(AR≥1)とは
// 別＝AR 0 でもプロセスの行動権はある。ただし**行動できない者(cantAct=戦闘不能タグ/脱落マーク)は
// 走査から除外**する(脱落扱い・2026-07-22 実機指摘)。走査を終えたら null(＝フェーズ送り)。

/** カット進行のフェーズ(cutPhase) → 用途タイミングのプロセス名(timing.processName)。 */
export const PHASE_TIMING_KEY = { setup: "setup", initiative: "initiative", cleanup: "clean-up" };

/**
 * 用途のタイミングが「メジャーアクション」か(2026-07-26 全面改訂の一般則。Combat_Flow「AR・メジャー
 * アクション・プロセス所有の一般則」)。メジャーを行ったプロセス所有者は、そのプロセス終了時に
 * AR−1＋CSカレント0。判定実行フック(markMajorAction)がこの判定でメジャー行動者を記帳する。
 * 該当は次の二つ:
 *   ・timing.value==="action" かつ actionName==="major"(手番中のメジャーアクション)。
 *   ・timing.value==="initiativeMajor"(イニシアチブ（メジャー）＝FS支援判定など)。
 * ムーブ/マイナー/リアクション/オート・プロセス既定処理・常時・神業・ダメージ算出系は該当しない
 * (神業の割り込みは将来 consumesAr で個別宣言=2026-07-26 ユーザー方針)。
 * @param {{value?:string, actionName?:string}|null|undefined} timing 用途の timing
 * @returns {boolean}
 */
export function isMajorActionTiming(timing) {
  if (!timing) return false;
  if (timing.value === "initiativeMajor") return true;
  return timing.value === "action" && timing.actionName === "major";
}

/**
 * スポット走査の順(CS順・エキストラと行動不能を除外)。
 * eligibleIds を渡すと、その集合に含まれる参加者だけに絞る(＝そのプロセスに使える用途を持つ者のみ
 * 手番が回る・自動スキップ)。null/未指定なら絞り込みなし(従来どおり全員)。
 * @param {Array} participants
 * @param {Set<string>|null} [eligibleIds]
 */
function spotOrder(participants, eligibleIds = null) {
  let order = resolveTurnOrder(participants).filter(p => !p.cantAct);
  if (eligibleIds) order = order.filter(p => eligibleIds.has(p.id));
  return order;
}

/**
 * サブターン走査の先頭(CS順の1人目)。いなければ null。
 * @param {Array} participants
 * @param {Set<string>|null} [eligibleIds] そのプロセスに手番が回る参加者(絞り込み)
 * @returns {string|null}
 */
export function firstSpotId(participants, eligibleIds = null) {
  return spotOrder(participants, eligibleIds)[0]?.id ?? null;
}

/**
 * サブターン走査の次のスポット。現スポットが末尾なら null(＝フェーズ送り)。
 * 現スポットが不明・不在(途中離脱・走査中の戦闘不能化等)なら先頭へ戻して頑健にする。
 * @param {Array} participants
 * @param {string|null} spotId 現スポットの combatant id
 * @param {Set<string>|null} [eligibleIds] そのプロセスに手番が回る参加者(絞り込み)
 * @returns {string|null}
 */
export function nextSpotId(participants, spotId, eligibleIds = null) {
  const order = spotOrder(participants, eligibleIds);
  const i = order.findIndex(p => p.id === spotId);
  if (i < 0) return order[0]?.id ?? null;
  return order[i + 1]?.id ?? null;
}
