/**
 * @fileoverview 指定技能への応答(Foundry 側・フェーズ14-9・2026-08-26 設計)。
 *
 * 選択肢の組み立ては designation-response-logic(純)。ダイアログは**縦積みボタン**
 * (D&D 5e 準拠・確立規約)で、「〈技能名〉で判定する」ボタン群+「代用判定」+キャンセル。
 * 未所持の指定技能は**グレーアウト+クリック不能**で存在だけ見せる(DialogV2 の disabled)。
 *
 * 適用面: 情報収集判定の起動・判定要求の応答。登場判定は「指定は候補の提示であって制限では
 * ない(全技能選択可)」の確立裁定(2026-08-07)を持つためダイアログは独自のまま、指定充足は
 * 候補グループへの合流で効かせる(appearance-check 側)。
 */

import { buildDesignationOptions } from "../rules/designation-response.mjs";
import {
    loadGeneralSkillNameByKey, loadSkillClassByKey, formatDesignatedSkills,
} from "../dictionary/skill-dictionary.mjs";
import { formatSkillName, itemDisplayName } from "../core/identification.mjs";
import { DISABLED_TRIGGER_CLASS } from "../ui/ui-trigger-disable.mjs";
import { enumerateRequestComboCandidates, buildRequestUsageChoices } from "./usage-check-context.mjs";

const { DialogV2 } = foundry.applications.api;

/** 指定技能への応答に使える技能タイプ(判定要求と同一・2026-08-12)。 */
const RESPONSE_SKILL_TYPES = ["generalSkill", "styleSkill"];

/** actor の技能を選択肢ビルダーの入力へ正規化する。 */
function normalizeActorSkills(actor) {
    return actor.items
        .filter(i => RESPONSE_SKILL_TYPES.includes(i.type))
        .map(i => ({
            id: i.id,
            name: i.name,
            identificationKey: i.system.identificationKey ?? "",
            isSubstitute: i.system.isSubstitute === true,
            substituteTarget: [...(i.system.substituteTarget ?? [])],
            designationStandIn: (i.system.designationStandIn ?? []).map(d => ({
                kinds: [...(d?.kinds ?? [])], condition: d?.condition ?? "",
            })),
        }));
}

/**
 * 指定技能への応答を解決する(情報収集・判定要求の共通入口)。
 * ダイアログ1回で「どう応じるか」を選び、技能なら判定用途まで解決して返す。
 * 代用判定は常設の明示的選択肢(選んだ時だけ既存の代用ダイアログへ)。
 * @param {Actor} actor
 * @param {Array<{keys?: Array<string>, tn?: ?(number|string), label?: string}>} rows 指定の行
 * @param {{checkKind?: ?string, title?: string}} [args]
 * @returns {Promise<?object>} { row, item, usageId?, substitution?, manualMod? } |
 *          { row, direct: true, label }(識別キーの無い行) | null=キャンセル
 */
export async function resolveDesignationResponse(actor, rows, { checkKind = null, title = "指定技能" } = {}) {
    const [nameByKey, classByKey] = await Promise.all([
        loadGeneralSkillNameByKey(), loadSkillClassByKey(),
    ]);
    const options = buildDesignationOptions({
        rows, actorSkills: normalizeActorSkills(actor), classByKey, checkKind,
    });
    if (!options.length) {
        ui.notifications.warn("応じられる指定がありません。");
        return null;
    }
    const chosen = await promptDesignationOption(title, options, nameByKey);
    if (!chosen) return null;
    const row = rows[chosen.rowIndex];

    if (chosen.kind === "direct") return { row, direct: true, label: chosen.label };

    const { TnxRlRequestApp } = await import("../app/tnx-rl-request-app.mjs");

    if (chosen.kind === "substitution") {
        // 代用判定は**指定(の束)の代用**(2026-08-25 ユーザー是正)。requestedLabel は行の束ね表記
        const res = await TnxRlRequestApp._promptSubstitution(actor, { requestedLabel: row?.label ?? "" });
        if (!res) return null;
        return {
            row, item: res.item,
            substitution: { requestedLabel: row?.label ?? "", usedName: res.item.name },
            manualMod: res.manualMod,
        };
    }

    // designated(所持している指定技能) / skill(代用技能・指定充足): 判定タイプの用途を解決
    // (KI-025=コンボ候補も列挙・1件なら自動解決・0件は警告して中止=2026-07-19 裁定を踏襲)
    const item = actor.items.get(chosen.itemId);
    if (!item) return null;
    const requestedLabel = chosen.kind === "designated"
        ? (formatDesignatedSkills([chosen.key], nameByKey) || itemDisplayName(item))
        : itemDisplayName(item);
    const comboCandidates = enumerateRequestComboCandidates(actor,
        item.system.identificationKey ?? "", { excludeItemId: item.id });
    const choices = buildRequestUsageChoices(item, comboCandidates);
    if (!choices.length) {
        ui.notifications.warn(`${requestedLabel}に判定タイプの用途が無いため起動できません。`);
        return null;
    }
    if (choices.length === 1) return { row, item: choices[0].item, usageId: choices[0].usage._id };
    const picked = await TnxRlRequestApp._promptUsageChoice(requestedLabel, choices);
    if (!picked) return null;
    return { row, item: picked.item, usageId: picked.usage._id };
}

/**
 * 応答の選択肢を縦積みボタンで選ばせる。未所持の指定技能は disabled(グレーアウト+存在表示)。
 * @param {string} title ダイアログタイトル
 * @param {Array<object>} options buildDesignationOptions の結果
 * @param {Map<string,string>} nameByKey 識別キー→辞典名
 * @returns {Promise<?object>} 選ばれた選択肢(null=キャンセル)
 */
async function promptDesignationOption(title, options, nameByKey) {
    const esc = foundry.utils.escapeHTML;
    // 目標値の括弧内で折り返さない(NBSP)。折り返す場合は括弧ごと次行へ落ちる
    const tnSuffix = (o) => (o.tn !== null && o.tn !== undefined && o.tn !== "" ? `（目標値\u00A0${o.tn}）` : "");
    const optionLabel = (o) => {
        if (o.kind === "designated") return `${formatDesignatedSkills([o.key], nameByKey) || "（参照切れ）"}で判定する${tnSuffix(o)}`;
        if (o.kind === "skill") return `${formatSkillName(o.name)}で判定する${tnSuffix(o)}`;
        if (o.kind === "direct") return `${o.label}で判定する${tnSuffix(o)}`;
        return `代用判定${tnSuffix(o)}`;
    };
    const buttons = options.map((o, i) => ({
        action: `opt${i}`,
        icon: o.kind === "substitution" ? "fas fa-shuffle" : "fas fa-diamond",
        label: optionLabel(o),
        disabled: o.disabled === true,
        class: o.disabled === true ? DISABLED_TRIGGER_CLASS : "",
        callback: () => i,
    }));
    buttons.push({ action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false });
    const res = await DialogV2.wait({
        window: { title: esc(title) },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
        position: { width: 400 },
        content: "",
        buttons,
        // ラベルは innerText 固定(コア実装)のため、描画後に「（目標値 n）」を nowrap スパンへ
        // 包み直す——技能名は折り返してよいが、目標値の括弧は途中で割らず丸ごと次行へ落とす
        render: (_event, dialog) => {
            for (const span of dialog.element.querySelectorAll(".form-footer button > span")) {
                const m = span.innerText.match(/^(.*)(（目標値\u00A0[^）]+）)$/);
                if (!m) continue;
                span.innerText = "";
                span.append(m[1]);
                const tn = document.createElement("span");
                tn.style.whiteSpace = "nowrap";
                tn.innerText = m[2];
                span.append(tn);
            }
        },
        close: () => null,
    });
    // 確定は**数値の添字**(0 を含む)。中止(false / null)と 0 を取り違えないよう整数で判定する
    if (!Number.isInteger(res)) return null;
    return options[res] ?? null;
}
