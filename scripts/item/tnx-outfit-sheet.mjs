import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";

export class TokyoNovaOutfitSheet extends ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "outfit"],
            template: "systems/tokyo-nova-axleration/templates/item/outfit-sheet.hbs",
            width: 650,
            height: 700,
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "details" },
            ]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        const system = this.item.system;
        context.system = system;

        // エフェクト対応
        EffectsSheetMixin.prepareEffectsContext(this.item, context);
        context.enrichedDescription = await TextEditor.enrichHTML(system.description, { async: true, relativeTo: this.item });

        // カテゴリ選択肢の生成
        context.majorCategories = CONFIG.TNX.outfitMajorCategories;
        
        // 現在の大分類に基づいて小分類の選択肢を絞り込み
        const availableMinors = CONFIG.TNX.outfitCategoryMap[system.majorCategory] || [];
        context.minorCategories = {};
        availableMinors.forEach(key => {
            context.minorCategories[key] = CONFIG.TNX.outfitMinorCategories[key];
        });

        // 入力項目の表示制御フラグ設定
        this._prepareInputFlags(context, system);

        return context;
    }

    /**
     * カテゴリに応じて表示すべき入力項目を判定する
     */
    _prepareInputFlags(context, system) {
        const major = system.majorCategory;
        const minor = system.minorCategory;

        // 基本フラグ（全般）
        context.hasAttack = ["weapon", "vehicle"].includes(major) || ["fullBody", "livingWeapon"].includes(minor);
        context.hasDefence = ["armor", "vehicle"].includes(major) || ["fullBody", "livingArmor"].includes(minor);
        context.hasCyber = ["cyberware", "tron"].includes(major) || ["livingWeapon", "livingArmor"].includes(minor);
        context.hasHousing = major === "housing";
        context.hasVehicle = major === "vehicle";
        context.hasTron = major === "tron";

        // 細分化されたフラグ
        context.showGuard = context.hasAttack && major !== "vehicle"; // 受け値
        context.showRange = context.hasAttack;
        context.showSlot = ["weapon", "tron", "vehicle", "housing"].includes(major) || ["ianus", "ianusOption", "livingWeapon"].includes(minor);
        context.showControlMod = ["armor", "vehicle"].includes(major) || ["ianus", "livingArmor"].includes(minor);
        context.showIanus = minor === "ianus";
        context.showTronSlots = ["tap", "software", "hardware"].includes(minor);
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;

        // エフェクト関連のリスナー
        EffectsSheetMixin.activateEffectListListeners(html, this.item);

        // 大分類変更時に小分類をリセットする処理
        html.find('select[name="system.majorCategory"]').on('change', this._onMajorCategoryChange.bind(this));
    }

    async _onMajorCategoryChange(event) {
        const newMajor = event.currentTarget.value;
        // マップから新しい小分類のリストを取得し、その先頭をデフォルト値とする
        const minors = CONFIG.TNX.outfitCategoryMap[newMajor];
        const defaultMinor = minors ? minors[0] : "-";
        
        await this.item.update({
            "system.majorCategory": newMajor,
            "system.minorCategory": defaultMinor
        });
    }
}