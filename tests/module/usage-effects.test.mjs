import { describe, it, expect } from "vitest";

const { resolveUsageEffectData, splitEffectsByTiming, attackCardEffectMode,
        prepareUsageEffectPayload, hitEffectTargetRefs } =
    await import("../../scripts/module/usage-effects.mjs");

// toObject を持つ簡易 effect / effects コレクション
const mkEffect = (id, name) => ({ id, name, toObject: () => ({ _id: id, name, disabled: true, transfer: true }) });
const mkEffects = (effs) => ({ get: (id) => effs.find(e => e.id === id) ?? null });

describe("resolveUsageEffectData()（用途effects→付与用AEデータ・2026-07-10）", () => {
  const parentItem = { id: "parent1", effects: mkEffects([mkEffect("e_par", "毒")]) };
  const weapon = { id: "wep1", effects: mkEffects([mkEffect("e_wep", "呪い")]) };
  const actor = { items: { get: (id) => (id === "wep1" ? weapon : null) } };

  it("itemId 空＝親アイテムから効果を引く（disabled=false・transfer=false・_id除去）", () => {
    const out = resolveUsageEffectData(actor, parentItem, { effects: [{ itemId: "", effectId: "e_par" }] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("毒");
    expect(out[0].data.disabled).toBe(false);
    expect(out[0].data.transfer).toBe(false);
    expect(out[0].data._id).toBeUndefined();
  });

  it("itemId 指定＝そのアイテム（使用武器など）から引く", () => {
    const out = resolveUsageEffectData(actor, parentItem, { effects: [{ itemId: "wep1", effectId: "e_wep" }] });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("呪い");
  });

  it("解決できない参照（effectId 空・見つからない）は捨てる", () => {
    const out = resolveUsageEffectData(actor, parentItem, { effects: [
      { itemId: "", effectId: "" },
      { itemId: "", effectId: "missing" },
      { itemId: "nope", effectId: "e_wep" },
    ] });
    expect(out).toEqual([]);
  });

  it("effects 無しは空配列", () => {
    expect(resolveUsageEffectData(actor, parentItem, {})).toEqual([]);
    expect(resolveUsageEffectData(actor, parentItem, { effects: [] })).toEqual([]);
  });
});

describe("適用タイミング（AE flags.grantTiming・2026-07-18 攻撃の適用効果タイミング2種）", () => {
  const SCOPE = "tokyo-nova-axleration";
  const mkTimedEffect = (id, name, flags = {}) => ({
    id, name,
    flags: { [SCOPE]: flags },
    toObject: () => ({ _id: id, name, disabled: true, transfer: true, flags: { [SCOPE]: { ...flags } } }),
  });

  it("grantTiming='hit' の効果は timing='hit' で解決される", () => {
    const parent = { id: "p", effects: { get: () => mkTimedEffect("e1", "毒", { grantTiming: "hit" }) } };
    const out = resolveUsageEffectData(null, parent, { effects: [{ itemId: "", effectId: "e1" }] });
    expect(out).toHaveLength(1);
    expect(out[0].timing).toBe("hit");
  });

  it("grantTiming 未設定・不明値は timing='damage'（既定=既存データ無移行）", () => {
    const parent = { id: "p", effects: { get: (id) =>
      (id === "e1" ? mkTimedEffect("e1", "呪い", {}) : mkTimedEffect("e2", "謎", { grantTiming: "sometime" })) } };
    const out = resolveUsageEffectData(null, parent, { effects: [
      { itemId: "", effectId: "e1" }, { itemId: "", effectId: "e2" },
    ] });
    expect(out.map(e => e.timing)).toEqual(["damage", "damage"]);
  });
});

describe("splitEffectsByTiming()（ペイロードの二股・2026-07-18）", () => {
  it("timing='hit' と 'damage' を分ける・timing 無し（旧カード互換）は damage", () => {
    const { hit, damage } = splitEffectsByTiming([
      { name: "a", timing: "hit" },
      { name: "b", timing: "damage" },
      { name: "c" },
    ]);
    expect(hit.map(e => e.name)).toEqual(["a"]);
    expect(damage.map(e => e.name)).toEqual(["b", "c"]);
  });

  it("空・null は両方空配列", () => {
    expect(splitEffectsByTiming([])).toEqual({ hit: [], damage: [] });
    expect(splitEffectsByTiming(null)).toEqual({ hit: [], damage: [] });
  });
});

describe("prepareUsageEffectPayload()（timing のペイロード伝搬・2026-07-18 是正）", () => {
  const SCOPE = "tokyo-nova-axleration";
  const mkEffect = (id, name, flags = {}) => ({
    id, name,
    flags: { [SCOPE]: flags },
    toObject: () => ({ _id: id, name, disabled: true, transfer: true, flags: { [SCOPE]: { ...flags } } }),
  });

  it("対象向けエントリに timing が載る（欠落すると命中時効果がダメージ時扱いになる＝実機報告バグ）", async () => {
    const parent = { id: "p", effects: { get: (id) =>
      (id === "e1" ? mkEffect("e1", "毒", { grantTiming: "hit" }) : mkEffect("e2", "呪い", {})) } };
    const payload = await prepareUsageEffectPayload(null, parent,
      { effects: [{ itemId: "", effectId: "e1" }, { itemId: "", effectId: "e2" }] },
      { targetOverride: [{ uuid: "u1", name: "A" }] });
    expect(payload.effects.map(e => e.timing)).toEqual(["hit", "damage"]);
  });
});

describe("hitEffectTargetRefs()（命中時効果の適用先＝命中対象＋カバー付け替え・2026-07-18 是正）", () => {
  it("hit の対象だけを返す（miss/pending は除外）", () => {
    const refs = hitEffectTargetRefs([
      { uuid: "a", name: "A", state: "hit" },
      { uuid: "b", name: "B", state: "miss" },
      { uuid: "c", name: "C", state: "pending" },
    ]);
    expect(refs).toEqual([{ uuid: "a", name: "A" }]);
  });

  it("カバー宣言済みの対象はカバーした側へ付け替える（効果もダメージもカバー側＝2026-07-18 裁定）", () => {
    const refs = hitEffectTargetRefs([
      { uuid: "a", name: "A", state: "hit", coveredBy: { uuid: "x", name: "X" } },
    ]);
    expect(refs).toEqual([{ uuid: "x", name: "X" }]);
  });

  it("カバーした側が自分も命中対象なら1件に畳む", () => {
    const refs = hitEffectTargetRefs([
      { uuid: "a", name: "A", state: "hit", coveredBy: { uuid: "x", name: "X" } },
      { uuid: "x", name: "X", state: "hit" },
    ]);
    expect(refs).toEqual([{ uuid: "x", name: "X" }]);
  });

  it("空・null は空配列", () => {
    expect(hitEffectTargetRefs([])).toEqual([]);
    expect(hitEffectTargetRefs(null)).toEqual([]);
  });
});

describe("attackCardEffectMode()（対決判定カードでの効果ブロックの出し分け・KI-028 是正）", () => {
  it("攻撃（isAttack 省略含む）は 'attack'（ボタンはダメージカードへ一本化）", () => {
    expect(attackCardEffectMode({ isAttack: true, targets: [{ state: "hit" }] })).toBe("attack");
    expect(attackCardEffectMode({ targets: [{ state: "pending" }] })).toBe("attack");
  });

  it("非攻撃対決: 未解決対象が残る間は 'hide'・全対象解決で 'button'", () => {
    expect(attackCardEffectMode({ isAttack: false, state: "active", targets: [{ state: "hit" }, { state: "pending" }] })).toBe("hide");
    expect(attackCardEffectMode({ isAttack: false, state: "active", targets: [{ state: "hit" }, { state: "miss" }] })).toBe("button");
  });

  it("非攻撃対決（対象なし=オープン）: openReaction.resolved で 'button'", () => {
    expect(attackCardEffectMode({ isAttack: false, state: "open", targets: [], openReaction: { resolved: false } })).toBe("hide");
    expect(attackCardEffectMode({ isAttack: false, state: "open", targets: [], openReaction: { resolved: true } })).toBe("button");
  });

  it("全体の終端状態（fumble/miss/failed）は対象が pending でも 'button'（結果カードの無条件表示と同じ=卓判断）", () => {
    expect(attackCardEffectMode({ isAttack: false, state: "fumble", targets: [{ state: "pending" }] })).toBe("button");
    expect(attackCardEffectMode({ isAttack: false, state: "miss", targets: [{ state: "pending" }] })).toBe("button");
    expect(attackCardEffectMode({ isAttack: false, state: "failed", targets: [], openReaction: { resolved: true } })).toBe("button");
  });
});
