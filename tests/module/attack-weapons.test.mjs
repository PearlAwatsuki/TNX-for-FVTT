import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveAttackRangeValue, attackWeaponDisplayName } =
  await import("../../scripts/module/attack-weapons.mjs");

const w = (min, max) => ({ system: { range: { min, max } } });

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

describe("attackWeaponDisplayName()（戦闘タブと同じ表記）", () => {
  it("通常武器=名前・生身書き換え(全身義体/生身変更)=「生身（名前）」", () => {
    expect(attackWeaponDisplayName({ type: "weapon", name: "カタナ", system: {} })).toBe("カタナ");
    expect(attackWeaponDisplayName({ type: "cyborg", name: "セイバーセンス", system: {} })).toBe("生身（セイバーセンス）");
    expect(attackWeaponDisplayName({ type: "weapon", name: "義腕", system: { isFleshChange: true } })).toBe("生身（義腕）");
  });
});
