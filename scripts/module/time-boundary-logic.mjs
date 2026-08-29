/**
 * @fileoverview 時間境界の適用ロジック(フェーズ15・純ロジック・Foundry 非依存)。
 *
 * フェーズ13-6(カット境界)と14-2(シーン/アクト境界)は**イベントを発火するだけ**で、購読者が
 * 一人も居ない状態で置かれていた。本モジュールとグルーの `time-boundary.mjs` が、その
 * **購読＝適用本体**にあたる。ここには「どの境界で何が畳まれるか」の判断だけを置き、
 * ドキュメントの読み書きはグルー側が行う。
 *
 * 設計の正本は llm-wiki/01_Wiki/Phases/Phase_15_Tasks_Detail.md、
 * ルールの正本は Game_Rules/Time_Management.md(時間単位)。
 *
 * **持続は入れ子の単位**であり、上位の境界は下位の単位も畳む(カット終了ではメインプロセス中の
 * 効果も失効する)。したがって判定は個別の対応表ではなく単位の順序で行う。ただし
 * **カット進行の終了はシーンを終わらせない**(Combat_Flow「開始はシーンと連動・終了は非連動」)
 * ため、カット進行終了はカットまでしか畳まない。
 *
 * **退場＝そのキャラクターにとってのシーンの終わり**(2026-08-29 ユーザー裁定)。一度退場したら
 * 再登場はできない(→ Appearance_Check)以上、退場後にシーン持続の効果を保つ意味がないため。
 */

import { CONDITION_KINDS, getConditionKinds } from "./conditions.mjs";

/** 適用の起点になる境界。グルーがフックから解決してこの値で呼ぶ。 */
export const TNX_BOUNDARIES = Object.freeze({
    /** 本人のメインプロセス開始(恐慌の回復＝メインの直前)。 */
    mainProcessStart: "mainProcessStart",
    /** メインプロセスの終了。 */
    mainProcessEnd: "mainProcessEnd",
    /** クリンナッププロセス(酩酊・電子妨害の回復・邪毒の継続ダメージ)。 */
    cleanup: "cleanup",
    /** カットの終了(次カット境界)。 */
    cutEnd: "cutEnd",
    /** カット進行の終了(気絶/失神の回復・BS の全解除)。シーンは終わらせない。 */
    cutProgressionEnd: "cutProgressionEnd",
    /** 退場＝そのキャラクターにとってのシーンの終わり。 */
    exit: "exit",
    /** シーンの開始(社会ダメージの「次のシーン」効果の休眠解除)。 */
    sceneStart: "sceneStart",
    /** アクトの終了。 */
    actEnd: "actEnd",
});

/**
 * 効果に指定できる持続。キーは保存値、値は表示ラベル。空文字＝無期限(境界では失効しない)。
 *
 * **Time_Management の時間単位だけを置く。**「治療まで」は選択肢に置かない
 * (2026-08-29 ユーザー指摘): ①境界の判定では「アクト中」と挙動が完全に同一で名前が違うだけ
 * ②RL が手で組んだ効果に「治療する」操作は存在しない(治療の対象は負傷)。本来の
 * 「治療するまで回復しない」BS は**元の負傷 AE が生きているかで導出**するため、この欄を使わない。
 */
export const TNX_DURATIONS = Object.freeze({
    "":             "なし",
    mainProcess:    "メインプロセス中",
    cut:            "カット中",
    scene:          "シーン中",
    act:            "アクト中",
});

const SCOPE = "tokyo-nova-axleration";

/** 持続の入れ子の深さ。小さいほど短い。 */
const DURATION_RANK = Object.freeze({
    mainProcess: 1,
    cut:         2,
    scene:       3,
    act:         4,
});

/**
 * 境界が畳む深さ。ここに無い境界は持続の境界ではない(状態別の回復・発火だけを担う)。
 * カット進行終了がカット止まりなのは、カット進行の終了がシーンを終わらせないため。
 */
const BOUNDARY_RANK = Object.freeze({
    [TNX_BOUNDARIES.mainProcessEnd]:    1,
    [TNX_BOUNDARIES.cutEnd]:            2,
    [TNX_BOUNDARIES.cutProgressionEnd]: 2,
    [TNX_BOUNDARIES.exit]:              3,
    [TNX_BOUNDARIES.actEnd]:            4,
});

/**
 * 効果に載った TNX の持続を読む。未設定・未知の値は無期限(空文字)として扱う——
 * 読めない値で勝手に失効させないため。
 * @param {object|null|undefined} effect ActiveEffect(flags を持つもの)
 * @returns {string} TNX_DURATIONS のキー
 */
export function readEffectDuration(effect) {
    const raw = effect?.flags?.[SCOPE]?.tnxDuration;
    return (typeof raw === "string" && raw in DURATION_RANK) ? raw : "";
}

/**
 * 効果一覧の「効果時間」列に出す表示。持続を持たない効果は**空文字**を返す——
 * 全行に「なし」と書いて列を埋めないため。
 * @param {object|null|undefined} effect
 * @returns {string}
 */
export function durationLabelOf(effect) {
    const d = readEffectDuration(effect);
    return d ? TNX_DURATIONS[d] : "";
}

/**
 * その境界でその持続が失効するか。上位の境界は下位の単位も畳む。
 * @param {string} duration TNX_DURATIONS のキー
 * @param {string} boundary TNX_BOUNDARIES の値
 * @returns {boolean}
 */
export function durationExpiresAt(duration, boundary) {
    const d = DURATION_RANK[duration];
    const b = BOUNDARY_RANK[boundary];
    if (!d || !b) return false;
    return d <= b;
}

/**
 * 境界で失効させる効果の id を抽出する。
 *
 * 対象は**アクターに乗っている効果**だけ(呼び出し側が渡す)。アイテムに乗っている効果は
 * 定義であって実体ではないため消さない——用途で対象へ付与されたコピーがアクター側の実体で、
 * 持続はそのコピーに引き継がれて失効する。
 * @param {Array<object>|null|undefined} effects
 * @param {string} boundary TNX_BOUNDARIES の値
 * @returns {string[]} 失効させる効果の id
 */
export function planEffectExpiry(effects, boundary) {
    return (effects ?? [])
        .filter(e => durationExpiresAt(readEffectDuration(e), boundary))
        .map(e => e.id);
}

/**
 * 使用回数の期間(`uses.type`)→ 畳む深さ。持続と同じ入れ子の単位なので同じ物差しで測る。
 * 神業は期間の指定を持たないが**アクト単位**(Time_Management「神業: アクト単位」)。
 * @param {object|null|undefined} item
 * @returns {number} 0 = 境界では戻さない
 */
function usesResetRank(item) {
    const rank = DURATION_RANK[item?.system?.uses?.type];
    if (rank) return rank;
    return item?.type === "miracle" ? DURATION_RANK.act : 0;
}

/**
 * 境界でアイテム側に起こすリセットの update patch を組む(15-2)。
 *
 * - **使用回数**: その単位の境界で消費(`uses.spent`)を 0 に戻す。上位の境界は下位の単位も戻す。
 * - **消費アイテムの個数**: アクト単位で常備化個数(`quantity.max`)まで戻す
 *   (Time_Management「消費アイテム: 個数はアクト単位」)。
 *
 * 変化しないものは patch に含めない——無駄な書き込みでユーザーのデータを触らないため。
 * @param {Array<object>|null|undefined} items
 * @param {string} boundary TNX_BOUNDARIES の値
 * @returns {Array<object>} `Item.updateDocuments` 用の patch 配列
 */
export function planItemBoundaryUpdates(items, boundary) {
    const boundaryRank = BOUNDARY_RANK[boundary];
    const updates = [];
    for (const item of (items ?? [])) {
        const patch = {};
        const rank = usesResetRank(item);
        if (boundaryRank && rank && rank <= boundaryRank && (Number(item.system?.uses?.spent) || 0) > 0) {
            patch["system.uses.spent"] = 0;
        }
        const quantity = item?.system?.quantity;
        if (boundary === TNX_BOUNDARIES.actEnd && item?.system?.isConsumption === true
            && quantity && (Number(quantity.value) || 0) < (Number(quantity.max) || 0)) {
            patch["system.quantity.value"] = Number(quantity.max) || 0;
        }
        if (Object.keys(patch).length) updates.push({ _id: item.id, ...patch });
    }
    return updates;
}


/** 境界 → その境界を回復条件とする BS の `recovery` 値。ここに無い境界は個別回復を起こさない。 */
const BOUNDARY_RECOVERY = Object.freeze({
    [TNX_BOUNDARIES.mainProcessStart]: "ownMainStart",
    [TNX_BOUNDARIES.mainProcessEnd]:   "ownMainEnd",
    [TNX_BOUNDARIES.cleanup]:          "cleanup",
});

/** 本人のメインプロセスに紐づく回復条件(他人のメインでは起きない)。 */
const OWN_MAIN_RECOVERY = new Set(["ownMainStart", "ownMainEnd"]);

/**
 * BS を**全解除**する境界(Bad_Status 共通ルール「BS はカット進行が終了するか、シーンが変われば
 * 全て解除」＋アクト終了)。個別の回復タイミングはこれより早く効く前倒しの回復。
 * カット終了(次カットへ続く)は含まない——カットが変わっただけでは BS は落ちない。
 */
const CLEAR_ALL_BS = new Set([
    TNX_BOUNDARIES.cutProgressionEnd,
    TNX_BOUNDARIES.exit,
    TNX_BOUNDARIES.actEnd,
]);

/**
 * 「治療するまで回復しない」BS が、まだ回復できない状態か。
 *
 * フラグを立て落としせず**元の負傷 AE が生きているかで導出**する(設計判断7)。負傷が残っている
 * 間は通常の回復タイミングで回復せず、治療されて負傷が消えれば次の境界で通常どおり回復する。
 * 治療側に「BS を消す」責務を持ち込まないので「BS の回復 ≠ ダメージの治療」を崩さない。
 * @param {object} effect
 * @param {string[]} bsKinds その効果が持つ BS 種別
 * @param {Set<string>} aliveIds 同じアクターに乗っている効果の id
 * @returns {boolean}
 */
function isUntreatedGated(effect, bsKinds, aliveIds) {
    const flags = effect?.flags?.[SCOPE] ?? {};
    const perKind = flags.conditions ?? {};
    const gated = bsKinds.some(k => (perKind[k]?.durationNote ?? flags.durationNote) === "治療まで");
    if (!gated) return false;
    const woundId = flags.woundSource || "";
    return !!woundId && aliveIds.has(woundId);
}

/**
 * 境界で回復する BS を抽出する(15-4)。対象は**バッドステータスだけ**——戦闘不能・負傷は
 * 別のタイミングで回復する(Damage_Rules)。
 *
 * @param {Array<object>|null|undefined} effects そのアクターに乗っている効果
 * @param {string} boundary TNX_BOUNDARIES の値
 * @param {{isMainActor?: boolean}} [opts] そのメインプロセスの行動者本人か
 * @returns {{removeIds: string[], downgrades: Array<{id: string, toKind: string}>}}
 *          downgrades = 消えるのではなく別の BS に変わるもの(酩酊(大)→酩酊(小))
 */
export function planConditionRecovery(effects, boundary, { isMainActor = false } = {}) {
    const list = effects ?? [];
    const removeIds = [];
    const downgrades = [];
    const clearAll = CLEAR_ALL_BS.has(boundary);
    const trigger = BOUNDARY_RECOVERY[boundary] ?? null;
    if (!clearAll && !trigger) return { removeIds, downgrades };
    if (trigger && OWN_MAIN_RECOVERY.has(trigger) && !isMainActor) return { removeIds, downgrades };

    const aliveIds = new Set(list.map(e => e?.id));
    for (const effect of list) {
        const bsKinds = getConditionKinds(effect).filter(k => CONDITION_KINDS[k]?.group === "bs");
        if (!bsKinds.length) continue;
        // アクト終了は「ダメージが治療されるかアクト終了まで」の後半＝ゲートを越えて落とす
        if (boundary !== TNX_BOUNDARIES.actEnd && isUntreatedGated(effect, bsKinds, aliveIds)) continue;
        if (clearAll) { removeIds.push(effect.id); continue; }
        const matched = bsKinds.filter(k => CONDITION_KINDS[k]?.recovery === trigger);
        if (!matched.length) continue;
        removeIds.push(effect.id);
        // 変換(酩酊(大)→(小))。同時に受けている(小)も同じ境界で回復するため、結果は(小)が1つ
        for (const kind of matched) {
            const toKind = CONDITION_KINDS[kind]?.downgradeTo;
            if (toKind) downgrades.push({ id: effect.id, toKind });
        }
    }
    return { removeIds, downgrades };
}
