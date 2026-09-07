/**
 * @fileoverview 携帯中/準備済みトグルの適用(2026-09-07 一本化)。
 *
 * 規則そのもの(住宅の携帯固定・携帯が準備の前提・装備先との連動)は Foundry 非依存の
 * `planOutfitFlagToggle`(data/item/helpers.mjs)が正本で、ここはその計画をドキュメントへ
 * 書き込むだけの層。
 *
 * 経緯: この不変条件はアクターシートの `_onToggleOutfitFlag` にだけ実装されており、
 * アイテムシートの `_onToggleFlag` は素で反転していた。**同じ操作でも入口によって結果が
 * 違い**、アイテムシートのヘッダからは「携帯していないのに準備済み」を作れていた
 * (防御力の合算は isPrepared を見るため、携帯していない防具の防御力が実効値に乗っていた)。
 *
 * 置き場について: 純関数は helpers.mjs のアウトフィット状態述語群(isOutfitUnusable 等)と
 * 同居させ、書き込みを伴うこの層だけを分けている。アイテムシートからアクターシート基底を
 * import すると依存の向きが逆になるため、両方が参照できる中立な場所に置く。
 */

import { planOutfitFlagToggle } from "../data/item/helpers.mjs";

/**
 * 携帯中/準備済みの切り替えを不変条件つきで適用する。
 *
 * @param {Item}   item  対象アウトフィット
 * @param {string} flag  切り替えるフラグ
 * @param {?Actor} actor 所属アクター(装備先・配下オプションの解決に使う)
 * @returns {Promise<boolean>} 適用したら true。対象外のフラグ・断られた場合は false
 *   (呼び出し側は false のとき、対象外なら素の反転へ進み、断られたなら何もしない)
 */
export async function applyOutfitFlagToggle(item, flag, actor) {
    const plan = planOutfitFlagToggle(item, flag, {
        host:     item.system.isOption ? (actor?.items.get(item.system.parentItemId) ?? null) : null,
        siblings: actor?.items ?? [],
    });
    if (!plan) return false;                       // 対象外のフラグ
    if (plan.blocked) {
        if (plan.blocked.message) ui.notifications?.warn(plan.blocked.message);
        return false;
    }
    await item.update(plan.update);
    // 装備先が未準備になったら配下の準備済みオプションも解除する
    if (plan.unprepareOptionIds.length && actor) {
        await actor.updateEmbeddedDocuments("Item",
            plan.unprepareOptionIds.map(id => ({ _id: id, "system.isPrepared": false })));
    }
    return true;
}

/** そのフラグが不変条件の対象か(対象外は呼び出し側が素で反転してよい)。 */
export function isEquipStateFlag(flag) {
    return flag === "isCarrying" || flag === "isPrepared";
}
