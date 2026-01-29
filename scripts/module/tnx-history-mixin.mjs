export const TnxHistoryMixin = {
    activateHistoryListeners(html) {
        html.find('.history-add').click(this._onHistoryAdd.bind(this));
        html.find('.history-delete').click(this._onHistoryDelete.bind(this));
        html.find('.history-input').change(this._onHistoryChange.bind(this));
    },

    /**
     * 履歴データの経験点合計を算出するヘルパー
     */
    _calculateTotalExp(historyMap) {
        return Object.values(historyMap || {}).reduce((sum, entry) => {
            return sum + (Number(entry.exp) || 0);
        }, 0);
    },

    /**
     * 行の追加
     */
    async _onHistoryAdd(event) {
        event.preventDefault();
        
        const newId = foundry.utils.randomID();
        const newEntry = { 
            id: newId, 
            date: "", 
            title: "", 
            exp: 0, // 新規行は0点なので合計には影響しないが、初期化は行う
            rl: "", 
            players: "" 
        };

        const updateData = {
            [`system.history.${newId}`]: newEntry
        };

        // expオブジェクトがない場合の安全策
        if (!this.document.system.exp) {
            updateData["system.exp"] = { value: 0, total: 0, spent: 0 };
        }

        await this._performHistoryUpdate(updateData);
    },

    /**
     * 行の削除
     */
    async _onHistoryDelete(event) {
        event.preventDefault();
        const targetId = event.currentTarget.dataset.id;
        if (!targetId) return;

        // 現在の履歴を取得して複製
        const historyMap = foundry.utils.deepClone(this.document.system.history || {});
        
        // 削除対象を除外
        delete historyMap[targetId];

        // 再集計
        const newTotal = this._calculateTotalExp(historyMap);

        const updateData = {
            [`system.history.-=${targetId}`]: null
        };

        // exp更新データの作成
        if (!this.document.system.exp) {
            updateData["system.exp"] = { value: 0, total: newTotal, spent: 0 };
        } else {
            updateData["system.exp.total"] = newTotal;
        }

        await this._performHistoryUpdate(updateData);
    },

    /**
     * 内容の変更
     */
    async _onHistoryChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const targetId = input.dataset.id;
        const field = input.dataset.field;
        const value = input.type === "number" ? Number(input.value) : input.value;

        // 現在の履歴を取得して複製
        const historyMap = foundry.utils.deepClone(this.document.system.history || {});
        
        if (historyMap[targetId]) {
            // 値を更新
            historyMap[targetId][field] = value;

            const updateData = {};
            updateData[`system.history.${targetId}.${field}`] = value;

            // 経験点が変更された場合、再集計して更新
            if (field === "exp") {
                const newTotal = this._calculateTotalExp(historyMap);
                
                if (!this.document.system.exp) {
                    updateData["system.exp"] = { value: 0, total: newTotal, spent: 0 };
                } else {
                    updateData["system.exp.total"] = newTotal;
                }
            }

            await this._performHistoryUpdate(updateData);
            if (field === "date") this.render(false);
        }
    },

    _prepareHistoryForDisplay(historyMap) {
        const historyArray = Object.values(historyMap || {});
        historyArray.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(a.date) - new Date(b.date);
        });
        return historyArray;
    }
};