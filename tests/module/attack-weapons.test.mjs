import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveAttackRangeValue, resolveAttackRangeSpan, attackWeaponDisplayName, resolvePhysicalAttackWeapons } =
  await import("../../scripts/rules/attack-weapons.mjs");

const w = (min, max) => ({ system: { range: { min, max } } });

it("射撃は選択した射撃武器の実体と射程を使い、準備・参照の不備は起動前に返す", async () => {
  const { resolveWeaponRangeSpan } = await import("../../scripts/core/usage-derivation.mjs");
  const gun = { id: "gun", type: "weapon", system: { ...w("short", "long").system, isRangedWeapon: true, isPrepared: true } };
  const blade = { id: "blade", type: "weapon", system: { ...w("close", "none").system, isMeleeWeapon: true, isPrepared: true, guardValue: { mode: "value", value: 3 } } };
  const actor = { system: { weaponRefs: { attackItemId: "gun" } }, items: new Map([[gun.id, gun], [blade.id, blade]]) };
  const usage = { type: "physicalAttack", attackWeaponKind: "ranged", weaponRefs: [{ itemId: "blade" }] };
  expect(resolvePhysicalAttackWeapons(actor, usage)).toEqual({ weapons: [gun], error: null });
  expect(resolveWeaponRangeSpan(usage, null, actor)).toEqual({ range: "short", rangeMax: "long" });
  expect(resolveWeaponRangeSpan({ ...usage, type: "reaction" }, null, actor)).toEqual({ range: "close", rangeMax: "none" });
  gun.system.isPreparedEffective = false;
  expect(resolvePhysicalAttackWeapons(actor, usage).error).toContain("準備");
  gun.system.noPrepareRequired = true;
  expect(resolvePhysicalAttackWeapons(actor, usage).error).toBeNull();
  actor.items.delete(gun.id);
  expect(resolvePhysicalAttackWeapons(actor, usage).error).toContain("参照先");
});

describe("resolveAttackRangeValue()（射程「武器」の実体解決・2026-07-13）", () => {
  it("実効射程=最長(max 優先・max='none' の単一射程は min)", () => {
    expect(resolveAttackRangeValue([w("none", "short")])).toBe("short");
    expect(resolveAttackRangeValue([w("short", "superLong")])).toBe("superLong");
    expect(resolveAttackRangeValue([w("close", "none")])).toBe("close");
  });

  it("複数武器は最短を採用(※複数は最短の既定)", () => {
    expect(resolveAttackRangeValue([w("none", "superLong"), w("none", "short")])).toBe("short");
  });

  it("武器なし・射程なしは至近(close)=生身の射程(ユーザー確定)", () => {
    expect(resolveAttackRangeValue([])).toBe("close");
    expect(resolveAttackRangeValue([w("none", "none")])).toBe("close");
    expect(resolveAttackRangeValue([{ system: {} }])).toBe("close");
  });
});

describe("resolveAttackRangeSpan()（射程の幅解決・2026-07-16）", () => {
  it("単一武器は自身の幅をそのまま返す(近～遠が潰れない)", () => {
    expect(resolveAttackRangeSpan([w("short", "long")])).toEqual({ min: "short", max: "long" });
    expect(resolveAttackRangeSpan([w("close", "superLong")])).toEqual({ min: "close", max: "superLong" });
  });

  it("単点武器(max='none')・min 未設定は単点", () => {
    expect(resolveAttackRangeSpan([w("close", "none")])).toEqual({ min: "close", max: "none" });
    expect(resolveAttackRangeSpan([w("none", "short")])).toEqual({ min: "short", max: "none" });
  });

  it("複数武器は幅の交差(下限=各下限の最長・上限=各実効の最短)", () => {
    // 近～超遠 × 至近～遠 → 近～遠
    expect(resolveAttackRangeSpan([w("short", "superLong"), w("close", "long")]))
      .toEqual({ min: "short", max: "long" });
    // 近～遠 × 遠(単点) → 遠(単点)
    expect(resolveAttackRangeSpan([w("short", "long"), w("long", "none")]))
      .toEqual({ min: "long", max: "none" });
  });

  it("交差が成立しない組み合わせは従来の単点(最短実効)へフォールバック", () => {
    // 至近(単点) × 中～遠 → 至近(従来の resolveAttackRangeValue と同じ)
    expect(resolveAttackRangeSpan([w("close", "none"), w("middle", "long")]))
      .toEqual({ min: "close", max: "none" });
  });

  it("武器なし・射程なしは至近の単点=生身の射程", () => {
    expect(resolveAttackRangeSpan([])).toEqual({ min: "close", max: "none" });
    expect(resolveAttackRangeSpan([w("none", "none")])).toEqual({ min: "close", max: "none" });
  });

  it("単一値解決(resolveAttackRangeValue)は常に幅の上限と一致する(挙動不変)", () => {
    const cases = [
      [w("short", "long")],
      [w("none", "short")],
      [w("short", "superLong"), w("close", "long")],
      [w("close", "none"), w("middle", "long")],
      [],
    ];
    for (const weapons of cases) {
      const span = resolveAttackRangeSpan(weapons);
      const eff = span.max !== "none" ? span.max : span.min;
      expect(resolveAttackRangeValue(weapons)).toBe(eff);
    }
  });
});

describe("attackWeaponDisplayName()（戦闘タブと同じ表記）", () => {
  it("通常武器=名前・生身書き換え(全身義体/生身変更)=「生身（名前）」", () => {
    expect(attackWeaponDisplayName({ type: "weapon", name: "カタナ", system: {} })).toBe("カタナ");
    expect(attackWeaponDisplayName({ type: "cyborg", name: "セイバーセンス", system: {} })).toBe("生身（セイバーセンス）");
    expect(attackWeaponDisplayName({ type: "weapon", name: "義腕", system: { isFleshChange: true } })).toBe("生身（義腕）");
  });
});
