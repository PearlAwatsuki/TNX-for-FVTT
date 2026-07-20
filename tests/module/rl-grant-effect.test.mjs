import { describe, it, expect } from "vitest";
import { buildConditionGrantData, rlConditionChoices } from "../../scripts/module/rl-grant-logic.mjs";
import { buildGrantedEffectDataFrom } from "../../scripts/module/usage-effects.mjs";

const SCOPE = "tokyo-nova-axleration";

describe("buildConditionGrantData()（RL による状態の任意付与・2026-07-20）", () => {
  it("バッドステータスを状態のみの効果として組み立てる", () => {
    const d = buildConditionGrantData("panic");
    expect(d.name).toBe("恐慌");
    expect(d.statuses).toEqual(["panic"]);
    expect(d.flags[SCOPE].conditionKind).toBe("panic");
  });

  it("リストに表示する（ダメージ由来ではないので隠さない）", () => {
    expect(buildConditionGrantData("panic").flags[SCOPE].hideFromList).toBe(false);
  });

  it("戦闘不能も付与できる", () => {
    const d = buildConditionGrantData("faint");
    expect(d.name).toBe("気絶");
    expect(d.statuses).toEqual(["faint"]);
  });

  it("効果値を持つ状態でも値を埋めない（衰弱・重圧の数字と対象は引いて決まる）", () => {
    const d = buildConditionGrantData("weakness");
    expect(d.flags[SCOPE].conditions).toBeUndefined();
    expect(d.changes ?? []).toEqual([]);
  });

  it("負傷状態は付与できない（ダメージチャートの出力であり治療目標値を伴うため）", () => {
    expect(buildConditionGrantData("physical-7")).toBeNull();
  });

  it("未知の種別は null", () => {
    expect(buildConditionGrantData("no-such-kind")).toBeNull();
    expect(buildConditionGrantData("")).toBeNull();
  });
});

describe("rlConditionChoices()（付与できる状態の選択肢）", () => {
  it("バッドステータスと戦闘不能をグループ見出しつきで返す", () => {
    const groups = rlConditionChoices();
    const labels = groups.map(g => g.label);
    expect(labels).toContain("バッドステータス");
    expect(labels).toContain("戦闘不能");
  });

  it("負傷のグループは含まない", () => {
    const groups = rlConditionChoices();
    const kinds = groups.flatMap(g => g.kinds.map(k => k.kind));
    expect(kinds).toContain("panic");
    expect(kinds.some(k => k.startsWith("physical-"))).toBe(false);
  });

  it("選択肢は内部キーの生値でなく表示ラベルを持つ", () => {
    const groups = rlConditionChoices();
    const panic = groups.flatMap(g => g.kinds).find(k => k.kind === "panic");
    expect(panic.label).toBe("恐慌");
  });
});

// 効果の複製は用途の適用効果と同じ機構を使う(RL 付与も用途付与も「切り離したコピー」)。
const { buildGrantedEffectData } = await import("../../scripts/module/usage-effects.mjs");

/** ActiveEffect のふりをする最小オブジェクト。 */
function fakeEffect(obj, uuid = "Item.xxx.ActiveEffect.yyy") {
  return {
    uuid,
    name: obj.name,
    flags: obj.flags ?? {},
    toObject: () => structuredClone(obj),
  };
}

describe("buildGrantedEffectData()（付与コピー＝供給元と切り離す）", () => {
  it("供給元の _id を持たず、付与先で有効な一回性のインスタンスにする", () => {
    const d = buildGrantedEffectData(fakeEffect({ _id: "abc", name: "強化", disabled: true, transfer: true, changes: [] }));
    expect(d._id).toBeUndefined();
    expect(d.disabled).toBe(false);
    expect(d.transfer).toBe(false);
  });

  it("片方向同期の対象にならない（transferredFrom を持たない＝供給元の更新・削除に追随しない）", () => {
    const d = buildGrantedEffectData(fakeEffect({ name: "強化", changes: [] }));
    expect(d.flags["tokyo-nova-axleration"].transferredFrom).toBeUndefined();
    expect(d.flags["tokyo-nova-axleration"].grantedFrom).toBe("Item.xxx.ActiveEffect.yyy");
  });

  it("準備先転送の設定は付与コピーに持ち越さない", () => {
    const d = buildGrantedEffectData(fakeEffect({
      name: "強化", changes: [],
      flags: { "tokyo-nova-axleration": { applyToParent: true } },
    }));
    expect(d.flags["tokyo-nova-axleration"].applyToParent).toBeUndefined();
  });

  it("状態を持たない効果には付与マーカーの状態を入れる（トークン演出のため）", () => {
    const d = buildGrantedEffectData(fakeEffect({ name: "強化", changes: [] }));
    expect(d.statuses).toEqual(["tnx-applied"]);
  });

  it("状態を持つ効果はそのまま保つ", () => {
    const d = buildGrantedEffectData(fakeEffect({ name: "恐慌", statuses: ["panic"], changes: [] }));
    expect(d.statuses).toEqual(["panic"]);
  });
});

describe("buildGrantedEffectDataFrom()（素データからの付与コピー・2026-07-21）", () => {
  it("素の効果データからも付与コピーを組める（プリセット・その場作成に使う）", () => {
    const d = buildGrantedEffectDataFrom({ name: "罠", changes: [{ key: "a", value: "1" }] });
    expect(d.name).toBe("罠");
    expect(d.disabled).toBe(false);
    expect(d.transfer).toBe(false);
  });

  it("statuses が空なら付与マーカーを注入する（トークン演出）", () => {
    expect(buildGrantedEffectDataFrom({ name: "罠" }).statuses).toEqual(["tnx-applied"]);
  });

  it("由来 uuid が無ければ grantedFrom を刻まない（供給元の無い一回性の効果）", () => {
    const d = buildGrantedEffectDataFrom({ name: "罠" });
    expect(d.flags[SCOPE].grantedFrom).toBeUndefined();
    expect(d.flags[SCOPE].effectId).toBeUndefined();
  });

  it("由来 uuid を渡せば刻む", () => {
    const d = buildGrantedEffectDataFrom({ name: "罠" }, "Item.x.ActiveEffect.y");
    expect(d.flags[SCOPE].grantedFrom).toBe("Item.x.ActiveEffect.y");
    expect(d.flags[SCOPE].effectId).toBe("Item.x.ActiveEffect.y");
  });

  it("_id と準備先転送のフラグは持ち越さない", () => {
    const d = buildGrantedEffectDataFrom({ _id: "abc", name: "罠", flags: { [SCOPE]: { applyToParent: true } } });
    expect(d._id).toBeUndefined();
    expect(d.flags[SCOPE].applyToParent).toBeUndefined();
  });

  it("元のデータを書き換えない", () => {
    const src = { name: "罠" };
    buildGrantedEffectDataFrom(src);
    expect(src.statuses).toBeUndefined();
  });
});
