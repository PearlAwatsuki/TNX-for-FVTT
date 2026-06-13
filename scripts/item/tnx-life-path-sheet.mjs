import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

export class TokyoNovaLifePathSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "life-path"],
        position: { width: 600, height: 520 },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/life-path-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }],
            initial: "description",
        },
    };
}
