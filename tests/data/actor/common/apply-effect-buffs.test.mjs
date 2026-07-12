import { describe, it, expect, vi } from "vitest";
import "../../../setup.mjs";

// 実行検証(2026-07-13): アイテム AE の適用エンジン(_applyEffectBuffs)を実コードのまま走らせる。
// 「item.self.system.attack.damageType で書き換わらない」報告に対し、エンジン経路を
// 推測でなく実行で確認するためのテスト。
// - setProperty / deepClone は setup に無いためここで補う(実装は Foundry 相当の最小)
foundry.utils.setProperty ??= (obj, path, value) => {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] == null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
  return true;
};
foundry.utils.getProperty ??= (obj, path) =>
  path.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);

const { CharacterBaseDataModel } = await import("../../../../scripts/data/actor/common/character-base.mjs");

/** 効果モック(実 ActiveEffect の読み取り面だけ)。apply は呼び出し記録用。 */
function effectMock({ id = "e1", changes, disabled = false }) {
  return {
    id, name: "テスト効果", img: "",
    active: !disabled, disabled,
    flags: {},
    changes,
    apply: vi.fn(),
  };
}

/** 武器モック(実 prepareDerivedData 後の形: total=base / damageTypeTotal=base 済み)。 */
function weaponMock(effects = []) {
  return {
    id: "w1", documentName: "Item", name: "新規白兵武器",
    system: {
      identificationKey: "",
      attack: { damageType: "I", value: 4, total: 4, damageTypeTotal: "I" },
      isPrepared: true,
    },
    effects,
  };
}

function runBuffs(items, actorEffects = []) {
  const actor = {
    documentName: "Actor",
    effects: actorEffects,
    items: Object.assign(items, { get: (id) => items.find(i => i.id === id) }),
  };
  const self = Object.create(CharacterBaseDataModel.prototype);
  self.parent = actor;
  self._applyEffectBuffs();
  return actor;
}

describe("_applyEffectBuffs 実行検証（アイテム AE・2026-07-13）", () => {
  it("item.self.system.attack.damageType（上書き・値 S）→ 実効 damageTypeTotal が S になり素値は不変", () => {
    const weapon = weaponMock();
    weapon.effects = [effectMock({ changes: [
      { key: "item.self.system.attack.damageType", mode: 5, value: "S" },
    ] })];
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("S");
    expect(weapon.system.attack.damageType).toBe("I"); // 設定欄(素値)は絶対に触らない
  });

  it("モードが追加(ADD)でも種別は上書きとして適用される（文字列に加算は無意味）", () => {
    const weapon = weaponMock();
    weapon.effects = [effectMock({ changes: [
      { key: "item.self.system.attack.damageType", mode: 2, value: "P" },
    ] })];
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("P");
  });

  it("item.self.system.attack.value（追加）→ effect.apply が実効パス attack.total へモードそのまま委譲", () => {
    const weapon = weaponMock();
    const eff = effectMock({ changes: [
      { key: "item.self.system.attack.value", mode: 2, value: "2" },
    ] });
    weapon.effects = [eff];
    runBuffs([weapon]);
    expect(eff.apply).toHaveBeenCalledTimes(1);
    const [doc, change] = eff.apply.mock.calls[0];
    expect(doc).toBe(weapon);
    expect(change.key).toBe("system.attack.total"); // base(value)でなく実効(total)へ
    expect(change.mode).toBe(2);
    expect(change.value).toBe("2");
  });

  it("値が空（セレクト未選択）の種別上書きは何もしない", () => {
    const weapon = weaponMock();
    weapon.effects = [effectMock({ changes: [
      { key: "item.self.system.attack.damageType", mode: 5, value: "" },
    ] })];
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
  });

  it("キーの綴り違い（tem.self.…）はパースされず何も起きない", () => {
    const weapon = weaponMock();
    weapon.effects = [effectMock({ changes: [
      { key: "tem.self.system.attack.damageType", mode: 5, value: "S" },
    ] })];
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
  });

  it("無効化された効果は適用されない", () => {
    const weapon = weaponMock();
    weapon.effects = [effectMock({ disabled: true, changes: [
      { key: "item.self.system.attack.damageType", mode: 5, value: "S" },
    ] })];
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
  });
});
