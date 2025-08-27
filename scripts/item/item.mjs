export class TokyoNovaItem extends Item {
    /**
     * @override
     */
    constructor(data, context) {
        if ( typeof data.img === 'undefined' ) {
            const iconMap = {
                "divine_work": "icons/svg/daze.svg",
                "information": "icons/svg/book.svg",
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