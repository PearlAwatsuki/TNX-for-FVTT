import { describe, it, expect } from "vitest";
import {
    USAGE_CONFRONTATION_OPTIONS,
    CONFRONTATION_REACTION_VALUES,
    isOpposedConfrontation,
    confrontationHasCannot,
    confrontationReactionTypes,
    confrontationSkillRows,
    asteriskSkillKeys,
    mergeConfrontationRows,
} from "../../scripts/module/confrontation-logic.mjs";
import {
    USAGE_TYPE_DEFS,
    defaultConfrontationForType,
    executionFormOf,
    attackCategoryOf,
    usageDisplayName,
} from "../../scripts/module/usage-types.mjs";

const row = (value, name = "") => ({ value, name, skillDict: "", skillGroup: "", skillSub: "" });

describe("用途タイプ(行動種別・2026-07-17 確定)", () => {
    it("リアクションタイプは対決欄の手段行と1:1(購入タイプ追加後=19種・2026-08-31)", () => {
        expect(Object.keys(USAGE_TYPE_DEFS)).toHaveLength(19);
        expect(USAGE_TYPE_DEFS.repair).toEqual({ label: "修理", kind: "action" });
        // 購入(16-3・2026-08-31 ユーザー裁定): デフォルト技能が決まっている性格=タイプで表現
        expect(USAGE_TYPE_DEFS.purchase).toEqual({ label: "購入", kind: "action" });
        // 汎用「リアクション」(2026-07-18): 系統フラグなし=あらゆる対決判定への資格(適否は卓)。
        // kind=reaction のため対決欄の手段行にも自動で入る(明示的に汎用リアクションを許す用途向け)
        expect(USAGE_TYPE_DEFS.reaction).toEqual({ label: "リアクション", kind: "reaction" });
        expect(CONFRONTATION_REACTION_VALUES).toEqual(
            ["dodge", "parry", "mentalReaction", "socialReaction", "moveBlockReaction", "escapeBlockReaction", "reaction"]);
    });

    it("系統既定の対決行は全て enum(技能名・辞典キーなし)", () => {
        expect(defaultConfrontationForType("physicalAttack").map(r => r.value)).toEqual(["dodge", "parry"]);
        expect(defaultConfrontationForType("mentalAttack").map(r => r.value)).toEqual(["mentalReaction"]);
        expect(defaultConfrontationForType("socialAttack").map(r => r.value)).toEqual(["socialReaction"]);
        expect(defaultConfrontationForType("move").map(r => r.value)).toEqual(["moveBlockReaction"]);
        expect(defaultConfrontationForType("escape").map(r => r.value)).toEqual(["escapeBlockReaction"]);
        expect(defaultConfrontationForType("check")).toEqual([]);
        for (const r of defaultConfrontationForType("physicalAttack")) expect(r.name).toBe("");
    });

    it("リアクション系タイプの既定対決は「なし」(2026-07-18 裁定=対決欄は全タイプが持つ)", () => {
        for (const t of ["dodge", "parry", "mentalReaction", "socialReaction", "moveBlockReaction", "escapeBlockReaction", "reaction"]) {
            expect(defaultConfrontationForType(t).map(r => r.value)).toEqual(["none"]);
        }
    });

    it("実行形式: 宣言=宣言・治療=用途の設定(既定は判定)・他は判定", () => {
        expect(executionFormOf({ type: "declaration" })).toBe("declaration");
        expect(executionFormOf({ type: "treatment" })).toBe("check");
        expect(executionFormOf({ type: "treatment", executionForm: "declaration" })).toBe("declaration");
        expect(executionFormOf({ type: "physicalAttack", executionForm: "declaration" })).toBe("check");
        expect(executionFormOf({ type: "check" })).toBe("check");
    });

    it("攻撃系統はタイプから導く(damageCategory 廃止)", () => {
        expect(attackCategoryOf("physicalAttack")).toBe("physical");
        expect(attackCategoryOf("mentalAttack")).toBe("mental");
        expect(attackCategoryOf("socialAttack")).toBe("social");
        expect(attackCategoryOf("check")).toBe("");
    });

    // 「対決欄セクションを持つタイプ」の絞り込み(hasConfrontationSection)は 2026-07-18 に撤回・
    // 全廃した(リアクション用途でも対決「なし」が設定される=対決欄は全タイプが持つ)

    it("実効表示名: 空なら「タイプ名（親アイテム名）」(2026-07-17 用途名既定空・全表示箇所統一)", () => {
        expect(usageDisplayName({ name: "", type: "check" }, "ペネトレイト")).toBe("判定（ペネトレイト）");
        expect(usageDisplayName({ name: "  ", type: "physicalAttack" }, "ペネトレイト")).toBe("物理攻撃（ペネトレイト）");
        expect(usageDisplayName({ name: "貫き", type: "check" }, "ペネトレイト")).toBe("貫き");
        // 親名が無い(スタンドアロン等)場合はタイプ名のみ・タイプ不明は親名フォールバック
        expect(usageDisplayName({ name: "", type: "treatment" }, "")).toBe("治療");
        expect(usageDisplayName({ name: "" }, "ペネトレイト")).toBe("ペネトレイト");
    });
});

describe("対決欄の選択肢(用途・2026-07-17 確定)", () => {
    it("「-」「技能名」「技能名※」＋手段行＋「なし」「不可」(解説参照/その他なし)", () => {
        const keys = Object.keys(USAGE_CONFRONTATION_OPTIONS);
        expect(keys[0]).toBe("blank");
        expect(keys).toContain("skillName");
        expect(keys).toContain("skillNameAsterisk");
        for (const v of CONFRONTATION_REACTION_VALUES) expect(keys).toContain(v);
        expect(keys).toContain("none");
        expect(keys).toContain("cannot");
        expect(keys).not.toContain("explanation");
        expect(keys).not.toContain("other");
    });
});

describe("isOpposedConfrontation()（対決判定の判別=「-」「なし」以外の有効行）", () => {
    it("手段行・技能名行・不可で対決判定になる", () => {
        expect(isOpposedConfrontation([row("dodge")])).toBe(true);
        expect(isOpposedConfrontation([row("skillName", "operate_bike")])).toBe(true);
        expect(isOpposedConfrontation([row("skillNameAsterisk", "operate_bike")])).toBe(true);
        expect(isOpposedConfrontation([row("cannot")])).toBe(true);
    });

    it("空・「-」・「なし」・名前未設定の技能名行は非対決", () => {
        expect(isOpposedConfrontation([])).toBe(false);
        expect(isOpposedConfrontation(undefined)).toBe(false);
        expect(isOpposedConfrontation([row("blank"), row("none")])).toBe(false);
        expect(isOpposedConfrontation([row("skillName", "")])).toBe(false);
    });
});

describe("対決欄の読み取りヘルパ", () => {
    const rows = [row("dodge"), row("parry"), row("skillName", "a"), row("skillNameAsterisk", "b"), row("cannot")];

    it("手段行(定義順・重複なし)・技能名行・※キー・不可を読み取る", () => {
        expect(confrontationReactionTypes(rows)).toEqual(["dodge", "parry"]);
        expect(confrontationReactionTypes([row("parry"), row("dodge"), row("dodge")])).toEqual(["dodge", "parry"]);
        expect(confrontationSkillRows(rows)).toEqual([
            { key: "a", asterisk: false }, { key: "b", asterisk: true }]);
        expect(asteriskSkillKeys(rows)).toEqual(["b"]);
        expect(confrontationHasCannot(rows)).toBe(true);
        expect(confrontationHasCannot([row("dodge")])).toBe(false);
    });
});

describe("mergeConfrontationRows()（合算=追記・吸収。2026-07-17 確定）", () => {
    it("既存行を保持したまま追記する(置き換えない)", () => {
        const existing = [row("dodge"), row("parry")];
        const merged = mergeConfrontationRows(existing, [row("skillName", "x")]);
        expect(merged.map(r => r.value)).toEqual(["dodge", "parry", "skillName"]);
        expect(existing).toHaveLength(2); // 非破壊
    });

    it("完全一致(同値・技能名行は同キー)は吸収する", () => {
        const merged = mergeConfrontationRows(
            [row("dodge"), row("skillName", "a")],
            [row("dodge"), row("skillName", "a"), row("skillName", "b")]);
        expect(merged.map(r => `${r.value}:${r.name}`))
            .toEqual(["dodge:", "skillName:a", "skillName:b"]);
    });

    it("無印技能名行は、既にある手段行の用途タイプをその技能が持つなら吸収(ロール既定でなく技能の能力)", () => {
        // 〈回避〉がドッジ用途を持つ→ドッジ行があるので吸収。同条件なら〈回避〉以外でも吸収される
        const skillHasReactionType = (key, type) => key === "kaihi" && type === "dodge";
        const merged = mergeConfrontationRows(
            [row("dodge")],
            [row("skillName", "kaihi"), row("skillName", "other")],
            { skillHasReactionType });
        expect(merged.map(r => `${r.value}:${r.name}`)).toEqual(["dodge:", "skillName:other"]);
    });

    it("※(必須)行は手段行があっても吸収しない", () => {
        const skillHasReactionType = () => true;
        const merged = mergeConfrontationRows(
            [row("dodge")],
            [row("skillNameAsterisk", "kaihi")],
            { skillHasReactionType });
        expect(merged.map(r => r.value)).toEqual(["dodge", "skillNameAsterisk"]);
    });

    it("不可は1行に吸収・blank/なし/用途対決欄で表せない値は持ち込まない", () => {
        const merged = mergeConfrontationRows(
            [row("cannot")],
            [row("cannot"), row("blank"), row("none"), row("explanation"), { value: "other", name: "自由文" }]);
        expect(merged.map(r => r.value)).toEqual(["cannot"]);
    });

    it("下地の保存: 不可があっても手段行・技能名行は落とさず並存する", () => {
        const merged = mergeConfrontationRows(
            [row("dodge"), row("parry")],
            [row("cannot")]);
        expect(merged.map(r => r.value)).toEqual(["dodge", "parry", "cannot"]);
    });
});
