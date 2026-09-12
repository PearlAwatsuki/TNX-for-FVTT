import { SYSTEM_ID } from "../constants.mjs";
import { getAreaAtPoint, getAreaDistance, getAreaRange, measureAreaPath, normalMovementStages, validateAreaBoard } from "../rules/area-combat.mjs";
import { TnxTokenRuler } from "./tnx-token-ruler.mjs";
import { movementStagesFromAchievement } from "../rules/vehicle-move.mjs";

const RANGE_LABELS = { close: "至近", short: "近", middle: "中", long: "遠", superLong: "超遠" };
let graphics, highlights, panel, preview, hovered;
const recent = new Map();
const movementSources = new Map();

function movementInfo(message) {
    const opposed = message.getFlag(SYSTEM_ID, "attackCheck");
    if (opposed?.movement) return {
        actorId: message.getFlag(SYSTEM_ID, "checkResult")?.actorId ?? opposed.movement.actorId,
        stages: ["fumble", "miss", "failed"].includes(opposed.state) ? 0 : movementStagesFromAchievement(opposed.achievement),
    };
    if (!message.content?.includes("data-tnx-movement-stages")) return null;
    const html = new DOMParser().parseFromString(message.content, "text/html");
    const stages = Number(html.querySelector("[data-tnx-movement-stages]")?.dataset.tnxMovementStages);
    return Number.isInteger(stages) && stages >= 0
        ? { actorId: message.getFlag(SYSTEM_ID, "checkResult")?.actorId, stages } : null;
}

function boardConfig() {
    const board = preview ?? canvas.scene?.getFlag(SYSTEM_ID, "areaCombat");
    return board?.enabled && !validateAreaBoard(board) ? board : null;
}

function destroyBoard() {
    graphics?.destroy();
    highlights?.destroy();
    panel?.remove();
    graphics = highlights = panel = null;
    hovered = null;
    recent.clear();
}

function drawBoard() {
    destroyBoard();
    for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ refreshRuler: true });
    const board = boardConfig();
    if (!canvas.ready || !board) return;
    graphics = new PIXI.Graphics();
    highlights = new PIXI.Graphics();
    graphics.eventMode = highlights.eventMode = "none";
    const { x, y } = board.origin;
    const { width, height } = board.cell;
    graphics.lineStyle(2, Number.parseInt(board.style.color.slice(1), 16), board.style.alpha);
    for (let column = 0; column <= board.columns; column++) {
        graphics.moveTo(x + column * width, y).lineTo(x + column * width, y + height * board.rows);
    }
    for (let row = 0; row <= board.rows; row++) {
        graphics.moveTo(x, y + row * height).lineTo(x + width * board.columns, y + row * height);
    }
    canvas.stage.addChild(graphics, highlights);
    panel = document.createElement("div");
    panel.className = "tnx-area-readout";
    document.body.appendChild(panel);
    refreshReadout();
}

function fillArea(board, area, color) {
    if (!area) return;
    highlights.beginFill(color, 0.12).drawRect(
        board.origin.x + area.column * board.cell.width,
        board.origin.y + area.row * board.cell.height, board.cell.width, board.cell.height,
    ).endFill();
}

function refreshReadout() {
    const board = boardConfig();
    if (!panel || !board) return;
    highlights.clear();
    const selected = canvas.tokens.controlled.filter(t => t.isVisible);
    if (selected.length !== 1) {
        panel.textContent = "エリア戦闘：トークンを1体選択すると距離を表示します";
        return;
    }
    const token = selected[0];
    const center = token.document.getCenterPoint();
    const area = getAreaAtPoint(board, center);
    fillArea(board, area, 0x88ccee);
    // 中心点が境界を越える時点を目で確認できるようにする。
    highlights.beginFill(0x88ccee, 0.9).drawCircle(center.x, center.y, 4).endFill();
    const vehicle = token.actor?.items?.find(i => i.type === "vehicle" && i.system.isPrepared);
    const stages = normalMovementStages(vehicle?.system);
    const lines = [area ? `エリア ${area.column + 1}列・${area.row + 1}行` : "盤面外／計測対象外",
        stages === null ? "通常ムーブ：上限不明" : `通常ムーブ：${stages}段階${vehicle ? "（SF）" : ""}`];
    const targets = hovered && hovered !== token ? [hovered] : [...(game.user.targets ?? [])];
    for (const target of targets.filter(t => t !== token && t.isVisible && t.document.parent?.id === canvas.scene.id)) {
        const point = target.document.getCenterPoint();
        const distance = getAreaDistance(board, center, point);
        lines.push(`${target.name}：${RANGE_LABELS[getAreaRange(distance)] ?? "計測対象外"}`);
        fillArea(board, getAreaAtPoint(board, point), 0xffcc66);
    }
    const last = recent.get(token.document.id);
    if (last) lines.push(`直近の移動：${last}`);
    const sourceId = movementSources.get(token.document.uuid);
    if (sourceId) {
        const message = game.messages.get(sourceId);
        const info = message?.visible ? movementInfo(message) : null;
        if (info) lines.push(`参照中の移動判定：${info.stages}段階（現在の結果）`);
        else movementSources.delete(token.document.uuid);
    }
    panel.textContent = lines.join("\n");
}

/** 起動登録。通常Sceneのグリッドや計測処理には手を加えない。 */
export function registerAreaCombat() {
    CONFIG.Token.rulerClass = TnxTokenRuler;
    Hooks.on("canvasReady", () => { preview = null; drawBoard(); });
    Hooks.on("canvasTearDown", () => { preview = null; movementSources.clear(); destroyBoard(); });
    Hooks.on("updateScene", (scene, changes) => {
        if (scene.id !== canvas.scene?.id) return;
        if (changes.flags?.[SYSTEM_ID] && ("areaCombat" in changes.flags[SYSTEM_ID] || "-=areaCombat" in changes.flags[SYSTEM_ID])) {
            preview = null;
            drawBoard();
        }
    });
    Hooks.on("tnxAreaBoardPreview", (sceneId, board) => {
        if (sceneId !== canvas.scene?.id) return;
        preview = board;
        drawBoard();
    });
    for (const event of ["controlToken", "targetToken", "refreshToken", "updateActor", "updateItem", "deleteToken"]) {
        Hooks.on(event, refreshReadout);
    }
    Hooks.on("hoverToken", (token, hover) => { hovered = hover ? token : null; refreshReadout(); });
    for (const event of ["updateChatMessage", "deleteChatMessage"]) Hooks.on(event, refreshReadout);
    Hooks.on("moveToken", (token, movement) => {
        const board = boardConfig();
        if (!board || token.parent?.id !== canvas.scene?.id || !token.object?.isVisible) return;
        const waypoints = movement.passed?.waypoints ?? [];
        // pendingは移動予定であり、途中停止時にも完了扱いにしない。
        if (!waypoints.length) return;
        if (["config", "paste", "undo"].includes(movement.method)
            || waypoints.some(p => ["teleport", "displace"].includes(p.action))) {
            recent.set(token.id, "配置・特殊移動");
        } else {
            const result = measureAreaPath(board, [movement.origin, ...waypoints].map(p => token.getCenterPoint(p)));
            recent.set(token.id, result.stages === null ? "計測対象外" : `${result.stages}段階`);
        }
        refreshReadout();
    });
}

/** 共通チャット描画表から呼ぶ。判定を再実行せず、結果への参照のみ保持する。 */
export function renderAreaMovementReference(message, html) {
        if (!message.visible) return;
        const info = movementInfo(message);
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!info || !root || root.querySelector(".tnx-area-movement-reference")) return;
        const actor = game.actors.get(info.actorId);
        if (!actor?.isOwner) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tnx-area-movement-reference";
        button.textContent = "盤面で移動段階を参照";
        button.addEventListener("click", () => {
            if (!boardConfig()) return void ui.notifications.info("エリア戦闘が有効な盤面を開いてください。");
            const selected = canvas.tokens.controlled;
            if (selected.length !== 1 || selected[0].actor?.id !== info.actorId || !selected[0].isOwner) {
                ui.notifications.warn("判定したキャラクターのトークンを1体選択してください。");
                return;
            }
            movementSources.set(selected[0].document.uuid, message.id);
            refreshReadout();
        });
        (root.querySelector(".tnx-card") ?? root).appendChild(button);
}
