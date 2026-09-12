import { describe, it, expect } from "vitest";
import { validateAreaBoard, getAreaAtPoint, measureAreaPath } from "../../scripts/rules/area-combat.mjs";

const board = {
    schemaVersion: 1, enabled: true, origin: { x: 200, y: 100 },
    cell: { width: 600, height: 400 }, rows: 8, columns: 8,
    style: { color: "#88ccee", alpha: 0.65 },
};
const p = (x, y) => ({ x: 200 + x * 600, y: 100 + y * 400 });
const stages = (...points) => measureAreaPath(board, points).stages;

describe("エリア盤面：ユーザー指定の段階と距離", () => {
    it("長方形の中を大きく動いても無料、境界を微小量越えれば1", () => {
        expect(stages(p(0.01, 0.01), p(0.99, 0.99))).toBe(0);
        expect(stages(p(0.999, 0.5), p(1.001, 0.5))).toBe(1);
    });
    it("2エリア先・斜め・往復はいずれも2", () => {
        expect(stages(p(0.5, 0.5), p(2.5, 0.5))).toBe(2);
        expect(stages(p(0.5, 0.5), p(1.5, 1.5))).toBe(2);
        expect(stages(p(0.5, 0.5), p(1.5, 0.5), p(0.5, 0.5))).toBe(2);
    });
    it("6エリア移動を超遠の4に丸めない", () => {
        expect(stages(p(0.5, 0.5), p(6.5, 0.5))).toBe(6);
    });
    it("往復後の相手との距離は移動消費と独立", () => {
        expect(stages(p(0.5, 0.5), p(1.5, 0.5), p(0.5, 0.5))).toBe(2);
    });
    it("角で分割しても、分割せず通過しても同じ段階", () => {
        for (const [a, b] of [[p(0.5, 0.5), p(1.5, 1.5)], [p(0.5, 1.5), p(1.5, 0.5)]]) {
            expect(stages(a, p(1, 1)) + stages(p(1, 1), b)).toBe(stages(a, b));
            expect(stages(b, p(1, 1)) + stages(p(1, 1), a)).toBe(stages(b, a));
        }
    });
    it("境界沿いは横方向の消費を増やさない", () => {
        expect(stages(p(1, 0.5), p(1, 3.5))).toBe(3);
        expect(getAreaAtPoint(board, p(1, 1))).toEqual({ row: 1, column: 1 });
    });
    it("線分の向き・長さによらず最短の直線経路は縦横差に一致", () => {
        for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
            expect(stages(p(3.5, 2.5), p(x + 0.5, y + 0.5))).toBe(Math.abs(x - 3) + Math.abs(y - 2));
        }
    });
    it("経由したエリアを順序付きで返す", () => {
        expect(measureAreaPath(board, [p(0.5, 0.5), p(2.5, 0.5)]).transitions)
            .toEqual([{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }]);
    });
    it("盤面外への往復も無料としない", () => {
        expect(measureAreaPath(board, [p(0.5, 0.5), p(-1, 0.5), p(0.5, 0.5)]))
            .toMatchObject({ status: "outside", stages: null });
        expect(getAreaAtPoint(board, p(8, 0))).toBeNull();
        expect(getAreaAtPoint(board, p(0, 8))).toBeNull();
        expect(getAreaAtPoint(board, p(0, 0))).toEqual({ row: 0, column: 0 });
    });
    it("不正経路を0段階にしない", () => {
        for (const path of [[], null, [null], [p(NaN, 0)]]) expect(measureAreaPath(board, path).status).toBe("invalid");
    });
});

describe("エリア設定と通常ムーブ", () => {
    it("設定と負荷上限を検証する", () => {
        expect(validateAreaBoard(board)).toBeNull();
        for (const patch of [{ schemaVersion: 2 }, { rows: 0 }, { columns: 101 }, { rows: 100, columns: 100 },
            { cell: { width: 0, height: 1 } }, { origin: { x: NaN, y: 0 } }, { style: { color: "bad", alpha: 1 } },
            { style: { color: "#88ccee", alpha: 2 } }]) expect(validateAreaBoard({ ...board, ...patch })).toBeTruthy();
    });
});
