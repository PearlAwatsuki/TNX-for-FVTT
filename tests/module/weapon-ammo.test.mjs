import { describe, it, expect } from "vitest";
import { hasAmmoTracking, ammoRemaining, isAmmoEmpty, nextAmmoCurrent } from "../../scripts/module/weapon-ammo.mjs";

// 2026-07-18 再設計: 残弾「任意」廃止・value モードのみ。消費/回復は用途の消費設定からのみ
// (nextAmmoCurrent が唯一の増減ロジック。自動消費 consumeNormalAmmo/consumeFaAmmo は撤去)。

describe("hasAmmoTracking()（残弾を追跡する武器か）", () => {
  it("mode が none / 未設定なら追跡しない", () => {
    expect(hasAmmoTracking({ mode: "none" })).toBe(false);
    expect(hasAmmoTracking({})).toBe(false);
    expect(hasAmmoTracking(undefined)).toBe(false);
  });

  it("mode が value なら追跡する", () => {
    expect(hasAmmoTracking({ mode: "value", value: 6 })).toBe(true);
    expect(hasAmmoTracking({ mode: "value", value: 1 })).toBe(true); // 残弾1(旧・任意)
  });
});

describe("ammoRemaining()（現在の残弾・null=満タン）", () => {
  it("数字モード: current=null は満タン(value)・数値ならその値", () => {
    expect(ammoRemaining({ mode: "value", value: 6, current: null })).toBe(6);
    expect(ammoRemaining({ mode: "value", value: 6, current: 3 })).toBe(3);
    expect(ammoRemaining({ mode: "value", value: 6, current: 0 })).toBe(0);
  });

  it("残弾1(value=1 or 0): null=満タン=1・0=空(具体的残弾数の無い武器)", () => {
    expect(ammoRemaining({ mode: "value", value: 1, current: null })).toBe(1);
    expect(ammoRemaining({ mode: "value", value: 0, current: null })).toBe(1); // 0 も残弾1扱い
    expect(ammoRemaining({ mode: "value", value: 1, current: 0 })).toBe(0);
  });

  it("追跡しない武器は Infinity(常に残弾あり)", () => {
    expect(ammoRemaining({ mode: "none" })).toBe(Infinity);
  });
});

describe("isAmmoEmpty()（残弾が空=リロード導線の条件）", () => {
  it("数字モード: current が 0 のときだけ空(満タン=value は空でない)", () => {
    expect(isAmmoEmpty({ mode: "value", value: 6, current: 0 })).toBe(true);
    expect(isAmmoEmpty({ mode: "value", value: 6, current: 3 })).toBe(false);
    expect(isAmmoEmpty({ mode: "value", value: 6, current: null })).toBe(false); // 満タン
  });

  it("残弾を追跡しない武器(none)は常に false", () => {
    expect(isAmmoEmpty({ mode: "none", current: 0 })).toBe(false);
    expect(isAmmoEmpty({})).toBe(false);
  });
});

describe("nextAmmoCurrent()（用途消費での残弾増減・正=消費/負=回復）", () => {
  it("消費: current から減らし 0 でクランプ", () => {
    expect(nextAmmoCurrent({ mode: "value", value: 6, current: 3 }, 1)).toBe(2);
    expect(nextAmmoCurrent({ mode: "value", value: 6, current: null }, 1)).toBe(5); // 満タン6→5
    expect(nextAmmoCurrent({ mode: "value", value: 6, current: 1 }, 5)).toBe(0);   // 0 クランプ
  });

  it("回復(負値=リロード): 増やし 満タンに達したら null(満タン)", () => {
    expect(nextAmmoCurrent({ mode: "value", value: 6, current: 2 }, -3)).toBe(5);
    expect(nextAmmoCurrent({ mode: "value", value: 6, current: 2 }, -10)).toBe(null); // 満タン超え→null
  });

  it("残弾1(FA武器等): 消費で0(空)・回復でnull(満タン=1)", () => {
    expect(nextAmmoCurrent({ mode: "value", value: 1, current: null }, 1)).toBe(0);
    expect(nextAmmoCurrent({ mode: "value", value: 1, current: 0 }, -1)).toBe(null);
  });

  it("追跡なし・量0は変更なし(undefined)", () => {
    expect(nextAmmoCurrent({ mode: "none" }, 1)).toBeUndefined();
    expect(nextAmmoCurrent({ mode: "value", value: 6, current: 3 }, 0)).toBeUndefined();
  });
});
