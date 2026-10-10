/** 付与AEの分類・部位操作を選択式で編集する。フォームには操作JSONだけを渡す。 */
import { ROW_OPERATION_KEYS, CATEGORY_FIELDS, PART_FIELDS, categoryRows, ensureOutfitRowIds, newOutfitRowId,
    parseRowOperation, applyOutfitRowOperation } from "../rules/outfit-row-operations.mjs";
import { getMajorCategoryChoices, getMinorCategoryChoices, getMajorCategoryLabel, getMinorCategoryLabel,
    OUTFIT_TYPES, majorOfMinor } from "../data/item/outfit-categories.mjs";
import { PART_KINDS, PART_REFERENCE_SUB_KINDS, PART_REQUIREMENTS, PART_HOST_FEATURE_LABELS,
    partRequirement, partIsOptional, formatOptionLabel } from "../data/item/part-helpers.mjs";

const LABELS = { major: "大分類", minor: "小分類", majorOther: "大分類の自由記述", minorOther: "小分類の自由記述",
    kind: "種別", requirement: "装備要件", optional: "任意", value: "部位名", partKey: "身体部位", slots: "消費数",
    refSubKind: "解説参照の実部位", hostMajor: "装備先の大分類", hostMinor: "装備先の小分類",
    hostMinorExclude: "小分類を除外", hostFeature: "装備先の特徴", hostKey: "装備先アイテム" };

export function syncOutfitRowOperationEditor(input, key, { actor = null, item = null, partSlots = [] } = {}) {
    const kind = ROW_OPERATION_KEYS[key];
    if (!kind || !input) return false;
    const old = input.nextElementSibling?.classList.contains("tnx-enchantment-rows") ? input.nextElementSibling : null;
    if (old?.dataset.key === key) return true;
    old?.remove();
    let op;
    try { op = input.value.trim() ? JSON.parse(input.value) : { operation: "add", rows: [] }; } catch { op = null; }
    if (!op || typeof op !== "object" || Array.isArray(op) || !["add", "update", "remove", "replace"].includes(op.operation)) {
        // 別キーからの切替や壊れた保存値を黙って消さない。明示操作で新しい編集を開始する。
        input.type = "text"; input.dataset.tnxRows = key;
        const warning = document.createElement("fieldset"); warning.className = "tnx-enchantment-rows"; warning.dataset.key = key;
        warning.append("現在の値は行操作の形式ではありません。元の値を確認してから設定してください。");
        const reset = document.createElement("button"); reset.type = "button"; reset.textContent = "新しい行操作を設定";
        reset.addEventListener("click", () => {
            warning.remove(); input.value = ""; input.setCustomValidity("");
            syncOutfitRowOperationEditor(input, key, { actor, item, partSlots });
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        warning.append(reset); input.after(warning); return true;
    }
    const box = document.createElement("fieldset");
    box.className = "tnx-fieldset tnx-enchantment-rows"; box.dataset.key = key;
    input.type = "hidden"; input.dataset.tnxRows = key; input.after(box);
    const items = [...(actor?.items ?? [])].filter(i => OUTFIT_TYPES.has(i.type));
    if (item && OUTFIT_TYPES.has(item.type) && !items.includes(item)) items.unshift(item);
    let referenceItem = item ?? items[0] ?? null;
    const fields = kind === "category" ? CATEGORY_FIELDS : PART_FIELDS;
    const defaults = () => ({ rowId: newOutfitRowId(), ...(kind === "category" ? { major: "", minor: "" } : { kind: "bodyPart", requirement: "and", optional: false, slots: 1 }) });
    const choicesFor = name => ({
        major: { "": "未選択", ...getMajorCategoryChoices() }, minor: { "": "未選択", ...getMinorCategoryChoices() },
        hostMajor: { "": "指定なし", ...getMajorCategoryChoices() }, hostMinor: { "": "指定なし", ...getMinorCategoryChoices() },
        kind: PART_KINDS, requirement: PART_REQUIREMENTS, refSubKind: PART_REFERENCE_SUB_KINDS,
        optional: { false: "オフ", true: "オン" }, hostMinorExclude: { false: "オフ", true: "オン" },
        hostFeature: { "": "指定なし", ...PART_HOST_FEATURE_LABELS },
        hostKey: { "": "種別で指定", ...Object.fromEntries(items.filter(i => i.system.identificationKey).map(i => [i.system.identificationKey, i.name])) },
        partKey: { "": "未選択", ...Object.fromEntries(partSlots.filter(p => p.key).map(p => [p.key, p.value])) },
    })[name];
    let message;
    const validate = () => {
        try {
            parseRowOperation(op, kind);
            if (referenceItem) applyOutfitRowOperation(referenceItem._source?.system ?? referenceItem.system, op, kind, "preview");
            message.textContent = referenceItem ? "参照装備で適用内容を検証しました。" : "付与先の行は適用時に確認します。";
            input.setCustomValidity("");
        } catch (e) { message.textContent = e.message; input.setCustomValidity(e.message); }
    };
    const save = () => { input.value = JSON.stringify(op); validate(); input.dispatchEvent(new Event("change", { bubbles: true })); };
    const select = (parent, label, choices, value, onChange, name) => {
        const wrap = document.createElement("label"); wrap.className = "tnx-part-field"; wrap.append(label);
        const el = document.createElement("select"); el.dataset.field = name;
        if (value !== undefined && !Object.hasOwn(choices, String(value))) choices = { ...choices, [value]: `未解決: ${value}` };
        for (const [v, text] of Object.entries(choices)) el.add(new Option(text, v));
        el.value = String(value ?? "");
        el.addEventListener("change", () => { onChange(el.value); save(); });
        wrap.append(el); parent.append(wrap); return el;
    };
    const button = (parent, label, action) => {
        const el = document.createElement("button"); el.type = "button"; el.textContent = label;
        el.addEventListener("click", () => { action(); render(); save(); }); parent.append(el);
    };
    const editFields = (parent, data, partial, condition = false) => {
        for (const field of fields) {
            const choices = choicesFor(field);
            const keep = condition ? "指定しない" : "変更しない";
            if (choices) {
                select(parent, LABELS[field], partial ? { __keep__: keep, ...choices } : choices,
                    Object.hasOwn(data, field) ? data[field] : partial ? "__keep__" : "", value => {
                        if (value === "__keep__") delete data[field];
                        else data[field] = ["optional", "hostMinorExclude"].includes(field) ? value === "true" : value;
                        if (field === "minor" && !partial && majorOfMinor(value)) { data.major = majorOfMinor(value); render(); }
                        if (field === "partKey" && !condition && value !== "__keep__") data.value = partSlots.find(p => p.key === value)?.value ?? "";
                    }, field);
            } else {
                const wrap = document.createElement("label"); wrap.className = "tnx-part-field"; wrap.append(LABELS[field]);
                const el = document.createElement("input"); el.dataset.field = field;
                el.type = field === "slots" ? "number" : "text";
                if (field === "slots") { el.min = "0"; el.step = "1"; }
                el.value = data[field] ?? "";
                if (partial) {
                    const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = Object.hasOwn(data, field);
                    enabled.dataset.enableField = field; el.disabled = !enabled.checked;
                    enabled.addEventListener("change", () => {
                        el.disabled = !enabled.checked;
                        if (!enabled.checked) delete data[field]; else data[field] = field === "slots" ? Number(el.value) : el.value;
                        save();
                    }); wrap.append(enabled, condition ? "指定する" : "変更する");
                }
                el.addEventListener("change", () => { data[field] = field === "slots" ? Number(el.value) : el.value; save(); });
                wrap.append(el); parent.append(wrap);
            }
        }
    };
    const render = () => {
        box.replaceChildren();
        select(box, "操作", kind === "category" ? { add: "副分類を追加", update: "指定行を変更", remove: "指定副分類を削除", replace: "分類全体を置換" }
            : { add: "行を追加", update: "指定行を変更", remove: "指定行を削除", replace: "部位全体を置換" }, op.operation, value => {
            op = ["add", "replace"].includes(value) ? { operation: value, rows: [defaults()] }
                : { operation: value, selector: { mode: "condition", match: {}, all: false }, ...(value === "update" ? { changes: {} } : {}) };
            render();
        }, "operation");
        if (items.length) select(box, "行を選ぶための参照装備（付与先はAEの設定に従います）",
            Object.fromEntries(items.map(i => [i.id, i.name])), referenceItem?.id, id => { referenceItem = items.find(i => i.id === id); render(); }, "referenceItem");
        if (["add", "replace"].includes(op.operation)) {
            const hint = document.createElement("p"); hint.textContent = op.operation === "replace"
                ? (kind === "category" ? "主分類と副分類すべてを置換します。先頭行が主分類です。" : "既存の部位をすべて置換します。") : "既存行を保持して追加します。"; box.append(hint);
            (op.rows ?? []).forEach((row, i) => {
                const card = document.createElement("fieldset"); const legend = document.createElement("legend");
                legend.textContent = kind === "category" && op.operation === "replace" && i === 0 ? "主分類" : `行 ${i + 1}`; card.append(legend);
                editFields(card, row, false); button(card, "この行を削除", () => op.rows.splice(i, 1)); box.append(card);
            });
            button(box, "行を追加", () => (op.rows ??= []).push(defaults()));
        } else {
            op.selector ??= { mode: "condition", match: {}, all: false };
            select(box, "対象の指定", { id: "特定の行", condition: "条件で指定" }, op.selector.mode, mode => {
                op.selector = mode === "id" ? { mode, id: "" } : { mode, match: {}, all: false }; render();
            }, "selectorMode");
            if (op.selector.mode === "id") {
                const sys = referenceItem?._source?.system ?? referenceItem?.system ?? {};
                const rows = kind === "category" ? categoryRows(sys) : ensureOutfitRowIds(sys.part, "part");
                const choices = { "": "対象行を選択" };
                for (const [i, row] of rows.entries()) {
                    if (kind === "category" && op.operation === "remove" && row.rowId === "primary") continue;
                    choices[row.rowId] = kind === "category" ? `${row.rowId === "primary" ? "主分類" : `副分類 ${i}`}：${getMajorCategoryLabel(row.major, row.majorOther)}／${getMinorCategoryLabel(row.minor, row.minorOther)}`
                        : `${i + 1}：${row.kind === "option" ? formatOptionLabel(row) : row.value || PART_KINDS[row.kind]}〔${PART_REQUIREMENTS[partRequirement(row, sys.partRelation)]}${partIsOptional(row, sys.partOptional) ? "・任意" : ""}〕`;
                }
                select(box, "対象行", choices, op.selector.id, value => { op.selector.id = value; }, "rowId");
            } else {
                editFields(box, op.selector.match ??= {}, true, true);
                select(box, "一致件数", { false: "1行だけ（複数一致なら適用しない）", true: "一致する全行" }, op.selector.all ?? false,
                    value => { op.selector.all = value === "true"; }, "all");
            }
            if (op.operation === "update") {
                const changes = document.createElement("fieldset"); const legend = document.createElement("legend"); legend.textContent = "変更内容"; changes.append(legend);
                editFields(changes, op.changes ??= {}, true); box.append(changes);
            }
        }
        message = document.createElement("p"); message.setAttribute("role", "status"); box.append(message); validate();
    };
    render();
    if (!input.value.trim()) input.value = JSON.stringify(op);
    return true;
}
