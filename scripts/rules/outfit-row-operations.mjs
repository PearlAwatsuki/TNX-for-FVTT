/** 分類・部位の行IDと付与操作。保存文書には書き込まない純関数。 */
import { getMajorCategoryChoices, getMinorCategoryChoices, majorOfMinor } from "../data/item/outfit-categories.mjs";
import { PART_KINDS, PART_REFERENCE_SUB_KINDS, partRequirement, partIsOptional } from "../data/item/part-helpers.mjs";

export const ROW_OPERATION_KEYS = Object.freeze({ "system.outfitCategories": "category", "system.equip.rows": "part" });
export const CATEGORY_FIELDS = ["major", "minor", "majorOther", "minorOther"];
export const PART_FIELDS = ["kind", "requirement", "optional", "value", "partKey", "slots", "refSubKind", "hostMajor", "hostMinor", "hostMinorExclude", "hostFeature", "hostKey"];
const own = (o, k) => Object.hasOwn(o, k);
const object = o => o && typeof o === "object" && !Array.isArray(o);
const hash = text => {
    let n = 2166136261;
    for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
    return (n >>> 0).toString(36);
};
export const newOutfitRowId = () => `row-${globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID()}`;

/** 旧文書の読込時にも同じIDを得る。付与後は編集・並べ替えでも保存IDを維持する。 */
export function ensureOutfitRowIds(rows, namespace = "row") {
    const used = new Set();
    const reserved = new Set((rows ?? []).map(r => r?.rowId).filter(Boolean));
    return (rows ?? []).map(row => {
        if (!object(row)) return row;
        let id = typeof row.rowId === "string" ? row.rowId : "";
        if (!id || used.has(id)) {
            const content = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "rowId").sort(([a], [b]) => a.localeCompare(b)));
            const base = `${namespace}-${hash(JSON.stringify(content))}`;
            id = base;
            for (let i = 2; used.has(id) || reserved.has(id); i++) id = `${base}-${i}`;
        }
        used.add(id);
        return { ...row, rowId: id };
    });
}

export function categoryRows(system) {
    return [{ rowId: "primary", major: system.majorCategory ?? "", minor: system.minorCategory ?? "",
        majorOther: system.majorCategoryOther ?? "", minorOther: system.minorCategoryOther ?? "" },
    ...ensureOutfitRowIds(system.additionalCategories, "category")];
}

function validateFields(value, kind, partial = false) {
    if (!object(value)) throw new Error("行の指定が不正です。");
    const fields = [...(kind === "category" ? CATEGORY_FIELDS : PART_FIELDS), ...(!partial ? ["rowId"] : [])];
    for (const [key, v] of Object.entries(value)) {
        if (!fields.includes(key)) throw new Error(`未対応の行項目: ${key}`);
        if (["optional", "hostMinorExclude"].includes(key)) {
            if (typeof v !== "boolean") throw new Error(`${key}にはオン／オフを指定してください。`);
        } else if (key === "slots") {
            if (!Number.isInteger(v) || v < 0) throw new Error("消費数は0以上の整数です。");
        } else if (typeof v !== "string") throw new Error(`${key}は文字列で指定してください。`);
        if (key === "rowId" && !v) throw new Error("行IDが空です。");
    }
    const enums = kind === "category" ? { major: { "": "", ...getMajorCategoryChoices() }, minor: { "": "", ...getMinorCategoryChoices() } }
        : { kind: PART_KINDS, requirement: { and: "", or: "" }, refSubKind: PART_REFERENCE_SUB_KINDS };
    for (const [key, choices] of Object.entries(enums)) {
        if (own(value, key) && !own(choices, value[key])) throw new Error(`${key}の選択肢が不正です。`);
    }
    if (!partial && kind === "part" && !value.kind) throw new Error("部位の種別を指定してください。");
    if (!partial && kind === "category" && !value.major && !value.minor) throw new Error("分類を指定してください。");
}

/** 未指定項目は保持。通常の小分類だけ大分類を補完し、曖昧な変更を拒否する。 */
export function changeCategory(row, patch) {
    const next = { ...row, ...patch };
    const parent = majorOfMinor(next.minor);
    if (own(patch, "minor") && parent && !own(patch, "major")) next.major = parent;
    if (parent && next.major !== parent) throw new Error("大分類と小分類が一致しません。小分類も変更するか、未選択を明示してください。");
    return next;
}

export function parseRowOperation(raw, kind) {
    const op = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (!object(op) || !["add", "update", "remove", "replace"].includes(op.operation)) throw new Error("行の操作を指定してください。");
    if (Object.keys(op).some(k => !["operation", "selector", "changes", "rows"].includes(k))) throw new Error("未対応の操作項目です。");
    if (["add", "replace"].includes(op.operation)) {
        if (!Array.isArray(op.rows) || (op.operation === "add" && !op.rows.length) || (kind === "category" && op.operation === "replace" && !op.rows.length)) throw new Error("生成する行を指定してください。");
        const rowIds = new Set();
        for (const row of op.rows) {
            validateFields(row, kind);
            if (row.rowId && rowIds.has(row.rowId)) throw new Error("行IDが重複しています。");
            if (row.rowId) rowIds.add(row.rowId);
            if (kind === "category") changeCategory({}, row);
        }
    } else {
        const selector = op.selector;
        if (!object(selector) || !["id", "condition"].includes(selector.mode)) throw new Error("対象行を指定してください。");
        if (Object.keys(selector).some(k => !["mode", "id", "match", "all"].includes(k))) throw new Error("未対応の行指定です。");
        if (selector.mode === "id" && (typeof selector.id !== "string" || !selector.id)) throw new Error("対象行を選択してください。");
        if (selector.mode === "condition") {
            validateFields(selector.match, kind, true);
            if (!Object.keys(selector.match).length) throw new Error("一致条件を指定してください。");
            if (selector.all !== undefined && typeof selector.all !== "boolean") throw new Error("全行指定が不正です。");
        }
        if (op.operation === "update") {
            validateFields(op.changes, kind, true);
            if (!Object.keys(op.changes).length) throw new Error("変更する項目を指定してください。");
        }
    }
    return op;
}

/** 操作全体を検証してから差分を返す。失敗した場合は一行も変更しない。 */
export function applyOutfitRowOperation(system, raw, kind, identity) {
    const op = parseRowOperation(raw, kind);
    let rows = kind === "category" ? categoryRows(system) : ensureOutfitRowIds(system.part, "part");
    const chosenId = kind === "part" ? rows[system.partOrChoice ?? 0]?.rowId : null;
    const fresh = r => ({ ...(kind === "part" ? { requirement: "and", optional: false, slots: 1 } : {}),
        ...r, rowId: `ae-${hash(identity)}-${r.rowId}` });
    if (op.operation === "add") {
        rows = [...rows, ...ensureOutfitRowIds(op.rows, "added").map(r => fresh(kind === "category" ? changeCategory({}, r) : r))];
    } else if (op.operation === "replace") {
        rows = ensureOutfitRowIds(op.rows, "replaced").map(r => fresh(kind === "category" ? changeCategory({}, r) : r));
        if (kind === "category") rows[0].rowId = "primary";
    } else {
        const effective = row => kind === "part" ? { ...row, requirement: partRequirement(row, system.partRelation), optional: partIsOptional(row, system.partOptional) } : row;
        const hits = rows.filter(row => op.selector.mode === "id" ? row.rowId === op.selector.id
            : Object.entries(op.selector.match).every(([k, v]) => effective(row)[k] === v));
        if (!hits.length) throw new Error("対象行がありません。削除済み、または一致条件を満たしていません。");
        if (hits.length > 1 && op.selector.all !== true) throw new Error("複数行が一致しました。「一致する全行」を指定してください。");
        if (op.operation === "remove" && kind === "category" && hits.some(r => r.rowId === "primary")) throw new Error("主分類は削除できません。主分類の変更を使用してください。");
        rows = op.operation === "remove" ? rows.filter(r => !hits.includes(r)) : rows.map(r => !hits.includes(r) ? r
            : kind === "category" ? changeCategory(r, op.changes) : { ...r, ...op.changes });
    }
    if (kind === "category") {
        const [primary, ...additionalCategories] = rows;
        return { majorCategory: primary.major ?? "", minorCategory: primary.minor ?? "",
            majorCategoryOther: primary.majorOther ?? "", minorCategoryOther: primary.minorOther ?? "", additionalCategories };
    }
    let choice = rows.findIndex(r => r.rowId === chosenId && partRequirement(r, system.partRelation) === "or");
    if (choice < 0) choice = rows.findIndex(r => partRequirement(r, system.partRelation) === "or");
    return { part: rows, partOrChoice: Math.max(0, choice) };
}
