const { DialogV2 } = foundry.applications.api;

/**
 * 新規山札作成時のオプション（デッキ数など）を確認するダイアログ。
 */
export class DeckCreationDialog {
    static async prompt() {
        const template = "systems/tokyo-nova-axleration/templates/dialog/deck-creation-dialog.hbs";
        const content = await renderTemplate(template, {});

        return DialogV2.wait({
            window: { title: "新規デッキ作成" },
            classes: ["tokyo-nova"],
            content,
            buttons: [
                {
                    action: "create",
                    icon: "fas fa-check",
                    label: "作成",
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

/**
 * 数値を入力させるための汎用ダイアログ。
 */
export class AmountInputDialog {
    static async prompt({title, label, initialValue = 1, min = 1, max = 99}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs";
        const content = await renderTemplate(template, { label, initialValue, min, max });

        const result = await DialogV2.wait({
            window: { title },
            classes: ["tokyo-nova", "tnx-amount-dialog"],
            position: { width: 480 },
            content,
            actions: {
                decrement: (_event, target) => {
                    target.closest(".number-input-spinner")
                        ?.querySelector("input[type='number']")?.stepDown();
                },
                increment: (_event, target) => {
                    target.closest(".number-input-spinner")
                        ?.querySelector("input[type='number']")?.stepUp();
                },
            },
            buttons: [
                {
                    action: "ok",
                    icon: "fas fa-check",
                    label: "ドロー",
                    default: true,
                    callback: (_event, _button, dialog) => parseInt(dialog.element.querySelector('input[name="amount"]')?.value),
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
        if (isNaN(result) || result < min) {
            ui.notifications.warn(`入力値は${min}以上である必要があります。`);
            return null;
        }
        return result;
    }
}

/**
 * 複数の選択肢から一つを選ばせるための汎用ダイアログ。
 */
export class TargetSelectionDialog {
    static async prompt({title, label, options, selectLabel = "決定"}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs";
        const content = await renderTemplate(template, { label, options });

        return DialogV2.wait({
            window: { title },
            classes: ["tokyo-nova"],
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
        const html = await renderTemplate(template, { content, cards });

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
 * 画像付きの確認ダイアログ（切り札使用確認など）
 */
export class RichConfirmDialog {
    static async prompt({title, content, mainButtonLabel = "使用", img, description}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/rich-confirm-dialog.hbs";
        const html = await renderTemplate(template, { content, img, description });

        return DialogV2.wait({
            window: { title },
            classes: ["tokyo-nova"],
            content: html,
            buttons: [
                {
                    action: "yes",
                    icon: "fas fa-check",
                    label: mainButtonLabel,
                    default: true,
                    callback: () => true,
                },
                {
                    action: "no",
                    icon: "fas fa-times",
                    label: "キャンセル",
                    callback: () => false,
                },
            ],
            close: () => false,
        });
    }
}

/**
 * 切り札を配布する際に、対象アクターとカードを選択させるダイアログ。
 */
export class DealTrumpDialog {
    /**
     * @param {object} data
     * @param {Actor[]} data.actors - 選択肢となるアクターの配列。
     * @param {Card[]} data.cards - 選択肢となるカードの配列。
     * @returns {Promise<object|null>} ユーザーが「配布」を押した場合は {actorId, cardId} を、キャンセルした場合は null を返す。
     */
    static async prompt({ actors, cards }) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs";
        const cardOptions = cards.map(c => {
            const raw   = c.faces?.[0]?.name ?? c.name ?? "";
            const label = raw.replace(/<[^>]+>/g, '').match(/：(.+?)\s*\//)?.[1] ?? raw;
            return { id: c.id, label };
        });
        const html = await renderTemplate(template, { actors, cards: cardOptions });

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

/**
 * リンクされたアイテムの解除と、任意での削除を確認する汎用ダイアログ。
 */
export class UnlinkConfirmDialog {
    /**
     * ダイアログを表示し、ユーザーの選択を待つ
     * @param {object} options
     * @param {Document} options.linkedDoc - リンクされているドキュメントオブジェクト。名前の表示に使用。
     * @returns {Promise<string|null>} ユーザーの選択に応じて "delete"、"unlink"、または null(キャンセル)を返す。
     */
    static async prompt({ linkedDoc }) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/unlink-confirm-dialog.hbs";
        const content = `「${linkedDoc.name}」のリンクを解除します。デッキも一緒に削除しますか？`;
        const html = await renderTemplate(template, { content });

        return DialogV2.wait({
            window: { title: "リンク解除の確認" },
            classes: ["tokyo-nova"],
            content: html,
            buttons: [
                {
                    action: "delete",
                    icon: "fas fa-trash-alt",
                    label: "解除して削除",
                    callback: () => "delete",
                },
                {
                    action: "unlink",
                    icon: "fas fa-unlink",
                    label: "リンクのみ解除",
                    default: true,
                    callback: () => "unlink",
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
 * 用途（Action）を追加する際のダイアログ
 */
export class UsageCreationDialog {
    static async prompt({ usageTypes }) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/usage-creation-dialog.hbs";
        const html = await renderTemplate(template, { usageTypes });

        return DialogV2.wait({
            window: { title: "用途の追加" },
            classes: ["tokyo-nova"],
            content: html,
            buttons: [
                {
                    action: "add",
                    icon: "fas fa-check",
                    label: "追加",
                    default: true,
                    callback: (_event, _button, dialog) => {
                        const form = dialog.element.querySelector("form");
                        return new FormDataExtended(form).object.type;
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
