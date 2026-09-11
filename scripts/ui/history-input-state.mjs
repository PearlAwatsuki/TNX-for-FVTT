/** 履歴保存・同期の再描画でも、現在入力中の行・値・選択範囲を引き継ぐ。 */
export function HistoryInputStateMixin(Base) {
    return class extends Base {
        _preSyncPartState(partId, newElement, priorElement, state) {
            super._preSyncPartState(partId, newElement, priorElement, state);
            const input = priorElement.ownerDocument.activeElement;
            if (!priorElement.contains(input) || !input?.matches(".history-input")) return;
            state.focus = `.history-input[data-id="${CSS.escape(input.dataset.id)}"][data-field="${CSS.escape(input.dataset.field)}"]`;
            // キャストのタブ復帰は通常_onRenderまで遅れる。非表示の入力へはfocusできないため、
            // 新しいDOMを挿入する前に、入力中のタブの表示状態を引き継ぐ。
            const tab = input.closest(".tab[data-group][data-tab]");
            if (tab?.classList.contains("active")) {
                for (const next of newElement.querySelectorAll(".tab[data-group][data-tab]")) {
                    if (next.dataset.group === tab.dataset.group) {
                        next.classList.toggle("active", next.dataset.tab === tab.dataset.tab);
                    }
                }
            }
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
            // コアのfocus()によるスクロールの跳ねを避け、復元済みの位置でフォーカスする。
            super._syncPartState(partId, newElement, priorElement,
                state.historyInput ? { ...state, focus: undefined } : state);
            if (input) input.focus({ preventScroll: true });
            if (input && state.historyInput.start !== null) {
                input.setSelectionRange(state.historyInput.start, state.historyInput.end, state.historyInput.direction);
            }
        }
    };
}
