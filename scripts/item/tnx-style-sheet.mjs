import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";

export class TokyoNovaStyleSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "style"],
        position: { width: 600, height: 600 },
        dragDrop: [{ dragSelector: null, dropSelector: ".tnx-import-box" }],
        actions: {
            openLinkedSheet:       TokyoNovaStyleSheet._onOpenLinkedSheet,
            createAndLinkMiracle:  TokyoNovaStyleSheet._onCreateAndLinkMiracle,
            decrementLevel:        TokyoNovaStyleSheet._onDecrementLevel,
            incrementLevel:        TokyoNovaStyleSheet._onIncrementLevel,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/style-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }],
            initial: "description",
        },
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.isOwnedByActor = !!this.item.actor;
        context.isLevel3Locked = context.system.level === 3;

        const abilityLabels = {
            reason:  "♠理性",
            passion: "♣感情",
            life:    "♥生命",
            mundane: "♦外界",
        };
        context.system.abilities = {};
        for (const key of Object.keys(abilityLabels)) {
            context.system.abilities[key] = {
                label:   abilityLabels[key],
                value:   context.system[key].value,
                control: context.system[key].control,
            };
        }

        context.linkedMiracle = this.item.system.miracle?.id
            ? await fromUuid(this.item.system.miracle.id)
            : null;

        return context;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!context.editable) return;

        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu-type="manage-miracle"]', [{
            name: "リンク解除",
            icon: '<i class="fas fa-unlink"></i>',
            condition: () => !!this.item.system.miracle?.id,
            callback: async () => {
                await this.item.update({ "system.miracle.id": "", "system.miracle.name": "" });
                ui.notifications.info("神業とのリンクを解除しました。");
            },
        }], { jQuery: false, fixed: true });
    }

    // ─── アクションハンドラ ────────────────────────────────────────────────────

    static async _onIncrementLevel(_event, _target) {
        const newLevel = Math.clamp(this.item.system.level + 1, 1, 3);
        if (this.item.system.level !== newLevel) await this.item.update({ "system.level": newLevel });
    }

    static async _onDecrementLevel(_event, _target) {
        const newLevel = Math.clamp(this.item.system.level - 1, 1, 3);
        if (this.item.system.level !== newLevel) await this.item.update({ "system.level": newLevel });
    }

    static async _onOpenLinkedSheet(_event, _target) {
        const miracleId = this.item.system.miracle?.id;
        if (miracleId) {
            const doc = await fromUuid(miracleId);
            doc?.sheet.render({ force: true });
        }
    }

    static async _onCreateAndLinkMiracle(_event, _target) {
        if (this.item.system.miracle?.id || this.item.actor) return;
        const miracleData = {
            name: `${this.item.name}の神業`,
            type: "miracle",
            img: "icons/svg/daze.svg",
            system: { description: `<p>${this.item.name}スタイルに対応する神業です。</p>` },
        };
        const newMiracle = await Item.create(miracleData, { parent: this.item.parent });
        if (newMiracle) {
            await this.item.update({
                "system.miracle.id":   newMiracle.uuid,
                "system.miracle.name": newMiracle.name,
            });
            ui.notifications.info(`新規神業「${newMiracle.name}」が作成され、リンクされました。`);
        }
    }

    /** @override ドラッグ&ドロップで神業をリンクする */
    async _onDrop(event) {
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return false; }
        if (data.type !== "Item") return false;
        const item = await Item.fromDropData(data);
        if (item?.type !== "miracle") return ui.notifications.warn("リンクできるのは「神業」タイプのアイテムのみです。");
        await this.item.update({ "system.miracle.id": item.uuid, "system.miracle.name": item.name });
    }
}
