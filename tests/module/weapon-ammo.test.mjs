import { describe, it, expect } from "vitest";
import { hasAmmoTracking, isAmmoEmpty } from "../../scripts/module/weapon-ammo.mjs";

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

describe("isAmmoEmpty()（残弾が空=リロード導線の条件・2026-07-09）", () => {
  it("追跡する武器が empty のときだけ true", () => {
    expect(isAmmoEmpty({ mode: "value", value: 6, empty: true })).toBe(true);
    expect(isAmmoEmpty({ mode: "arbitrary", empty: true })).toBe(true);
  });

  it("empty でなければ(装填中)false", () => {
    expect(isAmmoEmpty({ mode: "value", value: 6, empty: false })).toBe(false);
    expect(isAmmoEmpty({ mode: "arbitrary", empty: false })).toBe(false);
  });

  it("残弾を追跡しない武器(none)は常に false", () => {
    expect(isAmmoEmpty({ mode: "none", empty: true })).toBe(false);
    expect(isAmmoEmpty({})).toBe(false);
  });
});
