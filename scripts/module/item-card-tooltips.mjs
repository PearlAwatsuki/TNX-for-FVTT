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
import { fitDictionaryCard } from "./tnx-dictionary-browser.mjs";
import { loadSkillChoices, SKILL_PACKS, STYLE_PACK } from "./skill-dictionary.mjs";
import { loadOutfitDictNames } from "./outfit-dictionary.mjs";
import { getPartSlotPreset } from "./part-slot-preset-app.mjs";
import { resolveItemNameByKey } from "./identification.mjs";
import { readFlag } from "../data/item/helpers.mjs";

const { renderTemplate } = foundry.applications.handlebars;

/**
 * スタイル技能・アウトフィットのツールチップは辞典ブラウザと**同じ大きさのカード**にする
 * (2026-08-31 ユーザー指示)。寸法はブラウザの CSS(tnx2.css の --tnx-dict-card-w と
 * 種別別高さ)と対で保守する。tall=ヴィークル/全身義体/式神装備(4/3 高)。
 */
const TOOLTIP_CARD_SIZES = Object.freeze({
    styleSkill: { w: 222, h: 330 },
    outfit:     { w: 222, h: 285 },
    outfitTall: { w: 222, h: 380 },
});

/**
 * カード HTML を固定サイズスロットに入れ、オフスクリーンで文字縮小フィットを済ませた
 * ツールチップ用 HTML を返す(ツールチップは表示時に JS を実行できないため事前に確定させる)。
 * @param {string} cardHtml dictionary-card.hbs の描画結果
 * @param {{w: number, h: number}} size
 * @returns {string} フィット済みスロットの outerHTML
 */
function buildSizedTooltipHtml(cardHtml, size) {
    const stage = document.createElement("div");
    stage.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden;";
    const slot = document.createElement("div");
    slot.className = "tnx-dict__card-slot";
    slot.style.width = `${size.w}px`;
    slot.style.height = `${size.h}px`;
    slot.innerHTML = cardHtml;
    stage.appendChild(slot);
    document.body.appendChild(stage);
    try {
        const card = slot.querySelector(".tnx-dict-card");
        if (card) fitDictionaryCard(card);
        return slot.outerHTML;
    } finally {
        stage.remove();
    }
}

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
/** 辞典名マップ(技能・スタイル・アウトフィット)をまとめて読む(2つの適用系で共用)。 */
async function loadTooltipMaps() {
    const [skillNames, styleNames, outfitNames] = await Promise.all([
        loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]),
        loadSkillChoices([STYLE_PACK]),
        loadOutfitDictNames(),
    ]);
    return { skillNames, styleNames, outfitNames };
}

/**
 * 1アイテムのカード・ツールチップ HTML を組み立てる(行ツールチップとコンテンツリンクで共用)。
 * @param {Item} item 対象(所持アイテムまたは辞典アイテム)
 * @param {{maps: object, actor?: ?Actor, sizes?: ?object}} args
 *   sizes=種別→寸法(該当種別のみ固定サイズ化。null 判定は種別ごと)
 * @returns {Promise<?string>} data-tooltip-html 用 HTML(対象外は null)
 */
async function buildCardTooltipHtml(item, { maps, actor = null, sizes = TOOLTIP_CARD_SIZES }) {
    const kind = cardKindOf(item);
    if (!kind) return null;
    // 住宅施設: 紐づけた住宅エリアの供給値を合算する(シートの行表示と同じ値を出す)
    let areaMods = null;
    if (item.type === "residence" && item.system.housingArea) {
        const linked = await fromUuid(item.system.housingArea).catch(() => null);
        if (linked?.type === "housingArea") areaMods = linked.system;
    }
    const partSlotsCtx = actor?.system?.partSlotsEffective ?? actor?.system?.partSlots ?? getPartSlotPreset();
    const card = await buildDictionaryCard(item, {
        skillNames: maps.skillNames, styleNames: maps.styleNames,
        resolveHostName: (key) => resolveItemNameByKey(actor, key, maps.outfitNames),
        partSlotsCtx,
        partAdded: item.system.partAdded ?? [],
        areaMods,
    });
    if (!card) return null;
    const html = await renderTemplate(DICTIONARY_CARD_TEMPLATE, { card });
    // 固定サイズ化(2026-08-31 ユーザー指示=辞典ブラウザと同じ大きさ)。tall=ヴィークル/
    // 全身義体/式神装備。フィットは事前にオフスクリーンで確定させる
    const tall = item.type === "vehicle" || item.type === "cyborg" || readFlag(item.system, "isShiki");
    const size = kind === "outfit" ? (tall ? sizes?.outfitTall : sizes?.outfit) : sizes?.[kind];
    return size ? buildSizedTooltipHtml(html, size) : html;
}

export async function applyItemCardTooltips(root, actor) {
    if (!root || !actor) return;
    const els = root.querySelectorAll(TOOLTIP_ROW_SELECTORS.join(","));
    if (!els.length) return;
    const maps = await loadTooltipMaps();
    for (const el of els) {
        const item = actor.items.get(el.dataset.itemId);
        if (!item) continue;
        const html = await buildCardTooltipHtml(item, { maps, actor });
        if (!html) continue;
        el.dataset.tooltipHtml = html;
        el.dataset.tooltipClass = "tnx-dict-tooltip";
    }
}

/**
 * コンテンツリンク用のカード寸法(16-x): リンク先ホバーは全カード種別を固定サイズで出す
 * (自然高だと長文で巨大化するため)。styleSkill/outfit はシート行ツールチップと同一。
 */
const LINK_TOOLTIP_SIZES = Object.freeze({
    ...TOOLTIP_CARD_SIZES,
    generalSkill: { w: 340, h: 330 },
    miracle:      { w: 280, h: 370 },
    style:        { w: 320, h: 430 },
    organization: { w: 320, h: 430 },
});

/**
 * @UUID コンテンツリンクのうち、辞典カード対象のアイテムを指すものへカード・ツールチップを
 * 付ける(16-x・2026-08-31 ユーザー承認)。チャット・シート・ジャーナル・ブラウザカード内の
 * リンクすべてが対象(レンダー後フックから呼ぶ)。クリック挙動はコアのまま(シートを開く)。
 * @param {HTMLElement} root 描画済みのルート要素
 */
export async function applyContentLinkCardTooltips(root) {
    if (!root?.querySelectorAll) return;
    const links = [...root.querySelectorAll("a.content-link[data-uuid]")]
        .filter((a) => !a.dataset.tooltipHtml);
    if (!links.length) return;
    let maps = null; // リンクが辞典カード対象のときだけ辞典名マップを読む(遅延)
    for (const a of links) {
        const doc = await fromUuid(a.dataset.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Item" || !cardKindOf(doc)) continue;
        maps ??= await loadTooltipMaps();
        const html = await buildCardTooltipHtml(doc, { maps, actor: doc.actor ?? null, sizes: LINK_TOOLTIP_SIZES });
        if (!html) continue;
        a.dataset.tooltipHtml = html;
        a.dataset.tooltipClass = "tnx-dict-tooltip";
    }
}
