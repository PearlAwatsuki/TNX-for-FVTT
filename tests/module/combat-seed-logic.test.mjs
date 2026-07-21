import { describe, it, expect } from "vitest";
import { buildCombatSeedUpdate } from "../../scripts/module/combat-seed-logic.mjs";

describe("buildCombatSeedUpdate()（カット開始シード＝CSカレントへCS実効値・現在ARへ付与値・フェーズ13-2）", () => {
  it("CS・AR 両方あれば current=valueTotal・value=maxTotal を返す", () => {
    const update = buildCombatSeedUpdate({
      combatSpeed: { valueTotal: 7 },
      actionRank: { maxTotal: 2 },
    });
    expect(update).toEqual({
      "system.combatSpeed.current": 7,
      "system.actionRank.value": 2,
    });
  });

  it("実効値が未定義なら 0 で埋める", () => {
    const update = buildCombatSeedUpdate({ combatSpeed: {}, actionRank: {} });
    expect(update).toEqual({
      "system.combatSpeed.current": 0,
      "system.actionRank.value": 0,
    });
  });

  it("combatSpeed が無ければ AR のみ・actionRank が無ければ CS のみ（該当層だけ書く）", () => {
    expect(buildCombatSeedUpdate({ actionRank: { maxTotal: 1 } })).toEqual({
      "system.actionRank.value": 1,
    });
    expect(buildCombatSeedUpdate({ combatSpeed: { valueTotal: 5 } })).toEqual({
      "system.combatSpeed.current": 5,
    });
  });

  it("どちらも無ければ空オブジェクト（更新しない）", () => {
    expect(buildCombatSeedUpdate({})).toEqual({});
    expect(buildCombatSeedUpdate(null)).toEqual({});
  });
});
