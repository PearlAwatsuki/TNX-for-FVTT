/** 履歴保存・同期の再描画でも、現在入力中の行・値・選択範囲を引き継ぐ。 */
export function HistoryInputStateMixin(Base) {
    return class extends Base {
        _preSyncPartState(partId, newElement, priorElement, state) {
            super._preSyncPartState(partId, newElement, priorElement, state);
            const input = priorElement.querySelector(".history-input:focus");
            if (!input) return;
            state.focus = `.history-input[data-id="${CSS.escape(input.dataset.id)}"][data-field="${CSS.escape(input.dataset.field)}"]`;
            state.historyInput = {
                value: input.value,
                start: input.selectionStart,
                end: input.selectionEnd,
                direction: input.selectionDirection,
            };
        }

        _syncPartState(partId, newElement, priorElement, state) {
            const input = state.historyInput ? newElement.querySelector(state.focus) : null;
            // フォーカスを当てる前に未保存の入力を戻す。別の欄の保存結果で上書きしない。
            if (input) input.value = state.historyInput.value;
            super._syncPartState(partId, newElement, priorElement, state);
            if (input && state.historyInput.start !== null) {
                input.setSelectionRange(state.historyInput.start, state.historyInput.end, state.historyInput.direction);
            }
        }
    };
}
