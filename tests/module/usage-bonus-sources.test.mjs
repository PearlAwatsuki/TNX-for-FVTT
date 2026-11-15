import { describe, expect, it } from "vitest";
import { buildSkillBonusSourceOptions } from "../../scripts/app/usage-sheet-context.mjs";

const skill = (id, type) => ({ id, type, name: id, system: { identificationKey: id, actions: [] } });
const items = [skill("base", "generalSkill"), skill("combo", "styleSkill"), skill("unrelated", "styleSkill")];
const getItem = id => items.find(it => it.id === id);

describe("用途のボーナス由来候補", () => {
    it("親以外の一般技能ベースを組み合わせ技能の候補に含める", () => {
        const options = buildSkillBonusSourceOptions({ baseSkillRef: { itemId: "base" }, skillRefs: [{ itemId: "combo" }] }, "base", getItem);
        expect(options.map(o => o.value)).toEqual(["base", "combo"]);
    });

    it("未保存の既定ベースも表示側の解決結果から取得し、重複と削除済み参照を除く", () => {
        const options = buildSkillBonusSourceOptions({ skillRefs: [{ itemId: "base" }, { itemId: "missing" }] }, "base", getItem);
        expect(options.map(o => o.value)).toEqual(["base"]);
    });

    it("参加していないアイテムは追加しない", () => {
        expect(buildSkillBonusSourceOptions({}, "", getItem)).toEqual([]);
    });
});
