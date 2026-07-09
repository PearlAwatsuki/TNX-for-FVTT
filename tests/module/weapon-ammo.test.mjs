import { describe, it, expect } from "vitest";
import { hasAmmoTracking, ammoRemaining, isAmmoEmpty } from "../../scripts/module/weapon-ammo.mjs";

describe("hasAmmoTracking()（残弾を追跡する武器か・2026-07-09）", () => {
  it("mode が none / 未設定なら追跡しない", () => {
    expect(hasAmmoTracking({ mode: "none" })).toBe(false);
    expect(hasAmmoTracking({})).toBe(false);
    expect(hasAmmoTracking(undefined)).toBe(false);
  });

  it("mode が value / arbitrary なら追跡する", () => {
    expect(hasAmmoTracking({ mode: "value", value: 6 })).toBe(true);
    expect(hasAmmoTracking({ mode: "arbitrary" })).toBe(true);
  });
});

describe("ammoRemaining()（現在の残弾・null=満タン・2026-07-10）", () => {
  it("数字モード: current=null は満タン(value)・数値ならその値", () => {
    expect(ammoRemaining({ mode: "value", value: 6, current: null })).toBe(6);
    expect(ammoRemaining({ mode: "value", value: 6, current: 3 })).toBe(3);
    expect(ammoRemaining({ mode: "value", value: 6, current: 0 })).toBe(0);
  });

  it("任意モード: current=null は あり(1)・0 は なし", () => {
    expect(ammoRemaining({ mode: "arbitrary", current: null })).toBe(1);
    expect(ammoRemaining({ mode: "arbitrary", current: 0 })).toBe(0);
  });

  it("追跡しない武器は Infinity(常に残弾あり)", () => {
    expect(ammoRemaining({ mode: "none" })).toBe(Infinity);
  });
});

describe("isAmmoEmpty()（残弾が空=リロード導線の条件・2026-07-10）", () => {
  it("数字モード: current が 0 のときだけ空(満タン=value は空でない)", () => {
    expect(isAmmoEmpty({ mode: "value", value: 6, current: 0 })).toBe(true);
    expect(isAmmoEmpty({ mode: "value", value: 6, current: 3 })).toBe(false);
    expect(isAmmoEmpty({ mode: "value", value: 6, current: null })).toBe(false); // 満タン
  });

  it("任意モード: current=0(なし) は空・null(あり) は空でない", () => {
    expect(isAmmoEmpty({ mode: "arbitrary", current: 0 })).toBe(true);
    expect(isAmmoEmpty({ mode: "arbitrary", current: null })).toBe(false);
  });

  it("残弾を追跡しない武器(none)は常に false", () => {
    expect(isAmmoEmpty({ mode: "none", current: 0 })).toBe(false);
    expect(isAmmoEmpty({})).toBe(false);
  });
});
