import { describe, it, expect } from "vitest";
import { buildRlDamageRollFlag, rlGrantAmount, rlGrantLedgerRow } from "../../scripts/module/rl-grant-logic.mjs";

const TARGETS = [
  { uuid: "Actor.aaa", name: "キャストA" },
  { uuid: "Actor.bbb", name: "キャストB" },
];

describe("buildRlDamageRollFlag()（RL 任意ダメージ付与・2026-07-20 確定）", () => {
  it("系統と値を持ち、既存のダメージカードと同じ形の damageRoll フラグを返す", () => {
    const f = buildRlDamageRollFlag({ targets: TARGETS, category: "physical", value: 7, note: "落下" });
    expect(f.category).toBe("physical");
    expect(f.rlGrant).toEqual({ value: 7, note: "落下" });
    expect(f.applied).toBe(false);
    expect(f.appliedResult).toBeNull();
    expect(f.mods).toEqual([]);
  });

  it("攻撃固有の要素を持たない（カードを出さない・攻撃力なし・攻撃元なし・スタン宣言なし）", () => {
    const f = buildRlDamageRollFlag({ targets: TARGETS, category: "physical", value: 7, note: "" });
    expect(f.cards).toEqual([]);
    expect(f.attackPower).toBe(0);
    expect(f.attackSourceName).toBe("");
    expect(f.attackMessageId).toBeNull();
    expect(f.attackerUuid).toBeNull();
    expect(f.stun).toBe(false);
    expect(f.damageBonuses).toEqual([]);
    expect(f.manualMod).toBe(0);
  });

  it("対象を damageRoll の対象行に展開する（リアクションが無いため受け値0・成立なし）", () => {
    const f = buildRlDamageRollFlag({ targets: TARGETS, category: "social", value: 3, note: "" });
    expect(f.targets).toEqual([
      { uuid: "Actor.aaa", name: "キャストA", parryGuard: 0, reactionEstablished: false },
      { uuid: "Actor.bbb", name: "キャストB", parryGuard: 0, reactionEstablished: false },
    ]);
  });

  it("自由記述は空でも成立する", () => {
    const f = buildRlDamageRollFlag({ targets: TARGETS, category: "mental", value: 5 });
    expect(f.rlGrant.note).toBe("");
  });

  it("値0でもカードは成立する（適用するかは卓が判断する）", () => {
    const f = buildRlDamageRollFlag({ targets: TARGETS, category: "physical", value: 0, note: "" });
    expect(f.rlGrant.value).toBe(0);
  });

  it("負値・非数は0として扱う（負のダメージは存在しない）", () => {
    expect(buildRlDamageRollFlag({ targets: TARGETS, category: "physical", value: -5 }).rlGrant.value).toBe(0);
    expect(buildRlDamageRollFlag({ targets: TARGETS, category: "physical", value: NaN }).rlGrant.value).toBe(0);
    expect(buildRlDamageRollFlag({ targets: TARGETS, category: "physical", value: undefined }).rlGrant.value).toBe(0);
  });

  it("対象なしでも成立する（対象行が空）", () => {
    const f = buildRlDamageRollFlag({ targets: [], category: "physical", value: 4 });
    expect(f.targets).toEqual([]);
  });
});

describe("rlGrantAmount()（攻撃側合計への寄与）", () => {
  it("RL 付与の値を返す", () => {
    expect(rlGrantAmount(buildRlDamageRollFlag({ targets: [], category: "physical", value: 9 }))).toBe(9);
  });

  it("攻撃由来のダメージカード（rlGrant を持たない）では0を返す", () => {
    expect(rlGrantAmount({ cards: [{ value: 5 }], attackPower: 3 })).toBe(0);
    expect(rlGrantAmount(null)).toBe(0);
  });
});

describe("rlGrantLedgerRow()（台帳の行）", () => {
  it("自由記述を行のラベルに使う", () => {
    const f = buildRlDamageRollFlag({ targets: [], category: "physical", value: 7, note: "落下" });
    expect(rlGrantLedgerRow(f)).toEqual({ label: "ダメージ（落下）", value: 7 });
  });

  it("自由記述が無ければ素の「ダメージ」を行のラベルにする", () => {
    const f = buildRlDamageRollFlag({ targets: [], category: "physical", value: 7 });
    expect(rlGrantLedgerRow(f)).toEqual({ label: "ダメージ", value: 7 });
  });

  it("攻撃由来のダメージカードでは行を作らない", () => {
    expect(rlGrantLedgerRow({ cards: [{ value: 5 }] })).toBeNull();
    expect(rlGrantLedgerRow(null)).toBeNull();
  });
});
