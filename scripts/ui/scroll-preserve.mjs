/**
 * @fileoverview 再描画でスクロール位置が飛ぶのを防ぐ共通処理(2026-07-21)。
 *
 * ApplicationV2 は変更のたびにパートを描き直すため、内部のスクロール領域が先頭へ戻る。
 * これは過去に用途シート・FS判定シート・アクトシート等で繰り返し起きた不具合なので、
 * 一箇所に集約する。使い方:
 *   async _preRender(...) { await super._preRender?.(...); this._scrollTop = captureScrollTop(this.element, SELECTOR); }
 *   _onRender(...) { super._onRender(...); restoreScrollTop(this.element, SELECTOR, this._scrollTop); }
 */

/**
 * スクロール領域の現在位置を取る(再描画前に呼ぶ)。
 * @param {?HTMLElement} root シートのルート要素(this.element)
 * @param {string} selector スクロールする要素のセレクタ
 * @returns {number}
 */
export function captureScrollTop(root, selector) {
    return root?.querySelector(selector)?.scrollTop ?? 0;
}

/**
 * スクロール位置を復元する(再描画後に呼ぶ)。要素はまだ描画途中のことがあるため
 * 次フレームで戻す。
 * @param {?HTMLElement} root シートのルート要素(this.element)
 * @param {string} selector スクロールする要素のセレクタ
 * @param {number} top captureScrollTop の戻り
 */
export function restoreScrollTop(root, selector, top) {
    if (!top) return;
    requestAnimationFrame(() => {
        const el = root?.querySelector(selector);
        if (el) el.scrollTop = top;
    });
}
