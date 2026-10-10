import { ROW_OPERATION_KEYS, parseRowOperation, applyOutfitRowOperation, changeCategory } from "./outfit-row-operations.mjs";
/** 付与AEの構造属性。入力UIと実効値の適用で同じ定義を使う。 */
import { SYSTEM_ID } from "../constants.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices, majorOfMinor, OUTFIT_TYPES } from "../data/item/outfit-categories.mjs";
import { isEnchantment, enchantmentAppliesToSelf } from "./ae-kind.mjs";
import { parseEffectTargetKey, evalEffectConditions } from "../data/item/helpers.mjs";
import { PART_KINDS, PART_REFERENCE_SUB_KINDS } from "../data/item/part-helpers.mjs";
import { toPublicEffectKey } from "./ae-public-keys.mjs";

const choice = (path, label, choices) => ({ path, label, kind: "choice", choices, modes: ["override"] });
const bool = (path, label) => ({ ...choice(path, label, { true: "オン", false: "オフ" }), kind: "boolean" });
const text = (path, label, append = false) => ({ path, label, kind: "text", modes: append ? ["add", "override"] : ["override"] });
const rows = (path, label) => ({ path, label, kind: "rows", modes: ["add", "override"] });
const mode = (path, label, keys) => choice(path, label, Object.fromEntries([...new Set([...keys, "reference"])].map(k => [k, ({ none: "なし", value: "数値", reference: "解説参照", control: "制御値" })[k]])));

export const ENCHANTMENT_ATTRIBUTES = Object.freeze({
    "system.outfitCategories": { path: "additionalCategories", label: "分類の行操作", kind: "rowOperation", modes: ["override"] },
    "system.equip.rows": { path: "part", label: "装備部位の行操作", kind: "rowOperation", modes: ["override"] },
    "system.majorCategory": choice("majorCategory", "大分類", getMajorCategoryChoices()),
    "system.minorCategory": choice("minorCategory", "小分類", getMinorCategoryChoices()),
    "system.additionalCategories": { ...choice("additionalCategories", "副分類（旧形式：加算／全体置換）", getMinorCategoryChoices()), kind: "category", modes: ["add", "override"] },
    "system.equip.parts": rows("part", "装備部位"),
    "system.equip.relation": choice("partRelation", "全行の装備要件（旧形式）", { and: "かつ", or: "または" }),
    "system.equip.optional": bool("partOptional", "全行の任意（旧形式）"),
    "system.range.min": choice("range.min", "最低射程", { none: "なし", close: "至近", short: "近", middle: "中", long: "遠", superLong: "超遠", reference: "解説参照" }),
    "system.range.max": choice("range.max", "最大射程", { none: "なし", short: "近", middle: "中", long: "遠", superLong: "超遠", reference: "解説参照" }),
    "system.attackArea": choice("attackArea", "攻撃範囲", { none: "なし", area: "範囲", areaSelect: "範囲（選択）", scene: "シーン", sceneSelect: "シーン（選択）", reference: "解説参照" }),
    "system.isMeleeWeapon": bool("isMeleeWeapon", "白兵武器"),
    "system.isRangedWeapon": bool("isRangedWeapon", "射撃武器"),
    "system.canStun": bool("canStun", "スタン可能"),
    "system.shikiType": choice("shikiType", "式神タイプ", { "": "なし", attack: "攻撃", defense: "防御", drive: "操縦", independent: "独立", reference: "解説参照" }),
    "system.combatSpeedModGhostIgnore": bool("combatSpeedModGhostIgnore", "ゴースト時のCS修正無視"),
    "system.buy.mode": mode("buy.mode", "購入値の方式", ["none", "value", "reference"]),
    "system.hide.mode": mode("hide.mode", "隠匿値の方式", ["none", "value", "reference", "control"]),
    "system.guard.mode": mode("guardValue.mode", "受け値の方式", ["none", "value"]),
    ...Object.fromEntries(Object.entries({ preserveExp: "常備化経験点", appearancePenalty: "危険値", hack: "電脳制御値", defence: "防御力", controlMod: "制御値修正", speedFactor: "移動力", passenger: "乗員数", cycle: "サイクル", combatSpeedMod: "CS修正" })
        .map(([p, label]) => [`system.${p}.mode`, mode(`${p}.mode`, `${label}の方式`, ["none", "value"])])),
    "system.uses.isLimit": bool("uses.isLimit", "使用回数を制限"),
    "system.uses.type": choice("uses.type", "使用回数の回復区分", { "": "なし", act: "アクト", scene: "シーン", cut: "カット" }),
    "system.ammo.isLimit": bool("ammo.isLimit", "弾数を制限"),
    "system.exclusive": rows("exclusive", "専用条件"),
    "system.description": text("description", "説明", true),
    "system.img": { ...text("img", "画像"), document: true },
    "system.operateSkillKey": text("operateSkillKey", "操縦技能の識別キー"),
    "system.housingArea": text("housingArea", "住宅エリア参照"),
    "system.useHousingAreaDrop": bool("useHousingAreaDrop", "住宅エリアを利用"),
});

const get = (object, path) => path.split(".").reduce((o, k) => o?.[k], object);
const set = (object, path, value) => {
    const keys = path.split(".");
    let target = object;
    for (const key of keys.slice(0, -1)) target = target[key];
    target[keys.at(-1)] = value;
};
const changeType = c => c.type ?? ({ 2: "add", 5: "override" })[c.mode] ?? "override";

/** 条件付きキーも同じ属性定義へ解決する。 */
export function enchantmentAttributeKey(key) {
    return typeof key === "string" ? toPublicEffectKey(key.replace(/\[[^\]]*\]/, "").trim()) : "";
}

/** 構造属性の値を検証・変換。不正値は例外にし、評価時は当該変更を無視する。 */
export function parseEnchantmentAttribute(key, raw) {
    key = enchantmentAttributeKey(key);
    const def = ENCHANTMENT_ATTRIBUTES[key];
    if (!def) throw new Error("未定義の付与属性です。");
    if (def.kind === "rowOperation") return parseRowOperation(raw, ROW_OPERATION_KEYS[key]);
    if (def.choices) {
        const value = String(raw);
        if (!Object.hasOwn(def.choices, value)) throw new Error("選択肢にない値です。");
        if (def.kind === "category") return [{ major: majorOfMinor(value), minor: value }];
        if (def.kind === "boolean") return value === "true";
        return value;
    }
    if (def.kind === "text") return String(raw ?? "");
    const value = typeof raw === "string" ? JSON.parse(raw) : structuredClone(raw);
    if (def.kind === "rows" && !Array.isArray(value)) throw new Error("行の配列を指定してください。");
    if (def.kind === "object" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("参照情報を指定してください。");
    // Documentの任意キーやプロトタイプを構造属性経由で書き換えない。
    const encoded = JSON.stringify(value);
    if (/"(?:__proto__|prototype|constructor)"\s*:/.test(encoded)) throw new Error("無効な構造キーです。");
    for (const row of value) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("行の形式が不正です。");
        if (def.path === "exclusive") {
            if (!["style", "organization"].includes(row.type) || typeof row.key !== "string" || !row.key.trim()) throw new Error("専用条件の種別と識別キーが必要です。");
        } else if (def.path === "part") {
            if (!Object.hasOwn(PART_KINDS, row.kind)) throw new Error("部位の種別が不正です。");
            if (row.requirement !== undefined && !["and", "or", ""].includes(row.requirement)) throw new Error("装備要件が不正です。");
            if (row.optional !== undefined && row.optional !== null && typeof row.optional !== "boolean") throw new Error("任意指定が不正です。");
            if (row.slots !== undefined && (!Number.isInteger(row.slots) || row.slots < 0)) throw new Error("部位の消費数は0以上の整数です。");
            if (row.refSubKind !== undefined && !Object.hasOwn(PART_REFERENCE_SUB_KINDS, row.refSubKind)) throw new Error("解説参照の部位が不正です。");
            for (const field of ["rowId", "value", "partKey", "hostMajor", "hostMinor", "hostFeature", "hostKey"]) {
                if (row[field] !== undefined && typeof row[field] !== "string") throw new Error("部位の参照値が不正です。");
            }
            if (row.hostMinorExclude !== undefined && typeof row.hostMinorExclude !== "boolean") throw new Error("小分類の除外指定が不正です。");
        }
    }
    return value;
}

/** Itemの派生計算の前段で適用する。保存元(_source)には書き込まない。 */
export function applyEnchantmentAttributes(item) {
    if (!item?.actor || !OUTFIT_TYPES.has(item.type)) return;
    // 同じDocumentの再準備でも加算を累積せず、削除・無効化で元の値に戻す。
    for (const { path, document, original } of item._tnxEnchantmentPaths ?? []) {
        const saved = get(document ? item._source : item._source?.system, path);
        const value = saved === undefined ? original : saved;
        if (value !== undefined) set(document ? item : item.system, path, structuredClone(value));
    }
    const changes = [];
    const seen = new Set();
    for (const effect of item.effects ?? []) {
        if (!isEnchantment(effect) || effect.disabled || effect.isSuppressed || effect.active === false || !enchantmentAppliesToSelf(effect, item)) continue;
        const identity = effect.flags?.[SYSTEM_ID]?.effectId || effect.id;
        if (effect.flags?.[SYSTEM_ID]?.stackable !== true) {
            if (seen.has(identity)) continue;
            seen.add(identity);
        }
        for (const [changeIndex, change] of (effect.system?.changes ?? effect.changes ?? []).entries()) {
            const key = enchantmentAttributeKey(change.key);
            if (ENCHANTMENT_ATTRIBUTES[key] && evalEffectConditions(item.system, parseEffectTargetKey(change.key)?.conditions)) changes.push({ ...change, key, identity: `${effect.id ?? identity}:${changeIndex}`, effectName: effect.name ?? effect.id });
        }
    }
    changes.sort((a, b) => (a.priority ?? (changeType(a) === "add" ? 20 : 50)) - (b.priority ?? (changeType(b) === "add" ? 20 : 50)));
    item._tnxEnchantmentPaths = [];
    item._tnxEnchantmentWarnings = [];
    const write = (path, value, document = false) => {
        const target = document ? item : item.system;
        if (!item._tnxEnchantmentPaths.some(p => p.path === path && p.document === document)) {
            item._tnxEnchantmentPaths.push({ path, document, original: structuredClone(get(target, path)) });
        }
        set(target, path, value);
    };
    for (const change of changes) {
        const def = ENCHANTMENT_ATTRIBUTES[change.key];
        try {
            let value = parseEnchantmentAttribute(change.key, change.value);
            if (def.kind === "rowOperation") {
                const patch = applyOutfitRowOperation(item.system, value, ROW_OPERATION_KEYS[change.key], change.identity);
                for (const [path, v] of Object.entries(patch)) write(path, v);
                continue;
            }
            const target = def.document ? item : item.system;
            const previous = get(target, def.path);
            if (previous === undefined) continue;
            if (changeType(change) === "add" && def.modes.includes("add")) {
                if (Array.isArray(value)) value = [...(Array.isArray(previous) ? previous : []), ...value];
                else value = String(previous ?? "") + value;
            }
            if (def.kind === "category") value = value.filter((r, i, all) => all.findIndex(x => x.major === r.major && x.minor === r.minor) === i);
            if (["majorCategory", "minorCategory"].includes(def.path)) {
                const row = changeCategory({ major: item.system.majorCategory, minor: item.system.minorCategory },
                    { [def.path === "majorCategory" ? "major" : "minor"]: value });
                write("majorCategory", row.major);
                write("minorCategory", row.minor);
            } else write(def.path, value, !!def.document);
            // 旧全体指定も、明示的な新しい行属性へ反映する。
            if (["partRelation", "partOptional"].includes(def.path)) {
                const field = def.path === "partRelation" ? "requirement" : "optional";
                write("part", (item.system.part ?? []).map(row => ({ ...row, [field]: value })));
            }
        } catch (e) {
            item._tnxEnchantmentWarnings.push({ effect: change.effectName, key: change.key, message: e.message });
        }
    }
}

/** 編集用コピーへ素値を戻し、実効属性をフォームから焼き込まない。 */
export function restoreEnchantmentEditValues(item, system) {
    for (const { path, document, original } of item._tnxEnchantmentPaths ?? []) {
        if (document) continue;
        const saved = get(item._source?.system, path);
        const value = saved === undefined ? original : saved;
        if (value !== undefined) set(system, path, structuredClone(value));
    }
}

/** 保存時にも型を正規化し、API経由の入力でUIの制限を迂回させない。 */
export function normalizeEnchantmentChanges(changes) {
    return changes.map(change => {
        const def = ENCHANTMENT_ATTRIBUTES[enchantmentAttributeKey(change.key)];
        if (!def) return change;
        parseEnchantmentAttribute(change.key, change.value);
        if (def.modes.length !== 1) {
            if (!def.modes.includes(changeType(change))) throw new Error(`${def.label}で使用できない変更タイプです。`);
            return change;
        }
        return change.type !== undefined ? { ...change, type: def.modes[0] } : { ...change, mode: 5 };
    });
}
