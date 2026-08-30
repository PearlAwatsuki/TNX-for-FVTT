/**
 * @fileoverview アクターシートのアイテム・カードツールチップ(フェーズ16-2)。
 *
 * シート上で内容が見えないアイテム行(一般技能・スタイル技能・アウトフィット・神業・スタイル)に
 * カーソルオンで、**辞典ブラウザと同じカード**をツールチップ表示する(2026-08-30 ユーザー指定。
 * 適用範囲の整理は Phase_16_Tasks_Detail。住宅エリア=シートに並ばない/ライフパス=内容が
 * デフォルト表示のため対象外)。
 *
 * 所持アイテムなので値は AE 込み**実効値**で出る(カードビルダーが total 優先で読む)。
 * 配線は HUD シーンカードのツールチップ(14-8)と同じ data-tooltip-html 方式——レンダー後に
 * 非同期でカード HTML を組み立てて属性へ流し込む(ホバー時には出来上がっている)。
 */

import { buildDictionaryCard, cardKindOf, DICTIONARY_CARD_TEMPLATE } from "./dictionary-cards.mjs";
import { loadSkillChoices, SKILL_PACKS, STYLE_PACK } from "./skill-dictionary.mjs";
import { loadOutfitDictNames } from "./outfit-dictionary.mjs";
import { getPartSlotPreset } from "./part-slot-preset-app.mjs";
import { resolveItemNameByKey } from "./identification.mjs";

const { renderTemplate } = foundry.applications.handlebars;

/**
 * ツールチップを付けるアイテム行のセレクタ(シート上で内容が見えない行)。
 * ボタン・メニュー等の操作要素には付けない(行・スロット・名前ボタンのみ)。
 */
const TOOLTIP_ROW_SELECTORS = [
    ".outfit-row[data-item-id]",                 // アウトフィットタブの行
    ".general-skill-display[data-item-id]",      // 技能タブ: 一般技能
    ".style-skill-row[data-item-id]",            // 技能タブ: スタイル技能
    ".style-summary-item[data-item-id]",         // ヘッダ(閲覧): スタイル
    ".style-slot[data-item-id]",                 // ヘッダ(編集): スタイルスロット
    ".miracle-slot[data-item-id]",               // ヘッダ(編集): 神業スロット
    ".miracle-use-button[data-item-id]",         // ヘッダ(閲覧): 神業使用ボタン
];

/**
 * ルート要素配下のアイテム行へカード・ツールチップを適用する(レンダー後フックから呼ぶ)。
 * @param {HTMLElement} root シートのルート要素
 * @param {Actor} actor 行のアイテムを所持するアクター
 */
export async function applyItemCardTooltips(root, actor) {
    if (!root || !actor) return;
    const els = root.querySelectorAll(TOOLTIP_ROW_SELECTORS.join(","));
    if (!els.length) return;
    const [skillNames, styleNames, outfitNames] = await Promise.all([
        loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]),
        loadSkillChoices([STYLE_PACK]),
        loadOutfitDictNames(),
    ]);
    const partSlotsCtx = actor.system?.partSlotsEffective ?? actor.system?.partSlots ?? getPartSlotPreset();
    for (const el of els) {
        const item = actor.items.get(el.dataset.itemId);
        if (!item || !cardKindOf(item)) continue;
        // 住宅施設: 紐づけた住宅エリアの供給値を合算する(シートの行表示と同じ値を出す)
        let areaMods = null;
        if (item.type === "residence" && item.system.housingArea) {
            const linked = await fromUuid(item.system.housingArea).catch(() => null);
            if (linked?.type === "housingArea") areaMods = linked.system;
        }
        const card = await buildDictionaryCard(item, {
            skillNames, styleNames,
            resolveHostName: (key) => resolveItemNameByKey(actor, key, outfitNames),
            partSlotsCtx,
            partAdded: item.system.partAdded ?? [],
            areaMods,
        });
        if (!card) continue;
        el.dataset.tooltipHtml = await renderTemplate(DICTIONARY_CARD_TEMPLATE, { card });
        el.dataset.tooltipClass = "tnx-dict-tooltip";
    }
}
