export class TokyoNovaOrganizationSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "organization"],
            template: "systems/tokyo-nova-axleration/templates/item/organization-sheet.hbs",
            width: 600,
            height: 650,
            tabs: [
                { navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" },
            ]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        const system = foundry.utils.deepClone(this.item.system);
        context.system = system; // hbsで system を使えるように
        
        context.enrichedDescription = await TextEditor.enrichHTML(system.description, { async: true, relativeTo: this.item, editable: this.isEditable });
        
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}