/**
 * @fileoverview ダイアログの置き場。
 *
 * **中止の表し方(2026-09-07 統一)**: DialogV2 はボタンのコールバックの戻り値が nullish のとき
 * **ボタンの action 文字列**で解決する(`callback() ?? action`)。したがって
 * `callback: () => null` と書くと、キャンセルが文字列 `"cancel"` として届く——truthy なので
 * `if (!result)` を素通りする。実際に 2026-08-14(参加者の記録が全件削除)と 2026-09-07(KI-052・
 * キャンセルでも使用回数を消費)の 2 度、実機で事故になっている。
 *
 * よってキャンセルは **`callback: () => false`** と書く(`false ?? action` は `false` のまま)。
 * 呼び出し側の契約は次のとおり:
 *   - `false` … キャンセルボタン
 *   - `null`  … × で閉じた(`close: () => null`)
 *   - それ以外 … 確定した値
 * 確定値が **0 や空文字になりうる**場合は falsy 判定では中止と区別できない。
 * `Number.isInteger(res)` のように**確定値の形**で判定すること。
 *
 * action 文字列そのものを戻り値の protocol にしている箇所(カット終了の "scene"/"cut" 等)は
 * 意図的な設計なのでこの限りではない。
 */

import { DISABLED_TRIGGER_CLASS } from "./ui-trigger-disable.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * number-input-spinner の ± ボタン用の共通 DialogV2 アクション。
 * step 後に input イベントを発火する(ライブプレビュー等のリスナーへ変更を伝えるため)。
 */
export const spinnerDialogActions = {
    decrement: (_event, target) => {
        const input = target.closest(".number-input-spinner")?.querySelector("input[type='number']");
        input?.stepDown();
        input?.dispatchEvent(new Event("input", { bubbles: true }));
    },
    increment: (_event, target) => {
        const input = target.closest(".number-input-spinner")?.querySelector("input[type='number']");
        input?.stepUp();
        input?.dispatchEvent(new Event("input", { bubbles: true }));
    },
};

/**
 * 数値を入力させるための汎用ダイアログ。
 * allowOverride(2026-07-14): 「上書き」チェックボックスを表示し、戻り値を
 * `{ value, override }` にする(加減算か上書きかは呼び出し側が解釈する)。
 */
export class AmountInputDialog {
    static async prompt({title, label, initialValue = 1, min = 1, max = 99, okLabel = "ドロー", allowOverride = false, overrideLabel = "上書き（入力値をそのまま新しい値にする）"}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs";
        const content = await foundry.applications.handlebars.renderTemplate(template, { label, initialValue, min, max, allowOverride, overrideLabel });

        const result = await DialogV2.wait({
            window: { title },
            classes: ["tokyo-nova", "tnx-amount-dialog"],
            position: { width: 480 },
            content,
            actions: spinnerDialogActions,
            buttons: [
                {
                    action: "ok",
                    icon: "fas fa-check",
                    label: okLabel,
                    default: true,
                    callback: (_event, _button, dialog) => ({
                        value: parseInt(dialog.element.querySelector('input[name="amount"]')?.value),
                        override: dialog.element.querySelector('input[name="override"]')?.checked === true,
                    }),
                },
                {
                    action: "cancel",
                    icon: "fas fa-times",
                    label: "キャンセル",
                    callback: () => false,
                },
            ],
            close: () => null,
        });

        // 中止はキャンセル=false / × で閉じる=null。確定のときだけオブジェクトが返る
        if (!result) return null;
        if (isNaN(result.value) || result.value < min) {
            ui.notifications.warn(`入力値は${min}以上である必要があります。`);
            return null;
        }
        return allowOverride ? result : result.value;
    }
}

/**
 * 複数の選択肢から一つを選ばせるための汎用ダイアログ。
 */
export class TargetSelectionDialog {
    static async prompt({title, label, options, selectLabel = "決定", width = 360}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs";
        const content = await foundry.applications.handlebars.renderTemplate(template, { label, options });

        return DialogV2.wait({
            window: { title },
            classes: ["tokyo-nova", "tnx-dialog"],
            position: { width },
            content,
            buttons: [
                {
                    action: "select",
                    icon: "fas fa-check",
                    label: selectLabel,
                    default: true,
                    callback: (_event, _button, dialog) => {
                        const form = dialog.element.querySelector("form");
                        return new FormData(form).get("selection");
                    },
                },
                {
                    action: "cancel",
                    icon: "fas fa-times",
                    label: "キャンセル",
                    callback: () => false,
                },
            ],
            close: () => null,
        });
    }
}

/**
 * グリッド表示されたカードから複数を選択させるダイアログ。
 * card-selection-dialog.hbs は label ラップ構造のため JS イベントハンドラ不要。
 */
export class CardSelectionDialog {
    static async prompt({title, content, cards, passLabel = "渡す"}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs";
        const html = await foundry.applications.handlebars.renderTemplate(template, { content, cards });

        return DialogV2.wait({
            window: { title },
            classes: ["tokyo-nova"],
            content: html,
            buttons: [
                {
                    action: "pass",
                    icon: "fas fa-check",
                    label: passLabel,
                    default: true,
                    callback: (_event, _button, dialog) =>
                        Array.from(dialog.element.querySelectorAll('input[name="cardIds"]:checked')).map(cb => cb.value),
                },
                {
                    action: "cancel",
                    icon: "fas fa-times",
                    label: "キャンセル",
                    callback: () => false,
                },
            ],
            close: () => null,
        });
    }
}

/**
 * 切り札を配布する際に、対象ユーザーとカードを選択させるダイアログ。
 */
export class DealTrumpDialog {
    /**
     * @param {object} data
     * @param {User[]} data.users - 選択肢となるユーザーの配列。
     * @param {Card[]} data.cards - 選択肢となるカードの配列。
     * @returns {Promise<object|null>} ユーザーが「配布」を押した場合は {userId, cardId} を、キャンセルした場合は null を返す。
     */
    static async prompt({ users, cards }) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs";
        const cardOptions = cards.map(c => {
            const raw   = c.faces?.[0]?.name ?? c.name ?? "";
            const label = raw.replace(/<[^>]+>/g, '').match(/：(.+?)\s*\//)?.[1] ?? raw;
            return { id: c.id, label };
        });
        const html = await foundry.applications.handlebars.renderTemplate(template, { users, cards: cardOptions });

        return DialogV2.wait({
            window: { title: "配布先とカードを選択" },
            classes: ["tokyo-nova"],
            content: html,
            buttons: [
                {
                    action: "deal",
                    icon: "fas fa-check",
                    label: "配布",
                    default: true,
                    callback: (_event, _button, dialog) => {
                        const form = dialog.element.querySelector("form");
                        return new FormDataExtended(form).object;
                    },
                },
                {
                    action: "cancel",
                    icon: "fas fa-times",
                    label: "キャンセル",
                    callback: () => false,
                },
            ],
            close: () => null,
        });
    }
}

/**
 * 一覧から選ぶダイアログの行 HTML を組む(純粋・テスト対象)。
 *
 * 意匠は使用回数の消費ダイアログで確立した `tnx-uses-*` を共用する。従来この行の組み立てが
 * 修理・改造(対象/ドラッグ)・消費の各フローへコピーされており、`tnx-uses-dialog` という
 * 「使用回数」由来のクラス名まで一緒に運ばれていた(2026-09-07 一本化)。
 *
 * @param {Array<{value:string, label:string, sub?:string, disabled?:string,
 *                checked?:boolean, trailing?:string, trailingWarn?:boolean}>} options
 *   disabled=不可理由(あればグレーアウト＋tooltip＋選択不可)・trailing=右端の補助表示
 * @param {{multi?:boolean, name?:string}} [opts] multi=複数選択(チェックボックス)
 * @returns {string}
 */
export function buildSelectionRowsHtml(options, { multi = false, name = "sel" } = {}) {
    const esc = foundry.utils.escapeHTML;
    const list = options ?? [];
    // 単一選択で誰も指定が無ければ、選べる最初の 1 つを既定にする
    const autoIndex = (!multi && !list.some(o => o?.checked))
        ? list.findIndex(o => o && !o.disabled) : -1;
    return list.map((o, i) => {
        if (!o) return "";
        const off  = !!o.disabled;
        const on   = off ? false : (o.checked === true || i === autoIndex);
        const cls  = `tnx-uses-row${off ? ` ${DISABLED_TRIGGER_CLASS}` : ""}`;
        const tip  = off ? ` title="${esc(o.disabled)}"` : "";
        const sub  = o.sub ? `（${esc(o.sub)}）` : "";
        const tail = o.trailing
            ? `<span class="tnx-uses-count${o.trailingWarn ? " tnx-uses-out" : ""}">${esc(o.trailing)}</span>`
            : "";
        return `<div class="${cls}"${tip}><label>`
            + `<input type="${multi ? "checkbox" : "radio"}" name="${esc(name)}" value="${esc(o.value)}"`
            + `${on ? " checked" : ""}${off ? " disabled" : ""}>`
            + `<span>${esc(o.label)}${sub}</span></label>${tail}</div>`;
    }).join("");
}

/**
 * 一覧から選ぶ汎用ダイアログ(単一=ラジオ / 複数=チェックボックス)。
 *
 * TargetSelectionDialog は `<select>` を出すため、「名前＋分類を並べ、選べないものを理由つきで
 * グレーアウトする」形には合わなかった。合わないからと各フローでその場に DialogV2 を書いた結果、
 * 同じ形が 4 箇所へ複製されていた——**抽象が狭いなら広げる**、が本クラス(2026-09-07)。
 *
 * 中止の判定について: DialogV2 はボタンのコールバックの戻り値が無いとき **action 文字列**を
 * 返す(v13 の公式ドキュメントは「識別子または戻り値」とだけ書いており曖昧だが、実機では
 * キャンセルの `null` が文字列 "cancel" として届くことが観測されている)。加えて × で閉じた
 * ときは `close` の戻り値になる。どちらでも誤らないよう、**確定時だけ包んだオブジェクトを返し、
 * それ以外は全て中止**として扱う。
 *
 * @param {object} opts
 * @param {string} opts.title  ウィンドウタイトル
 * @param {Array} opts.options {@link buildSelectionRowsHtml} の選択肢
 * @param {string} [opts.note] 一覧の上に出す説明
 * @param {boolean} [opts.multi=false]
 * @param {number} [opts.min=0]  複数選択の下限(下回ると理由を出して選び直し)
 * @param {number} [opts.max=0]  複数選択の上限(超えると理由を出して選び直し。0=無制限)
 * @param {string} [opts.minMessage] / @param {string} [opts.maxMessage] 既定文言の差し替え
 * @param {string} [opts.confirmLabel="決定"] / @param {string} [opts.confirmIcon="fas fa-check"]
 * @param {number} [opts.width=420]
 * @param {string} [opts.extraHtml] 一覧の後ろに足す固定の行(選択できない注記など)
 * @returns {Promise<?string|?string[]>} 単一=値 / 複数=値の配列。中止は null
 */
export class ListSelectionDialog {
    static async prompt({
        title, options = [], note = "", multi = false, min = 0, max = 0,
        minMessage = "", maxMessage = "", confirmLabel = "決定",
        confirmIcon = "fas fa-check", width = 420, extraHtml = "",
    }) {
        const name = multi ? "listSelectionMulti" : "listSelectionOne";
        const rows = buildSelectionRowsHtml(options, { multi, name });
        const head = note ? `<p class="tnx-uses-note">${foundry.utils.escapeHTML(note)}</p>` : "";
        const content = `<div class="tnx-uses-consume">${head}${rows}${extraHtml}</div>`;

        // 下限/上限を満たすまで選び直させる
        for (;;) {
            const res = await DialogV2.wait({
                window:   { title },
                classes:  ["tokyo-nova", "tnx-dialog", "tnx-uses-dialog"],
                position: { width },
                content,
                buttons: [
                    { action: "ok", icon: confirmIcon, label: confirmLabel, default: true,
                      // 確定だけを包んで返す(中止の識別を戻り値の形で行うため)
                      callback: (_e, _b, dialog) => ({ picked: multi
                          ? [...dialog.element.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value)
                          : (dialog.element.querySelector(`input[name="${name}"]:checked`)?.value ?? null) }) },
                    { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
                ],
                close: () => null,
            });
            if (!res || typeof res !== "object" || !("picked" in res)) return null;  // 中止
            const picked = res.picked;
            if (!multi) return picked ?? null;
            if (min > 0 && picked.length < min) {
                ui.notifications?.warn(minMessage || `${min} つ以上選んでください。`);
                continue;
            }
            if (max > 0 && picked.length > max) {
                ui.notifications?.warn(maxMessage || `選択できるのは最大 ${max} 個です。`);
                continue;
            }
            return picked;
        }
    }
}
