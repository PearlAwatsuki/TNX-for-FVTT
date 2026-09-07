import { describe, it, expect } from "vitest";
import {
  collectPresets,
  presetLabel,
  presetSkillKeys,
  checkRequestPresetToForm,
  bountyPresetToForm,
  newCheckRequestPreset,
  newBountyPreset,
  newDamageGrantPreset,
  newEffectGrantPreset,
  newScenarioTextPreset,
  damagePresetToForm,
  effectPresetIsEmpty,
} from "../../scripts/session/request-presets.mjs";

const SCOPE = "tokyo-nova-axleration";

const JOURNALS = [
  {
    name: "第1話",
    flags: { [SCOPE]: { checkRequests: [
      { id: "p1", label: "扉のロック", checkType: "skillCheck", identificationKey: "electronics", targetValue: 14 },
      { id: "p2", label: "",           checkType: "abilityCheck", abilityKey: "life", targetValue: 12 },
    ] } },
  },
  { name: "メモ", flags: {} },
  {
    name: "第2話",
    flags: { [SCOPE]: { checkRequests: [
      { id: "p3", label: "追跡", checkType: "skillCheck", identificationKey: "drive", targetValue: 16 },
    ] } },
  },
];

describe("collectPresets()（アクトシートのプリセットをジャーナル名でグループ化）", () => {
  it("プリセットを持つジャーナルだけをグループにする", () => {
    const groups = collectPresets(JOURNALS, "checkRequests");
    expect(groups.map(g => g.label)).toEqual(["第1話", "第2話"]);
  });

  it("グループの中身はそのジャーナルのプリセット", () => {
    const groups = collectPresets(JOURNALS, "checkRequests");
    expect(groups[0].presets.map(p => p.id)).toEqual(["p1", "p2"]);
    expect(groups[1].presets.map(p => p.id)).toEqual(["p3"]);
  });

  it("該当が無ければ空", () => {
    expect(collectPresets([], "checkRequests")).toEqual([]);
    expect(collectPresets(JOURNALS, "bountyGrants")).toEqual([]);
  });

  it("ジャーナルの ID も持つ（効果の付与元はジャーナルを跨いで一意に指す・2026-07-21）", () => {
    const groups = collectPresets(
      [{ id: "j1", name: "第1話", flags: { [SCOPE]: { effectGrants: [{ id: "e1" }] } } }],
      "effectGrants",
    );
    expect(groups[0].journalId).toBe("j1");
  });
});

describe("presetLabel()（プレースホルダー）", () => {
  it("名前があればそれを使う", () => {
    expect(presetLabel({ label: "扉のロック" }, 0, "判定要求")).toBe("扉のロック");
  });

  it("名前が無ければ「判定要求n」（1始まり）", () => {
    expect(presetLabel({ label: "" }, 0, "判定要求")).toBe("判定要求1");
    expect(presetLabel({}, 2, "判定要求")).toBe("判定要求3");
  });

  it("報酬点でも同じ規則", () => {
    expect(presetLabel({ label: "" }, 1, "報酬点")).toBe("報酬点2");
  });

  it("シナリオテキストは名前欄のキーが title（既存データのキー名を保つ）", () => {
    expect(presetLabel({ title: "オープニング読み上げ" }, 0, "テキスト")).toBe("オープニング読み上げ");
    expect(presetLabel({ title: "" }, 1, "テキスト")).toBe("テキスト2");
  });
});

describe("newScenarioTextPreset()（シナリオテキストの新規行）", () => {
  it("名前は空・本文は空（名前は未入力ならプレースホルダーが出る）", () => {
    const row = newScenarioTextPreset();
    expect(row.title).toBe("");
    expect(row.content).toBe("");
    expect(row.id).toBeTruthy();
  });

  it("行ごとに id が振られる", () => {
    expect(newScenarioTextPreset().id).not.toBe(newScenarioTextPreset().id);
  });
});

describe("checkRequestPresetToForm()（プリセット → フォーム値）", () => {
  const preset = {
    id: "p1", label: "扉のロック", checkType: "skillCheck",
    identificationKey: "electronics",
    targetValue: 14, targetValueHidden: true, description: "静かに開ける",
  };

  it("各欄へ写像する（指定技能は複数可＝配列・2026-08-12）", () => {
    expect(checkRequestPresetToForm(preset)).toEqual({
      checkType: "skillCheck",
      identificationKeys: ["electronics"],
      targetValue: 14,
      targetValueHidden: true,
      description: "静かに開ける",
    });
  });

  it("対象アクターは含めない（卓の状況で変わるため起動時に選ぶ）", () => {
    expect(checkRequestPresetToForm({ ...preset, targets: [{ actorId: "x" }] })).not.toHaveProperty("targets");
  });

  it("欠損は既定値で埋める", () => {
    const f = checkRequestPresetToForm({ id: "x" });
    expect(f.checkType).toBe("skillCheck");
    expect(f.targetValue).toBe(0);
    expect(f.targetValueHidden).toBe(false);
    expect(f.identificationKeys).toEqual([]);
  });

  it("技能名の自由入力・スート指定は持たない（ドロップが自由入力の役割を果たすため廃止・2026-08-12）", () => {
    const f = checkRequestPresetToForm({ ...preset, customSkillName: "でっち上げ技能", validSuits: ["spade"] });
    expect(f).not.toHaveProperty("customSkillName");
    expect(f).not.toHaveProperty("validSuits");
  });
});

describe("presetSkillKeys()（判定要求プリセットの指定技能・複数化の読み替え・2026-08-12）", () => {
  it("配列があればそれを使う（空要素は落とす）", () => {
    expect(presetSkillKeys({ identificationKeys: ["melee", "", "element_fire"] }))
      .toEqual(["melee", "element_fire"]);
  });

  it("旧形式（単数）は1件として読む（一括書き換えはしない）", () => {
    expect(presetSkillKeys({ identificationKey: "electronics" })).toEqual(["electronics"]);
  });

  it("配列がある行では旧単数を見ない（空配列＝意図的に空）", () => {
    expect(presetSkillKeys({ identificationKeys: [], identificationKey: "electronics" })).toEqual([]);
  });

  it("どちらも無ければ空", () => {
    expect(presetSkillKeys({})).toEqual([]);
    expect(presetSkillKeys(null)).toEqual([]);
  });
});

describe("bountyPresetToForm()（報酬点プリセット → フォーム値）", () => {
  it("点数と記述を写像する", () => {
    expect(bountyPresetToForm({ id: "b1", label: "前金", amount: 5, note: "依頼の前金" }))
      .toEqual({ amount: 5, note: "依頼の前金" });
  });

  it("対象アクターは含めない", () => {
    expect(bountyPresetToForm({ amount: 5, targets: [{ uuid: "x" }] })).not.toHaveProperty("targets");
  });

  it("欠損は0と空文字", () => {
    expect(bountyPresetToForm({})).toEqual({ amount: 0, note: "" });
  });
});

describe("newCheckRequestPreset() / newBountyPreset()（新規行）", () => {
  it("判定要求の新規行は既定値を持つ（指定技能は空配列）", () => {
    const p = newCheckRequestPreset();
    expect(p.checkType).toBe("skillCheck");
    expect(p.label).toBe("");
    expect(p.targetValue).toBe(0);
    expect(p.identificationKeys).toEqual([]);
  });

  it("報酬点の新規行は既定値を持つ", () => {
    const p = newBountyPreset();
    expect(p.amount).toBe(0);
    expect(p.note).toBe("");
  });
});

describe("newDamageGrantPreset() / damagePresetToForm()（ダメージ付与の事前設定・2026-07-21）", () => {
  it("新規行は生身の攻撃と同じ既定値を持つ（既定モードは固定）", () => {
    const p = newDamageGrantPreset();
    expect(p.category).toBe("physical");
    expect(p.damageType).toBe("I");
    expect(p.value).toBe(0);
    expect(p.note).toBe("");
    expect(p.mode).toBe("fixed");
  });

  it("付与フォームの値へ写す（モードも含む）", () => {
    expect(damagePresetToForm({ category: "social", damageType: "", value: 3, note: "威圧", mode: "fixed" }))
      .toEqual({ category: "social", damageType: "", value: 3, note: "威圧", mode: "fixed" });
  });

  it("カードモードのプリセットはモードを保存・再現する（＝カード系ギミックを丸ごと保存できる）", () => {
    expect(damagePresetToForm({ category: "physical", damageType: "I", value: 5, note: "落下", mode: "card" }).mode)
      .toBe("card");
  });

  it("負のダメージは0に丸める", () => {
    expect(damagePresetToForm({ value: -5 }).value).toBe(0);
  });

  it("欠損は既定値で埋める（モード未指定＝固定＝既存プリセットの後方互換）", () => {
    expect(damagePresetToForm({})).toEqual({ category: "physical", damageType: "I", value: 0, note: "", mode: "fixed" });
  });

  it("不正なモードは固定に落とす", () => {
    expect(damagePresetToForm({ mode: "bogus" }).mode).toBe("fixed");
  });
});

describe("newEffectGrantPreset() / effectPresetIsEmpty()（効果の事前設定）", () => {
  it("新規行は効果が未設定", () => {
    const p = newEffectGrantPreset();
    expect(p.label).toBe("");
    expect(p.effect).toBeNull();
    expect(effectPresetIsEmpty(p)).toBe(true);
  });

  it("効果データが入れば未設定ではない", () => {
    expect(effectPresetIsEmpty({ effect: { name: "罠", changes: [] } })).toBe(false);
  });

  it("名前だけで中身の無いものは未設定として扱う", () => {
    expect(effectPresetIsEmpty({ effect: {} })).toBe(true);
    expect(effectPresetIsEmpty({})).toBe(true);
    expect(effectPresetIsEmpty(null)).toBe(true);
  });
});
