export const TnxHistoryMixin = {

    /**
     * V2 DEFAULT_OPTIONS.actions に展開して使うアクションハンドラ群。
     * this = シートインスタンス、target = data-action を持つ要素。
     */
    ACTIONS: {
        async addHistory(_event, _target) {
            const newId = foundry.utils.randomID();
            const newEntry = {
                id: newId,
                date: "",
                title: "",
                exp: 0,
                rl: "",
                players: "",
                origin: this.document?.uuid ?? "",
            };

            const updateData = {
                [`system.history.${newId}`]: newEntry
            };

            if (!this.document.system.exp) {
                updateData["system.exp"] = { value: 0, total: 0, spent: 0 };
            }

            await this._performHistoryUpdate(updateData);
        },

        async deleteHistory(_event, target) {
            const targetId = target.closest("[data-id]")?.dataset.id;
            if (!targetId) return;

            const historyMap = foundry.utils.deepClone(this.document.system.history || {});
            delete historyMap[targetId];

            const newTotal = TnxHistoryMixin._calculateTotalExp(historyMap);

            const updateData = { [`system.history.-=${targetId}`]: null };

            if (!this.document.system.exp) {
                updateData["system.exp"] = { value: 0, total: newTotal, spent: 0 };
            } else {
                updateData["system.exp.total"] = newTotal;
            }

            await this._performHistoryUpdate(updateData);
        },
    },

    /**
     * V2 の _onRender(el) から呼ぶ。history-input の change イベントを native DOM で登録する。
     */
    activateHistoryListeners(el) {
        for (const input of el.querySelectorAll(".history-input")) {
            input.addEventListener("change", (event) => TnxHistoryMixin._onHistoryChange.call(this, event));
        }
    },

    _calculateTotalExp(historyMap) {
        return Object.values(historyMap || {}).reduce((sum, entry) => {
            return sum + (Number(entry.exp) || 0);
        }, 0);
    },

    async _onHistoryChange(event) {
        const input = event.currentTarget;
        const targetId = input.dataset.id;
        const field = input.dataset.field;
        const value = input.type === "number" ? Number(input.value) : input.value;

        const historyMap = foundry.utils.deepClone(this.document.system.history || {});

        if (historyMap[targetId]) {
            historyMap[targetId][field] = value;

            const updateData = {};
            updateData[`system.history.${targetId}.${field}`] = value;

            if (field === "exp") {
                const newTotal = TnxHistoryMixin._calculateTotalExp(historyMap);

                if (!this.document.system.exp) {
                    updateData["system.exp"] = { value: 0, total: newTotal, spent: 0 };
                } else {
                    updateData["system.exp.total"] = newTotal;
                }
            }

            await this._performHistoryUpdate(updateData);
            if (field === "date") this.render();
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
