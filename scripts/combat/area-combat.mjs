import { SYSTEM_ID } from "../constants.mjs";
import { getAreaAtPoint, validateAreaBoard } from "../rules/area-combat.mjs";
import { TnxTokenRuler } from "./tnx-token-ruler.mjs";

let graphics, highlights, preview, hovered;

function boardConfig() {
    const board = preview ?? canvas.scene?.getFlag(SYSTEM_ID, "areaCombat");
    return board?.enabled && !validateAreaBoard(board) ? board : null;
}

function destroyBoard() {
    graphics?.destroy();
    highlights?.destroy();
    graphics = highlights = null;
    hovered = null;
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
    refreshHighlights();
}

function fillArea(board, area, color) {
    if (!area) return;
    highlights.beginFill(color, 0.12).drawRect(
        board.origin.x + area.column * board.cell.width,
        board.origin.y + area.row * board.cell.height, board.cell.width, board.cell.height,
    ).endFill();
}

function refreshHighlights() {
    const board = boardConfig();
    if (!highlights || !board) return;
    highlights.clear();
    const selected = canvas.tokens.controlled.filter(t => t.isVisible);
    if (selected.length !== 1) return;
    const token = selected[0];
    const center = token.document.getCenterPoint();
    const area = getAreaAtPoint(board, center);
    fillArea(board, area, 0x88ccee);
    // 中心点が境界を越える時点を目で確認できるようにする。
    highlights.beginFill(0x88ccee, 0.9).drawCircle(center.x, center.y, 4).endFill();
    const targets = hovered && hovered !== token ? [hovered] : [...(game.user.targets ?? [])];
    for (const target of targets.filter(t => t !== token && t.isVisible && t.document.parent?.id === canvas.scene.id)) {
        fillArea(board, getAreaAtPoint(board, target.document.getCenterPoint()), 0xffcc66);
    }
}

/** 起動登録。通常Sceneのグリッドや計測処理には手を加えない。 */
export function registerAreaCombat() {
    CONFIG.Token.rulerClass = TnxTokenRuler;
    Hooks.on("canvasReady", () => { preview = null; drawBoard(); });
    Hooks.on("canvasTearDown", () => { preview = null; destroyBoard(); });
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
        Hooks.on(event, refreshHighlights);
    }
    Hooks.on("hoverToken", (token, hover) => { hovered = hover ? token : null; refreshHighlights(); });
}
