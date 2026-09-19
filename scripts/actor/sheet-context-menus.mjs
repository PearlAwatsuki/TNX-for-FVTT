import { wrapMenu } from "../ui/menu-wrapper.mjs";
/**
 * @fileoverview アクターシートの右クリックメニュー(2026-09-07 シート基底から移設)。
 *
 * 技能・アウトフィット・神業・バッドステータス等の行に ContextMenu を張る。シートの状態
 * (編集可否・機能ゲート)を読むためシート自身を受け取るが、描画データの組み立てとは
 * 関心が別なので分けてある。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { usesMaxBaseOf } from "../data/item/uses.mjs";
import { CONDITION_KINDS, getConditionKind } from "../rules/conditions.mjs";
import { openConditionEditDialog } from "../flow/condition-edit.mjs";
import { startTreatment } from "../flow/treatment-flow.mjs";

export function activateContextMenus(sheet, el) {
    const getItemFromHeader = header => {
        const itemId = header.dataset.itemId || header.closest('[data-item-id]')?.dataset.itemId;
        return sheet.actor.items.get(itemId);
    };

    // 初期習得技能(初期技能カテゴリ・名乗りの初期分)の判定
    const isInitialSkill = item =>
        item?.type === 'generalSkill'
        && (item.system.generalSkillCategory === 'initialSkill'
            || item.system.onomasticSkill?.isInitial);

    const openItemSheet = (header, editMode) => {
        const item = getItemFromHeader(header);
        if (!item) return;
        item.sheet._isEditMode = editMode;
        item.sheet.render({ force: true });
    };

    const itemDeleteCallback = async header => {
        const item = getItemFromHeader(header);
        if (!item) return;

        if (item.type === 'miracle') {
            // 母数(uses.max)が2以上なら削除でなく-1(多重取得の1つを外す)。spent は新 max にクランプ
            const uses = item.system.uses;
            if (uses && usesMaxBaseOf(item.system) > 1) {
                const newMax = usesMaxBaseOf(item.system) - 1;
                await item.update({ "system.uses.max": String(newMax), "system.uses.spent": Math.min(Number(uses.spent) || 0, newMax) });
                ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                return;
            }
        }

        if (item.type === 'style' && item.system.level > 1) {
            await item.update({ 'system.level': item.system.level - 1 });
            return;
        }

        await sheet.actor.deleteEmbeddedDocuments("Item", [item.id]);
    };

    const viewOption = {
        label:     "閲覧",
        icon:     '<i class="fas fa-eye"></i>',
        onClick: header => openItemSheet(header, false)
    };
    const editOption = {
        label:      "編集",
        icon:      '<i class="fas fa-edit"></i>',
        visible: () => sheet.isEditable,
        onClick:  header => openItemSheet(header, true)
    };
    // 初期習得技能(基本13技能)の削除保護は、技能をシードされる型(能力値を持つシート)のみ。
    // エキストラは技能を持たないのが普通のため、置いた技能は自由に削除できる(2026-07-04)
    const protectInitial = sheet.sheetFeatures.abilities;
    const deleteOption = {
        label:      "削除",
        icon:      '<i class="fas fa-trash"></i>',
        visible: header => sheet.isEditable && !(protectInitial && isInitialSkill(getItemFromHeader(header))),
        onClick:  itemDeleteCallback
    };
    const duplicateOption = {
        label:      "複製",
        icon:      '<i class="fas fa-copy"></i>',
        visible: header => {
            if (!sheet.isEditable) return false;
            const item = getItemFromHeader(header);
            return item?.system.generalSkillCategory !== 'initialSkill';
        },
        onClick: async header => {
            const item = getItemFromHeader(header);
            if (!item) return;
            const data = item.toObject();
            delete data._id;
            data.name = `${data.name}(コピー)`;
            // 名乗り初期分の複製は通常の名乗り技能として扱う
            if (foundry.utils.getProperty(data, "system.onomasticSkill.isInitial")) {
                foundry.utils.setProperty(data, "system.onomasticSkill.isInitial", false);
            }
            await sheet.actor.createEmbeddedDocuments("Item", [data]);
        }
    };

    const baseItemMenu = [viewOption, editOption, deleteOption];
    const skillMenu    = [viewOption, editOption, duplicateOption, deleteOption];

    const CM = foundry.applications.ux.ContextMenu.implementation;

    new CM(el, '.item-button[data-context-menu="item-edit"]', wrapMenu(baseItemMenu), { jQuery: false, fixed: true });
    new CM(el, '[data-context-menu="miracle-view"]', wrapMenu(baseItemMenu), { jQuery: false, fixed: true });
    new CM(el, ".style-skills-list .style-skill-row", wrapMenu(skillMenu), { jQuery: false, fixed: true });
    new CM(el, ".skills-list-view .general-skill-display", wrapMenu(skillMenu), { jQuery: false, fixed: true });

    // ライフパスボタン（編集モード）のコンテキストメニュー
    const lifepathItemMenu = [
        {
            label:     "閲覧",
            icon:     '<i class="fas fa-eye"></i>',
            onClick: async header => {
                const key  = header.dataset.lifepathKey;
                const uuid = sheet.actor.system.lifePath[key]?.itemUuid;
                if (!uuid) return;
                const item = await fromUuid(uuid);
                if (!item) return;
                item.sheet._isEditMode = false;
                item.sheet.render({ force: true });
            }
        },
        {
            label:      "編集",
            icon:      '<i class="fas fa-edit"></i>',
            visible: () => sheet.isEditable,
            onClick: async header => {
                const key  = header.dataset.lifepathKey;
                const uuid = sheet.actor.system.lifePath[key]?.itemUuid;
                if (!uuid) return;
                const item = await fromUuid(uuid);
                if (!item) return;
                item.sheet._isEditMode = true;
                item.sheet.render({ force: true });
            }
        },
        {
            label:      "削除",
            icon:      '<i class="fas fa-trash"></i>',
            visible: () => sheet.isEditable,
            onClick: async header => {
                const key = header.dataset.lifepathKey;
                if (!key) return;
                await sheet.actor.update({
                    [`system.lifePath.${key}.itemUuid`]: "",
                    [`system.lifePath.${key}.name`]:     "",
                });
            }
        }
    ];
    new CM(el, '.lifepath-item-btn[data-context-menu="lifepath-item"]', wrapMenu(lifepathItemMenu), { jQuery: false, fixed: true });

    // バッドステータス/負傷 閲覧モード: 左クリックで「治療」(ダメージ=負傷・戦闘不能のみ)。
    // 削除は編集モードの X ボタン(removeBadStatus)のみ(2026-07-09 ユーザー指示)。
    // 社会の負傷もメニュー対象(2026-07-18 一本化: 治療可否は用途の範囲設定が決める。
    // 社会を範囲に持つ専用スタイル技能があれば治療でき、無ければ照合で「技能が無い」になる)
    const isTreatableKind = (kind) => {
        const def = CONDITION_KINDS[kind];
        if (!def) return false;
        return def.type === "wound" || def.group === "incapacitation";
    };
    // 効果値を持つ BS(邪毒/電子妨害/衰弱/重圧/萎縮/憎悪/捕縛)は「効果を編集」で任意編集できる。
    // kind は status id、無い場合(isBadStatus フォールバック)は効果の conditionKind から解決する。
    const kindOf = header => {
        const sid = header.dataset.statusId;
        if (sid && CONDITION_KINDS[sid]) return sid;
        return getConditionKind(sheet.actor.effects.get(header.dataset.effectId));
    };
    const hasEditableFields = (kind) => {
        const def = CONDITION_KINDS[kind];
        return !!def && (def.magnitudeField || def.abilityField || def.targetField || def.weaponField);
    };
    const badStatusViewMenu = [
        {
            label:      "治療",
            icon:      '<i class="fas fa-briefcase-medical"></i>',
            visible: header => isTreatableKind(header.dataset.statusId),
            onClick:  async header => {
                await startTreatment(sheet.actor, header.dataset.effectId);
            }
        },
        {
            label:      "効果を編集",
            icon:      '<i class="fas fa-sliders"></i>',
            visible: header => hasEditableFields(kindOf(header)),
            onClick:  async header => {
                const effect = sheet.actor.effects.get(header.dataset.effectId);
                if (effect) await openConditionEditDialog(sheet.actor, effect, kindOf(header));
            }
        },
        // 手動オーバーライド(卓ツール): このインスタンスの効果を止める/戻す。バッヂ(タグ)は残り、
        // 消費側の抑止・取り消し線は ignore.* AE と同じ effectIgnored 経路に合流する(manuallyIgnored フラグ)。
        {
            label:      "効果を無視する",
            icon:      '<i class="fas fa-ban"></i>',
            visible: header => sheet.actor.effects.get(header.dataset.effectId)?.getFlag(SYSTEM_ID, "manuallyIgnored") !== true,
            onClick:  async header => {
                const effect = sheet.actor.effects.get(header.dataset.effectId);
                if (effect) await effect.setFlag(SYSTEM_ID, "manuallyIgnored", true);
            }
        },
        {
            label:      "無視を解除する",
            icon:      '<i class="fas fa-arrow-rotate-left"></i>',
            visible: header => sheet.actor.effects.get(header.dataset.effectId)?.getFlag(SYSTEM_ID, "manuallyIgnored") === true,
            onClick:  async header => {
                const effect = sheet.actor.effects.get(header.dataset.effectId);
                if (effect) await effect.unsetFlag(SYSTEM_ID, "manuallyIgnored");
            }
        }
    ];
    new CM(el, ".tnx-bs-btn--view", wrapMenu(badStatusViewMenu), { jQuery: false, fixed: true, eventName: "click" });

    // アウトフィット行のコンテキストメニュー
    const outfitMenu = [
        {
            label:     "閲覧",
            icon:     '<i class="fas fa-eye"></i>',
            onClick: header => {
                const item = getItemFromHeader(header);
                if (!item) return;
                item.sheet._isEditMode = false;
                item.sheet.render({ force: true });
            }
        },
        {
            label:      "編集",
            icon:      '<i class="fas fa-edit"></i>',
            visible: () => sheet.isEditable,
            onClick:  header => {
                const item = getItemFromHeader(header);
                if (!item) return;
                item.sheet._isEditMode = true;
                item.sheet.render({ force: true });
            }
        },
        {
            label:      "改造を解除",
            icon:      '<i class="fas fa-wrench"></i>',
            visible: header => sheet.isEditable
                && (getItemFromHeader(header)?.system.modifications?.length ?? 0) > 0,
            onClick:  async header => {
                const item = getItemFromHeader(header);
                if (!item) return;
                await item.update({ "system.modifications": [] });
            }
        },
        {
            label:      "コンバイン解除",
            icon:      '<i class="fas fa-unlink"></i>',
            visible: header => sheet.isEditable && !!getItemFromHeader(header)?.system.combineGroupId,
            onClick:  async header => {
                const srcItem = getItemFromHeader(header);
                if (!srcItem) return;
                const combiner = sheet.actor.items.get(srcItem.system.combineGroupId);
                if (!combiner) return;
                const s1Uuid = combiner.system.combine.source1;
                const s2Uuid = combiner.system.combine.source2;
                const updates = [{
                    _id: combiner.id,
                    "system.isCombineActive": false,
                    "system.combine.source1": "",
                    "system.combine.source2": "",
                }];
                for (const uuid of [s1Uuid, s2Uuid].filter(Boolean)) {
                    const si = sheet.actor.items.find(i => i.uuid === uuid);
                    if (si) updates.push({ _id: si.id, "system.combineGroupId": "" });
                }
                await sheet.actor.updateEmbeddedDocuments("Item", updates);
            }
        },
        {
            label:      "削除",
            icon:      '<i class="fas fa-trash"></i>',
            visible: () => sheet.isEditable,
            onClick:  async header => {
                const item = getItemFromHeader(header);
                if (!item) return;
                await sheet.actor.deleteEmbeddedDocuments("Item", [item.id]);
            }
        }
    ];
    new CM(el, ".outfit-row", wrapMenu(outfitMenu), { jQuery: false, fixed: true });
}
