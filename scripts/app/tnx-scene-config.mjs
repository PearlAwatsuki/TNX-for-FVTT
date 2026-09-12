import { SYSTEM_ID } from "../constants.mjs";
import { validateAreaBoard } from "../rules/area-combat.mjs";

/** コアのScene設定にエリア欄を追加し、同じ保存操作で更新する。 */
export class TnxSceneConfig extends foundry.applications.sheets.SceneConfig {
    async _renderHTML(context, options) {
        const parts = await super._renderHTML(context, options);
        if (!parts.grid || !game.user.isGM) return parts;
        const rect = this.document.dimensions.sceneRect;
        const board = this.document.getFlag(SYSTEM_ID, "areaCombat") ?? {
            enabled: false, origin: { x: rect.x, y: rect.y },
            cell: { width: Math.max(1, Math.floor(rect.width / 5)), height: Math.max(1, Math.floor(rect.height / 3)) },
            rows: 3, columns: 5, style: { color: "#88ccee", alpha: 0.65 },
        };
        const html = await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/app/area-combat-config.hbs", { board },
        );
        // コアが描画したgrid本文に追加する。タブ見出しは変更しない。
        parts.grid.insertAdjacentHTML("beforeend", html);
        return parts;
    }

    _processFormData(event, form, formData) {
        const data = super._processFormData(event, form, formData);
        const area = data.flags?.[SYSTEM_ID]?.areaCombat;
        if (!area) return data;
        if (!game.user.isGM) throw new Error("エリア設定を変更できるのはRLだけです。");
        area.schemaVersion = 1;
        area.revision = (this.document.getFlag(SYSTEM_ID, "areaCombat")?.revision ?? 0) + 1;
        const error = validateAreaBoard(area);
        if (error) throw new Error(error);
        if (area.enabled) {
            data.grid ??= {};
            data.grid.type = CONST.GRID_TYPES.GRIDLESS;
        }
        return data;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const section = this.element.querySelector(".tnx-area-settings");
        if (!section) return;
        const syncGrid = () => {
            const enabled = section.querySelector('[name$=".enabled"]').checked;
            const gridType = this.element.querySelector('[name="grid.type"]');
            if (gridType) {
                if (enabled) gridType.value = String(CONST.GRID_TYPES.GRIDLESS);
                gridType.disabled = enabled;
            }
            const align = this.element.querySelector('[data-action="openGridConfig"]');
            if (align) align.disabled = enabled;
        };
        syncGrid();
        section.oninput = () => {
            syncGrid();
            try {
                const data = this._processFormData(null, this.form, new foundry.applications.ux.FormDataExtended(this.form));
                section.querySelector('[role="alert"]').textContent = "";
                Hooks.callAll("tnxAreaBoardPreview", this.document.id, data.flags[SYSTEM_ID].areaCombat);
            } catch (error) {
                section.querySelector('[role="alert"]').textContent = error.message;
            }
        };
    }

    async close(options) {
        Hooks.callAll("tnxAreaBoardPreview", this.document.id, null);
        return super.close(options);
    }
}
