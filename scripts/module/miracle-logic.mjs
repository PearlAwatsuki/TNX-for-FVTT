/**
 * @fileoverview 神業の純ロジック(フェーズ17-1・Foundry 非依存)。
 * 正本: Miracle_Rules.md「神業の位置づけ」「神業の構造」・Phase_17_Tasks_Detail「設計の中心 — 神業由来の印」。
 *
 * 神業はゴールデンルール「RL の絶対権限」のひとつ下に位置する強制力の強いルールであり、
 * 挙動は既存の用途の器で表現するが、その用途が神業のものであるという**印**を結果へ運ぶ。
 * 本モジュールは印の出どころ・残回数ゲート・使用時の消費・カードの描画データといった
 * 計算だけを担い、ドキュメントの更新や投稿(Foundry 依存)は呼び出し側が行う。
 */

import { usesMaxTotalOf } from "../data/item/uses.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 残回数ゲート。残り ＝ 実効最大値(AE 込み・usesMaxTotalOf) − 消費済み。
 * @param {object|null|undefined} system 神業アイテムの system
 * @returns {{ok: boolean, remaining: number, max: number}}
 */
export function miracleUseGate(system) {
    const max = usesMaxTotalOf(system);
    const spent = Number(system?.uses?.spent) || 0;
    const remaining = Math.max(0, max - spent);
    return { ok: remaining > 0, remaining, max };
}

/**
 * 使用による消費の更新オブジェクト。消費済みを 1 増やし(実効最大値で頭打ち)、この消費で
 * 尽きるなら isUsed を true にする(手動リセットの起点として残す・旧経路と同じ)。
 * @param {object} system 神業アイテムの system
 * @returns {Record<string, number|boolean>} item.update 用の更新データ
 */
export function miracleConsumeUpdate(system) {
    const { max } = miracleUseGate(system);
    const spent = Math.min(max, (Number(system?.uses?.spent) || 0) + 1);
    const update = { "system.uses.spent": spent };
    if (spent >= max) update["system.isUsed"] = true;
    return update;
}

/**
 * 消費先が空の神業用途に「このアイテム自身の使用回数 ×1」を既定消費として補う(実行時のみ・保存しない)。
 * 「消費は消費先の設定からのみ」の一般原則はコンボ参加技能の遠隔消費を廃した文脈のもので、
 * 使用＝回数消費が定義に含まれる神業には当たらない(用途を作った途端に回数が減らなくなるのは
 * 「用途を前提条件にしない」設計判断0と食い違う)。
 * @param {object} usage 用途エントリ
 * @returns {object} 既定行を補った複製。設定済みなら引数そのもの
 */
export function withDefaultMiracleConsumption(usage) {
    if (Array.isArray(usage?.consumeTargets) && usage.consumeTargets.length > 0) return usage;
    return { ...usage, consumeTargets: [{ type: "item", itemId: "", resource: "uses", amount: 1 }] };
}

// ─── 他の神業への干渉(17-4・《ファイト！》《プリーズ！》) ────────────────────────────
// 効果文「他のキャラクターの持つ神業の使用回数を、1回増やす。…すでに使用されているものでも…
// アクトが終了した後に持ち越すことはできない」「《ファイト！》を《ファイト！》することはできない」／
// 「他人…に、神業を使わせることができる。…相手の神業は使用済みにならない」(使い切ったものも可)

/**
 * 消費先を空にした用途の複製(《プリーズ！》で使わされる神業: 使用済みにならない)。
 * 既定消費(withDefaultMiracleConsumption)の対になる変換で、以降の全分岐が消費行ゼロで動く。
 * @param {object} usage 用途エントリ
 * @returns {object} 複製(元の用途は変えない)
 */
export function withoutConsumption(usage) {
    return { ...usage, consumeTargets: [] };
}

/**
 * 対象の所持アイテムから干渉できる神業を列挙する(id と名前)。使い切った神業も候補に入る。
 * addUse は使用中の神業と同名のものを除く(《ファイト！》を《ファイト！》できない)。
 * @param {Iterable<{id:string,type:string,name:string}>} items 対象の所持アイテム
 * @param {{mode: "addUse"|"requestUse", byName?: string}} opts
 * @returns {Array<{id:string,name:string}>}
 */
export function interferenceCandidates(items, { mode, byName = "" } = {}) {
    const out = [];
    for (const i of (items ?? [])) {
        if (i?.type !== "miracle") continue;
        if (mode === "addUse" && byName && i.name === byName) continue;
        out.push({ id: i.id, name: i.name });
    }
    return out;
}

/**
 * 《ファイト！》が対象の神業に載せる効果の素(付与コピーの印は呼び出し側が
 * buildGrantedEffectDataFrom で刻む)。uses.max +1 は実効値 uses.maxTotal に着地し、残回数ゲートも
 * それを読む。持続はアクト中(境界で付与コピーとして失効)・神業由来・重ねがけ可(2人が同じ神業に
 * 使えば +2。同名効果の重複排除で 2 つ目が消えないように)。
 * @param {{name: string, img?: string}} by 使用した神業
 * @returns {object} ActiveEffect の生成データの素
 */
export function addUseEffectSource({ name, img = "" }) {
    return {
        name, img,
        changes: [{ key: "system.uses.max", mode: 2 /* CONST.ACTIVE_EFFECT_MODES.ADD */, value: "1" }],
        flags: { [SCOPE]: { tnxDuration: "act", fromMiracle: true, stackable: true } },
    };
}

/**
 * 神業由来の印の出どころ: 用途の親アイテムが miracle 型であること(専用フィールドは持たない)。
 * 他の神業として使ったとき(17-5)は、その神業(uuid と名前)を印に添える——カードの「効果」行と
 * 使用ログ(《突然変異》がコピーするのは解決後の神業)のため。source(ドキュメント)は載せない。
 * @param {{id?: string, type?: string, name?: string, uuid?: string}|null|undefined} item
 * @param {?{uuid: string, name: string}} [asOther] 他の神業として使うときの参照先
 * @returns {?{itemId: string, name: string, uuid: string, asOther?: {uuid: string, name: string}}} 神業でなければ null
 */
export function miracleOriginOf(item, asOther = null) {
    if (item?.type !== "miracle") return null;
    return {
        itemId: item.id, name: item.name, uuid: item.uuid ?? "",
        ...(asOther?.uuid ? { asOther: { uuid: asOther.uuid, name: asOther.name ?? "" } } : {}),
    };
}

/**
 * カードのフラグ(またはそれに相当するオブジェクト)が神業由来の印を持つか。
 * 読み手はすべて本関数を通す(効き先＝軽減・リアクション・治療・打ち消しの各ゲートは 17-2/17-3)。
 * @param {object|null|undefined} flags システムスコープのフラグ
 * @returns {boolean}
 */
export function isMiracleOrigin(flags) {
    return !!flags?.miracle?.itemId;
}

/**
 * ダメージカードで、まだ防がれていない対象行の添字。表示(行が消える)と適用(残った対象だけ)の
 * 両方がこれを読む(防御タイプ「適用前に防ぐ」・17-2)。
 * @param {{targets?: Array<{protectedBy?: object}>}} f ダメージカードのフラグ
 * @returns {number[]}
 */
export function unprotectedTargetIndices(f) {
    return (f?.targets ?? []).map((t, i) => (t?.protectedBy ? -1 : i)).filter(i => i >= 0);
}

/**
 * 「適用前に防ぐ」の計画(防御タイプ・17-2)。効果文: 《難攻不落》「社会ダメージを除く、ダメージをひとつ
 * 打ち消す。このダメージは1回の判定、もしくは1発の神業によって発生したものすべて」「ダメージを受けて
 * しまった後から治療することはできない」／《守護神》《友情》「選択したひとりのキャラクター以外に…
 * 被害をこうむるキャラクターがいる場合、そのキャラクターを助けることはできない」。
 * @param {{category?: string, applied?: boolean, targets?: Array}} f ダメージカードのフラグ
 * @param {{defenceScope?: "all"|"one", defenceCategories?: string[]}} usage 防御タイプの用途
 * @param {{rowIndex: number, by: {itemId: string, name: string, actorId: string}}} opts
 *   rowIndex=クリックした対象行(1人のときに使う)・by=防いだ神業(印)
 * @returns {{ok: true, indices: number[], by: object} | {ok: false, reason: "applied"|"category"|"noTargets"|"alreadyProtected"}}
 */
export function defencePreventPlan(f, usage, { rowIndex, by }) {
    if (f?.applied) return { ok: false, reason: "applied" };
    const cats = Array.isArray(usage?.defenceCategories) && usage.defenceCategories.length
        ? usage.defenceCategories : ["physical", "mental", "social"];
    if (!cats.includes(f?.category || "physical")) return { ok: false, reason: "category" };
    if (!(f?.targets ?? []).length) return { ok: false, reason: "noTargets" };
    const open = unprotectedTargetIndices(f);
    const indices = usage?.defenceScope === "one" ? open.filter(i => i === rowIndex) : open;
    if (!indices.length) return { ok: false, reason: "alreadyProtected" };
    return { ok: true, indices, by };
}

/**
 * 判定の完了継続のうち、成功時に効果が**即座に適用される**種類(打ち消しの「適用前」から外れる)。
 * 回復の除去・修理・改造・購入の付与・登場・情報開示・制御打消は結果カードの投稿と同時に適用され、
 * リアクション/カバー/NPC取得も解決が即座に攻撃カードや場へ反映される。移動は段階の表示のみ(適用は手動)。
 */
const IMMEDIATELY_APPLIED_CONTINUATIONS = Object.freeze([
    "recovery", "repair", "modification", "purchase", "appearance", "infoGathering", "controlNegate",
    "reaction", "covering", "npcAcquire",
]);

/**
 * 打ち消し(判定を失敗させる)の可否(防御タイプ・17-2)。効果文《チャイ》「既に効果が適用された神業や
 * 判定に対して、時間をさかのぼって打ち消すことはできない」。
 * @param {{recheck?: object, damageCards?: Array<{applied?: boolean}>}} arg
 *   recheck=結果カードの再判定スナップショット(継続の種類を持つ)・damageCards=その攻撃から出たダメージカード
 * @returns {{ok: true} | {ok: false, reason: "applied"}}
 */
export function negateCheckGate({ recheck = {}, damageCards = [] } = {}) {
    if (IMMEDIATELY_APPLIED_CONTINUATIONS.some(k => recheck?.[k])) return { ok: false, reason: "applied" };
    if ((damageCards ?? []).some(d => d?.applied)) return { ok: false, reason: "applied" };
    return { ok: true };
}

/**
 * 打ち消しを事後修正(checkMods)の器に積む: 修正 0 の「打ち消し（神業名）」行を足し、成否を失敗・
 * 差分値なしに固定する(達成値は変えない)。表示は既存の「修正後の成否」行に乗る。
 * @param {?{rows?: Array, achievement?: number}} mods 既存の checkMods(無ければ null)
 * @param {{achievement: number, targetValue?: ?number, by: {itemId: string, name: string, actorId: string}}} opts
 * @returns {{rows: Array, achievement: number, success: false, diff: null, targetValue?: number}}
 */
export function negatedCheckMods(mods, { achievement, targetValue = null, by }) {
    const rows = [...(mods?.rows ?? []), { label: `打ち消し（${by?.name ?? "神業"}）`, value: 0, negatedBy: by }];
    const out = { rows, achievement: Number(achievement) || 0, success: false, diff: null };
    if (targetValue !== null && targetValue !== undefined) out.targetValue = targetValue;
    return out;
}

/**
 * 回避(防御タイプ・17-2・《脱出》)の計画。効果文「1回の判定や1発の神業によるあなた、もしくはあなたの
 * 操縦するヴィークルへの物理攻撃をかわす（その場合、位置は変わらない）」。回避は命中の段階の動作
 * (ダメージが決まった後は防御の領分)。ヴィークルへの攻撃は操縦者を対象にするため「自分の行」に含まれる。
 * @param {{category?: string, damageRolled?: boolean, targets?: Array}} f 攻撃カードのフラグ
 * @param {{rowIndex: number, actorId: string, by: object, resolveActorId: (uuid: string) => ?string}} opts
 *   rowIndex=クリックした対象行・actorId=回避する神業の使用者・resolveActorId=対象 uuid→アクター id
 * @returns {{ok: true, index: number, by: object} | {ok: false, reason: "noTarget"|"category"|"damageRolled"|"notSelf"|"alreadyMiss"}}
 */
export function evadePlan(f, { rowIndex, actorId, by, resolveActorId }) {
    const t = (f?.targets ?? [])[rowIndex];
    if (!t) return { ok: false, reason: "noTarget" };
    if ((f?.category || "physical") !== "physical") return { ok: false, reason: "category" };
    if (f?.damageRolled) return { ok: false, reason: "damageRolled" };
    if ((resolveActorId?.(t.uuid) ?? null) !== actorId) return { ok: false, reason: "notSelf" };
    if (t.state === "miss") return { ok: false, reason: "alreadyMiss" };
    return { ok: true, index: rowIndex, by };
}

// ─── 即死・社会戦(17-3)＝神業版のダメージカード ─────────────────────────────────
// 効果文《死の舞踏》「［完全死亡］させる…代わりに任意の肉体戦ダメージを与えても良い」《神の御言葉》「［精神崩壊］
// …代わりに任意の精神戦ダメージ」《制裁》「任意の社会戦ダメージ…抹殺でもよい。トループならば全滅させてもよい」。
// 「神業以外の効果で防がれることも治癒されることもない」＝軽減を一切通さず、付与した状態に神業由来の印を刻む。

/** 系統→終端状態のキー(肉体=完全死亡・精神=精神崩壊・社会=抹殺)。 */
export function terminalKindFor(category) {
    return { physical: "dead", mental: "mind-break", social: "erased" }[category] ?? "dead";
}

const TERMINAL_LABELS = Object.freeze({ dead: "完全死亡", "mind-break": "精神崩壊", erased: "抹殺" });

/**
 * 神業版のダメージカードのフラグ(damageRoll)。既存のダメージカードの器に神業の印と結果を載せ、
 * カード・攻撃力・修正の段は持たない(軽減を通さない)。対象行・防ぐ・打ち消し・適用は既存のまま。
 * @param {{by: object, category: string, targets: Array<{uuid: string, name: string}>, result: object}} arg
 * @returns {object}
 */
export function buildMiracleDamageFlag({ by, category, targets, result }) {
    return {
        miracle: by,
        miracleResult: result,
        category,
        damageType: "",
        targets: (targets ?? []).map(t => ({ uuid: t.uuid, name: t.name, parryGuard: 0, reactionEstablished: false })),
        cards: [],
        attackPower: 0,
        damageBonuses: [],
        mods: [],
        applied: false,
    };
}

/** 結果の表示(終端状態は系統の終端の名前・任意ダメージは値)。 */
export function miracleResultLabel(result, category) {
    if (result?.kind === "terminal") return TERMINAL_LABELS[terminalKindFor(category)];
    return `ダメージ ${Number(result?.value) || 0}`;
}

/**
 * 対象の型ごとに、神業版ダメージの適用で何が起こるか。
 * キャスト/ゲスト: 終端状態はその状態を直接付与・任意ダメージはチャートの値をそのまま(軽減なし)。
 * トループ: 終端状態は壊滅(人数 0・トループ壊滅は即死に含める=ユーザー裁定 2026-09-04)・任意ダメージは人数から引く。
 * エキストラ: ダメージの概念が無い(宣言死)。
 * @param {{kind: "terminal"|"chart", value?: number}} result
 * @param {string} targetType アクターの type
 * @param {string} category 系統
 * @returns {{op: "terminal", kind: string} | {op: "chart", value: number} | {op: "annihilate"} | {op: "heads", value: number} | {op: "none"}}
 */
export function miracleTargetOutcome(result, targetType, category) {
    if (targetType === "extra") return { op: "none" };
    const terminal = result?.kind === "terminal";
    const value = Math.max(0, Number(result?.value) || 0);
    if (targetType === "troop") return terminal ? { op: "annihilate" } : { op: "heads", value };
    return terminal ? { op: "terminal", kind: terminalKindFor(category) } : { op: "chart", value };
}

/**
 * 「受けたシーン」の同一性。状態は受けた時点のアクト id と上演中のシーン番号(sessionState.sceneNumber)を
 * 持つ(preCreateActiveEffect で刻む)。どちらかが不明なら比較できない=同じ扱い(検査できないものはゲートしない)。
 * @param {?{act?: string, number?: number}} received
 * @param {?{act?: string, number?: number}} current
 * @returns {boolean}
 */
export function isSameReceivedScene(received, current) {
    if (!received || !current) return true;
    const missing = (v) => v === null || v === undefined;
    if (missing(received.act) || missing(current.act) || missing(received.number) || missing(current.number)) return true;
    return received.act === current.act && Number(received.number) === Number(current.number);
}

/**
 * 神業の治癒(防御タイプ「受けた後に消す」・17-2)で、その効果を回復対象の候補に載せてよいか(純関数)。
 * 回復範囲(recoveryTargets)/除外(recoveryExcludes)の照合は既存の回復フロー側で行い、ここは神業の治癒で
 * 足した3つを判定する:
 *  - 印のゲートの受け側: 神業由来(fromMiracle)の状態・効果は神業の治療でしか除去できない。
 *  - 受けたシーンの制限(recoverySceneLimit): terminal=完全死亡・精神崩壊だけそのシーンで受けたもの／
 *    all=すべてそのシーンで受けたもの(《腹心》《人命救助》《黄泉還り》の効果文)。
 *  - スタイル技能の効果の解除(recoveryEffects): 状態でない付与コピーはこの設定がオンの神業の治療で
 *    だけ候補になり、供給元がスタイル技能でないと解決できたものは外す(解決できないものは通す)。
 * @param {{isCondition: boolean, isTerminal?: boolean, isGranted?: boolean, sourceIsStyleSkill?: ?boolean,
 *          fromMiracle?: boolean, receivedScene?: ?{act?: string, number?: number}}} entry
 * @param {{recoverySceneLimit?: string, recoveryEffects?: boolean}} usage
 * @param {{byMiracle: boolean, currentScene?: ?{act?: string, number?: number}}} ctx
 * @returns {boolean}
 */
export function recoveryCandidateAllowed(entry, usage, { byMiracle, currentScene = null }) {
    if (entry?.fromMiracle && !byMiracle) return false;
    if (!entry?.isCondition) {
        if (!byMiracle || usage?.recoveryEffects !== true) return false;
        if (!entry?.isGranted) return false;
        return entry.sourceIsStyleSkill !== false;
    }
    const limit = usage?.recoverySceneLimit ?? "none";
    if (limit === "all" || (limit === "terminal" && entry.isTerminal)) {
        return isSameReceivedScene(entry.receivedScene ?? null, currentScene);
    }
    return true;
}

/**
 * 神業カードの描画データ。効果文・条件はエンリッチ済みの HTML を受け取る(純関数のため
 * エンリッチは呼び出し側)。空の欄は空文字で返し、テンプレート側で行ごと畳む。
 * @param {{name?: string, system?: {furigana?: string}}} item 神業アイテム
 * @param {{description?: string, condition?: string, remaining: number, max: number}} opts
 * @returns {{typeLabel: string, name: string, furigana: string, description: string,
 *            condition: string, remaining: number, max: number}}
 */
export function buildMiracleCardData(item, { description = "", condition = "", remaining, max }) {
    return {
        typeLabel:   "神業",
        name:        item?.name ?? "",
        furigana:    item?.system?.furigana ?? "",
        description: description ?? "",
        condition:   condition ?? "",
        remaining,
        max,
    };
}

// ─── 他の神業として使う神業(17-5・《万能道具》《突然変異》) ───────────────────────────
// 効果文《万能道具》「取得している〈フォルム〉によって、異なるスタイルの神業と同等の効果が発生する」＋
// 対応表(アイテム側に参照行として設定)／《突然変異》「そのアクト中に使用された神業をコピーして使用する」
// 「コピーする神業は、あなたが登場したシーンで使用されたものに限られる」「登場していれば、その神業の
// 効果が適用される前であっても、コピーすることは可能」。選び方は3つ・実行経路は1つ(選ばれた神業の
// 用途を、元の神業の名前・使用回数・印のもとで実行する)。

/**
 * 参照行のうち条件技能を満たすものの参照先(uuid)を順に返す。条件技能が空の行は無条件。
 * 参照先が空の行は除き、同じ参照先は1つにまとめる。
 * @param {Array<{name?: string, uuid?: string}>} refs 参照行
 * @param {(key: string) => boolean} hasSkill アクターがその識別キーの技能を所持するか
 * @returns {string[]} 参照先の uuid
 */
export function asOtherRefCandidates(refs, hasSkill) {
    const out = [];
    for (const r of (refs ?? [])) {
        if (!r?.uuid) continue;
        if (r.name && !hasSkill(r.name)) continue;
        if (!out.includes(r.uuid)) out.push(r.uuid);
    }
    return out;
}

/**
 * 使用ログのうち、その人が登場したシーンで使われた神業(同じ神業は1つに)。
 * 記帳時に登場していたか、または現在シーンの使用でいま登場していれば候補になる
 * (同じシーンで使用の後に登場した場合も「登場したシーンで使用されたもの」)。
 * @param {Array<{scene: number, uuid: string, name: string, appeared?: string[]}>} log
 * @param {{actorId: string, sceneNumber: number, appearedNow?: string[]}} ctx
 * @returns {Array<{uuid: string, name: string}>}
 */
export function miracleLogCandidates(log, { actorId, sceneNumber, appearedNow = [] }) {
    const out = [];
    const nowHere = (appearedNow ?? []).includes(actorId);
    for (const e of (log ?? [])) {
        if (!e?.uuid) continue;
        const wasHere = (e.appeared ?? []).includes(actorId) || (nowHere && e.scene === sceneNumber);
        if (!wasHere) continue;
        if (out.some(c => c.uuid === e.uuid)) continue;
        out.push({ uuid: e.uuid, name: e.name ?? "" });
    }
    return out;
}

/**
 * カードのフラグから神業の使用(印)を取る。神業カード(miracle)か神業版ダメージカード
 * (damageRoll.miracle)。それ以外は null。
 * @param {object|null|undefined} flags システムスコープのフラグ
 * @returns {?{itemId: string, name: string, uuid?: string, asOther?: {uuid: string, name: string}}}
 */
export function miracleUseFromMessageFlags(flags) {
    const origin = flags?.miracle?.itemId ? flags.miracle : (flags?.damageRoll?.miracle?.itemId ? flags.damageRoll.miracle : null);
    return origin ?? null;
}

/**
 * 使用ログの1行。他の神業として使った分は**解決後の神業**を記帳する(《突然変異》がコピーするのは
 * 実際に起きた効果の神業)。appeared=記帳時に登場していたアクター id。
 * @returns {{scene: number, sceneId: string, actorId: string, actorName: string, uuid: string, name: string, appeared: string[]}}
 */
export function buildMiracleUseLogEntry({ sceneNumber, sceneId = "", actorId = "", actorName = "", origin, appeared = [] }) {
    const uuid = origin?.asOther?.uuid || origin?.uuid || "";
    const name = origin?.asOther?.uuid ? (origin.asOther.name ?? "") : (origin?.name ?? "");
    return { scene: Number(sceneNumber) || 0, sceneId, actorId, actorName, uuid, name, appeared: [...(appeared ?? [])] };
}

