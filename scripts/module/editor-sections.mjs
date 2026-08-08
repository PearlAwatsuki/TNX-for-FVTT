/**
 * @fileoverview tnx-editor-section(枠付きテキストエディタ)の共通配線。
 *
 * Foundry の toggled prose-mirror は編集トグルボタンをエリア右上に絶対配置し
 * hover 時のみ表示するため、枠の無い領域では編集導線が視認できない。
 * 本システムでは `.tnx-editor-section`(ヘッダー＋枠付きコンテンツ)で包み、
 * トグルボタンをヘッダーへ移設して常時表示する(item シートで確立した意匠。
 * アクトシートでも共用するためここに一本化)。
 */

/**
 * ルート要素配下の全 tnx-editor-section について、prose-mirror の編集トグル
 * ボタンをセクションヘッダーへ移設する。エディタを閉じるとボタンが
 * prose-mirror 内に再生成されるため、close のたびに移設し直す。
 * @param {HTMLElement} rootEl 走査のルート(シートの this.element)
 */
export function attachEditorSectionToggles(rootEl) {
    if (!rootEl) return;
    for (const section of rootEl.querySelectorAll(".tnx-editor-section")) {
        const header = section.querySelector(".tnx-editor-section__header");
        const pm = section.querySelector(".tnx-editor-section__content prose-mirror");
        if (!header || !pm) continue;
        const move = () => {
            const btn = pm.querySelector("button.toggle");
            if (btn) header.appendChild(btn);
        };
        requestAnimationFrame(move);
        pm.addEventListener("close", () => requestAnimationFrame(move));
    }
}
