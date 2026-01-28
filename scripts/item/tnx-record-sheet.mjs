import { TnxHistoryMixin } from "../module/tnx-history-mixin.mjs";

export class TokyoNovaRecordSheet extends ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "record"],
            template: "systems/tokyo-nova-axleration/templates/item/record-sheet.hbs",
            width: 800,
            height: 600,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "history" }]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        console.log(this.item.system);
        const system = this.item.system;
        context.system = system;
        
        const historyMap = this.item.system.history || {};
        context.history = TnxHistoryMixin._prepareHistoryForDisplay(historyMap);

        // 編集モードフラグ（アイテムシートは権限があれば編集可能とする）
        context.isEditMode = this.isEditable; 

        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;

        // Mixinのリスナー登録
        TnxHistoryMixin.activateHistoryListeners.call(this, html);
    }

    // Mixinのメソッド取り込み
    _prepareHistoryForDisplay = TnxHistoryMixin._prepareHistoryForDisplay;

    // イベントハンドラ
    _onHistoryAdd = TnxHistoryMixin._onHistoryAdd;
    _onHistoryDelete = TnxHistoryMixin._onHistoryDelete;
    _onHistoryChange = TnxHistoryMixin._onHistoryChange;

    async _getHistoryData() {
        return foundry.utils.deepClone(this.item.system.history || []);
    }

    /**
     * 履歴データの保存（レコードシート固有：自身の更新のみ）
     */
    async _saveHistoryData(newHistory) {
        await this.item.update({ "system.history": newHistory });
    }

    /**
     * 経験点合計の更新
     */
    async _updateExpTotal(diff) {
        const currentTotal = Number(this.item.system.exp.total) || 0;
        await this.item.update({
            "system.exp.total": currentTotal + diff
        });
    }

    /**
     * ▼▼▼ 実装: Mixinから呼ばれる更新処理 ▼▼▼
     * 単純に自分自身を更新するだけ
     */
    async _performHistoryUpdate(updateData) {
        await this.item.update(updateData);
    }
}