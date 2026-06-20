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
     * @override
     * Foundry の Item は既定で「自分自身の ActiveEffect」を適用しない
     * (applyActiveEffects は Actor のみ)。アイテムのパラメータを直接書き換えるモードA の効果
     * (改造・固有ボーナス。transfer:false)を成立させるため、Actor と同じく
     * prepareEmbeddedDocuments の後に自己適用する。
     * → 着地点 effectMod に値が入り、DataModel.prepareDerivedData が total を算出する。
     */
    prepareEmbeddedDocuments() {
        super.prepareEmbeddedDocuments();
        this.applyActiveEffects();
    }

    /**
     * 自身の有効な非転送(transfer:false)ActiveEffect の changes を自分(system)へ適用する。
     * transfer:true の効果は所有アクター側(actor.applyActiveEffects)が適用するためここでは扱わない。
     */
    applyActiveEffects() {
        for (const effect of this.effects) {
            if (!effect.active || effect.transfer) continue;
            for (const change of effect.changes) effect.apply(this, change);
        }
    }
}