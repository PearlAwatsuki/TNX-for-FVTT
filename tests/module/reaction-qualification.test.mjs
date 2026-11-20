import { checkChangeMatches } from "../../scripts/data/item/helpers.mjs";
import { checkCriteria } from "../../scripts/rules/next-check-expiry.mjs";
import { describe, it, expect } from "vitest";
import { migrateReactionUsages, reactionQualificationSummary, hasReactionQualification } from "../../scripts/rules/action-qualifications.mjs";
import { resolveReactionQualification, findReactionCombination, reactionConfrontation } from "../../scripts/rules/reaction-qualification.mjs";
import { GeneralSkillDataModel } from "../../scripts/data/item/general-skill.mjs";
import { StyleSkillDataModel } from "../../scripts/data/item/style-skill.mjs";
import { USAGE_TYPE_DEFS } from "../../scripts/rules/usage-types.mjs";

const row = (value, name = "") => ({ value, name });
const usage = { _id: "u", type: "reaction", skillRefs: [] };
const skill = (id, qualifications = [], extra = {}, type = "generalSkill") => ({ id, name: id, type,
    system: { identificationKey: id, isAction: true, level: 1, suits: { spade: true }, actionQualifications: qualifications, actions: [usage], ...extra } });
const base = skill("base", ["parry"]);
const grant = skill("grant", ["dodge"], { isAction: false, comboSkill: [row("skillName", "base")] }, "styleSkill");
const resolve = (b, members = [], options = {}) => resolveReactionQualification({ base: b, participants: members,
    usage, mode: "dodge", rows: [row("dodge")], ...options });
const find = (b, skills, options = {}) => findReactionCombination({ base: b, skills, usage, mode: "dodge", rows: [row("dodge")], ...options });

describe("選択済みの手段と技能構成の資格", () => {
    it.each(["dodge", "parry"])("旧AEキー check.%s は選択済み手段で照合する", mode => {
        const criteria = checkCriteria({ items: new Map([[base.id, base]]) }, {
            type: "skillCheck", skillIds: [base.id], usageType: "reaction", usageKind: "reaction", reaction: { mode } }, "reason");
        expect(checkChangeMatches(`check.${mode}`, criteria)).toBe(true);
        expect(checkChangeMatches(`check.${mode === "dodge" ? "parry" : "dodge"}`, criteria)).toBe(false);
        expect(checkChangeMatches("check.reaction", criteria)).toBe(true);
    });
    it.each([["mentalAttack", "mentalReaction"], ["socialAttack", "socialReaction"],
        ["move", "moveBlockReaction"], ["escape", "escapeBlockReaction"]])(
        "%sへのリアクション分類は複数の選択肢があっても能動側から決まる", (activeUsageType, checkType) => {
            const reaction = { mode: "reaction", activeUsageType,
                confrontation: [row("mentalReaction"), row("socialReaction"), row("dodge"), row("reaction")] };
            const criteria = checkCriteria({}, { type: "skillCheck", usageType: "reaction", reaction }, "reason");
            expect(checkChangeMatches(`check.${checkType}`, criteria)).toBe(true);
            expect(checkChangeMatches("check.reaction", criteria)).toBe(true);
            expect(checkChangeMatches("check.parry", criteria)).toBe(false);
            expect(reaction.mode).toBe("reaction");
        });
    it("その他・オープン入口でも精神攻撃へのリアクション分類を失わない", () => {
        for (const reaction of [{ mode: "other" }, { mode: "reaction", open: true }]) {
            const criteria = checkCriteria({}, { type: "skillCheck", usageType: "check",
                reaction: { ...reaction, activeUsageType: "mentalAttack" } }, "reason");
            expect(checkChangeMatches("check.mentalReaction", criteria)).toBe(true);
            expect(checkChangeMatches("check.reaction", criteria)).toBe(true);
            expect(checkChangeMatches("check.socialReaction", criteria)).toBe(false);
        }
    });
    it("一般アクション技能のドッジ", () => expect(resolve(skill("a", ["dodge"])).ok).toBe(true));
    it("一般アクション技能のパリー", () => expect(resolve(base, [], { mode: "parry", rows: [row("parry")] }).ok).toBe(true));
    it("ケースA: スタイルがベース、一般技能は必須コンボ", () => {
        const action = skill("style", ["dodge"], { comboSkill: [row("skillName", "base")] }, "styleSkill");
        expect(resolve(action).ok).toBe(false);
        expect(resolve(action, [base]).ok).toBe(true);
        expect(find(action, [action, base])).toEqual(["style", "base"]);
        expect(base.system.actionQualifications).toEqual(["parry"]);
    });
    it("ケースB: 所持する付与技能まで探索し、実参加したときだけ資格を加える", () => {
        expect(find(base, [base, grant])).toEqual(["base", "grant"]);
        expect(resolve(base).ok).toBe(false);
        expect(resolve(base, [grant]).ok).toBe(true);
        expect(base.system.actionQualifications).toEqual(["parry"]);
    });
    it("追加技能の必須条件が足りなければ候補にも実行にも使えない", () => {
        const invalid = skill("grant", ["dodge"], { isAction: false, comboSkill: [row("skillName", "missing")] }, "styleSkill");
        expect(find(base, [base, invalid])).toBeNull();
        expect(resolve(base, [invalid]).reason).toContain("missing");
    });
    it("非アクション技能単体をベースにしない", () => expect(resolve(grant).ok).toBe(false));
    it("他のアクション技能の資格を組み合わせから借用しない", () => {
        expect(resolve(base, [skill("otherAction", ["dodge"])]).ok).toBe(false);
    });
    it("空の資格とリアクション用途は汎用を表し、技能名には依存しない", () => {
        const generic = skill("任意の名前");
        expect(resolve(generic).ok).toBe(true);
        expect(resolve(generic, [], { mode: "socialReaction", rows: [row("socialReaction")] }).ok).toBe(true);
        expect(reactionQualificationSummary(generic.system)).toBe("汎用リアクション");
    });
    it("用途のない空資格と非アクションの空資格は汎用でない", () => {
        expect(hasReactionQualification(skill("a", [], { actions: [] }).system, "dodge")).toBe(false);
        expect(reactionQualificationSummary(skill("a", [], { actions: [] }).system)).toBe("設定なし");
        expect(resolve(base, [skill("a", [], { isAction: false }, "styleSkill")]).ok).toBe(false);
    });
    it("その他は資格ゲートだけを外し、他種用途も許可する", () => {
        const other = skill("x", [], { actions: [{ type: "check" }] });
        expect(resolve(other, [], { usage: { type: "check" } }).ok).toBe(false);
        expect(resolve(other, [], { usage: { type: "check" }, mode: "other" }).ok).toBe(true);
    });
    it("名前行で指定した技能を含む構成を探索する", () => {
        const named = skill("named", [], { isAction: false, actions: [] }, "styleSkill");
        const options = { mode: "reaction", rows: [row("skillName", "named")] };
        expect(resolve(base, [], options).ok).toBe(false);
        expect(find(base, [base, named], options)).toEqual(["base", "named"]);
        expect(resolve(base, [named], options).ok).toBe(true);
    });
    it("※行はすべて実参加が必要", () => {
        const a = skill("a", [], { isAction: false });
        const b = skill("b", [], { isAction: false });
        const options = { rows: [row("skillNameAsterisk", "a"), row("skillNameAsterisk", "b")] };
        expect(resolve(base, [a], options).ok).toBe(false);
        expect(find(base, [base, a, b], options)).toEqual(["base", "a", "b"]);
        expect(resolve(base, [a, b], options).ok).toBe(true);
    });
    it("汎用技能でも選択手段は対決欄の下地に従う", () => {
        expect(resolve(skill("generic"), [], { rows: [row("mentalReaction")] }).ok).toBe(false);
    });
    it("不可を無視しても下地の資格を満たさなければ実行できない", () => {
        const options = { rows: [row("cannot"), row("dodge")] };
        expect(resolve(base, [grant], options).ok).toBe(false);
        options.usage = { ...usage, ignoresUnopposable: true };
        expect(resolve(base, [], options).ok).toBe(false);
        expect(resolve(base, [grant], options).ok).toBe(true);
    });
    it("オープン入口はドッジを含む全手段の和集合", () => {
        expect(resolve(skill("a", ["dodge"]), [], { mode: "open" }).ok).toBe(true);
        expect(resolve(base, [], { mode: "open" }).ok).toBe(false);
    });
    it.each(["mentalReaction", "socialReaction", "escapeBlockReaction"])("%s は統合入口から実行できる", method => {
        expect(resolve(skill("a", [method]), [], { mode: "reaction", rows: [row(method)] }).ok).toBe(true);
    });
    it("移動妨害の車両条件は用途の requiresVehicle と独立", () => {
        const b = skill("a", ["moveBlockReaction"]);
        const options = { mode: "reaction", rows: [row("moveBlockReaction")], usage: { ...usage, requiresVehicle: false } };
        expect(resolve(b, [], options).ok).toBe(false);
        expect(resolve(b, [], { ...options, hasVehicle: true }).ok).toBe(true);
    });
    it("統合ボタンに複数行があっても、移動妨害だけを実行できる構成には車両が必要", () => {
        const options = { mode: "reaction", rows: [row("moveBlockReaction"), row("socialReaction")] };
        expect(resolve(skill("move", ["moveBlockReaction"]), [], options).ok).toBe(false);
        expect(resolve(skill("social", ["socialReaction"]), [], options).ok).toBe(true);
    });
    it("操縦時は対決の下地を操縦※へ置換し、不可は残す", () => {
        expect(reactionConfrontation([row("cannot"), row("dodge")], "pilot"))
            .toEqual([row("cannot"), row("skillNameAsterisk", "pilot")]);
    });
    it("代用技能で必要条件を満たす", () => {
        const substitute = skill("sub", [], { isAction: false, isSubstitute: true, substituteTarget: ["required"] });
        const action = skill("action", ["dodge"], { comboSkill: [row("skillName", "required")] }, "styleSkill");
        expect(find(action, [action, substitute])).toEqual(["action", "sub"]);
        expect(resolve(action, [substitute]).ok).toBe(true);
    });
    it("選択組み合わせは所持・実参加のどちらでも条件を検証する", () => {
        const action = skill("action", ["dodge"], { comboSkill: [row("skillName", "a"), row("skillName", "b")] });
        const a = skill("a", [], { isAction: false });
        expect(find(action, [action])).toBeNull();
        expect(find(action, [action, a])).toEqual(["action", "a"]);
        expect(resolve(action).ok).toBe(false);
        expect(resolve(action, [a]).ok).toBe(true);
    });
    it("共通スートがない組み合わせや組み合わせ不可では資格を供給しない", () => {
        const invalid = structuredClone(grant);
        invalid.system.suits = { heart: true };
        expect(find(base, [base, invalid])).toBeNull();
        expect(resolve(base, [invalid]).reason).toContain("スート");
        invalid.system.suits = { spade: true };
        invalid.system.noCombo = true;
        expect(find(base, [base, invalid])).toBeNull();
    });
    it("繰り返し解決・資格編集・技能削除は用途や資格を変更しない", () => {
        const b = structuredClone(base), g = structuredClone(grant);
        const before = structuredClone([b, g, usage]);
        expect(find(b, [b, g])).toEqual(find(b, [b, g]));
        expect([b, g, usage]).toEqual(before);
        g.system.actionQualifications = ["socialReaction"];
        expect(find(b, [b, g])).toBeNull();
        expect(find(b, [b])).toBeNull();
    });
});

describe("旧用途の移行", () => {
    it("新規作成のリアクション用途は1タイプのみ", () => {
        expect(Object.keys(USAGE_TYPE_DEFS).filter(k => USAGE_TYPE_DEFS[k].kind === "reaction")).toEqual(["reaction"]);
    });
    it("用途を合併せずタイプ以外の全フィールドと対決行を保持する", () => {
        const source = { actions: ["dodge", "parry", "dodge"].map((type, i) => ({ _id: String(i), type,
            name: "別用途", effects: ["ae"], weaponRefs: [{ itemId: "weapon" }], consumeTargets: [{ amount: 2 }],
            guardBonuses: [{ formula: "3", source: "manual" }], hideFromUsageSelection: true,
            skillRefs: [{ itemId: "combo" }], confrontation: [row("parry"), row("cannot")],
            requiresVehicle: false, settingsBackup: { type, checkBonusSelf: "7" } })) };
        const original = structuredClone(source);
        migrateReactionUsages(source);
        expect(source.actionQualifications).toEqual(["dodge", "parry"]);
        expect(source.actions).toEqual(original.actions.map(u => ({ ...u, type: "reaction" })));
        const once = structuredClone(source);
        expect(migrateReactionUsages(source)).toEqual(once);
    });
    it("汎用と個別の混在は空資格となり、技能名による補完をしない", () => {
        const src = { name: "回避", actions: [{ type: "parry" }, { type: "reaction" }] };
        expect(migrateReactionUsages(src).actionQualifications).toEqual([]);
        expect(migrateReactionUsages(src).actionQualifications).toEqual([]);
    });
    it.each([GeneralSkillDataModel, StyleSkillDataModel])("DataModelの実際のmixin順序でも変換前の資格を読める (%s)", Model => {
        const source = { actions: [{ _id: "a", type: "dodge", confrontation: [row("parry")] }] };
        const result = Model.migrateData(source);
        expect(result.actionQualifications).toEqual(["dodge"]);
        expect(result.actions[0].type).toBe("reaction");
        const once = structuredClone(result);
        expect(Model.migrateData(result)).toEqual(once);
        expect(Model.defineSchema()).toHaveProperty("actionQualifications");
    });
});
