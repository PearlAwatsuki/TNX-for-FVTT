/**
 * @fileoverview Handlebars テンプレートの事前読み込み(2026-09-07 tnx.mjs から移設)。
 *
 * partial として使うテンプレートは参照される前に読み込まれている必要がある。一覧が長いのは
 * テンプレートの数だけ行が要るためで、システム起動の筋道とは読む理由が違う。
 */


export async function preloadHandlebarsTemplates() {
    const templatePaths = [
        // === Actor Sheets ===
        "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",

        // === Item Sheets ===
        "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/general-skill-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-skill-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/organization-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/life-path-sheet.hbs",

        // === Journal Sheets ===
        "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/journal/focus-system-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/parts/focus-system-editor.hbs",

        // === Chat ===
        // 判定結果系カードの基底部品(2026-07-19 基底化): 全カードが参照するためパーシャルとして先読み
        "systems/tokyo-nova-axleration/templates/chat/parts/check-card-row.hbs",
        "systems/tokyo-nova-axleration/templates/chat/parts/check-calc-rows.hbs",
        "systems/tokyo-nova-axleration/templates/chat/parts/info-disclose-outcome.hbs",
        "systems/tokyo-nova-axleration/templates/chat/scene-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/check-result.hbs",
        "systems/tokyo-nova-axleration/templates/chat/miracle-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/item-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/simple-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/derived-damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/check-request.hbs",
        "systems/tokyo-nova-axleration/templates/chat/attack-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/reaction-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/vehicle-move-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/rl-damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/condition-outcome.hbs",
        "systems/tokyo-nova-axleration/templates/chat/condition-prompt.hbs",

        // === App ===
        "systems/tokyo-nova-axleration/templates/parts/target-picker.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-request-app.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-damage.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-effect.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-bounty.hbs",
        "systems/tokyo-nova-axleration/templates/chat/bounty-grant.hbs",
        "systems/tokyo-nova-axleration/templates/chat/handout-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/scene-switch-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/text-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/info-card.hbs",
        "systems/tokyo-nova-axleration/templates/app/focus-system-panel.hbs",
        "systems/tokyo-nova-axleration/templates/app/focus-system-start.hbs",
        "systems/tokyo-nova-axleration/templates/chat/focus-system-start.hbs",
        "systems/tokyo-nova-axleration/templates/chat/focus-system-result.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs",

        // === Dialogs ===
        "systems/tokyo-nova-axleration/templates/dialog/check-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs",

        // === Partials ===
        // アクターシート共通部品(フェーズ11-2。cast/guest 等で共有・features フラグで差異をゲート)
        "systems/tokyo-nova-axleration/templates/actor/parts/sidebar.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/header.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-abilities.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-combat.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-outfits.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-status.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-history.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-profile.hbs",
        "systems/tokyo-nova-axleration/templates/parts/active-effects-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/card-setup-app.hbs",
        "systems/tokyo-nova-axleration/templates/parts/prosemirror-editor.hbs",
        "systems/tokyo-nova-axleration/templates/parts/history-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/usage-list.hbs",
        "systems/tokyo-nova-axleration/templates/item/parts/skill-traits.hbs",
        "systems/tokyo-nova-axleration/templates/parts/bad-status-list.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-combo.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-bonus-rows.hbs",
        // 辞典カード(16-2。ブラウザの種別別カードとアイテム・ツールチップの共用部品)
        "systems/tokyo-nova-axleration/templates/app/dictionary-card.hbs",

        // === User Sheets ===
        "systems/tokyo-nova-axleration/templates/user/record-sheet.hbs",
    ];
    // チャットカードの統一規格(2026-09-05)。骨格と段は**短い別名のパーシャル**で登録する——
    // パーシャルブロック({{#> tnxCard}}…{{/tnxCard}})はパスでは書けないため。
    // カードを作る側はこの別名だけを使い、器・見出し・段のマークアップを各所で組まない。
    const cardPartials = {
        tnxCard:       "systems/tokyo-nova-axleration/templates/chat/parts/card.hbs",
        tnxCardField:  "systems/tokyo-nova-axleration/templates/chat/parts/card-field.hbs",
        tnxCardRow:    "systems/tokyo-nova-axleration/templates/chat/parts/card-row.hbs",
        tnxCardFold:   "systems/tokyo-nova-axleration/templates/chat/parts/card-fold.hbs",
        tnxCardText:   "systems/tokyo-nova-axleration/templates/chat/parts/card-text.hbs",
        tnxCardResult: "systems/tokyo-nova-axleration/templates/chat/parts/card-result.hbs",
    };
    await foundry.applications.handlebars.loadTemplates(cardPartials);
    return foundry.applications.handlebars.loadTemplates(templatePaths);
}
