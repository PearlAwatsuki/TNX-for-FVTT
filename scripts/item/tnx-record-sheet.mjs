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
        console.log(this.item.toObject());
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
    _calculateTotalExp = TnxHistoryMixin._calculateTotalExp;

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
        // 現在のデータを取得
        const currentTotal = updateData["system.exp.total"] !== undefined 
            ? updateData["system.exp.total"] 
            : (Number(this.item.system.exp?.total) || 0);

        const currentSpent = updateData["system.exp.spent"] !== undefined
            ? updateData["system.exp.spent"]
            : (Number(this.item.system.exp?.spent) || 0);

        // Valueの再計算 (Total - Spent)
        const newValue = currentTotal - currentSpent;

        // updateDataにvalueを含める
        updateData["system.exp.value"] = newValue;

        await this.item.update(updateData);
    }

    async updateSharedSpent() {
        // このレコードシートをリンクしている全てのアクター（キャスト）を取得
        // ※ compendium内のアクターは対象外とし、ワールド内のアクターのみ対象とします
        const linkedActors = game.actors.filter(a => 
            a.type === 'cast' && a.system.recordSheetId === this.item.uuid
        );

        let totalSharedSpent = 0;

        for (const actor of linkedActors) {
            // 各キャストの「超過消費分」を計算する
            // 計算式: 実際の総消費 - (キャスト自身の履歴合計 + 追加点 + 初期値170)
            
            // A. 実際の総消費 (spent + 170)
            const actorRealSpent = (Number(actor.system.exp.spent) || 0) + 170;

            // B. キャスト自身の保有リソース
            // 履歴合計
            const history = actor.system.history || {};
            const historyTotal = Object.values(history).reduce((sum, entry) => sum + (Number(entry.exp) || 0), 0);
            // 追加点
            const additional = Number(actor.system.exp.additional) || 0;
            // 初期値
            const initial = 170;

            const actorOwnedTotal = historyTotal + additional + initial;

            // C. 超過分 (0未満にはならない)
            const overflow = Math.max(0, actorRealSpent - actorOwnedTotal);

            totalSharedSpent += overflow;
        }

        // 現在の値と比較して変更があれば更新
        const currentSpent = Number(this.item.system.exp.spent) || 0;
        const currentTotal = Number(this.item.system.exp.total) || 0;
        
        if (currentSpent !== totalSharedSpent) {
            const newValue = currentTotal - totalSharedSpent;
            
            // syncingオプションを付けて、無限ループ（再計算の連鎖）を防ぐ
            await this.item.update({
                "system.exp.spent": totalSharedSpent,
                "system.exp.value": newValue
            }, { syncing: true });
            
            console.log(`TNX | Updated Shared Record Spent: ${totalSharedSpent} (from ${linkedActors.length} actors)`);
        }
    }
}