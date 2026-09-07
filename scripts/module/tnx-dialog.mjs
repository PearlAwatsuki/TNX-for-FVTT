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
                    callback: () => null,
                },
            ],
            close: () => null,
        });

        if (result === null) return null;
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
                    callback: () => null,
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
                    callback: () => null,
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
                    callback: () => null,
                },
            ],
            close: () => null,
        });
    }
}
