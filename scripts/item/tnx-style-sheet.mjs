import { UnlinkConfirmDialog } from '../module/tnx-dialog.mjs';

export class TokyoNovaStyleSheet extends ItemSheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "item", "style"],
            template: "systems/tokyo-nova-axleration/templates/item/style-sheet.hbs",
            width: 580,
            height: 600,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }],
            dragDrop: [{ dragSelector: null, dropSelector: ".tnx-import-box" }]
        });
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.item.system;
        context.isOwnedByActor = !!this.item.actor;
        context.enrichedDescription = await TextEditor.enrichHTML(this.item.system.description, { async: true, relativeTo: this.item, editable: this.isEditable });
        context.isLevel3Locked = context.system.level === 3;
        
        const abilityKeys = ["reason", "passion", "life", "mundane"];
        const abilityLabels = { "reason": "TNX.Reason", "passion": "TNX.Passion", "life": "TNX.Life", "mundane": "TNX.Mundane" };
        context.system.abilities = {};
        for (const key of abilityKeys) {
            context.system.abilities[key] = {
                label: abilityLabels[key],
                value: context.system[key].value,
                control: context.system[key].control
            };
        }
        
        context.linkedDivineWork = null;
        if (this.item.system.divineWork?.id) {
            context.linkedDivineWork = await fromUuid(this.item.system.divineWork.id);
        }
        return context;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;
    
        html.on('click', '[data-action]', (event) => {
            const action = event.currentTarget.dataset.action;
            switch (action) {
                case 'open-linked-sheet':
                    this._onOpenLinkedSheet(event);
                    break;
                case 'create-and-link-divine-work':
                    this._onCreateAndLinkDivineWork(event);
                    break;
                case 'decrement-level':
                    this._onModifyLevel(event, -1);
                    break;
                case 'increment-level':
                    this._onModifyLevel(event, 1);
                    break;
            }
        });
    
        const divineWorkContextMenu = [{
            name: game.i18n.localize("TNX.Unlink"),
            icon: '<i class="fas fa-unlink"></i>',
            condition: () => !!this.item.system.divineWork?.id,
            callback: async () => {
                await this.item.update({ "system.divineWork.id": "", "system.divineWork.name": "" });
                ui.notifications.info(`神業とのリンクを解除しました。`);
            }
        }];
        new ContextMenu(html, '[data-context-menu-type="manage-divine-work"]', divineWorkContextMenu);
    }

    async _onModifyLevel(event, amount) {
        event.preventDefault();
        const currentLevel = this.item.system.level;
        // ▼▼▼ Math.clamped を Math.clamp に修正 ▼▼▼
        const newLevel = Math.clamp(currentLevel + amount, 1, 3);
        if (currentLevel !== newLevel) {
            await this.item.update({'system.level': newLevel});
        }
    }
    
    async _onDrop(event) {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch (err) { return false; }
        
        if (data.type !== "Item") return false;
        const item = await Item.fromDropData(data);
        if (item?.type !== "divine_work") return ui.notifications.warn("リンクできるのは「神業」タイプのアイテムのみです。");
        
        await this.item.update({ "system.divineWork.id": item.uuid, "system.divineWork.name": item.name });
    }

    async _onCreateAndLinkDivineWork(event) {
        event.preventDefault();
        if (this.item.system.divineWork?.id || this.item.actor) return;

        const divineWorkData = {
            name: `${this.item.name}の神業`,
            type: "divine_work",
            img: "icons/svg/daze.svg",
            system: { description: `<p>${this.item.name}スタイルに対応する神業です。</p>` }
        };

        const newDivineWork = await Item.create(divineWorkData, { parent: this.item.parent });
        if (newDivineWork) {
            await this.item.update({
                "system.divineWork.id": newDivineWork.uuid,
                "system.divineWork.name": newDivineWork.name
            });
            ui.notifications.info(`新規神業「${newDivineWork.name}」が作成され、リンクされました。`);
        }
    }

    async _onOpenLinkedSheet(event) {
        event.preventDefault();
        const divineWorkId = this.item.system.divineWork?.id;
        if (divineWorkId) {
            const doc = await fromUuid(divineWorkId);
            doc?.sheet.render(true);
        }
    }
}