import { describe, it, expect, vi, afterEach } from "vitest";
import { HistoryInputStateMixin } from "../../scripts/ui/history-input-state.mjs";
afterEach(() => vi.unstubAllGlobals());

function setup({ field = "title", selection = 2, missing = false, history = true } = {}) {
    vi.stubGlobal("CSS", { escape: value => value });
    const before = { dataset: { id: "row-b", field }, value: "typing now",
        selectionStart: selection, selectionEnd: selection, selectionDirection: "none" };
    const after = { value: "old saved value", focus: vi.fn(), setSelectionRange: vi.fn() };
    const prior = { querySelector: () => history ? before : null };
    let selector;
    const next = { querySelector: query => { selector = query; return missing ? null : after; } };
    class Core {
        _preSyncPartState(_id, _next, _prior, state) { state.scrollPositions = [100]; }
        _syncPartState(_id, next, _prior, state) {
            if (state.focus) next.querySelector(state.focus)?.focus();
        }
    }
    const app = new (HistoryInputStateMixin(Core))();
    const state = {};
    app._preSyncPartState("main", next, prior, state);
    app._syncPartState("main", next, prior, state);
    return { after, state, selector };
}

describe("履歴入力中の再描画", () => {
    it("保存した欄ではなく、Tabやクリックで移動した先の行と欄へフォーカスを戻す", () => {
        const { selector, after, state } = setup();
        expect(selector).toBe('.history-input[data-id="row-b"][data-field="title"]');
        expect(after.focus).toHaveBeenCalledOnce();
        expect(state.scrollPositions).toEqual([100]);
    });
    it("再描画待ちの間に入力した未保存の文字とカーソル位置を保持する", () => {
        const { after } = setup();
        expect(after.value).toBe("typing now");
        expect(after.setSelectionRange).toHaveBeenCalledWith(2, 2, "none");
    });
    it.each(["date", "exp"])("%sの入力は非対応の選択範囲APIを呼ばずフォーカスだけ戻す", field => {
        const { after } = setup({ field, selection: null });
        expect(after.focus).toHaveBeenCalledOnce();
        expect(after.setSelectionRange).not.toHaveBeenCalled();
    });
    it("対象行が削除された場合は他の行へフォーカスを移さない", () => {
        const { after } = setup({ missing: true });
        expect(after.focus).not.toHaveBeenCalled();
    });
    it("履歴以外にフォーカスがある場合はコアの処理を変更しない", () => {
        const { after, state } = setup({ history: false });
        expect(state.historyInput).toBeUndefined();
        expect(after.value).toBe("old saved value");
        expect(after.focus).not.toHaveBeenCalled();
    });
});
