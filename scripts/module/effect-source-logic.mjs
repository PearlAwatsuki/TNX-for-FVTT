/**
 * @fileoverview RL 任意付与の「効果の付与元」の純ロジック(2026-07-21 設計確定)。
 *
 * 付与元は3通りある。プルダウン1つで選べるよう、種別と参照先を1つの値に畳む。
 *
 * - アクトのプリセット … 事前に組んでおいた効果(アクトシートに実体で持つ)
 * - アクター/ワールドのアイテムの効果 … 既に世界に在るものを流用する
 * - 新規作成 … その場で標準の効果シートを開いて組む
 *
 * 当初は「効果を持つワールドアイテム」だけを母集団にしていたが、TNX の効果は通常アクターの
 * 所持アイテムに乗っており、同梱パックにも効果を持つアイテムが無いため、母集団が空で分岐が
 * 死んでいた(2026-07-21 ユーザー指摘)。プリセットとアクター所持分を加えて実用にする。
 */

/** 新規作成を表すキー。 */
export const NEW_EFFECT_KEY = "new";

const SEP = "|";

/**
 * 付与元を1つの文字列へ畳む。
 *
 * uuid には `.` が含まれるため区切りは `|` を使い、**2つ目の区切りまで**で切る
 * (uuid 側に区切りが混ざっても壊れないように、後半は分割しない)。
 *
 * @param {"preset"|"item"|"new"} kind
 * @param {string} [a] プリセットならジャーナル ID、アイテムなら uuid
 * @param {string} [b] プリセット ID / 効果 ID
 * @returns {string}
 */
export function effectSourceKey(kind, a = "", b = "") {
    if (kind === "new") return NEW_EFFECT_KEY;
    return `${kind}${SEP}${a}${SEP}${b}`;
}

/**
 * `effectSourceKey` の逆。壊れた値は null。
 * @param {?string} key
 * @returns {?{kind:string, a:string, b:string}}
 */
export function parseEffectSourceKey(key) {
    if (typeof key !== "string" || !key) return null;
    if (key === NEW_EFFECT_KEY) return { kind: "new", a: "", b: "" };
    const first = key.indexOf(SEP);
    const last  = key.lastIndexOf(SEP);
    if (first < 0 || last === first) return null;
    return {
        kind: key.slice(0, first),
        a:    key.slice(first + 1, last),
        b:    key.slice(last + 1),
    };
}

/** 効果名にアイテム名を添える(同名なら重ねない)。 */
function optionLabel(effectName, itemName) {
    const eff = String(effectName ?? "").trim();
    const item = String(itemName ?? "").trim();
    return (!item || item === eff) ? eff : `${eff}（${item}）`;
}

/** アイテム群 → 選択肢(効果を持たないアイテムは落ちる)。 */
function itemOptions(items) {
    const out = [];
    for (const item of (items ?? [])) {
        for (const eff of (item?.effects ?? [])) {
            out.push({
                value: effectSourceKey("item", item.uuid, eff.id),
                label: optionLabel(eff.name, item.name),
            });
        }
    }
    return out;
}

/**
 * 付与元プルダウンのグループを組む。空のグループは出さない。
 *
 * 並びは プリセット → アクター → ワールド(手前ほど卓で使う頻度が高い)。
 *
 * @param {object} [sources]
 * @param {Array<{label:string, journalId:string, presets:Array<{id:string,label:string,empty?:boolean}>}>} [sources.presetGroups]
 * @param {Array<{label:string, items:Array<{uuid:string,name:string,effects:Array<{id:string,name:string}>}>}>} [sources.actorGroups]
 * @param {Array<{uuid:string,name:string,effects:Array<{id:string,name:string}>}>} [sources.worldItems]
 * @returns {Array<{label:string, options:Array<{value:string,label:string}>}>}
 */
export function buildEffectSourceGroups({ presetGroups = [], actorGroups = [], worldItems = [] } = {}) {
    const groups = [];

    for (const group of presetGroups) {
        // 効果が未設定のプリセットは付与できないため出さない
        const options = (group?.presets ?? [])
            .filter(p => p?.empty !== true)
            .map(p => ({ value: effectSourceKey("preset", group.journalId, p.id), label: p.label }));
        if (options.length) groups.push({ label: group.label, options });
    }

    for (const group of actorGroups) {
        const options = itemOptions(group?.items);
        if (options.length) groups.push({ label: group.label, options });
    }

    const world = itemOptions(worldItems);
    if (world.length) groups.push({ label: "ワールドのアイテム", options: world });

    return groups;
}
