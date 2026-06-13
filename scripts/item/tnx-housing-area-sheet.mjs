import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

/**
 * 住宅エリア(housingArea)シート。
 *
 * 住宅エリアは厳密にはアウトフィットではなく、住宅施設(residence)に対する修正値の集合
 * (2026-06-13 ユーザー確定)。そのためアウトフィットシートではなく、説明 + 修正値のみの
 * 専用シートとする。実効値の算出(住宅施設 + 住宅エリア)はフェーズ6-6 で扱う。
 *
 * 数値入力は基底(TokyoNovaItemSheet)の incrementField / decrementField を使う。
 */
export class TokyoNovaHousingAreaSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "housing-area"],
        position: { width: 600, height: 650 },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/housing-area-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }],
            initial: "description",
        },
    };

    /** 修正値フィールドの表示順とラベル(ユーザー確定の住宅施設パラメータ順) */
    static MOD_FIELDS = [
        { key: "buyRatingMod",        label: "購入値" },
        { key: "preserveExpMod",      label: "常備化経験点" },
        { key: "hideMod",             label: "隠匿値" },
        { key: "appearanceTargetMod", label: "登場判定目標値" },
        { key: "cyberSecurityMod",    label: "電脳セキュリティ" },
        { key: "analogSecurityMod",   label: "アナログセキュリティ" },
        { key: "slotMod",             label: "スロット" },
    ];

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.modFields = this.constructor.MOD_FIELDS.map((m) => ({
            ...m,
            value: context.system[m.key] ?? 0,
        }));
        return context;
    }
}
