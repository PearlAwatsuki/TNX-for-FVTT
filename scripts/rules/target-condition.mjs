/**
 * @fileoverview ダメージ修正の対象条件(2026-09-01 設計承認・正本 Game_Mechanics/Damage_Rules)。
 *
 * 「ウェットの対象には効果がない」「特定スタイルの対象にのみダメージ+n」のような、
 * **対象のありよう**で個別のダメージ修正行を有効/無効化する条件の照合。用途のダメージ修正行
 * (damageBonuses)・自身の修正値(damageBonusSelf)に付く targetCondition を評価する。
 *
 * 条件 = { kind, mode, key }:
 * - kind: "none"(条件なし・既定) / "wet"(ウェット) / "style"(スタイル) / "works"(ワークス所属)
 * - mode: "exclude"(該当対象には無効) / "only"(該当対象のみ有効)
 * - key:  kind=style/works のときの識別キー(スタイル識別キー / 組織識別キー)
 *
 * 対象コンテキスト ctx = { isWet, styles, works }(呼び出し側が対象アクターから解決する。
 * isWet の定義は conditions.mjs の isWetActor=電子妨害のウェット分岐と同一)。
 * **対象未解決(ctx=null)はゲートしない**(条件を検査できないため行は通常適用・注記なし)。
 *
 * 無効化された行は内訳から黙って落とさず、**注記つき 0 行**として表示する(設計承認時の要件)。
 * 注記文字列は targetConditionNote が作る(スタイル/ワークスの表示名は呼び出し側が逆引きして渡す
 * =生キー表示禁止の規約)。
 *
 * 本モジュールは純粋関数(Foundry 非依存)に徹する。
 */

/** 条件の種類(選択肢順)。 */
export const TARGET_CONDITION_KINDS = ["none", "wet", "style", "works"];

/** 条件の極性: exclude=「〜には無効」 / only=「〜のみ有効」。 */
export const TARGET_CONDITION_MODES = ["exclude", "only"];

/**
 * 条件が実質を持つか(kind が none/未設定なら条件なし)。
 * @param {{kind?: string}|null|undefined} cond
 * @returns {boolean}
 */
export function hasTargetCondition(cond) {
    const kind = cond?.kind;
    if (!kind || kind === "none") return false;
    // style/works はキーが選ばれて初めて条件になる(未選択は条件なし扱い)
    if ((kind === "style" || kind === "works") && !cond?.key) return false;
    return true;
}

/**
 * 対象が条件の**種類に該当**するか(極性の適用前)。
 * @param {{kind?: string, key?: string}} cond
 * @param {{isWet?: boolean, styles?: string[], works?: string[]}} ctx 対象コンテキスト
 * @returns {boolean}
 */
export function matchesTargetCondition(cond, ctx) {
    switch (cond?.kind) {
        case "wet":   return ctx?.isWet === true;
        case "style": return (ctx?.styles ?? []).includes(cond?.key);
        case "works": return (ctx?.works ?? []).includes(cond?.key);
        default:      return false;
    }
}

/**
 * この対象に行を適用するか。条件なし・対象未解決(ctx=null)は常に適用。
 * exclude=該当したら無効 / only=該当しなければ無効。
 * @param {{kind?: string, mode?: string, key?: string}|null|undefined} cond
 * @param {{isWet?: boolean, styles?: string[], works?: string[]}|null} ctx
 * @returns {boolean}
 */
export function targetConditionApplies(cond, ctx) {
    if (!hasTargetCondition(cond) || !ctx) return true;
    const member = matchesTargetCondition(cond, ctx);
    return cond.mode === "only" ? member : !member;
}

/**
 * 無効化の注記文字列(内訳の 0 行に付ける)。
 * 例: 「ウェット無効」「ウェットのみ・対象外」「〈スタイル名〉無効」「〈組織名〉のみ・対象外」。
 * @param {{kind?: string, mode?: string}} cond
 * @param {string} [keyLabel] kind=style/works の表示名(呼び出し側が識別キーから逆引き)
 * @returns {string}
 */
export function targetConditionNote(cond, keyLabel = "") {
    const subject = cond?.kind === "wet" ? "ウェット" : (keyLabel || "指定対象");
    return cond?.mode === "only" ? `${subject}のみ・対象外` : `${subject}無効`;
}
