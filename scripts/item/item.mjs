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
     * @param {object} [options]
     * @param {object|null} [options.usageEffects] 用途の適用効果ペイロード(宣言使用時のみ)
     */
    async postDescriptionCard({ usageEffects = null } = {}) {
        const desc = await foundry.applications.ux.TextEditor.enrichHTML(this.system?.description ?? "", { async: true });
        // 解説が空なら本文ブロックごと省く(空の余白帯と二重境界線を出さない)
        const body = desc?.trim() ? `<div class="card-content">${desc}</div>` : "";
        return ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor ?? undefined }),
            content: `<details class="tnx-chat-card" open><summary><h3>${foundry.utils.escapeHTML(this.name)}</h3></summary>`
                + body
                + (usageEffects ? `<div class="tnx-usage-effect-area"></div>` : "")
                + `</details>`,
            flags: {
                "core.canPopout": true,
                ...(usageEffects ? { "tokyo-nova-axleration": { usageEffects } } : {}),
            },
        });
    }
}