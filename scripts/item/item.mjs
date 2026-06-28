export class TokyoNovaItem extends Item {
    /**
     * @override
     */
    constructor(data, context) {
        if ( typeof data.img === 'undefined' ) {
            const iconMap = {
                "miracle": "icons/svg/daze.svg",
                "organization": "icons/svg/tower-flag.svg",
                "generalSkill": "icons/svg/card-hand.svg",
                "styleSkill": "icons/svg/card-joker.svg",
                "style": "icons/svg/paralysis.svg",
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
     */
    async postDescriptionCard() {
        const desc = await foundry.applications.ux.TextEditor.enrichHTML(this.system?.description ?? "", { async: true });
        return ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor ?? undefined }),
            content: `<details class="tnx-chat-card" open><summary><h3>${this.name}</h3></summary>
                <div class="card-content">${desc}</div></details>`,
            flags: { "core.canPopout": true },
        });
    }
}