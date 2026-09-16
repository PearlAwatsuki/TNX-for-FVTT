import { describe, it, expect } from "vitest";
import { pickDisembarkPosition } from "../../scripts/rules/appearance.mjs";

const base = { origin: { x: 200, y: 200 }, size: { width: 100, height: 100 }, gridSize: 100,
    bounds: { x: 0, y: 0, width: 1000, height: 1000 } };
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
describe("降車時の空き位置", () => {
    it("大型車両と周囲のコマの占有範囲を避ける", () => {
        const occupied = [{ x: 200, y: 200, width: 300, height: 200 }, { x: 100, y: 100, width: 100, height: 100 }];
        const point = pickDisembarkPosition({ ...base, occupied });
        expect(occupied.some(p => overlaps({ ...point, ...base.size }, p))).toBe(false);
    });
    it("盤面端でもコマ全体を盤面内に収める", () => {
        const point = pickDisembarkPosition({ ...base, origin: { x: 0, y: 0 }, size: { width: 200, height: 200 },
            occupied: [{ x: 0, y: 0, width: 100, height: 100 }] });
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.x + 200).toBeLessThanOrEqual(1000);
        expect(point.y + 200).toBeLessThanOrEqual(1000);
    });
    it("複数の降車位置を予約すると同じ位置を選ばない", () => {
        const occupied = [{ ...base.origin, ...base.size }];
        const first = pickDisembarkPosition({ ...base, occupied });
        const second = pickDisembarkPosition({ ...base, occupied: [...occupied, { ...first, ...base.size }] });
        expect(overlaps({ ...first, ...base.size }, { ...second, ...base.size })).toBe(false);
    });
    it("車両が消えて元の位置が空いていればその位置を使える", () => {
        expect(pickDisembarkPosition(base)).toEqual(base.origin);
    });
    it("空きがないときは重ねずに失敗を返す", () => {
        expect(() => pickDisembarkPosition({ ...base, occupied: [base.bounds] })).toThrow("空き位置");
    });
});
