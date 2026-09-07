/**
 * @fileoverview アウトフィットのコンバイン(2026-09-07 アウトフィットシートから移設)。
 *
 * 2 つのアウトフィットを 1 つに合成する機能。合成後の各パラメータをどう決めるかの定義表・
 * 合成結果のプレビュー・元アイテムの参照メニュー・合成の解除をまとめる。シートの他の関心
 * (部位エディタ・分類・住宅エリア)とは独立していて、シートからは element/isEditable/item
 * しか触らない。
 */

import { getMajorCategoryLabel, getMinorCategoryLabel } from "../data/item/outfit-categories.mjs";
import { getPartSlotPreset } from "../app/part-slot-preset-app.mjs";
import { joinPartDesignations, resolvePartRowsForDisplay, resolvePartAdditions } from "../data/item/part-helpers.mjs";
import { hideLabel, formatWeaponRangeLabel } from "../ui/outfit-view.mjs";

/**
 * コンバイン元の比較対象パラメータ定義。
 * exists: 当該 system にフィールドが定義されているか(型依存)。
 * eq: 二値が等しいかの判定(等しければラジオ不要)。
 */
/** {mode,value} 形式のフィールド用共通比較 */
function modeValueEq(a, b) {
    const mA = a?.mode ?? "none", mB = b?.mode ?? "none";
    if (mA !== mB) return false;
    if (mA !== "value") return true;
    return (a?.value ?? 0) === (b?.value ?? 0);
}
function modeValueFmt(v) {
    return v?.mode === "value" ? String(v.value ?? 0) : "-";
}

const COMBINE_PARAM_DEFS = Object.freeze([
    {
        key: "appearancePenalty", label: "危険値",
        exists: () => true,
        get: (s) => s.appearancePenalty,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "controlMod", label: "制御値修正",
        exists: (s) => s.controlMod !== undefined,
        get: (s) => s.controlMod,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "attack", label: "攻撃力",
        exists: (s) => s.attack !== undefined,
        get: (s) => s.attack,
        // 表示は実効値(AE 込み・2026-07-13): 種別=damageTypeTotal・値=total
        fmt: (v) => `${v.damageTypeTotal || v.damageType || ""}+${v.total ?? v.value ?? 0}`,
        eq: (a, b) => a.damageType === b.damageType && (a.value ?? 0) === (b.value ?? 0),
    },
    {
        key: "defence", label: "防御値",
        exists: (s) => s.defence !== undefined,
        get: (s) => s.defence,
        fmt: (v) => v?.mode === "value"
            ? `${v.S_defence ?? 0}／${v.P_defence ?? 0}／${v.I_defence ?? 0}` : "-",
        eq: (a, b) => {
            const mA = a?.mode ?? "none", mB = b?.mode ?? "none";
            if (mA !== mB) return false;
            if (mA !== "value") return true;
            return (a.S_defence ?? 0) === (b.S_defence ?? 0)
                && (a.P_defence ?? 0) === (b.P_defence ?? 0)
                && (a.I_defence ?? 0) === (b.I_defence ?? 0);
        },
    },
    {
        key: "guardValue", label: "受け値",
        exists: (s) => s.guardValue !== undefined,
        get: (s) => s.guardValue,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "range", label: "射程",
        exists: (s) => s.range !== undefined,
        get: (s) => s.range,
        fmt: (v) => formatWeaponRangeLabel(v),
        eq: (a, b) => (a?.min ?? "none") === (b?.min ?? "none")
                   && (a?.max ?? "none") === (b?.max ?? "none"),
    },
    {
        key: "speedFactor", label: "SF",
        exists: (s) => s.speedFactor !== undefined,
        get: (s) => s.speedFactor,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "passenger", label: "乗員",
        exists: (s) => s.passenger !== undefined,
        get: (s) => s.passenger,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "combatSpeedMod", label: "CS修正",
        exists: (s) => s.combatSpeedMod !== undefined,
        get: (s) => s.combatSpeedMod,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
]);

/**
 * コンバイン元二つを解決し、確定的な合成結果(部位/分類/電制/隠/常備化経験点)を組み立てる。
 * 食い違うパラメータは paramRows として返し、テンプレート側でラジオ選択 UI を表示する。
 * @param {Object} system コンバイナーの system データ
 * @returns {Promise<Object>}
 */
export async function prepareCombinePreview(sheet, system) {
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const resolve = async (uuid) => (uuid ? await fromUuid(uuid).catch(() => null) : null);
    const s1 = await resolve(system.combine.source1);
    const s2 = await resolve(system.combine.source2);

    const hackOf = (it) => (it?.system?.hack?.mode === "value" ? num(it.system.hack.value) : null);
    const hideOf = (sys) => hideLabel(sys?.hide);
    const penaltyOf = (sys) => sys?.appearancePenalty?.mode === "value"
        ? String(num(sys.appearancePenalty.value)) : "-";

    const result = {
        source1: s1 ? { name: s1.name, img: s1.img } : null,
        source2: s2 ? { name: s2.name, img: s2.img } : null,
        appearance: system.combine.appearance,
    };

    if (s1 && s2) {
        // 常備化経験点: コンバイナー本体 + 元1 + 元2 の合計(2026-06-13 ユーザー確定)
        const expNum = (s) => s?.preserveExp?.mode === "value" ? num(s.preserveExp.value) : 0;
        const preserveExpTotal = expNum(system)
            + expNum(s1.system)
            + expNum(s2.system);

        // 部位: 両方の指定部位を全て占有(merged.part で joinPartDesignations により併記)

        // 食い違うパラメータのラジオ選択行を生成する
        const params = system.combine.params ?? {};
        const paramRows = [];
        for (const def of COMBINE_PARAM_DEFS) {
            const sy1 = s1.system, sy2 = s2.system;
            if (!def.exists(sy1) || !def.exists(sy2)) continue;
            const v1 = def.get(sy1), v2 = def.get(sy2);
            if (def.eq(v1, v2)) continue; // 同値なら選択不要
            paramRows.push({
                key:    def.key,
                label:  def.label,
                val1:   def.fmt(v1),
                val2:   def.fmt(v2),
                choice: params[def.key] ?? "1",
            });
        }

        result.paramRows = paramRows;
        const appearSrc = system.combine.appearance === "2" ? s2 : s1;
        const appearSys = appearSrc.system;

        // 分類: 大分類が同じ場合は短縮形(2026-06-13 ユーザー確定)。表示は label を引く
        const maj1 = getMajorCategoryLabel(s1.system.majorCategory) || "-", min1 = getMinorCategoryLabel(s1.system.minorCategory) || "-";
        const maj2 = getMajorCategoryLabel(s2.system.majorCategory) || "-", min2 = getMinorCategoryLabel(s2.system.minorCategory) || "-";
        const category = s1.system.majorCategory === s2.system.majorCategory
            ? `${maj1}／${min1}、${min2}`
            : `${maj1}／${min1}、${maj2}／${min2}`;

        const mergedSlotsCtx = sheet.item.parent?.system?.partSlotsEffective
            ?? sheet.item.parent?.system?.partSlots ?? getPartSlotPreset();
        const resolvedPartSys = (src) => ({
            part: resolvePartRowsForDisplay(src.system.part, mergedSlotsCtx),
            partRelation: src.system.partRelation,
            partOptional: src.system.partOptional,
            partAdditions: resolvePartAdditions(src.system.partAdded, mergedSlotsCtx),
        });
        result.merged = {
            name: appearSrc.name,
            part: joinPartDesignations([resolvedPartSys(s1), resolvedPartSys(s2)]),
            category,
            preserveExpTotal,
            // 電制: どちらか高い方(両方なしなら -)
            hack: (() => {
                const a = hackOf(s1), b = hackOf(s2);
                const vals = [a, b].filter((v) => v !== null);
                return vals.length ? String(Math.max(...vals)) : "-";
            })(),
            // 隠：見た目元の隠匿値(コンバイナーの隠匿値)／選択した元の危険値
            hide: (() => {
                const penaltySrc = system.combine.params?.appearancePenalty === "2" ? s2 : s1;
                return `${hideOf(appearSys)}(${hideOf(system)})／${penaltyOf(penaltySrc.system)}`;
            })(),
        };
    }
    return result;
}

/**
 * コンバインを解除する共通処理。
 * isCombineActive を false にし、source1/source2 をクリア、
 * 関連ソースアイテムの combineGroupId をクリアする。
 * @param {Item} combinerItem コンバイナーアイテム
 */
export async function deactivateCombine(combinerItem) {
    const actor = combinerItem.parent;
    const s1Uuid = combinerItem.system.combine.source1;
    const s2Uuid = combinerItem.system.combine.source2;
    const updates = [{
        _id: combinerItem.id,
        "system.isCombineActive": false,
        "system.combine.source1": "",
        "system.combine.source2": "",
    }];
    if (actor?.documentName === "Actor") {
        for (const uuid of [s1Uuid, s2Uuid].filter(Boolean)) {
            const src = actor.items.find(i => i.uuid === uuid);
            if (src) updates.push({ _id: src.id, "system.combineGroupId": "" });
        }
        await actor.updateEmbeddedDocuments("Item", updates);
    } else {
        await combinerItem.update({
            "system.isCombineActive": false,
            "system.combine.source1": "",
            "system.combine.source2": "",
        });
    }
}

/**
 * コンバイン元ボタンの右クリックコンテキストメニューを設置する。
 * editable に関わらず閲覧は可能。リンク解除は condition で制御する。
 */
export function setupCombineSourceMenu(sheet) {
    const CM = foundry.applications.ux.ContextMenu.implementation;
    new CM(sheet.element, '[data-context-menu="combine-source"]', [
        {
            name: "閲覧",
            icon: '<i class="fas fa-eye"></i>',
            callback: async (target) => {
                const uuid = target.dataset.source === "2"
                    ? sheet.item.system.combine.source2
                    : sheet.item.system.combine.source1;
                const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
                if (item) item.sheet.render(true, { editable: false });
            },
        },
        {
            name: "編集",
            icon: '<i class="fas fa-edit"></i>',
            callback: async (target) => {
                const uuid = target.dataset.source === "2"
                    ? sheet.item.system.combine.source2
                    : sheet.item.system.combine.source1;
                const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
                if (item) item.sheet.render(true);
            },
        },
        {
            name: "リンク解除",
            icon: '<i class="fas fa-unlink"></i>',
            condition: () => sheet.isEditable,
            callback: (target) => {
                const key = target.dataset.source === "2" ? "source2" : "source1";
                sheet.item.update({ [`system.combine.${key}`]: "" });
            },
        },
    ], { jQuery: false, fixed: true });
}
