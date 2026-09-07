/**
 * @fileoverview アクターシートへのアイテムドロップと並び替え(2026-09-07 シート基底から移設)。
 *
 * 技能・アウトフィット・スタイル等の受け入れ判定、コンパクトな重複処理、装備先(ホスト)への
 * 結線、同一グループ内の並び替えを扱う。シートの状態を読むためシート自身を受け取る。
 */

import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { usesMaxBaseOf } from "../data/item/uses.mjs";
import { displayGroupKey } from "./outfit-tab.mjs";
import { calcSkillInsertSort } from "../core/identification.mjs";

/**
 * 「このモジュールでは扱わない＝既定処理(ActorSheetV2 の取り込み)へ委ねる」ことを表す戻り値。
 * `super` はクラスの中でしか書けないため、判断はここで行い、実際の呼び出しは
 * シート側の委譲メソッドが行う。`false`(受け入れ拒否)と区別する必要があるので記号にした。
 */
export const DROP_FALLBACK = Symbol("dropFallback");

export async function onDropItem(sheet, event, data) {
    if (!sheet.actor.isOwner) return false;

    let item;
    if (data.uuid) {
        item = await fromUuid(data.uuid);
    } else {
        item = await Item.fromDropData(data);
    }
    if (!item) return;

    // 住宅エリアは厳密にはアウトフィットではないためアクターには持たせない(2026-06-13 確定)
    if (item.type === "housingArea") {
        ui.notifications.warn("住宅エリアはアクターに直接持たせられません。住宅施設アイテムに設定してください。");
        return false;
    }

    // 神業を使用できないアクター(トループ/トループ級＝Troops.md)には神業を持たせない
    if (item.type === "miracle" && !sheet.sheetFeatures.miracles) {
        ui.notifications.warn("このアクターは神業を使用できません。");
        return false;
    }

    if (sheet.actor.uuid === item.parent?.uuid) {
        return onSortItem(sheet, event, item.toObject());
    }

    // 常備化経験点「ー」のアウトフィットはドラッグ&ドロップでインポートできない(2026-08-31
    // ユーザー指示・正本=Purchase_and_Modification.md の経路マトリクス: 入手経路はアクト中の
    // 購入判定のみ)。弾くのはドロップによるインポートだけ——購入フローの付与
    // (isCheckAcquired/isPre-play の立った複製)とシート上の新規作成は対象外。
    // 対象アクター=常備化経験点の経済を持つキャストと、**所有アクターがキャストの
    // トループ**(2026-08-31 指示・所有トループの常備化経験点は所有者キャストに計上される
    // 同じ経済圏)。所有者なし/キャスト以外が所有するトループ・ゲスト/エキストラは
    // RL の自由装備のまま
    let ownerIsCast = false;
    if (sheet.actor.type === "troop" && sheet.actor.system.ownerActorRef?.uuid) {
        const owner = await fromUuid(sheet.actor.system.ownerActorRef.uuid).catch(() => null);
        ownerIsCast = owner?.type === "cast";
    }
    const inPreserveEconomy = sheet.actor.type === "cast" || ownerIsCast;
    if (OUTFIT_ITEM_TYPES.has(item.type)
            && inPreserveEconomy
            && item.system.preserveExp?.mode !== "value"
            && item.system.isCheckAcquired !== true
            && item.system["isPre-play"] !== true) {
        ui.notifications.warn(`「${item.name}」は常備化経験点が「ー」のためインポートできません（入手はアクト中の購入判定のみ）。`);
        return false;
    }

    // 一般技能: 正規ソート順(GENERAL_SKILL_SORT_PREFIXES)の位置に挿入する sort を振って作成する
    // (2026-07-10)。辞典ドロップは辞典側の sort 値を持ち込んで並びが崩れていたため、＋ボタンからの
    // 作成と同じ挿入挙動に揃える。識別キーなしの自作技能は末尾。
    if (item.type === "generalSkill") {
        const data = item.toObject();
        const existingSkills = sheet.actor.items.filter(i => i.type === "generalSkill");
        data.sort = calcSkillInsertSort(existingSkills, data.system?.identificationKey ?? "");
        return sheet.actor.createEmbeddedDocuments("Item", [data]);
    }

    // コンバイナー（source1/source2 設定済み）: 3 アイテムを一括インポートして活性化する
    if (item.type === "combiner"
            && item.system.combine?.source1
            && item.system.combine?.source2
            && !item.system.isCombineActive) {
        const s1 = await fromUuid(item.system.combine.source1).catch(() => null);
        const s2 = await fromUuid(item.system.combine.source2).catch(() => null);
        const src1Data = s1?.toObject();
        const src2Data = s2?.toObject();
        const datas = [item.toObject(), ...([src1Data, src2Data].filter(Boolean))];
        const created = await sheet.actor.createEmbeddedDocuments("Item", datas);
        const combinerCreated = created[0];
        let srcIdx = 1;
        const src1Created = src1Data ? created[srcIdx++] : null;
        const src2Created = src2Data ? created[srcIdx]   : null;
        if (combinerCreated && src1Created && src2Created) {
            await sheet.actor.updateEmbeddedDocuments("Item", [
                {
                    _id: combinerCreated.id,
                    "system.isCombineActive": true,
                    "system.combine.source1": src1Created.uuid,
                    "system.combine.source2": src2Created.uuid,
                },
                { _id: src1Created.id, "system.combineGroupId": combinerCreated.id },
                { _id: src2Created.id, "system.combineGroupId": combinerCreated.id },
            ]);
        } else if (combinerCreated) {
            // 一方のソース解決失敗: UUID だけ更新して非活性状態を維持
            const partialUpdate = { _id: combinerCreated.id };
            if (src1Created) {
                partialUpdate["system.combine.source1"] = src1Created.uuid;
                await sheet.actor.updateEmbeddedDocuments("Item", [
                    partialUpdate,
                    { _id: src1Created.id, "system.combineGroupId": combinerCreated.id },
                ]);
            } else if (src2Created) {
                partialUpdate["system.combine.source2"] = src2Created.uuid;
                await sheet.actor.updateEmbeddedDocuments("Item", [
                    partialUpdate,
                    { _id: src2Created.id, "system.combineGroupId": combinerCreated.id },
                ]);
            }
        }
        return created;
    }

    const dropArea = event.target.closest('[data-drop-area]')?.dataset.dropArea;

    const lifepathAreaMap = {
        "lifepath-origin":     "origin",
        "lifepath-experience": "experience",
        "lifepath-encounter":  "encounter",
    };
    if (dropArea && lifepathAreaMap[dropArea]) {
        const key = lifepathAreaMap[dropArea];
        if (item.type !== "lifePath") {
            ui.notifications.warn("ライフパスアイテムのみドロップできます。");
            return false;
        }
        const lifePathType = item.system?.lifePathType;
        if (lifePathType && lifePathType !== key) {
            const typeLabels = { origin: "出自", experience: "経験", encounter: "邂逅" };
            ui.notifications.warn(`このスロットには「${typeLabels[key]}」のライフパスのみドロップできます。`);
            return false;
        }
        await sheet.actor.update({
            [`system.lifePath.${key}.itemUuid`]: item.uuid ?? "",
            [`system.lifePath.${key}.name`]:     item.name ?? "",
        });
        return;
    }

    // ライフパスはスロット(uuid 参照)で管理するため、スロット外へのドロップは素の作成に
    // 落とさず弾く(2026-07-08。以下の種別ルーティングと同じ抜け穴封鎖)
    if (item.type === "lifePath") {
        ui.notifications.warn("ライフパスは詳細タブの各スロットにドロップしてください。");
        return false;
    }

    // スタイル/神業/組織は**ドロップ位置でなくアイテム種別で**取り込みフローに載せる
    // (2026-07-08 修正)。従来は data-drop-area(編集モードのインポートボックス)限定だったため、
    // 閲覧モード等のボックス外ドロップが素の作成に落ち、スタイルのレベル合算・上限検証・
    // **神業の同時インポート**を素通りしていた
    if (item.type === "style") {
        const allStyles  = sheet.actor.items.filter(i => i.type === 'style');
        const totalLevel = allStyles.reduce((sum, s) => sum + (s.system.level || 1), 0);
        const existingItem = allStyles.find(i => i.name === item.name);

        if (existingItem) {
            if (totalLevel >= 3) { ui.notifications.warn("これ以上スタイルレベルを上げられません。"); return false; }
            await existingItem.update({ 'system.level': (existingItem.system.level || 1) + 1 });
            return existingItem;
        } else {
            const itemData = item.toObject();
            if (!itemData.system.level) itemData.system.level = 1;
            if (totalLevel + itemData.system.level > 3) {
                ui.notifications.warn("スタイルの合計レベルが3を超えてしまいます。"); return false;
            }
            const createdItems = await sheet.actor.createEmbeddedDocuments("Item", [itemData]);
            const createdStyle = createdItems[0];
            // スタイルインポート時の神業自動取得。神業を使用できないアクター
            // (トループ/トループ級)ではスキップする(2026-07-03 確定・Troops.md)
            if (createdStyle && sheet.sheetFeatures.miracles) {
                const miracleUuid = createdStyle.system.miracle?.id;
                if (miracleUuid) {
                    const sourceMiracle = await fromUuid(miracleUuid);
                    if (sourceMiracle) {
                        const allMiracles    = sheet.actor.items.filter(i => i.type === 'miracle');
                        const existingMiracle = allMiracles.find(i => i.name === sourceMiracle.name);
                        if (existingMiracle) {
                            // 母数(uses.max)+1・上限3、満タンへ(spent=0)。2026-07-18 uses 一本化
                            // max は StringField(式可)のため土台は usesMaxBaseOf・保存は文字列
                            const newMax = Math.min(3, usesMaxBaseOf(existingMiracle.system) + 1);
                            ui.notifications.info(`神業「${existingMiracle.name}」の母数が+1されました。`);
                            await existingMiracle.update({ "system.uses.max": String(newMax), "system.uses.spent": 0 });
                        } else if (allMiracles.length >= 3) {
                            ui.notifications.warn("神業は3種類までしか所有できません。");
                        } else {
                            // uses は DataModel の既定(isLimit:true/max:1/spent:0)で作成。母数のレベル連動は
                            // preUpdateItem(スタイルレベル変更)が維持する
                            await sheet.actor.createEmbeddedDocuments("Item", [sourceMiracle.toObject()]);
                            ui.notifications.info(`神業「${sourceMiracle.name}」がスタイル「${createdStyle.name}」から追加されました。`);
                            // 効果の参照(《万能道具》《神意》《半身》)の効果は、神業がアクターに
                            // 入った時点で決める(createItem フックが _chooseMiracleFormEffect を呼ぶ)。
                            // スタイル経由でも直接インポートでも同じ経路を通す(2026-09-06)
                        }
                    }
                }
            }
            return createdStyle;
        }
    }

    if (item.type === "miracle") {
        const allMiracles  = sheet.actor.items.filter(i => i.type === 'miracle');
        const existingItem = allMiracles.find(i => i.name === item.name);
        if (existingItem) {
            // 母数(uses.max)+1・上限3、満タンへ(spent=0)。2026-07-18 uses 一本化
            const newMax = Math.min(3, usesMaxBaseOf(existingItem.system) + 1);
            ui.notifications.info(`神業「${existingItem.name}」の母数が+1されました。`);
            return existingItem.update({ "system.uses.max": String(newMax), "system.uses.spent": 0 });
        } else {
            if (allMiracles.length >= 3) { ui.notifications.warn("神業は3種類までしか所有できません。"); return false; }
            return sheet.actor.createEmbeddedDocuments("Item", [item.toObject()]);
        }
    }

    const itemLimits = { organization: { limit: 1 } };
    const rule = itemLimits[item.type];
    if (rule) {
        const count = sheet.actor.items.filter(i => i.type === item.type).length;
        if (count >= rule.limit) { ui.notifications.warn(`${item.name}は${rule.limit}つまでしか所有できません。`); return false; }
        return sheet.actor.createEmbeddedDocuments("Item", [item.toObject()]);
    }

    return DROP_FALLBACK;
}

/**
 * 同型アイテム間の並び替え。
 * 一般技能は二列表示のため DOM 兄弟ではなく actor 上の同型アイテム全体を siblings とする。
 * アウトフィットは同じ表示グループ内のみソート可能（グループをまたぐドロップは無視）。
 * @override
 */
export function onSortItem(sheet, event, itemData) {
    const items  = sheet.actor.items;
    const source = items.get(itemData._id);
    if (!source) return;

    const dropTarget = event.target.closest("[data-item-id]");
    if (!dropTarget) return;
    const target = items.get(dropTarget.dataset.itemId);
    if (!target || source.id === target.id) return;

    // アウトフィット同士は同じ表示グループ内のみソート（グループをまたぐドロップは無視）
    if (OUTFIT_ITEM_TYPES.has(source.type) && OUTFIT_ITEM_TYPES.has(target.type)) {
        const sourceGroup = displayGroupKey(source.system.majorCategory);
        const targetGroup = displayGroupKey(target.system.majorCategory);
        if (sourceGroup !== targetGroup) return;
        const siblings = items.filter(i =>
            OUTFIT_ITEM_TYPES.has(i.type)
            && displayGroupKey(i.system.majorCategory) === sourceGroup
            && i.id !== source.id
        );
        const sortUpdates = foundry.utils.performIntegerSort(source, { target, siblings });
        const updateData = sortUpdates.map(u => ({ _id: u.target.id, ...u.update }));
        return sheet.actor.updateEmbeddedDocuments("Item", updateData);
    }

    if (source.type !== target.type) return;
    const siblings = items.filter(i => i.type === source.type && i.id !== source.id);
    const sortUpdates = foundry.utils.performIntegerSort(source, { target, siblings });
    const updateData = sortUpdates.map(u => ({ _id: u.target.id, ...u.update }));
    return sheet.actor.updateEmbeddedDocuments("Item", updateData);
}
