import { syncOutfitRowOperationEditor } from "./outfit-row-operation-editor.mjs";
/** 付与AEの部位・専用条件を、アウトフィットと同じ行操作で編集する。 */
import { PART_KINDS, PART_REFERENCE_SUB_KINDS, PART_HOST_FEATURE_LABELS, PART_REQUIREMENTS, matchesHostDescriptor } from "../data/item/part-helpers.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices, OUTFIT_CATEGORIES, OUTFIT_TYPES } from "../data/item/outfit-categories.mjs";
import { loadSkillChoices, STYLE_PACK, ORGANIZATION_PACK } from "../dictionary/skill-dictionary.mjs";
import { loadOutfitHostChoices } from "../dictionary/outfit-dictionary.mjs";

function icon(label, iconName, action) {
    const button = document.createElement("a");
    button.className = "tnx-icon-ctrl";
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.title = label;
    button.setAttribute("aria-label", label);
    const i = document.createElement("i");
    i.className = `fas fa-${iconName}`;
    button.append(i);
    button.addEventListener("click", ev => { ev.preventDefault(); action(); });
    button.addEventListener("keydown", ev => { if (["Enter", " "].includes(ev.key)) { ev.preventDefault(); action(); } });
    return button;
}

/** hiddenの保存欄以外にnameは付けず、ネイティブAEフォームへ配列JSONだけ渡す。 */
export function syncEnchantmentRowEditor(input, key, { actor = null, item = null, partSlots = [] } = {}) {
    if (!input) return;
    if (syncOutfitRowOperationEditor(input, key, { actor, item, partSlots })) return;
    const existing = input.nextElementSibling?.classList.contains("tnx-enchantment-rows") ? input.nextElementSibling : null;
    if (!["system.equip.parts", "system.exclusive"].includes(key)) {
        existing?.remove();
        if (input.dataset.tnxRows) { input.type = "text"; delete input.dataset.tnxRows; input.setCustomValidity(""); }
        return;
    }
    if (existing?.dataset.key === key) return;
    existing?.remove();
    let rows;
    try { rows = input.value.trim() ? JSON.parse(input.value) : []; } catch { return; }
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== "object" || Array.isArray(r))) return;
    const box = document.createElement("fieldset");
    box.className = "tnx-fieldset tnx-enchantment-rows";
    box.dataset.key = key;
    input.type = "hidden";
    input.dataset.tnxRows = key;
    input.after(box);
    const isPart = key === "system.equip.parts";
    const save = () => {
        input.value = JSON.stringify(rows);
        input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const render = () => {
        box.replaceChildren();
        const legend = document.createElement("legend");
        legend.append(isPart ? "装備部位 " : "専用条件 ", icon("行を追加", "plus", () => {
            rows.push(isPart ? { kind: "bodyPart", partKey: "", value: "", slots: 1, requirement: "and", optional: false } : { type: "style", key: "" });
            render(); save();
        }));
        box.append(legend);
        rows.forEach((row, index) => {
            const card = document.createElement("div");
            card.className = "tnx-part-card";
            const field = (name, label, choices = null, type = "text", redraw = false) => {
                const wrap = document.createElement("label");
                wrap.className = "tnx-part-field";
                wrap.append(label);
                const control = document.createElement(choices ? "select" : "input");
                control.dataset.field = name;
                if (choices) {
                    if (row[name] && !Object.hasOwn(choices, row[name])) choices = { ...choices, [row[name]]: row[name] };
                    for (const [value, text] of Object.entries(choices)) control.add(new Option(text, value));
                    control.value = row[name] ?? "";
                } else {
                    control.type = type;
                    if (type === "checkbox") control.checked = row[name] === true;
                    else control.value = row[name] ?? (type === "number" ? 1 : "");
                    if (type === "number") { control.min = "0"; control.step = "1"; }
                }
                control.addEventListener("change", () => {
                    row[name] = name === "optional" ? (control.value === "" ? null : control.value === "true") : type === "checkbox" ? control.checked : type === "number" ? Number(control.value) : control.value;
                    if (name === "partKey") row.value = partSlots.find(s => s.key === row.partKey)?.value ?? "";
                    if (name === "hostMajor") row.hostMinor = "";
                    if (["hostMajor", "hostMinor", "hostMinorExclude", "hostFeature"].includes(name)) row.hostKey = "";
                    if (name === "type") row.key = "";
                    if (redraw) render();
                    save();
                });
                wrap.append(control); card.append(wrap);
                return control;
            };
            card.append(icon("この行を削除", "trash", () => { rows.splice(index, 1); render(); save(); }));
            if (isPart) {
                field("requirement", "装備要件", { "": "旧全体指定を継承", ...PART_REQUIREMENTS });
                field("optional", "任意", { "": "旧全体指定を継承", true: "オン", false: "オフ" });
                field("kind", "種別", PART_KINDS, "text", true);
                if (row.kind === "reference") field("refSubKind", "実部位", PART_REFERENCE_SUB_KINDS, "text", true);
                const kind = row.kind === "reference" ? row.refSubKind : row.kind;
                if (kind === "bodyPart") {
                    field("partKey", "身体部位", { "": "—", ...Object.fromEntries(partSlots.filter(s => s.key).map(s => [s.key, s.value || s.key])) });
                    field("slots", "消費数", null, "number");
                } else if (kind === "other") field("value", "部位名");
                else if (kind === "option") {
                    field("hostMajor", "大分類", { "": "—", ...getMajorCategoryChoices() }, "text", true);
                    const minors = row.hostMajor ? Object.fromEntries(Object.entries(OUTFIT_CATEGORIES[row.hostMajor]?.minors ?? {}).map(([k, v]) => [k, v.label])) : getMinorCategoryChoices();
                    field("hostMinor", "小分類", { "": "—", ...minors }, "text", true);
                    field("hostMinorExclude", "小分類を除外", null, "checkbox", true);
                    field("hostFeature", "特徴", { "": "—", ...PART_HOST_FEATURE_LABELS }, "text", true);
                    const hosts = { "": "種別で指定" };
                    for (const item of actor?.items ?? []) {
                        if (OUTFIT_TYPES.has(item.type) && item.system?.identificationKey && matchesHostDescriptor(item.system, row)) hosts[item.system.identificationKey] = item.name;
                    }
                    const selector = field("hostKey", "識別キー", hosts);
                    void loadOutfitHostChoices(row).then(choices => {
                        if (!selector.isConnected) return;
                        const used = new Set([...selector.options].map(o => o.value));
                        for (const [k, name] of Object.entries(choices)) if (!used.has(k)) selector.add(new Option(name, k));
                    }).catch(() => {});
                    field("slots", "消費数", null, "number");
                }
            } else {
                field("type", "種別", { style: "スタイル", organization: "オーガニゼーション" }, "text", true);
                const selector = field("key", "識別キー", { "": "—" });
                void loadSkillChoices([row.type === "organization" ? ORGANIZATION_PACK : STYLE_PACK]).then(choices => {
                    if (!selector.isConnected) return;
                    const used = new Set([...selector.options].map(o => o.value));
                    for (const [k, name] of Object.entries(choices)) if (!used.has(k)) selector.add(new Option(name, k));
                }).catch(() => {});
            }
            box.append(card);
        });
    };
    render();
    // 新規空欄は「行なし」として保存できる。
    if (!input.value.trim()) input.value = "[]";
}
