import { describe, it, expect } from "vitest";
import { findItemByIdentificationKey, resolveItemNameByKey } from "../../scripts/module/identification.mjs";

// アクターの items は配列でよい(find を持つ)。system.identificationKey で逆引きする。
const actor = {
  items: [
    { name: "〈操縦：カー〉", type: "generalSkill", system: { identificationKey: "operate_car" } },
    { name: "自作の操縦",     type: "generalSkill", system: { identificationKey: "" } },
    { name: "愛車",           type: "vehicle",      system: { identificationKey: "operate_car" } }, // 同キー別種別
  ],
};

describe("findItemByIdentificationKey()（識別キーで所持アイテムを逆引き・2026-07-10）", () => {
  it("識別キー一致のアイテムを返す", () => {
    expect(findItemByIdentificationKey(actor, "operate_car")?.name).toBe("〈操縦：カー〉");
  });

  it("type 指定で種別を絞れる", () => {
    expect(findItemByIdentificationKey(actor, "operate_car", { type: "vehicle" })?.name).toBe("愛車");
  });

  it("空キー・不一致・actor 無しは null", () => {
    expect(findItemByIdentificationKey(actor, "")).toBeNull();
    expect(findItemByIdentificationKey(actor, "operate_bike")).toBeNull();
    expect(findItemByIdentificationKey(null, "operate_car")).toBeNull();
  });
});

describe("resolveItemNameByKey()（識別キー→現在のアイテム名・生キーは表示しない・2026-07-10）", () => {
  it("逆引きしたアイテムの現在名を返す", () => {
    expect(resolveItemNameByKey(actor, "operate_car")).toBe("〈操縦：カー〉");
  });

  it("該当が無ければ辞典名にフォールバック", () => {
    expect(resolveItemNameByKey(actor, "operate_bike", { operate_bike: "〈操縦：バイク〉" }))
      .toBe("〈操縦：バイク〉");
  });

  it("解決不能は空文字（生の識別キーは返さない）", () => {
    expect(resolveItemNameByKey(actor, "operate_bike")).toBe("");
    expect(resolveItemNameByKey(actor, "unknown_key", {})).toBe("");
    expect(resolveItemNameByKey(actor, "")).toBe("");
  });
});
