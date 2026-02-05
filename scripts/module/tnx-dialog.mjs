/**
 * 新規山札作成時のオプション（デッキ数など）を確認するダイアログ。
 */
export class DeckCreationDialog {
    static async prompt() {
        const template = "systems/tokyo-nova-axleration/templates/dialog/deck-creation-dialog.hbs";
        const html = await renderTemplate(template, {});

        return new Promise((resolve) => {
            new Dialog({
                title: game.i18n.localize("TNX.CreateNewDeckDialogTitle"),
                content: html,
                buttons: {
                    create: {
                        icon: '<i class="fas fa-check"></i>',
                        label: game.i18n.localize("TNX.Create"),
                        callback: (html) => {
                            const form = html[0].querySelector("form");
                            const data = new FormDataExtended(form);
                            resolve(data.object);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                default: "create",
                close: () => resolve(null)
            }).render(true);
        });
    }
}

/**
 * 数値を入力させるための汎用ダイアログ。
 */
export class AmountInputDialog {
    static async prompt({title, label, initialValue = 1, min = 1, max = 99}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs";
        const templateData = { label, initialValue, min, max };
        const content = await renderTemplate(template, templateData);

        return new Promise(resolve => {
            new Dialog({
                title: title,
                content: content,
                buttons: {
                    ok: {
                        icon: '<i class="fas fa-check"></i>',
                        label: game.i18n.localize("TNX.Draw"),
                        callback: (html) => {
                            const amount = parseInt(html.find('input[name="amount"]').val());
                            if (isNaN(amount) || amount < min) {
                                ui.notifications.warn(`入力値は${min}以上である必要があります。`);
                                return;
                            }
                            resolve(amount);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                default: "ok",
                close: () => resolve(null)
            }).render(true);
        });
    }
}

/**
 * 複数の選択肢から一つを選ばせるための汎用ダイアログ。
 */
export class TargetSelectionDialog {
    static async prompt({title, label, options, selectLabel = "決定"}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs";
        const templateData = { label, options };
        const content = await renderTemplate(template, templateData);

        return new Promise(resolve => {
            new Dialog({
                title: title,
                content: content,
                buttons: {
                    select: {
                        icon: '<i class="fas fa-check"></i>',
                        label: selectLabel,
                        callback: html => resolve(new FormData(html[0].querySelector("form")).get("selection"))
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                default: "select",
                close: () => resolve(null)
            }).render(true);
        });
    }
}

/**
 * グリッド表示されたカードから複数を選択させるダイアログ。
 */
export class CardSelectionDialog {
    static async prompt({title, content, cards, passLabel = "渡す"}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs";
        const templateData = { content, cards };
        const html = await renderTemplate(template, templateData);

        return new Promise(resolve => {
            new Dialog({
                title: title,
                content: html,
                buttons: {
                    pass: {
                        icon: '<i class="fas fa-check"></i>',
                        label: passLabel,
                        callback: (html) => resolve(Array.from(html[0].querySelectorAll("input[name=cardIds]:checked")).map(cb => cb.value))
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                render: (html) => {
                    html.find('.card-selection-item').on('click', (ev) => {
                        const item = $(ev.currentTarget);
                        const cb = item.find('input');
                        cb.prop('checked', !cb.prop('checked'));
                        item.toggleClass('selected', cb.prop('checked'));
                    });
                }
            }).render(true);
        });
    }
}

/**
 * 画像付きの確認ダイアログ（切り札使用確認など）
 */
export class RichConfirmDialog {
    static async prompt({title, content, mainButtonLabel = "使用", img, description}) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/rich-confirm-dialog.hbs";
        const templateData = { content, img, description };
        const html = await renderTemplate(template, templateData);

        return new Promise(resolve => {
            new Dialog({
                title: title,
                content: html,
                buttons: {
                    yes: { icon: '<i class="fas fa-check"></i>', label: mainButtonLabel, callback: () => resolve(true) },
                    no: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("TNX.Cancel"), callback: () => resolve(false) }
                },
                default: "yes",
                render: (html) => html.closest('.dialog').css('height', 'auto'),
                close: () => resolve(false)
            }).render(true);
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
        const html = await renderTemplate(template, { actors, cards });

        return new Promise((resolve) => {
            new Dialog({
                title: game.i18n.localize("TNX.SelectTargetActorAndCardTitle"),
                content: html,
                buttons: {
                    deal: {
                        icon: '<i class="fas fa-check"></i>',
                        label: game.i18n.localize("TNX.Deal"),
                        callback: (html) => {
                            const form = html[0].querySelector("form");
                            const formData = new FormDataExtended(form);
                            resolve(formData.object);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                default: "deal",
                close: () => resolve(null)
            }).render(true);
        });
    }
}

/**
 * リンクされたアイテムの解除と、任意での削除を確認する汎用ダイアログ。
 * @export
 */
export class UnlinkConfirmDialog {
    /**
     * ダイアログを表示し、ユーザーの選択を待つ
     * @param {object} - options
     * @param {Document} options.linkedDoc - リンクされているドキュメントオブジェクト。名前の表示に使用。
     * @returns {Promise<string|null>} ユーザーの選択に応じて "delete"、"unlink"、または null(キャンセル)を返す。
     */
    static async prompt({ linkedDoc }) {
        const template = "systems/tokyo-nova-axleration/templates/dialog/unlink-confirm-dialog.hbs";
        const content = game.i18n.format("TNX.UnlinkAndConfirmDeleteContent", { cardsName: linkedDoc.name });
        const html = await renderTemplate(template, { content });

        return new Promise(resolve => {
            new Dialog({
                title: game.i18n.localize("TNX.UnlinkAndConfirmDeleteTitle"),
                content: html,
                buttons: {
                    delete: {
                        icon: '<i class="fas fa-trash-alt"></i>',
                        label: game.i18n.localize("TNX.UnlinkAndDelete"),
                        callback: () => resolve("delete")
                    },
                    unlink: {
                        icon: '<i class="fas fa-unlink"></i>',
                        label: game.i18n.localize("TNX.UnlinkOnly"),
                        callback: () => resolve("unlink")
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                default: "unlink",
                close: () => resolve(null)
            }).render(true);
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

        return new Promise(resolve => {
            new Dialog({
                title: "用途の追加",
                content: html,
                buttons: {
                    add: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "追加",
                        callback: (html) => {
                            const form = html[0].querySelector("form");
                            // FormDataExtendedを使用してフォームデータを取得
                            const formData = new FormDataExtended(form);
                            resolve(formData.object.type);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("TNX.Common.Cancel"),
                        callback: () => resolve(null)
                    }
                },
                default: "add",
                close: () => resolve(null)
            }).render(true);
        });
    }
}