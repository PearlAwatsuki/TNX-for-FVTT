import { SYSTEM_ID } from "../constants.mjs";
import { measureAreaPath, validateAreaBoard } from "../rules/area-combat.mjs";

/** コアの経路・秘匿・物理計測を維持し、ラベルの表示単位だけをエリアへ置き換える。 */
export class TnxTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
    _areaGraphics;

    _onVisibleChange() {
        super._onVisibleChange();
        if (this._areaGraphics) this._areaGraphics.visible = this.visible;
    }

    refresh(data) {
        super.refresh(data);
        this._areaGraphics?.clear();
        const config = this.token.document.parent?.getFlag(SYSTEM_ID, "areaCombat");
        const planned = data.plannedMovement?.[game.user.id];
        if (!config?.enabled || validateAreaBoard(config) || !planned || planned.hidden || !this.isVisible || !this.token.isVisible) return;
        const points = planned.foundPath.map(p => this.token.document.getCenterPoint(p));
        const result = measureAreaPath(config, points);
        if (result.status !== "ok") return;
        if (!this._areaGraphics) {
            this._areaGraphics = new PIXI.Graphics();
            this._areaGraphics.eventMode = "none";
            canvas.stage.addChild(this._areaGraphics);
        }
        this._areaGraphics.visible = this.visible;
        for (const area of result.transitions) {
            this._areaGraphics.beginFill(0x88ccee, 0.10).drawRect(
                config.origin.x + area.column * config.cell.width,
                config.origin.y + area.row * config.cell.height, config.cell.width, config.cell.height,
            ).endFill();
        }
    }

    clear() {
        this._areaGraphics?.clear();
        return super.clear();
    }

    destroy() {
        this._areaGraphics?.destroy();
        this._areaGraphics = null;
        return super.destroy();
    }

    _getWaypointLabelContext(waypoint, state) {
        const context = super._getWaypointLabelContext(waypoint, state);
        const config = this.token.document.parent?.getFlag(SYSTEM_ID, "areaCombat");
        if (!context || !config?.enabled || validateAreaBoard(config)) return context;
        const path = [];
        let special = false;
        let point = waypoint;
        while (point) {
            // 非公開区間を距離の合計からも漏らさない。
            if (point.hidden) return context;
            special ||= ["teleport", "displace"].includes(point.action);
            path.push(point.center);
            if (point !== waypoint && (point.stage !== waypoint.stage || point.movementId !== waypoint.movementId)) break;
            point = point.previous;
        }
        const measurement = measureAreaPath(config, path.reverse());
        context.cost = null;
        context.distance = { total: special ? "配置・特殊移動" : measurement.status === "ok"
            ? (measurement.stages === 0 ? "エリア内移動" : `${measurement.stages} 段階`)
            : "盤面外／計測対象外" };
        context.units = "";
        // 高度は元の物理単位を保つ。
        if (context.elevation && !context.elevation.hidden) {
            context.elevation = { ...context.elevation, total: `${context.elevation.total} ${canvas.grid.units}` };
        }
        return context;
    }
}
