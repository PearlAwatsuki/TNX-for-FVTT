import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { aggregateDefence, defenceForType, computeDamage, splitSharedBonusRows } =
  await import("../../scripts/module/damage-logic.mjs");

const armor = (S, P, I, { prepared = true, mode = "value" } = {}) => ({
  type: "armor",
  system: { isPrepared: prepared, defence: { mode, S_defence: S, P_defence: P, I_defence: I } },
});

describe("aggregateDefence()（防御力の合算・戦闘タブ規約）", () => {
  it("準備済み armor/cyborg の S/P/I を合算する", () => {
    const items = [armor(3, 2, 1), { type: "cyborg", system: { isPrepared: true, defence: { mode: "value", S_total: 2, P_total: 2, I_total: 2 } } }];
    expect(aggregateDefence(items)).toEqual({ S: 5, P: 4, I: 3 });
  });

  it("未準備・mode≠value・防具以外は除外", () => {
    const items = [armor(3, 3, 3, { prepared: false }), armor(1, 1, 1, { mode: "none" }), { type: "weapon", system: {} }];
    expect(aggregateDefence(items)).toEqual({ S: 0, P: 0, I: 0 });
  });

  it("S_total を S_defence より優先(派生値がある場合)", () => {
    const items = [{ type: "armor", system: { isPrepared: true, defence: { mode: "value", S_total: 9, S_defence: 3, P_defence: 0, I_defence: 0 } } }];
    expect(aggregateDefence(items).S).toBe(9);
  });

  it("搭乗中(準備済み)ヴィークルの防御力も合算する(戦闘タブ合計と一致・2026-07-16)", () => {
    const items = [
      armor(2, 2, 2),
      { type: "vehicle", system: { isPrepared: true, defence: { mode: "value", S_defence: 4, P_defence: 3, I_defence: 1 } } },
    ];
    expect(aggregateDefence(items)).toEqual({ S: 6, P: 5, I: 3 });
  });
});

describe("defenceForType()（ダメージ種別に対応する防御力・X は軽減なし）", () => {
  const def = { S: 5, P: 3, I: 1 };
  it("S/P/I はそれぞれの防御力", () => {
    expect(defenceForType(def, "S")).toBe(5);
    expect(defenceForType(def, "P")).toBe(3);
    expect(defenceForType(def, "I")).toBe(1);
  });
  it("X・未指定は 0（対応防御力なし）", () => {
    expect(defenceForType(def, "X")).toBe(0);
    expect(defenceForType(def, "")).toBe(0);
  });
});

describe("computeDamage()（攻撃側合計→恒久軽減→10上限→事後修正→適用時軽減・Damage_Rules 1〜6）", () => {
  it("max(0, カード+攻撃力+修正 − 恒久軽減)・参照値=min(値,21)", () => {
    expect(computeDamage({ damageCard: 8, attackPower: 5, modifier: 2, mitigation: 3 }))
      .toEqual({ raw: 15, calc: 12, attack: 12, final: 12, stage: 12, capped: false });
  });

  it("恒久軽減は丸める前の生ダメージに効く（21 頭打ちは参照値のみ）", () => {
    // 35ダメージを15軽減 → 20
    expect(computeDamage({ damageCard: 21, attackPower: 14, modifier: 0, mitigation: 15 }))
      .toEqual({ raw: 35, calc: 20, attack: 20, final: 20, stage: 20, capped: false });
    // 5軽減 → 30 → 参照値21
    expect(computeDamage({ damageCard: 21, attackPower: 14, modifier: 0, mitigation: 5 }))
      .toEqual({ raw: 35, calc: 30, attack: 30, final: 30, stage: 21, capped: false });
  });

  it("下限0（軽減が生ダメージを上回る）", () => {
    expect(computeDamage({ damageCard: 3, attackPower: 0, modifier: 0, mitigation: 10 }))
      .toEqual({ raw: 3, calc: -7, attack: -7, final: 0, stage: 0, capped: false });
  });

  it("スタン/説得: 恒久軽減を引いた後＝算出の一番最後に10上限（2026-07-16 裁定=KI-024）", () => {
    // KI-024 の正例: 攻撃側合計18・防御力5 → 13 → 10（旧実装 min(18,10)−5=5 は過小で誤り）
    expect(computeDamage({ damageCard: 18, attackPower: 0, modifier: 0, mitigation: 5, stun: true }))
      .toEqual({ raw: 18, calc: 10, attack: 10, final: 10, stage: 10, capped: true });
    // 恒久軽減で10以下まで下がれば上限は掛からない
    expect(computeDamage({ damageCard: 20, attackPower: 0, modifier: 0, mitigation: 15, stun: true }))
      .toEqual({ raw: 20, calc: 5, attack: 5, final: 5, stage: 5, capped: false });
    // 軽減0: 20 → 10
    expect(computeDamage({ damageCard: 20, attackPower: 0, modifier: 0, mitigation: 0, stun: true }))
      .toEqual({ raw: 20, calc: 10, attack: 10, final: 10, stage: 10, capped: true });
    // 10未満はそのまま
    expect(computeDamage({ damageCard: 7, attackPower: 0, modifier: 0, mitigation: 0, stun: true }))
      .toEqual({ raw: 7, calc: 7, attack: 7, final: 7, stage: 7, capped: false });
  });

  it("事後修正(postModifier)は10上限の後に乗る（算出後〜適用前・2026-07-16 ユーザー裁定）", () => {
    // 15 → 10上限 → 事後修正−5 → 5（上限前に合算すると min(15−5,10)=10 になってしまう）
    expect(computeDamage({ damageCard: 15, postModifier: -5, stun: true }))
      .toEqual({ raw: 15, calc: 10, attack: 5, final: 5, stage: 5, capped: true });
    // 正の事後修正は上限の後に加算＝10を超えられる（恒久軽減 15−3=12 → 10 → +3）
    expect(computeDamage({ damageCard: 15, mitigation: 3, postModifier: 3, stun: true }))
      .toEqual({ raw: 15, calc: 10, attack: 13, final: 13, stage: 13, capped: true });
  });

  it("適用時の軽減(applyMitigation=手動・報酬点)は事後修正のさらに後に引く", () => {
    // 18 − 防御5 = 13 → 10上限 → 手動軽減4 → 6
    expect(computeDamage({ damageCard: 18, mitigation: 5, applyMitigation: 4, stun: true }))
      .toEqual({ raw: 18, calc: 10, attack: 10, final: 6, stage: 6, capped: true });
  });

  it("スタン/説得でなければ各段は単純な線形加減算", () => {
    expect(computeDamage({ damageCard: 8, postModifier: 2, applyMitigation: 3 }))
      .toEqual({ raw: 8, calc: 8, attack: 10, final: 7, stage: 7, capped: false });
  });
});

describe("splitSharedBonusRows()（対象ごと評価の行を共有/個別へ分ける・2026-09-01）", () => {
  const row = (name, value, note) => ({ name, value, ...(note ? { note } : {}) });

  it("対象が1体なら全行が共有（従来と同じ見た目）", () => {
    const rows = [row("技能A", 5), row("技能B", 3)];
    const { shared, extras } = splitSharedBonusRows([rows]);
    expect(shared).toEqual(rows);
    expect(extras).toEqual([[]]);
  });

  it("全対象で同じ行は共有・違う行だけ対象ごとに残る", () => {
    const { shared, extras } = splitSharedBonusRows([
      [row("技能A", 5), row("技能B", 0, "ウェット無効")],
      [row("技能A", 5), row("技能B", 3)],
    ]);
    expect(shared).toEqual([row("技能A", 5)]);
    expect(extras).toEqual([[row("技能B", 0, "ウェット無効")], [row("技能B", 3)]]);
  });

  it("値が同じでも注記が違えば別の行として扱う", () => {
    const { shared, extras } = splitSharedBonusRows([
      [row("技能A", 0, "ウェット無効")],
      [row("技能A", 0, "カブキのみ・対象外")],
    ]);
    expect(shared).toEqual([]);
    expect(extras[0]).toEqual([row("技能A", 0, "ウェット無効")]);
    expect(extras[1]).toEqual([row("技能A", 0, "カブキのみ・対象外")]);
  });

  it("対象ごとに個数が違う行（対象条件つき AE）は共通個数だけ共有へ", () => {
    const { shared, extras } = splitSharedBonusRows([
      [row("与ダメ", 2), row("対アヤカシ", 4)],
      [row("与ダメ", 2)],
    ]);
    expect(shared).toEqual([row("与ダメ", 2)]);
    expect(extras).toEqual([[row("対アヤカシ", 4)], []]);
  });

  it("同名同値の行が複数あっても個数で対応づける", () => {
    const { shared, extras } = splitSharedBonusRows([
      [row("用途", 1), row("用途", 1)],
      [row("用途", 1)],
    ]);
    expect(shared).toEqual([row("用途", 1)]);
    expect(extras).toEqual([[row("用途", 1)], []]);
  });

  it("全対象で完全に一致すれば個別は空・対象なしは空を返す", () => {
    const rows = [row("技能A", 5)];
    expect(splitSharedBonusRows([rows, rows, rows])).toEqual({ shared: rows, extras: [[], [], []] });
    expect(splitSharedBonusRows([])).toEqual({ shared: [], extras: [] });
  });
});
