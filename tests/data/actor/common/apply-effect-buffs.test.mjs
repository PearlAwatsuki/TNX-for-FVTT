import { describe, it, expect, vi } from "vitest";
import "../../../setup.mjs";

// 実行検証(2026-07-13): アイテム AE の適用エンジン(_applyEffectBuffs)を実コードのまま走らせる。
// 「素のパラメータキーで書き換わらない」報告に対し、エンジン経路を推測でなく実行で確認するための
// テスト。2026-07-13 再設計で綴りは item.self.system.* → 素の system.* へ移行し、
// 自動適用ゲート(transfer)が加わった。
// - setProperty / deepClone は setup に無いためここで補う(実装は Foundry 相当の最小)
foundry.utils.setProperty ??= (obj, path, value) => {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] === null || cur[p] === undefined) cur[p] = {};
    cur = cur[p];
  }
  cur[parts.at(-1)] = value;
  return true;
};
foundry.utils.getProperty ??= (obj, path) =>
  path.split(".").reduce((o, p) => o?.[p], obj);

const { CharacterBaseDataModel } = await import("../../../../scripts/data/actor/common/character-base.mjs");

/** 効果モック(実 ActiveEffect の読み取り面だけ)。apply は呼び出し記録用。 */
function effectMock({ id = "e1", changes, disabled = false, transfer = true, flags = {} }) {
  return {
    id, name: "テスト効果", img: "",
    active: !disabled, disabled, transfer,
    flags,
    changes,
    apply: vi.fn(),
  };
}

/** 武器モック(実 prepareDerivedData 後の形: total=base / damageTypeTotal=base 済み)。 */
function weaponMock(effects = []) {
  const weapon = {
    id: "w1", documentName: "Item", name: "新規白兵武器",
    system: {
      identificationKey: "",
      attack: { damageType: "I", value: 4, total: 4, damageTypeTotal: "I" },
      isPrepared: true,
    },
    effects,
  };
  // 実 ActiveEffect と同じく parent がアイテムを指す(自動適用ゲートの判定に使う)
  for (const e of effects) e.parent = weapon;
  return weapon;
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
  it("system.attack.damageType（上書き・値 S）→ 実効 damageTypeTotal が S になり素値は不変", () => {
    const weapon = weaponMock([effectMock({ changes: [
      { key: "system.attack.damageType", mode: 5, value: "S" },
    ] })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("S");
    expect(weapon.system.attack.damageType).toBe("I"); // 設定欄(素値)は絶対に触らない
  });

  it("モードが追加(ADD)でも種別は上書きとして適用される（文字列に加算は無意味）", () => {
    const weapon = weaponMock([effectMock({ changes: [
      { key: "system.attack.damageType", mode: 2, value: "P" },
    ] })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("P");
  });

  it("system.attack.value（追加）→ effect.apply が実効パス attack.total へモードそのまま委譲", () => {
    const eff = effectMock({ changes: [
      { key: "system.attack.value", mode: 2, value: "2" },
    ] });
    const weapon = weaponMock([eff]);
    runBuffs([weapon]);
    expect(eff.apply).toHaveBeenCalledTimes(1);
    const [doc, change] = eff.apply.mock.calls[0];
    expect(doc).toBe(weapon);
    expect(change.key).toBe("system.attack.total"); // base(value)でなく実効(total)へ
    expect(change.mode).toBe(2);
    expect(change.value).toBe("2");
  });

  it("値が空（セレクト未選択）の種別上書きは何もしない", () => {
    const weapon = weaponMock([effectMock({ changes: [
      { key: "system.attack.damageType", mode: 5, value: "" },
    ] })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
  });

  it("旧綴り（item.self.system.…）は廃止済みでパースされず何も起きない", () => {
    const weapon = weaponMock([effectMock({ changes: [
      { key: "item.self.system.attack.damageType", mode: 5, value: "S" },
    ] })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
  });

  it("無効化された効果は適用されない", () => {
    const weapon = weaponMock([effectMock({ disabled: true, changes: [
      { key: "system.attack.damageType", mode: 5, value: "S" },
    ] })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
  });

  it("自動適用オフ（transfer=false）のペイロードは適用されない（2026-07-13 再設計）", () => {
    const weapon = weaponMock([effectMock({ transfer: false, changes: [
      { key: "system.attack.damageType", mode: 5, value: "S" },
      { key: "system.attack.value", mode: 2, value: "2" },
    ] })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("I");
    expect(weapon.effects[0].apply).not.toHaveBeenCalled();
  });

  it("転送コピー（transferredFrom）は transfer=false でも適用される（実体化済みインスタンス）", () => {
    const weapon = weaponMock([effectMock({ transfer: false,
      flags: { "tokyo-nova-axleration": { transferredFrom: "Actor.a.Item.o1.ActiveEffect.e9" } },
      changes: [{ key: "system.attack.damageType", mode: 5, value: "S" }],
    })]);
    runBuffs([weapon]);
    expect(weapon.system.attack.damageTypeTotal).toBe("S");
  });

  it("付与コピー（grantedFrom）は transfer=false でも適用される（使用時付与の着地）", () => {
    const weapon = weaponMock([effectMock({ transfer: false,
      flags: { "tokyo-nova-axleration": { grantedFrom: "Actor.a.Item.s1.ActiveEffect.e9" } },
      changes: [{ key: "system.attack.value", mode: 2, value: "3" }],
    })]);
    runBuffs([weapon]);
    expect(weapon.effects[0].apply).toHaveBeenCalledTimes(1);
  });

  it("「準備先（親アイテム）に適用」の供給元自身は適用されない（準備先の転送コピーが担う）", () => {
    const weapon = weaponMock([effectMock({
      flags: { "tokyo-nova-axleration": { applyToParent: true } },
      changes: [{ key: "system.attack.value", mode: 2, value: "2" }],
    })]);
    runBuffs([weapon]);
    expect(weapon.effects[0].apply).not.toHaveBeenCalled();
  });

  it("cs.current（CSカレントへのバフ）の AE は currentBuff へ着地し currentTotal には乗らない（一度計算・凍結・2026-07-21）", () => {
    const effect = effectMock({ changes: [{ key: "system.cs.current", mode: 2, value: "3" }] });
    const weapon = weaponMock([effect]);
    const actor = {
      documentName: "Actor",
      effects: [],
      items: Object.assign([weapon], { get: (id) => [weapon].find(i => i.id === id) }),
      system: { combatSpeed: { baseTotal: 5, valueTotal: 5, currentTotal: 5, currentBuff: 0 } },
    };
    const self = Object.create(CharacterBaseDataModel.prototype);
    self.parent = actor;
    self._applyEffectBuffs();
    const keys = effect.apply.mock.calls.map(c => c[1]?.key);
    expect(keys).toContain("system.combatSpeed.currentBuff");   // 蓄積先＝焼き込み用
    expect(keys).not.toContain("system.combatSpeed.currentTotal"); // 実効値には毎回足さない
  });
});
