import { describe, it, expect } from "vitest";
import { computeProgressGain } from "../../scripts/rules/focus-system.mjs";

describe("computeProgressGain()（進行判定で獲得する進行値・ルール3+5・13-7）", () => {
  it("floor(差分値÷10) の基本（進行修正・支援なし）", () => {
    expect(computeProgressGain(10, 0, 0)).toBe(1);
    expect(computeProgressGain(25, 0, 0)).toBe(2); // floor(2.5)
    expect(computeProgressGain(9, 0, 0)).toBe(0);  // floor(0.9)
    expect(computeProgressGain(0, 0, 0)).toBe(0);
  });

  it("進行修正は floor の内側（和全体を切り捨て・ルール3）", () => {
    expect(computeProgressGain(25, 3, 0)).toBe(5);   // floor(2.5+3)=floor(5.5)=5
    expect(computeProgressGain(25, 1.5, 0)).toBe(4); // floor(2.5+1.5)=floor(4.0)=4
    expect(computeProgressGain(5, 0.4, 0)).toBe(0);  // floor(0.5+0.4)=floor(0.9)=0
  });

  it("支援ボーナスは floor の外側（獲得する進行値に +N・ルール5訂正）", () => {
    expect(computeProgressGain(25, 0, 2)).toBe(4);   // floor(2.5)+2
    expect(computeProgressGain(9, 0, 1)).toBe(1);    // floor(0.9)+1=0+1
    expect(computeProgressGain(25, 1.5, 1)).toBe(5); // floor(4.0)+1
  });

  it("差分値が無い（失敗/ファンブル）は進行なし", () => {
    expect(computeProgressGain(null, 5, 2)).toBe(0);
    expect(computeProgressGain(undefined, 5, 2)).toBe(0);
    expect(computeProgressGain(NaN, 5, 2)).toBe(0);
  });
});
