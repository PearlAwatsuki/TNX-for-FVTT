import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveNoReaction, resolveOpposed, attackReactionModes, formatAttackLabel, combineWeaponAttack,
  resolveAttackRecheckState } =
  await import("../../scripts/module/attack-flow-logic.mjs");

// ダメージカードは命中判定のカードとは別に出す(Damage_Rules 2026-07-08 訂正)ため、
// 命中判定値からの導出(novaDamageCardValue)は廃止された

describe("formatAttackLabel()（攻撃力表記=アウトフィットの表示を踏襲・2026-07-09）", () => {
  it("種別+符号つき数値（連結表記 I0/S5 にしない）", () => {
    expect(formatAttackLabel("I", 4)).toBe("I+4");
    expect(formatAttackLabel("S", 0)).toBe("S+0");
    expect(formatAttackLabel("I", 0)).toBe("I+0");
  });

  it("種別なしは符号つき数値のみ", () => {
    expect(formatAttackLabel("", 3)).toBe("+3");
    expect(formatAttackLabel(undefined, 0)).toBe("+0");
  });
});

describe("resolveNoReaction()（リアクションなし=目標値に対象の制御値）", () => {
  it("達成値≥制御値で命中・差分値=達成値−制御値", () => {
    expect(resolveNoReaction(15, 12)).toEqual({ hit: true, diff: 3, targetValue: 12 });
    expect(resolveNoReaction(12, 12)).toEqual({ hit: true, diff: 0, targetValue: 12 });
  });

  it("未達は失敗・差分値は算出されない（勝利時のみ=Check_Rules 2026-07-09 訂正）", () => {
    expect(resolveNoReaction(10, 12)).toEqual({ hit: false, diff: null, targetValue: 12 });
  });
});

describe("resolveOpposed()（対決=受動有利・相手の達成値を上回れば命中・Check_Rules/Combat_Flow）", () => {
  it("攻撃達成値がリアクション達成値を上回れば命中", () => {
    expect(resolveOpposed(18, 15)).toEqual({ hit: true, diff: 3, targetValue: 15 });
  });

  it("同値はリアクション（受動）側の勝利＝攻撃側敗北（受動有利）", () => {
    expect(resolveOpposed(15, 15)).toEqual({ hit: false, diff: null, targetValue: 15 });
  });

  it("未満は攻撃側敗北=攻撃終了・差分値は算出されない（勝利時のみ）", () => {
    expect(resolveOpposed(14, 15)).toEqual({ hit: false, diff: null, targetValue: 15 });
  });

  it("リアクション不成立(達成値0扱い)なら攻撃達成値がそのまま差分値", () => {
    expect(resolveOpposed(16, 0)).toEqual({ hit: true, diff: 16, targetValue: 0 });
  });
});

describe("attackReactionModes()（系統別のリアクション導線・2026-07-08 確定）", () => {
  it("物理=ドッジ/パリー/リアクションしない", () => {
    expect(attackReactionModes("physical")).toEqual(["dodge", "parry", "none"]);
  });

  it("精神・社会=リアクション/リアクションしない の2択", () => {
    expect(attackReactionModes("mental")).toEqual(["reaction", "none"]);
    expect(attackReactionModes("social")).toEqual(["reaction", "none"]);
  });
});

describe("resolveAttackRecheckState()（再判定の置き換え着地・リアクションやり直しなし・2026-07-14 確定）", () => {
  it("新しい判定のファンブル/スート不一致はリアクション以前に失敗が確定する", () => {
    expect(resolveAttackRecheckState({ state: "hit", resolution: "dodge", reactionAchievement: 12 },
      { achievement: 0, fumble: true, suitMismatch: false }))
      .toEqual({ state: "fumble", resolution: "fumble", diff: null });
    expect(resolveAttackRecheckState({ state: "pending", resolution: null, targetUuid: "t" },
      { achievement: 0, fumble: false, suitMismatch: true }))
      .toEqual({ state: "miss", resolution: "mismatch", diff: null });
  });

  it("制御値受け(resolution=none)で解決済みなら保存済みの目標値で再解決する", () => {
    expect(resolveAttackRecheckState({ state: "miss", resolution: "none", targetValue: 12 },
      { achievement: 15, fumble: false, suitMismatch: false }))
      .toEqual({ state: "hit", resolution: "none", diff: 3 });
    expect(resolveAttackRecheckState({ state: "hit", resolution: "none", targetValue: 12 },
      { achievement: 10, fumble: false, suitMismatch: false }))
      .toEqual({ state: "miss", resolution: "none", diff: null });
  });

  it("リアクションで解決済みなら保存済みの相手値で再解決する（やり直しはしない・受動有利）", () => {
    expect(resolveAttackRecheckState({ state: "miss", resolution: "dodge", reactionAchievement: 15 },
      { achievement: 16, fumble: false, suitMismatch: false }))
      .toEqual({ state: "hit", resolution: "dodge", diff: 1 });
    // 同値は受動側の勝利のまま
    expect(resolveAttackRecheckState({ state: "miss", resolution: "parry", reactionAchievement: 15 },
      { achievement: 15, fumble: false, suitMismatch: false }))
      .toEqual({ state: "miss", resolution: "parry", diff: null });
  });

  it("未解決(pending/open)は新しい達成値で仕切り直す（初回のリアクション機会は生きる）", () => {
    expect(resolveAttackRecheckState({ state: "pending", resolution: null, targetUuid: "t" },
      { achievement: 14, fumble: false, suitMismatch: false }))
      .toEqual({ state: "pending", resolution: null, diff: null, targetValue: null, reactionAchievement: null, parryGuard: 0 });
    expect(resolveAttackRecheckState({ state: "open", resolution: null, targetUuid: null },
      { achievement: 14, fumble: false, suitMismatch: false }))
      .toEqual({ state: "open", resolution: null, diff: null, targetValue: null, reactionAchievement: null, parryGuard: 0 });
  });

  it("元がスート不一致/ファンブル失敗（リアクション未実施）なら仕切り直してリアクション機会が生じる", () => {
    expect(resolveAttackRecheckState({ state: "miss", resolution: "mismatch", targetUuid: "t" },
      { achievement: 14, fumble: false, suitMismatch: false }))
      .toEqual({ state: "pending", resolution: null, diff: null, targetValue: null, reactionAchievement: null, parryGuard: 0 });
    expect(resolveAttackRecheckState({ state: "fumble", resolution: "fumble", targetUuid: null },
      { achievement: 14, fumble: false, suitMismatch: false }))
      .toEqual({ state: "open", resolution: null, diff: null, targetValue: null, reactionAchievement: null, parryGuard: 0 });
  });
});

describe("combineWeaponAttack()（複数武器の攻撃力合算・2026-07-09 確定）", () => {
  const W = (name, attackValue, damageType, isFullAuto = false, faValue = 0) =>
    ({ name, attackValue, damageType, isFullAuto, faValue });

  it("武器なしは生身(baseAttack)にフォールバック", () => {
    expect(combineWeaponAttack([], "", { value: 3, damageType: "I" }))
      .toEqual({ weaponAttack: 3, damageType: "I", attackSourceName: "生身", faOptions: [] });
  });

  it("生身の種別未設定は I 既定", () => {
    expect(combineWeaponAttack([], "", {}).damageType).toBe("I");
  });

  it("単一武器はその攻撃力・種別・名前", () => {
    expect(combineWeaponAttack([W("刀", 4, "S")], "", {}))
      .toEqual({ weaponAttack: 4, damageType: "S", attackSourceName: "刀", faOptions: [] });
  });

  it("複数武器は攻撃力を合算し名前を連結", () => {
    const r = combineWeaponAttack([W("刀", 4, "S"), W("小刀", 2, "S")], "", {});
    expect(r.weaponAttack).toBe(6);
    expect(r.attackSourceName).toBe("刀＋小刀");
    expect(r.damageType).toBe("S"); // 同一種別ならその種別
  });

  it("種別が別々のときは override が無ければ先頭の種別", () => {
    expect(combineWeaponAttack([W("刀", 4, "S"), W("拳銃", 3, "I")], "").damageType).toBe("S");
  });

  it("ダメージ種別 override は常に優先(別々のときの選択)", () => {
    expect(combineWeaponAttack([W("刀", 4, "S"), W("拳銃", 3, "I")], "I").damageType).toBe("I");
    expect(combineWeaponAttack([W("刀", 4, "S")], "P").damageType).toBe("P");
  });

  it("FAは自動加算せず faOptions として返す(ダメージダイアログで武器ごとに選択)", () => {
    const r = combineWeaponAttack([
      { itemId: "w1", name: "FA銃", attackValue: 5, damageType: "I", isFullAuto: true, faValue: 3, consumesAmmo: true },
      { itemId: "w2", name: "刀",   attackValue: 4, damageType: "S", isFullAuto: false, faValue: 0 },
    ], "");
    expect(r.weaponAttack).toBe(9); // 攻撃力は合算(FAは別)
    expect(r.faOptions).toEqual([{ itemId: "w1", name: "FA銃", faValue: 3, consumesAmmo: true }]);
  });

  it("FA武器が無ければ faOptions は空", () => {
    expect(combineWeaponAttack([W("刀", 4, "S")], "").faOptions).toEqual([]);
    expect(combineWeaponAttack([], "", {}).faOptions).toEqual([]);
  });

  it("複数のFA武器は両方 faOptions に載る(両方選べば両方加算)・残弾消費有無も伝わる", () => {
    // 自動給弾のFA武器は残弾を追跡しない(consumesAmmo=false)
    const r = combineWeaponAttack([
      { itemId: "a", name: "自動給弾FA銃", attackValue: 5, damageType: "I", isFullAuto: true, faValue: 3, consumesAmmo: false },
      { itemId: "b", name: "通常FA銃",   attackValue: 4, damageType: "I", isFullAuto: true, faValue: 2, consumesAmmo: true },
    ], "");
    expect(r.faOptions.map(o => o.itemId)).toEqual(["a", "b"]);
    expect(r.faOptions[0].consumesAmmo).toBe(false);
    expect(r.faOptions[1].consumesAmmo).toBe(true);
  });
});
