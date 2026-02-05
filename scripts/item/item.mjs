export class TokyoNovaItem extends Item {
    /**
     * @override
     */
    constructor(data, context) {
        if ( typeof data.img === 'undefined' ) {
            const iconMap = {
                "miracle": "icons/svg/daze.svg",
                "organization": "icons/svg/house.svg",
                "outfit": "icons/svg/item-bag.svg",
                "generalSkill": "icons/svg/card-hand.svg",
                "styleSkill": "icons/svg/card-joker.svg",
                "style": "icons/svg/paralysis.svg",
                "record": "icons/svg/book.svg"
            };

            if ( iconMap[data.type] ) {
                data.img = iconMap[data.type];
            }
        }
        super(data, context);
    }
}