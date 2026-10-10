import { describe, it, expect } from "vitest";
import { ensureOutfitRowIds, applyOutfitRowOperation, parseRowOperation, changeCategory } from "../../scripts/rules/outfit-row-operations.mjs";
import { applyEnchantmentAttributes, restoreEnchantmentEditValues } from "../../scripts/rules/enchantment-attributes.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices } from "../../scripts/data/item/outfit-categories.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

const base = () => ({ majorCategory: "weapon", minorCategory: "melee", majorCategoryOther: "", minorCategoryOther: "",
    additionalCategories: [{ rowId: "c1", major: "cyberware", minor: "neuralware" }, { rowId: "c2", major: "armor", minor: "bodyArmor" }],
    part: [{ rowId: "p1", kind: "bodyPart", value: "生身", requirement: "and", optional: false, slots: 1 },
        { rowId: "p2", kind: "bodyPart", value: "片腕", requirement: "or", optional: false, slots: 1 },
        { rowId: "p3", kind: "bodyPart", value: "片脚", requirement: "or", optional: false, slots: 1 }],
    partRelation: "and", partOptional: false, partOrChoice: 2 });
const update = (id, changes) => ({ operation: "update", selector: { mode: "id", id }, changes });
const run = (system, op, kind = "category", id = "effect:0") => applyOutfitRowOperation(system, op, kind, id);
function itemWith(changes) {
    const source = { system: base() };
    return { documentName: "Item", type: "weapon", actor: {}, system: structuredClone(source.system), _source: source,
        effects: [{ id: "effect", name: "付与", type: "enchantment", transfer: false,
            flags: { [SYSTEM_ID]: { applyToSelf: true } }, system: { changes } }] };
}
const change = (key, value) => ({ key, value: typeof value === "string" ? value : JSON.stringify(value), type: "override" });

describe("アウトフィット行操作", () => {
    it("IDは再読込・並べ替えで維持され、同内容の行も区別する", () => {
        const old = [{ kind: "bodyPart", value: "片腕" }, { kind: "bodyPart", value: "片腕" }];
        const rows = ensureOutfitRowIds(old, "part");
        expect(rows).toEqual(ensureOutfitRowIds(old, "part"));
        expect(rows[0].rowId).not.toBe(rows[1].rowId);
        expect(ensureOutfitRowIds([...rows].reverse(), "part")).toEqual([...rows].reverse());
        expect(old[0].rowId).toBeUndefined();
    });
    it("副分類の指定行だけを変更し、大分類を補完する", () => {
        const source = base(); const result = run(source, update("c1", { minor: "melee" }));
        expect(result.additionalCategories[0]).toEqual({ rowId: "c1", major: "weapon", minor: "melee" });
        expect(result.additionalCategories[1]).toEqual(source.additionalCategories[1]);
        expect(source.additionalCategories[0].minor).toBe("neuralware");
    });
    it("解説参照とその他は大分類を消さず、自由記述を設定できる", () => {
        for (const minor of ["reference", "other"]) {
            expect(run(base(), update("primary", { minor, minorOther: "独自" }))).toMatchObject({ majorCategory: "weapon", minorCategory: minor, minorCategoryOther: "独自" });
        }
        expect(() => run(base(), update("primary", { major: "armor" }))).toThrow(/小分類/);
        expect(changeCategory({ major: "weapon", minor: "melee" }, { major: "armor", minor: "" })).toEqual({ major: "armor", minor: "" });
    });
    it("追加・削除・分類全体置換を区別する", () => {
        expect(run(base(), { operation: "add", rows: [{ minor: "melee" }] }).additionalCategories).toHaveLength(3);
        expect(run(base(), { operation: "remove", selector: { mode: "id", id: "c1" } }).additionalCategories.map(r => r.rowId)).toEqual(["c2"]);
        expect(() => run(base(), { operation: "remove", selector: { mode: "id", id: "primary" } })).toThrow(/主分類/);
        expect(run(base(), { operation: "replace", rows: [{ minor: "bodyArmor" }, { minor: "neuralware" }] })).toMatchObject({ majorCategory: "armor", minorCategory: "bodyArmor", additionalCategories: [{ major: "cyberware", minor: "neuralware" }] });
    });
    it("AEで追加する行も並べ替えて別行に化けない", () => {
        const rows = [{ rowId: "added-arm", kind: "bodyPart", value: "片腕" }, { rowId: "added-leg", kind: "bodyPart", value: "片脚" }];
        const first = run(base(), { operation: "add", rows }, "part").part;
        const second = run(base(), { operation: "add", rows: [...rows].reverse() }, "part").part;
        expect(first.find(r => r.value === "片腕" && r.rowId.startsWith("ae-")).rowId)
            .toBe(second.find(r => r.value === "片腕" && r.rowId.startsWith("ae-")).rowId);
    });
    it("部位の並べ替え後も指定行だけ変更し、選択をIDで引き継ぐ", () => {
        const system = base(); system.part.reverse(); system.partOrChoice = 0;
        const result = run(system, update("p2", { optional: true }), "part");
        expect(result.part.find(r => r.rowId === "p2").optional).toBe(true);
        expect(result.part[0].rowId).toBe("p3"); expect(result.partOrChoice).toBe(0);
        const removed = run(base(), { operation: "remove", selector: { mode: "id", id: "p1" } }, "part");
        expect(removed.partOrChoice).toBe(1);
    });
    it("存在しない行と曖昧な条件は停止し、全行指定だけ複数一致を許す", () => {
        expect(() => run(base(), update("missing", { minor: "melee" }))).toThrow(/対象行/);
        const op = { operation: "update", selector: { mode: "condition", match: { requirement: "or" } }, changes: { optional: true } };
        expect(() => run(base(), op, "part")).toThrow(/複数行/);
        op.selector.all = true;
        expect(run(base(), op, "part").part.map(p => p.optional)).toEqual([false, true, true]);
    });
    it("空条件・不正値・任意パスへの書き込みを拒否する", () => {
        expect(() => parseRowOperation({ operation: "remove", selector: { mode: "condition", match: {} } }, "part")).toThrow();
        for (const changes of [{ slots: -1 }, { optional: "true" }, { requirement: "bogus" }, { rowId: "hijack" }]) {
            expect(() => run(base(), update("p1", changes), "part")).toThrow();
        }
    });
    it("分類の特殊選択肢を末尾へ並べる", () => {
        expect(Object.keys(getMajorCategoryChoices()).slice(-2)).toEqual(["reference", "other"]);
        expect(Object.keys(getMinorCategoryChoices()).slice(-2)).toEqual(["reference", "other"]);
    });
});

describe("行操作のAE適用と復元", () => {
    it("再計算で増殖せず、保存元・編集値を保ち、解除で復元する", () => {
        const item = itemWith([change("system.outfitCategories", { operation: "add", rows: [{ minor: "melee" }] }),
            change("system.equip.rows", update("p2", { optional: true }))]);
        const source = structuredClone(item._source);
        applyEnchantmentAttributes(item); const result = structuredClone(item.system);
        applyEnchantmentAttributes(item); expect(item.system).toEqual(result);
        expect(item.system.additionalCategories).toHaveLength(3);
        expect(item._source).toEqual(source);
        const edit = structuredClone(item.system); restoreEnchantmentEditValues(item, edit); expect(edit).toEqual(source.system);
        item.effects[0].disabled = true; applyEnchantmentAttributes(item); expect(item.system).toEqual(source.system);
    });
    it("旧全体指定は新しい行属性にも適用する", () => {
        const item = itemWith([change("system.equip.optional", "true"), change("system.equip.relation", "or")]);
        applyEnchantmentAttributes(item);
        expect(item.system.part.every(r => r.optional && r.requirement === "or")).toBe(true);
        item.effects = []; applyEnchantmentAttributes(item); expect(item.system).toEqual(item._source.system);
    });
    it("旧小分類AEの特殊値も大分類を空にしない", () => {
        const item = itemWith([change("system.minorCategory", "reference")]);
        applyEnchantmentAttributes(item); expect(item.system.majorCategory).toBe("weapon");
    });
    it("旧副分類上書きは副分類全体だけを置換して解除時に復元する", () => {
        const item = itemWith([change("system.additionalCategories", "melee")]);
        applyEnchantmentAttributes(item);
        expect(item.system.additionalCategories).toEqual([{ major: "weapon", minor: "melee" }]);
        expect(item.system.majorCategory).toBe("weapon");
        item.effects = []; applyEnchantmentAttributes(item); expect(item.system).toEqual(item._source.system);
    });
    it("失敗は警告として保持し、部分変更を残さない", () => {
        const item = itemWith([change("system.outfitCategories", update("missing", { minor: "melee" }))]);
        applyEnchantmentAttributes(item);
        expect(item.system).toEqual(item._source.system);
        expect(item._tnxEnchantmentWarnings[0].message).toMatch(/対象行/);
    });
});
