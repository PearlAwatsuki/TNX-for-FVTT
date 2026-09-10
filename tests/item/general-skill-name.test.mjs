import { describe, it, expect, vi } from "vitest";
import { decoratedItemName } from "../../scripts/core/identification.mjs";

// 画面基底だけを代替し、区分選択時の処理と閲覧名の整形は実物を通す。
vi.mock("../../scripts/item/tnx-item-sheet.mjs", () => ({ TokyoNovaItemSheet: class {} }));
const { TokyoNovaGeneralSkillSheet } = await import("../../scripts/item/tnx-general-skill-sheet.mjs");

describe("固有名詞技能の区分選択と保存名", () => {
  it.each([
    ["テスト都市", "", "society", "社会：テスト都市"],
    ["テスト人物", "", "contact", "コネ：テスト人物"],
    ["社会：テスト都市", "", "society", "社会：テスト都市"],
    ["社会:テスト都市", "", "society", "社会：テスト都市"],
    ["社会：テスト都市", "society", "contact", "コネ：テスト都市"],
    ["社会:テスト都市", "society", "contact", "コネ：テスト都市"],
    ["テスト都市", "society", "society", "社会：テスト都市"],
  ])("%s の区分を %s → %s にすると閲覧名も %s になる", async (name, oldType, newType, expected) => {
    const item = {
      type: "generalSkill", name,
      system: { generalSkillCategory: "onomasticSkill", onomasticType: oldType, identificationKey: "" },
      update: vi.fn(async changes => {
        if (changes.name) item.name = changes.name;
        item.system.onomasticType = changes["system.onomasticType"];
      }),
    };
    await TokyoNovaGeneralSkillSheet.prototype._onSelectChange.call({ item }, {
      currentTarget: { name: "system.onomasticType", value: newType },
    });
    expect(item.update).toHaveBeenCalledOnce();
    expect(item.name).toBe(expected);
    // 閲覧モードのテンプレートが使う整形関数でも接頭辞を失わない。
    expect(decoratedItemName(item)).toBe(expected);
    item.system.isAction = true;
    expect(decoratedItemName(item)).toBe(`★${expected}`);
  });
});
