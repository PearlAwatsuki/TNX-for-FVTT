export const TnxHistoryMixin = {
    activateHistoryListeners(html) {
        html.find('.history-add').click(this._onHistoryAdd.bind(this));
        html.find('.history-delete').click(this._onHistoryDelete.bind(this));
        html.find('.history-input').change(this._onHistoryChange.bind(this));
    },

    /**
     * 行の追加
     */
    async _onHistoryAdd(event) {
        event.preventDefault();
        
        // ユニークID生成
        const newId = foundry.utils.randomID();
        const newEntry = { 
            id: newId, 
            date: "", 
            title: "", 
            exp: 0, 
            rl: "", 
            players: "" 
        };

        const updateData = {
            [`system.history.${newId}`]: newEntry
        };

        // ▼▼▼ 修正: 各クラスで実装する更新メソッドに委譲 ▼▼▼
        await this._performHistoryUpdate(updateData);
    },

    /**
     * 行の削除
     */
    async _onHistoryDelete(event) {
        event.preventDefault();
        const targetId = event.currentTarget.dataset.id;
        if (!targetId) return;

        // 削除対象データの取得（計算用）
        const historyData = this.document.system.history || {};
        const entry = historyData[targetId];

        const updateData = {
            [`system.history.-=${targetId}`]: null
        };

        // Exp計算 (Itemシート単体利用時のため計算して渡す)
        if (entry) {
            const exp = Number(entry.exp) || 0;
            if (exp !== 0) {
                const currentTotal = Number(this.document.system.exp.total) || 0;
                updateData["system.exp.total"] = currentTotal - exp;
            }
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

        const historyData = this.document.system.history || {};
        const entry = historyData[targetId];

        if (entry) {
            const updateData = {};
            updateData[`system.history.${targetId}.${field}`] = value;

            // Exp変更時の差分計算
            if (field === "exp") {
                const oldExp = Number(entry.exp) || 0;
                const newExp = Number(value) || 0;
                const diff = newExp - oldExp;
                
                if (diff !== 0) {
                    const currentTotal = Number(this.document.system.exp.total) || 0;
                    updateData["system.exp.total"] = currentTotal + diff;
                }
            }

            await this._performHistoryUpdate(updateData);
            if (field === "date") this.render(false);
        }
    },

    /**
     * 表示用ヘルパー
     */
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