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
                "skill": "icons/svg/card-joker.svg",
                "style": "icons/svg/paralysis.svg"
            };

            if ( iconMap[data.type] ) {
                data.img = iconMap[data.type];
            }
        }
        super(data, context);
    }
}