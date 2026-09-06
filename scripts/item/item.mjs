import { itemKindLabel } from "../data/item/helpers.mjs";

export class TokyoNovaItem extends Item {
    /**
     * @override
     */
    constructor(data, context) {
        if ( typeof data.img === 'undefined' ) {
            const iconMap = {
                "miracle": "icons/svg/wing.svg",
                "organization": "icons/svg/tower-flag.svg",
                "generalSkill": "icons/svg/card-hand.svg",
                "styleSkill": "icons/svg/card-joker.svg",
                "style": "icons/svg/door-closed.svg",
                "housingArea": "icons/svg/village.svg",
                "residence": "icons/svg/house.svg",
                "weapon": "icons/svg/sword.svg",
                "armor": "icons/svg/shield.svg",
                "tron": "icons/svg/video.svg",
                "tap": "icons/svg/target.svg",
                "ianus": "icons/svg/teleport.svg",
                "cyborg": "icons/svg/statue.svg",
                "vehicle": "icons/svg/lever.svg",
                "lifePath": "icons/svg/thrust.svg",
                "combiner": "icons/svg/circle.svg",
                "general": "icons/svg/upgrade.svg"
            };

            if ( iconMap[data.type] ) {
                data.img = iconMap[data.type];
            }
        }
        super(data, context);
    }

    /**
     * D&D 方式: 用途自体が無いアイテムをロール/使用した時、アイテム名＋解説をそのままチャットに表示する。
     * 「用途の無いアイテムは説明が提示される」というアイテムの基本機能(エラー/ダイアログにしない)。
     *
     * 宣言用途の使用カードもこのカードに統合(2026-08-30 ユーザー承認)。宣言は判定を行わず
     * 組み合わせが無いため効果文=解説を1枚で提示できる。適用効果ペイロードを渡すと
     * フラグに載せ、本文末尾に効果エリアを設ける(「効果を適用」ボタン/付与注記は
     * renderChatMessageHTML フックの renderUsageEffectButton がそこへ注入する)。
     * 帰結行(outcome)を渡すと、その使用で実際に起きたこと(治癒した状態など)がカードの末尾に出る
     * ——帰結だけの短いカードを別に出さないため(2026-09-07 ユーザー指示)。
     * @param {object} [options]
     * @param {object|null} [options.usageEffects] 用途の適用効果ペイロード(宣言使用時のみ)
     * @param {?{icon:string, text:string}} [options.outcome] 帰結行(アイコンと文)
     */
    async postDescriptionCard({ usageEffects = null, outcome = null } = {}) {
        const desc = await foundry.applications.ux.TextEditor.enrichHTML(this.system?.description ?? "", { async: true });
        // チャットカードの統一規格(item-card.hbs)で組む。空の効果文は段ごと出ない
        const card = await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/item-card.hbs",
            { typeLabel: itemKindLabel(this), name: this.name,
              description: desc?.trim() ? desc : "" });
        return ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor ?? undefined }),
            // 効果エリアは折りたたみ(details)の**外**に置く(2026-08-30 ユーザー指摘)——
            // 折りたたみは長い効果文を畳むためのもので、「効果を適用」はまだ押されていない
            // 操作のため、畳んでも隠れてはならない。枠はラッパーが引き受ける
            content: usageEffects
                ? `<div class="tnx-usage-use-card">${card}<div class="tnx-usage-effect-area"></div></div>`
                : card,
            flags: {
                "core.canPopout": true,
                ...(usageEffects || outcome
                    ? { "tokyo-nova-axleration": {
                        ...(usageEffects ? { usageEffects } : {}),
                        ...(outcome ? { cardOutcome: outcome } : {}),
                    } }
                    : {}),
            },
        });
    }
}