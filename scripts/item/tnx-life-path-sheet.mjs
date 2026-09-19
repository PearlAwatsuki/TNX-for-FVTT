import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

export class TokyoNovaLifePathSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "life-path"],
        position: { width: 600, height: 520 },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/life-path-sheet.hbs", scrollable: [".sheet-body", ".tab[data-tab='description']", ".tab[data-tab='setting']", ".tab[data-tab='usage']", ".tab[data-tab='effects']"] },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }],
            initial: "description",
        },
    };
}
