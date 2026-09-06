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
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";

const SCOPE = "tokyo-nova-axleration";

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

/**
 * 種別タグの文字列を幅の上限に収める。上限に入りきらない種別名は**横に縮める**
 * (2026-09-06 ユーザー指示「タグの表示幅を固定にして、入りきらない場合はX拡縮」
 *  ＋「固定幅は上限です」。上限＝一番長い「アーティフィシャルボディ」12文字が潰れない幅)。
 *
 * 縮めるのは中身の span だけで、枠(幅)は動かさない——タグが伸びると本体である名前を
 * 押し出してしまうため。カードを描いた後に呼ぶ(renderChatMessageHTML)。
 * @param {HTMLElement|Document} root 走査の起点
 */
export function fitCardTags(root) {
    for (const text of root?.querySelectorAll?.(".tnx-card__tag-text") ?? []) {
        const box = text.parentElement;
        if (!box) continue;
        text.style.transform = "";
        const style = getComputedStyle(box);
        const avail = box.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
        const natural = text.getBoundingClientRect().width;
        // 誤差(小数の丸め)で全部のタグに倍率が付くのを避ける。実際にはみ出した分だけ縮める
        if (!(avail > 0) || !(natural > 0) || natural <= avail + 0.5) continue;
        // 下限を置く(これ以上潰すと読めない。実際の種別名はここまで長くならない)
        text.style.transform = `scaleX(${Math.max(0.45, avail / natural).toFixed(3)})`;
    }
}

/**
 * 段: 帰結行(check-result.hbs の登場/購入/開示と同じ形)。
 * 「その使用の結果、実際に何が起きたか」を1行で示す段。
 * 結果の行と同じく**アイコン以外は1つの要素にまとめる**(行は flex で語間 gap があるため、
 * 折らない塊の span を直に並べると塊ごとに flex アイテムが分かれて語の間が空く)。
 * @param {string} inner 中身(HTML 断片。先頭の <i> はアイコンとして外に出す)
 * @param {{modifier?: string}} [opts]
 * @returns {HTMLDivElement}
 */
export function cardOutcome(inner, { modifier = "" } = {}) {
    const div = document.createElement("div");
    div.className = `tnx-card__outcome${modifier ? ` ${modifier}` : ""}`;
    div.innerHTML = keepTogether(inner).replace(
        /^(\s*<i[^>]*><\/i>)?([\s\S]*)$/,
        (_m, icon, rest) => `${icon ?? ""}<span class="tnx-card__outcome-text">${rest}</span>`);
    return div;
}

/**
 * 用途の帰結(治療・修理・改造)を、**その使用を表しているカード**へ刻む(2026-09-07 ユーザー指示)。
 * 帰結だけの短いカードを別に出さない——神業なら神業カード、宣言ならアイテムの解説カード、
 * 判定なら判定結果カードに、その効果として何が起きたかが出る。
 *
 * 保存するのは構造(アイコンと文)で、描画は `renderCardOutcome`(フック)が行う。**本文の書き換えでは
 * 刻まない**——投稿済みカードの content を後から組み直すと、再判定の置き換えなど他の本文更新と
 * 競合する(非作者の更新はソケット委譲で非同期に着地するため、古い本文で上書きしうる)。
 * @param {ChatMessage} message 刻む先のカード
 * @param {{icon?: string, text?: string}} outcome アイコン(Font Awesome のクラス)と文。
 *   文は**組み立て済みの HTML 断片**(この段の他の部品と同じ約束——エスケープと、囲みで閉じていない
 *   決まった言い回しの `nowrap` は呼び出し側の責任。囲みで閉じた語は描画時に一括で塊にする)
 */
export async function stampCardOutcome(message, { icon = "fa-circle-info", text = "" } = {}) {
    if (!message || !text) return;
    await TnxSocketHandler.applyMessagePatch(message, { icon, text }, "cardOutcome");
}

/** cardOutcome フラグを帰結行として描画する(renderChatMessageHTML・tnx.mjs から登録)。 */
export function renderCardOutcome(message, html) {
    const outcome = message.getFlag(SCOPE, "cardOutcome");
    const card = html?.querySelector?.(".tnx-card");
    if (!outcome?.text || !card || card.querySelector(".tnx-card__outcome--stamped")) return;
    const icon = String(outcome.icon || "fa-circle-info").replace(/[^a-z0-9-]/gi, "");
    const body = card.querySelector(".tnx-card__body") ?? card;
    body.appendChild(cardOutcome(
        `<i class="fas ${icon}"></i> ${outcome.text}`,
        { modifier: "tnx-card__outcome--stamped" }));
}
