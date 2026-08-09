/**
 * @fileoverview 使用回数(uses)の最大値の解決(2026-08-09 ユーザー要望「最大『レベル』回」)。
 *
 * `uses.max` は**数値も式も受ける StringField**(用途の checkBonusSelf / damageBonusSelf と同じ流儀)。
 * 実効値は派生フィールド `uses.maxTotal`(number)で、消費・表示はすべてこちらを読む。
 *
 * 評価の順序境界(2026-08-09 ユーザー裁定): 式が参照する値は **ActiveEffect 適用前**の実効値。
 * 「レベル回」の使用回数は、AE でレベルが上がっても増えない——これはルールとしての正解であり、
 * 実装順序の都合ではない。技術的にも、AE 適用前に maxTotal を確定させることで
 * AE(`system.uses.max` → `uses.maxTotal`)の追加/上書き/乗算のモード意味論をそのまま活かせる
 * (`actionRank.maxTotal` と同型: 派生で base を置き、その上に AE が乗る)。
 *
 * 端数は切り捨て(TNX の除算の慣例)。負値・評価不能(自由文・ダイス入り・構文エラー)は 0。
 *
 * ※ 旧 `uses.value` → `uses.spent` の移行は helpers.mjs の `migrateUsesValueToSpent`。
 *   本ファイルの `migrateUsesMaxToString` は**その後に**呼ぶこと(前者が max を数値として読むため)。
 */

import { parsePlainNumber, evaluateFormulaSync, buildFormulaData } from "../../module/tnx-formula.mjs";

/**
 * 使用回数の最大値(数値または式)を、**評価できたかどうかと併せて**解決する
 * (Foundry 非依存・評価関数は注入)。`resolved:false` はシートが「＝ ?」を出すための情報——
 * 「レベル0の技能で正しく 0」と「書き間違いで読めず 0」を取り違えないため。
 * @param {string|number|null|undefined} raw `uses.max` の素値
 * @param {(formula: string|number|null|undefined) => number|null} evaluate 式の評価関数
 * @returns {{value: number, resolved: boolean}} value は 0 以上の整数(評価不能は 0)
 */
export function resolveUsesMaxDetail(raw, evaluate) {
    const blank = !String(raw ?? "").trim();
    const plain = parsePlainNumber(raw);
    const value = blank ? 0 : (plain !== null ? plain : evaluate(raw));
    return {
        value:    Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0,
        resolved: blank || Number.isFinite(value),
    };
}

/**
 * 使用回数の最大値(数値または式)を実効値へ解決する。
 * @param {string|number|null|undefined} raw `uses.max` の素値
 * @param {(formula: string|number|null|undefined) => number|null} evaluate 式の評価関数
 * @returns {number} 0 以上の整数。評価不能は 0
 */
export function resolveUsesMax(raw, evaluate) {
    return resolveUsesMaxDetail(raw, evaluate).value;
}

/**
 * 最大値の素値が式か(＝シートに実効値バッジを出すか)。純数値・空は false。
 * @param {string|number|null|undefined} raw `uses.max` の素値
 * @returns {boolean}
 */
export function usesMaxIsFormula(raw) {
    const s = String(raw ?? "").trim();
    return s !== "" && parsePlainNumber(s) === null;
}

/**
 * `uses.max` の NumberField → StringField 移行(2026-08-09)。source を破壊的に書き換える。
 * @param {object} source DataModel の生ソース
 */
export function migrateUsesMaxToString(source) {
    const uses = source?.uses;
    if (uses && typeof uses.max === "number") uses.max = String(uses.max);
}

/**
 * 使用回数の最大値の**実効値を読む**(読み手はすべて本関数を経由する)。
 * 実効値 `maxTotal` があればそれ、無ければ素値を数値として読む(辞典アイテム・派生前の生データ)。
 * 素値が式で実効値が無い場合は 0——式は派生でしか解けないため(`readFlag` と同じ思想)。
 * @param {object|null|undefined} system アイテムの system
 * @returns {number}
 */
export function usesMaxTotalOf(system) {
    const uses = system?.uses;
    if (!uses) return 0;
    if (Number.isFinite(uses.maxTotal)) return uses.maxTotal;
    const plain = parsePlainNumber(uses.max);
    return plain !== null ? Math.max(0, Math.floor(plain)) : 0;
}

/**
 * 母数を**機械維持する書き手**(神業の多重取得 ±1・スタイルレベル連動)が使う「土台」の数値。
 * 保存値が数値ならその値(AE で膨らんだ実効値を保存へ焼き込まないため)、式なら実効値。
 * ※式の入ったアイテムでこれを土台に書き戻すと式は数値に置き換わる——神業の母数は連動フックが
 *   機械維持する領分であり、そこに式を入れる運用は想定しない(2026-08-09 ユーザー了承)。
 * @param {object|null|undefined} system アイテムの system
 * @returns {number}
 */
export function usesMaxBaseOf(system) {
    const plain = parsePlainNumber(system?.uses?.max);
    return plain !== null ? Math.max(0, Math.floor(plain)) : usesMaxTotalOf(system);
}

/**
 * 実効値 `uses.maxTotal` を派生算出して system に書き込む(base の `uses.max` は不変)。
 *
 * - **アイテム単体の段**(各 DataModel の prepareDerivedData): actor を渡さず `@item.self` のみ供給。
 *   アクター無所属(辞典・ワールド直下・コンペンディウム)でもシートが値を出せるようにするため。
 * - **アクターの段**(`_applyEffectBuffs` の直前): actor を渡してフル文脈
 *   (`@system.*` / `@item.<識別キー>.*` / `@item.self`)で再評価する。
 *
 * @param {object} system アイテムの system データ(prepareDerivedData の this)
 * @param {Actor|null} [actor] 所有アクター。null ならアイテム単体の段
 */
export function computeUsesMaxTotal(system, actor = null) {
    if (!system?.uses) return;
    const bearer = system.parent ?? null; // DataModel の parent = Item(`@item.self` の供給元)
    const data = buildFormulaData(actor, null, bearer);
    const { value, resolved } = resolveUsesMaxDetail(system.uses.max, (f) => evaluateFormulaSync(f, data));
    system.uses.maxTotal    = value;
    system.uses.maxResolved = resolved; // シートのバッジが「＝ ?」を出すかの判定に使う
}

/**
 * 所有アイテムすべての `uses.maxTotal` を**アクター文脈込みで**再評価する
 * (`_applyEffectBuffs` の**直前**に呼ぶ)。アイテム単体の段では引けなかった
 * `@system.*` / `@item.<識別キー>.*` がここで解決される。
 * @param {Actor|null} actor
 */
export function computeUsesMaxTotalForActor(actor) {
    for (const item of (actor?.items ?? [])) computeUsesMaxTotal(item.system, actor);
}

/**
 * AE 適用後の `uses.maxTotal` を 0 以上の整数に丸める(`_applyEffectBuffs` の**後**に呼ぶ)。
 * `actionRank.maxTotal` の 0clamp と同じ位置づけ。AE の減算・乗算で負値や端数が生じうる。
 * @param {Actor|null} actor
 */
export function clampUsesMaxTotalForActor(actor) {
    for (const item of (actor?.items ?? [])) {
        const uses = item?.system?.uses;
        if (!uses) continue;
        uses.maxTotal = Number.isFinite(uses.maxTotal) ? Math.max(0, Math.floor(uses.maxTotal)) : 0;
    }
}
