/**
 * @fileoverview ルール層の未到達 export の挙動を固定する(2026-09-07・フェーズ18)。
 *
 * scripts/rules/ と scripts/data/ は「テストのあるファイル」で見れば 100% だが、関数単位で
 * 見ると一度も呼ばれていない export が残っていた。ここで扱うのは、そのうち**壊れても静かに
 * 間違った結果を出す**もの——種別の分類、データ移行、適格判定。
 *
 * 判定の基準は各関数の定義そのもの(表を引く関数は表を、移行は変換式を)。値を直書きせず
 * 定義側の表から導けるものは表から導き、表を書き換えたときにここが追随するようにする。
 */

import { describe, it, expect } from "vitest";
import {
  isAttackType, isReactionType, usesVehicle, effectiveBaseSkillId, USAGE_TYPE_DEFS,
} from "../../scripts/rules/usage-types.mjs";
import { migrateUsesValueToSpent } from "../../scripts/data/item/helpers.mjs";
import {
  isMajorLevelSlotMajor, MAJOR_LEVEL_SLOT_MAJORS, OUTFIT_CATEGORIES,
} from "../../scripts/data/item/outfit-categories.mjs";
import { isSameReceivedScene } from "../../scripts/rules/miracle.mjs";
import { attackWeaponKindEligible } from "../../scripts/rules/attack-weapons.mjs";

const typesOf = (pred) => Object.keys(USAGE_TYPE_DEFS).filter(pred);

describe("用途タイプの分類（表と述語が食い違わない）", () => {
  it("isAttackType は kind=attack のタイプちょうどに一致する", () => {
    const byDef = typesOf(t => USAGE_TYPE_DEFS[t].kind === "attack");
    expect(byDef.length).toBeGreaterThan(0);          // 空振り防止
    expect(typesOf(isAttackType)).toEqual(byDef);
  });

  it("isReactionType は kind=reaction のタイプちょうどに一致する", () => {
    const byDef = typesOf(t => USAGE_TYPE_DEFS[t].kind === "reaction");
    expect(byDef.length).toBeGreaterThan(0);
    expect(typesOf(isReactionType)).toEqual(byDef);
  });

  it("攻撃とリアクションは排他（同じタイプが両方になることはない）", () => {
    for (const t of Object.keys(USAGE_TYPE_DEFS)) {
      expect(isAttackType(t) && isReactionType(t)).toBe(false);
    }
  });

  it("usesVehicle は usesVehicle=true のタイプちょうどに一致する", () => {
    const byDef = typesOf(t => USAGE_TYPE_DEFS[t].usesVehicle === true);
    expect(byDef.length).toBeGreaterThan(0);
    expect(typesOf(usesVehicle)).toEqual(byDef);
  });

  it("知らないタイプ・未設定はどの述語も false（未知を攻撃扱いしない）", () => {
    for (const v of ["nosuchType", "", null, undefined]) {
      expect(isAttackType(v)).toBe(false);
      expect(isReactionType(v)).toBe(false);
      expect(usesVehicle(v)).toBe(false);
    }
  });
});

describe("effectiveBaseSkillId()（用途の実効ベース技能）", () => {
  const item = (over = {}) => ({ id: "self", system: {}, ...over });

  it("アクション技能は常に自身がベース（baseSkillRef があっても無視する）", () => {
    const action = item({ system: { isAction: true } });
    expect(effectiveBaseSkillId({ baseSkillRef: { itemId: "other" } }, action)).toBe("self");
  });

  it("非アクションは baseSkillRef を使う", () => {
    expect(effectiveBaseSkillId({ baseSkillRef: { itemId: "other" } }, item())).toBe("other");
  });

  it("baseSkillRef が無い・空なら親自身へ落ちる（未永続の瞬間の安全網）", () => {
    expect(effectiveBaseSkillId({ baseSkillRef: { itemId: "" } }, item())).toBe("self");
    expect(effectiveBaseSkillId({}, item())).toBe("self");
    expect(effectiveBaseSkillId(null, item())).toBe("self");
  });

  it("親も無ければ空文字（undefined を id として撒かない）", () => {
    expect(effectiveBaseSkillId(null, null)).toBe("");
    expect(effectiveBaseSkillId({}, {})).toBe("");
  });
});

describe("migrateUsesValueToSpent()（残り回数 → 消費済み回数の移行）", () => {
  it("spent = max - value に変換し、旧 value を消す", () => {
    const src = { uses: { max: 3, value: 1 } };
    migrateUsesValueToSpent(src);
    expect(src.uses).toEqual({ max: 3, spent: 2 });
  });

  it("使い切り(value=0)は spent=max・未使用(value=max)は spent=0", () => {
    const full = { uses: { max: 3, value: 0 } };
    migrateUsesValueToSpent(full);
    expect(full.uses.spent).toBe(3);
    const none = { uses: { max: 3, value: 3 } };
    migrateUsesValueToSpent(none);
    expect(none.uses.spent).toBe(0);
  });

  it("範囲外の値は [0, max] に丸める（負の消費・上限超えを作らない）", () => {
    const over = { uses: { max: 2, value: -5 } };   // max - value = 7 → 2
    migrateUsesValueToSpent(over);
    expect(over.uses.spent).toBe(2);
    const under = { uses: { max: 2, value: 9 } };   // max - value = -7 → 0
    migrateUsesValueToSpent(under);
    expect(under.uses.spent).toBe(0);
  });

  it("max が無ければ 0 として扱う（spent も 0）", () => {
    const src = { uses: { value: 4 } };
    migrateUsesValueToSpent(src);
    expect(src.uses.spent).toBe(0);
  });

  it("冪等: 移行済み(spent がある)データは触らない", () => {
    const done = { uses: { max: 3, spent: 1 } };
    migrateUsesValueToSpent(done);
    expect(done.uses).toEqual({ max: 3, spent: 1 });
    // 何かの拍子に value が復活しても、spent があれば上書きしない
    const both = { uses: { max: 3, spent: 1, value: 3 } };
    migrateUsesValueToSpent(both);
    expect(both.uses.spent).toBe(1);
  });

  it("value が数でない・uses が無い・source が無くても落ちない", () => {
    const s1 = { uses: { max: 3, value: "1" } };
    migrateUsesValueToSpent(s1);
    expect(s1.uses.spent).toBeUndefined();
    expect(() => migrateUsesValueToSpent({})).not.toThrow();
    expect(() => migrateUsesValueToSpent(null)).not.toThrow();
  });
});

describe("isMajorLevelSlotMajor()（大分類レベルでスロットを共有する分類）", () => {
  it("表に載っている大分類だけが true", () => {
    for (const k of MAJOR_LEVEL_SLOT_MAJORS) expect(isMajorLevelSlotMajor(k)).toBe(true);
    for (const k of Object.keys(OUTFIT_CATEGORIES)) {
      expect(isMajorLevelSlotMajor(k)).toBe(MAJOR_LEVEL_SLOT_MAJORS.includes(k));
    }
  });

  it("知らないキー・未設定は false", () => {
    expect(isMajorLevelSlotMajor("nosuch")).toBe(false);
    expect(isMajorLevelSlotMajor("")).toBe(false);
    expect(isMajorLevelSlotMajor(undefined)).toBe(false);
  });
});

describe("isSameReceivedScene()（神業を受けたシーンの同一性）", () => {
  const sc = (act, number) => ({ act, number });

  it("アクトとシーン番号が両方一致すれば同じシーン", () => {
    expect(isSameReceivedScene(sc("a1", 2), sc("a1", 2))).toBe(true);
  });

  it("どちらかが違えば別のシーン", () => {
    expect(isSameReceivedScene(sc("a1", 2), sc("a1", 3))).toBe(false);
    expect(isSameReceivedScene(sc("a1", 2), sc("a2", 2))).toBe(false);
  });

  it("シーン番号は数として比べる（文字列で入っていても同じ扱い）", () => {
    expect(isSameReceivedScene(sc("a1", 2), sc("a1", "2"))).toBe(true);
  });

  it("検査できないものはゲートしない＝欠けていれば同じ扱い(true)", () => {
    expect(isSameReceivedScene(null, sc("a1", 2))).toBe(true);
    expect(isSameReceivedScene(sc("a1", 2), null)).toBe(true);
    expect(isSameReceivedScene(sc(undefined, 2), sc("a1", 2))).toBe(true);
    expect(isSameReceivedScene(sc("a1", null), sc("a1", 2))).toBe(true);
    expect(isSameReceivedScene({}, {})).toBe(true);
  });

  it("シーン番号 0 は「欠けている」ではない（偽値の取りこぼしを作らない）", () => {
    expect(isSameReceivedScene(sc("a1", 0), sc("a1", 0))).toBe(true);
    expect(isSameReceivedScene(sc("a1", 0), sc("a1", 1))).toBe(false);
  });
});

describe("attackWeaponKindEligible()（白兵／射撃の使用武器として適格か）", () => {
  const w = (system, type = "weapon") => ({ type, system });

  it("射撃は射撃武器フラグの武器のみ（生身では行えない）", () => {
    expect(attackWeaponKindEligible(w({ isRangedWeapon: true }), "ranged")).toBe(true);
    expect(attackWeaponKindEligible(w({ isMeleeWeapon: true }), "ranged")).toBe(false);
    expect(attackWeaponKindEligible(w({}, "cyborg"), "ranged")).toBe(false);
  });

  it("白兵は白兵武器フラグに加えてサイボーグ体を認める", () => {
    expect(attackWeaponKindEligible(w({ isMeleeWeapon: true }), "melee")).toBe(true);
    expect(attackWeaponKindEligible(w({}, "cyborg"), "melee")).toBe(true);
    expect(attackWeaponKindEligible(w({ isRangedWeapon: true }), "melee")).toBe(false);
  });

  it("白兵は生身書き換え装備(isFleshChange)も認める＝素手で殴れる体", () => {
    expect(attackWeaponKindEligible(w({ isFleshChange: true }), "melee")).toBe(true);
    expect(attackWeaponKindEligible(w({ isFleshChange: false }), "melee")).toBe(false);
    // 射撃は生身では行えないので、生身書き換えでも不適格
    expect(attackWeaponKindEligible(w({ isFleshChange: true }), "ranged")).toBe(false);
  });

  it("フラグは実効値(<フラグ>Total)を優先して読む＝AE のオン/オフが効く", () => {
    // AE でオンにされた: base は false でも Total が真なら適格
    expect(attackWeaponKindEligible(
      w({ isFleshChange: false, isFleshChangeTotal: true }), "melee")).toBe(true);
    // AE でオフにされた: base が真でも Total が偽なら不適格
    expect(attackWeaponKindEligible(
      w({ isFleshChange: true, isFleshChangeTotal: false }), "melee")).toBe(false);
  });

  it("武器が無ければ不適格（未指定を通さない）", () => {
    expect(attackWeaponKindEligible(null, "melee")).toBe(false);
    expect(attackWeaponKindEligible(undefined, "ranged")).toBe(false);
    expect(attackWeaponKindEligible(w(null), "melee")).toBe(false);
  });
});
