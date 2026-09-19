/**
 * @fileoverview PixiJS v7 (Foundry v13) / v8 (Foundry v14) 互換ユーティリティ。
 *
 * v14 は PixiJS v8 を採用しており、v7 の描画 API（beginFill / endFill / lineStyle /
 * moveTo / lineTo / drawRect）が削除されている。両バージョンで動作させるため、
 * ランタイムで API の存在をチェックして適切な呼び出しに振り分ける。
 */

/**
 * 矩形を塗りつぶす（v7: beginFill→drawRect→endFill / v8: rect→fill）。
 * @param {PIXI.Graphics} g
 * @param {number} color  塗り色(hex)
 * @param {number} alpha  不透明度
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function fillRect(g, color, alpha, x, y, w, h) {
    if (typeof g.beginFill === "function") {
        g.beginFill(color, alpha).drawRect(x, y, w, h).endFill();
    } else {
        g.rect(x, y, w, h).fill({ color, alpha });
    }
}

/**
 * 線分の配列を描画する（v7: lineStyle→moveTo→lineTo / v8: moveTo→lineTo→stroke）。
 * @param {PIXI.Graphics} g
 * @param {number} width  線幅
 * @param {number} color  線色(hex)
 * @param {number} alpha  不透明度
 * @param {Array<[number,number,number,number]>} segments [[x1,y1,x2,y2], ...]
 */
export function strokeLines(g, width, color, alpha, segments) {
    if (typeof g.lineStyle === "function") {
        g.lineStyle(width, color, alpha);
        for (const [x1, y1, x2, y2] of segments) g.moveTo(x1, y1).lineTo(x2, y2);
    } else {
        for (const [x1, y1, x2, y2] of segments) g.moveTo(x1, y1).lineTo(x2, y2);
        g.stroke({ width, color, alpha });
    }
}

/**
 * 矩形の枠線を描画する（v7: lineStyle→drawRect / v8: rect→stroke）。
 * @param {PIXI.Graphics} g
 * @param {number} width  線幅
 * @param {number} color  線色(hex)
 * @param {number} alpha  不透明度
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function strokeRect(g, width, color, alpha, x, y, w, h) {
    if (typeof g.lineStyle === "function") {
        g.lineStyle(width, color, alpha).drawRect(x, y, w, h);
    } else {
        g.rect(x, y, w, h).stroke({ width, color, alpha });
    }
}

