/**
 * @fileoverview 辞典カードのデータビルダー(フェーズ16-2)。
 *
 * 辞典ブラウザの種別別カードと、アクターシートのアイテム・ツールチップが**同じ部品**を使う
 * (2026-08-30 ユーザー指定=「辞典ブラウザ上と同じ形のカード型」)。描画テンプレートは
 * templates/app/dictionary-card.hbs(kind で出し分け)・本モジュールはそのデータ組み立て。
 *
 * 値の読みはすべて「実効値(total)があればそれ、無ければ素値」——所持アイテムのツールチップは
 * AE 込み実効値・辞典エントリ(AE 未適用)は素値になる(表示は全箇所実効値の規約)。
 *
 * 表示形式の裁定(2026-08-30・正本は Phase_16_Tasks_Detail):
 * - スタイル技能/アウトフィット = ルルブのデータカード形式の踏襲(名前ヘッダ＋略号パラメータ行＋解説)
 * - 一般技能 = D&D の状態異常ツールチップに近い形(タイトル＋種別タグ＋本文・横幅広め)
 * - スタイル = スタイルデータ形式の骨格(キャッチコピーなし・神業ライブ合成・能力値/制御値)
 * - 神業 = 名前(ふりがな)・使用回数・条件・解説(種別フラグは出さない=便宜的な内部分類)
 */

import { TnxSkillUtils } from "./tnx-skill-utils.mjs";
import { decoratedItemName } from "./identification.mjs";
import { buildOutfitSummaryRows } from "./outfit-view.mjs";
import { getMajorCategoryLabel, getMinorCategoryLabel, OUTFIT_TYPES } from "../data/item/outfit-categories.mjs";
import { ONOMASTIC_TYPES, SOCIETY_CLASSES, onomasticTypeOf } from "./skill-dictionary.mjs";

/** 辞典カードの描画テンプレート(ブラウザ・ツールチップ共用) */
export const DICTIONARY_CARD_TEMPLATE = "systems/tokyo-nova-axleration/templates/app/dictionary-card.hbs";

/**
 * アイテム(相当)から辞典カードの kind を判定する。カード対象外は null。
 * @param {{type?: string}} item
 * @returns {?("outfit"|"styleSkill"|"generalSkill"|"style"|"miracle"|"organization")}
 */
export function cardKindOf(item) {
    const type = item?.type ?? "";
    if (type === "styleSkill") return "styleSkill";
    if (type === "generalSkill") return "generalSkill";
    if (type === "style") return "style";
    if (type === "miracle") return "miracle";
    if (type === "organization") return "organization";
    if (OUTFIT_TYPES.has(type)) return "outfit";
    return null;
}

/** 分類ラベル(大分類／小分類・副分類は「＋」で列挙)。 */
function categoryLabel(system) {
    const fmt = (major, minor) => {
        const M = getMajorCategoryLabel(major);
        const m = getMinorCategoryLabel(minor);
        return M && m ? `${M}／${m}` : (M || m || "");
    };
    const primary = fmt(system.majorCategory, system.minorCategory) || "-";
    const extras = (system.additionalCategories ?? []).map((r) => fmt(r?.major, r?.minor)).filter(Boolean);
    return extras.length ? `${primary} ＋ ${extras.join(" ＋ ")}` : primary;
}

/**
 * アウトフィットカード(ルルブ形式: 名前＋略号パラメータ行＋解説)。
 * @param {{name: string, img?: string, type: string, system: object}} item
 * @param {{resolveHostName?: ?(key: string)=>string, partSlotsCtx?: ?Array, partAdded?: Array, areaMods?: ?object}} [opts]
 * @returns {object} dictionary-card.hbs 用データ
 */
export function buildOutfitCard(item, { resolveHostName = null, partSlotsCtx = null, partAdded = [], areaMods = null } = {}) {
    const system = item.system ?? {};
    return {
        kind: "outfit",
        img: item.img,
        name: decoratedItemName(item),
        subtitle: categoryLabel(system),
        rows: buildOutfitSummaryRows(system, item.type, { areaMods, resolveHostName, partSlotsCtx, partAdded }),
        description: system.description ?? "",
    };
}

/**
 * スタイル技能カード(ルルブ形式: 名前＋技能/上限/タイミング/対象/射程/目標値/対決＋解説)。
 * @param {{name: string, img?: string, type: string, system: object}} item
 * @param {{skillNames?: Record<string,string>, styleNames?: Record<string,string>}} [opts]
 * @returns {object}
 */
export function buildStyleSkillCard(item, { skillNames = {}, styleNames = {} } = {}) {
    const system = item.system ?? {};
    const options = TnxSkillUtils.getSkillOptions();
    const view = TnxSkillUtils.prepareStyleSkillView(system, options, skillNames);
    return {
        kind: "styleSkill",
        img: item.img,
        name: decoratedItemName(item),
        furigana: system.furigana ?? "",
        subtitle: styleNames[system.style] ?? "",
        rows: [
            { label: "技能", value: view.comboSkill || "-" },
            { label: "上限", value: String(view.maxLevel ?? "-") },
            { label: "タイミング", value: view.timing || "-", full: true },
            { label: "対象", value: view.target || "-" },
            { label: "射程", value: view.range || "-" },
            { label: "目標値", value: String(view.targetValue ?? "-") },
            { label: "対決", value: view.confrontation || "-" },
        ],
        description: system.description ?? "",
    };
}

/**
 * 一般技能カード(D&D の状態異常ツールチップに近い形: タイトル＋種別タグ＋パラメータ＋本文)。
 * @param {{name: string, img?: string, type: string, system: object}} item
 * @returns {object}
 */
export function buildGeneralSkillCard(item) {
    const system = item.system ?? {};
    const onom = onomasticTypeOf(system);
    const tags = [];
    if (system.generalSkillCategory === "initialSkill") tags.push("無条件取得技能");
    if (system.generalSkillCategory === "onomasticSkill") tags.push("固有名詞技能");
    if (onom) tags.push(ONOMASTIC_TYPES[onom]);
    const rows = [];
    if (onom === "society" && system.societyClass && SOCIETY_CLASSES[system.societyClass]) {
        rows.push({ label: "下位区分", value: SOCIETY_CLASSES[system.societyClass] });
    }
    if (onom === "craft" && system.craftCategory) {
        const label = getMajorCategoryLabel(system.craftCategory)
            ? `${getMajorCategoryLabel(system.craftCategory)}（大分類全体）`
            : getMinorCategoryLabel(system.craftCategory);
        if (label) rows.push({ label: "対応分類", value: label });
    }
    if (system.initialSkill?.initialSuit) {
        const suits = { spade: "スペード", club: "クラブ", heart: "ハート", diamond: "ダイヤ" };
        const suit = suits[system.initialSkill.initialSuit];
        if (suit) rows.push({ label: "初期スート", value: suit });
    }
    const traits = [];
    if (system.isAction === true) traits.push("アクション技能");
    if (system.usesBounty === true) traits.push("報酬点を使用可能");
    if (traits.length) rows.push({ label: "特性", value: traits.join("・") });
    return {
        kind: "generalSkill",
        img: item.img,
        name: decoratedItemName(item),
        tags,
        rows,
        description: system.description ?? "",
    };
}

/**
 * 神業カード(2026-08-30 裁定: 名前(ふりがな)・使用回数・条件・解説。種別フラグは出さない)。
 * @param {{name: string, img?: string, system: object}} item
 * @returns {object}
 */
export function buildMiracleCard(item) {
    const system = item.system ?? {};
    const max = system.uses?.maxTotal ?? system.uses?.max ?? "";
    const rows = [];
    if (max !== "" && max !== null && max !== undefined) rows.push({ label: "使用回数", value: `${max} 回` });
    return {
        kind: "miracle",
        img: item.img,
        name: item.name ?? "",
        furigana: system.furigana ?? "",
        rows,
        description: system.description ?? "",
        // 条件はリッチテキスト(HTML)のことがあるため rows でなく専用枠で描画する
        condition: system.usageCondition ?? "",
    };
}

/**
 * スタイルカード(スタイルデータ形式の骨格: イラスト＋英名＋解説＋能力値/制御値。
 * キャッチコピーは持たない=2026-08-30 裁定。**神業は載せない**=2026-08-31 ユーザー指摘
 * 「神業タブが別にあるのに神業を載せる意味が分からない」・当初の合成案は撤回)。
 * @param {{name: string, img?: string, system: object}} item
 * @returns {object}
 */
export function buildStyleCard(item) {
    const system = item.system ?? {};
    const ab = (f) => ({ value: f?.value ?? 0, control: f?.control ?? 0 });
    return {
        kind: "style",
        img: item.img,
        name: item.name ?? "",
        nameEn: system.nameEn ?? "",
        abilities: [
            { label: "理性", ...ab(system.reason) },
            { label: "感情", ...ab(system.passion) },
            { label: "生命", ...ab(system.life) },
            { label: "外界", ...ab(system.mundane) },
        ],
        description: system.description ?? "",
    };
}

/**
 * オーガニゼーションカード(名前＋解説のシンプルな形)。
 * @param {{name: string, img?: string, system: object}} item
 * @returns {object}
 */
export function buildOrganizationCard(item) {
    return {
        kind: "organization",
        img: item.img,
        name: item.name ?? "",
        rows: [],
        description: item.system?.description ?? "",
    };
}

/**
 * アイテム(相当)から kind に応じたカードを組み立てる(ディスパッチャ)。
 * @param {{name: string, img?: string, type: string, system: object}} item
 * @param {object} [opts] 各ビルダーへの追加文脈(skillNames/styleNames/resolveHostName 等)
 * @returns {Promise<?object>} カードデータ(対象外は null)
 */
export async function buildDictionaryCard(item, opts = {}) {
    const kind = cardKindOf(item);
    if (!kind) return null;
    let card = null;
    switch (kind) {
        case "outfit":       card = buildOutfitCard(item, opts); break;
        case "styleSkill":   card = buildStyleSkillCard(item, opts); break;
        case "generalSkill": card = buildGeneralSkillCard(item); break;
        case "miracle":      card = buildMiracleCard(item); break;
        case "style":        card = buildStyleCard(item); break;
        case "organization": card = buildOrganizationCard(item); break;
    }
    if (!card) return null;
    // リッチテキストのエンリッチ(16-x): @UUID コンテンツリンク等を全カード面
    // (辞典ブラウザ・ツールチップ)で解決する(16-2 の申し送りの統合)
    const enrich = (t) => foundry.applications.ux.TextEditor.enrichHTML(t ?? "", { async: true });
    card.description = await enrich(card.description);
    if (card.condition) card.condition = await enrich(card.condition);
    return card;
}
