/**
 * @fileoverview チャットカードの段を JS から組むための共通部品(統一規格・2026-09-05)。
 *
 * カードの多くは投稿後にフックが中身をライブ描画する(ダメージの台帳・対決の状態領域・
 * 状態の解決結果など)。**そのとき組む段も、テンプレートの部品(templates/chat/parts/card*.hbs)と
 * 同じ形にする**——各所で `document.createElement` して独自にクラスを並べると、
 * 「同じ役割の段が場所ごとに別物」という食い違いがまた生まれる(2026-09-05 ユーザー指摘
 * 「別々の場所で別々に作っているからこういうことになるのではないですか？」)。
 *
 * 文字列は**組み立て済みの HTML 断片**を受け取る(エスケープは呼び出し側の責任——
 * 値にアイコンやスート記号を入れる箇所があるため)。折ってはいけない塊の nowrap は
 * ここで一括して掛けるので、呼び出し側で keepTogether を書かない。
 */

import { keepTogether } from "./chat-text.mjs";

/**
 * 段: ラベル＝値の1行(card-field.hbs と同じ形)。
 * @param {string} label ラベル(HTML 断片)
 * @param {string} value 値(HTML 断片)
 * @param {{modifier?: string, valueModifier?: string}} [opts] 行/値の変種クラス
 * @returns {HTMLDivElement}
 */
export function cardField(label, value, { modifier = "", valueModifier = "" } = {}) {
    const div = document.createElement("div");
    div.className = `tnx-card__field${modifier ? ` ${modifier}` : ""}`;
    div.innerHTML = keepTogether(
        `<span class="tnx-card__field-label">${label}</span>`
        + `<span class="tnx-card__field-value${valueModifier ? ` ${valueModifier}` : ""}">${value}</span>`);
    return div;
}

/**
 * 段: 結果の行(card-result.hbs と同じ形)。
 * 行は flex(語間 gap つき)なので、**アイコン以外は1つの要素にまとめる**——折らない塊の span を
 * 直に並べると塊ごとに flex アイテムが分かれ、語の間に隙間が空く(2026-09-05)。
 * @param {string} inner 中身(HTML 断片。先頭の <i> はアイコンとして外に出す)
 * @param {{modifier?: string}} [opts]
 * @returns {HTMLDivElement}
 */
export function cardResult(inner, { modifier = "" } = {}) {
    const div = document.createElement("div");
    div.className = `tnx-card__result${modifier ? ` ${modifier}` : ""}`;
    div.innerHTML = keepTogether(inner).replace(
        /^(\s*<i[^>]*><\/i>)?([\s\S]*)$/,
        (_m, icon, rest) => `${icon ?? ""}<span class="tnx-card__result-text">${rest}</span>`);
    return div;
}

/**
 * 段: 畳める段(card-fold.hbs と同じ形)。**常に畳んだ状態で作る**(open を付けない)。
 * @param {string} label 見出しのラベル(HTML 断片)
 * @param {string} value 見出しに添える値(HTML 断片・省略可)
 * @param {string} body 中身(HTML 断片)
 * @param {{modifier?: string}} [opts]
 * @returns {HTMLDetailsElement}
 */
export function cardFold(label, value, body, { modifier = "" } = {}) {
    const el = document.createElement("details");
    el.className = `tnx-card__fold${modifier ? ` ${modifier}` : ""}`;
    el.innerHTML = keepTogether(
        `<summary class="tnx-card__field tnx-card__fold-summary">`
        + `<span class="tnx-card__field-label">${label}</span>`
        + (value ? `<span class="tnx-card__field-value">${value}</span>` : "")
        + `</summary><div class="tnx-card__fold-body">${body}</div>`);
    return el;
}

/**
 * 段: カード本体の長文(card-text.hbs と同じ形)。畳まない。
 * @param {string} content 長文(エンリッチ済み HTML)
 * @param {{modifier?: string}} [opts]
 * @returns {HTMLDivElement}
 */
export function cardText(content, { modifier = "" } = {}) {
    const div = document.createElement("div");
    div.className = `tnx-card__text${modifier ? ` ${modifier}` : ""}`;
    div.innerHTML = content;
    return div;
}
