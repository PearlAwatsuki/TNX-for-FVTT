/**
 * @fileoverview 回復フロー(2026-07-13 ユーザー確定・正本 Conditions.md / Check_Rules.md)。
 *
 * BS・戦闘不能・負傷を除去する回復・治療系スタイル技能の表現。器は用途の回復設定
 * (recovery / recoveryTargets / recoveryExcludes / recoveryAll / recoveryCount /
 * recoveryTargetFormula)。使用は必ずアイテムロール。
 *
 * フロー:
 * 1. 使用 → 対象解決(ターゲット1体。無ければ確認→自分)
 * 2. **対象が現在受けている状態から回復対象を選択**(範囲=recoveryTargets・除外=recoveryExcludes。
 *    該当すべて(recoveryAll)は一覧確認のみ・それ以外は recoveryCount 個まで選択)
 * 3. declaration 用途=消費適用→即除去 / check 用途=判定へ(ctx.recovery 完了継続・成功で除去)
 *
 * 目標値: recoveryTargetFormula(式)が @condition.magnitude(選択した状態の強度・複数は最大)と
 * @condition.woundValue(負傷のダメージ値・同)を参照できる。空なら用途の目標値(数値)を使う。
 *
 * 除去の意味論(既存規約の流用):
 * - BS=その効果のみ(woundSource は辿らない=「BS を回復してもダメージは治療されない」)
 * - 戦闘不能=**元となる負傷(ダメージ)ごと治療する**(2026-07-13 ユーザー確定。戦闘不能はダメージ
 *   そのもの=2026-07-09 裁定。紐づく負傷があればその除去範囲へ展開・孤立は単体除去)
 * - 負傷=治療と同じ範囲(負傷+紐づき戦闘不能+非BS。BS は残る)
 * - 除去の権限が無ければ treatmentApply ソケットで GM 委譲(治療と同じ経路)
 *
 * 完全死亡・精神崩壊(とそれを与える負傷)は全回復系でも治療不可=通例は除外タグに設定する
 * (システムはハードコードで強制しない。抹殺は未確定=技能ごとの設定・卓裁定)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { getComboSuits, comboUsesBounty } from "./tnx-check-engine.mjs";
import { CONDITION_KINDS, getConditionKinds, recoveryKindMatches, recoveryKindExcluded, readCondition } from "./conditions.mjs";
import { postConditionOutcome } from "./condition-resolution.mjs";
import { resolveConsumeRowsForActor, promptConsumption, applyConsumptionPlan } from "./usage-consumption.mjs";
import { buildFormulaData, evaluateFormula, parsePlainNumber } from "./tnx-formula.mjs";

const SCOPE = "tokyo-nova-axleration";

/** 対象アクターの現在の状態から、回復範囲に合致し除外に当たらない効果を列挙する。 */
export function listRecoverableEffects(patient, usage) {
    const out = [];
    for (const e of (patient?.effects ?? [])) {
        const kind = getConditionKinds(e)[0];
        if (!kind) continue;
        if (!recoveryKindMatches(kind, usage.recoveryTargets)) continue;
        if (recoveryKindExcluded(kind, usage.recoveryExcludes)) continue;
        out.push(e);
    }
    return out;
}

/** 負傷の除去範囲(治療と同じ: 負傷+紐づきの非BS。BS は残る)。 */
function woundRemovalIds(patient, wound) {
    const linked = patient.effects.filter(e =>
        e.flags?.[SCOPE]?.woundSource === wound.id
        && CONDITION_KINDS[getConditionKinds(e)[0]]?.group !== "bs");
    return [wound.id, ...linked.map(e => e.id)];
}

/** 選択された効果群から除去 ID 集合と式参照値(強度・ダメージ値の最大)を組む。 */
function buildRemovalPlan(patient, effects) {
    const ids = new Set();
    let magnitude = 0;
    let woundValue = 0;
    const labels = [];
    const addWoundRange = (wound) => {
        for (const id of woundRemovalIds(patient, wound)) ids.add(id);
        woundValue = Math.max(woundValue, Number(wound.flags?.[SCOPE]?.woundValue) || 0);
    };
    for (const e of effects) {
        const kind = getConditionKinds(e)[0];
        const def = CONDITION_KINDS[kind];
        labels.push(def?.label ?? e.name);
        if (def?.type === "wound") {
            addWoundRange(e);
        } else if (def?.group === "incapacitation") {
            // 戦闘不能=元となる負傷(ダメージ)ごと治療する(2026-07-13 ユーザー確定。戦闘不能は
            // ダメージそのもの=2026-07-09 裁定・医療の治療と同じ扱い)。孤立(手動付与)は単体除去
            const woundId = e.flags?.[SCOPE]?.woundSource || "";
            const wound = woundId ? patient.effects.get(woundId) : null;
            if (wound) addWoundRange(wound);
            else ids.add(e.id);
        } else {
            // BS=その効果のみ(BS を回復してもダメージは治療されない=既存規約)
            ids.add(e.id);
        }
        magnitude = Math.max(magnitude, Number(readCondition(e)?.magnitude) || 0);
    }
    return { removeIds: [...ids], magnitude, woundValue, label: labels.join("・") };
}

/** 回復対象の選択ダイアログ。recoveryAll=一覧確認のみ・それ以外=recoveryCount 個まで選択。 */
async function promptRecoverySelection(patient, candidates, usage) {
    const esc = foundry.utils.escapeHTML;
    const max = usage.recoveryAll ? candidates.length : Math.max(1, Number(usage.recoveryCount) || 1);
    const rows = candidates.map(e => {
        const kind = getConditionKinds(e)[0];
        const def = CONDITION_KINDS[kind];
        const mag = Number(readCondition(e)?.magnitude) || 0;
        const wv = Number(e.flags?.[SCOPE]?.woundValue) || 0;
        const linkedWound = def?.group === "incapacitation" && e.flags?.[SCOPE]?.woundSource
            ? patient.effects.get(e.flags[SCOPE].woundSource) : null;
        const extra = def?.type === "wound"
            ? `（ダメージ値 ${wv}・紐づく戦闘不能・効果も除去）`
            : linkedWound
                ? `（元の負傷「${CONDITION_KINDS[getConditionKinds(linkedWound)[0]]?.label ?? linkedWound.name}」ごと治療）`
                : (mag ? `（強度 ${mag}）` : "");
        const input = usage.recoveryAll
            ? `<input type="checkbox" checked disabled>`
            : `<input type="checkbox" name="recover" value="${esc(e.id)}">`;
        return `<div class="tnx-uses-row"><label>${input}
            <span>${esc(def?.label ?? e.name)}${esc(extra)}</span></label></div>`;
    }).join("");
    const note = usage.recoveryAll
        ? "<p class=\"tnx-uses-note\">該当するすべての状態を回復します。</p>"
        : `<p class="tnx-uses-note">回復する状態を選んでください（最大 ${max} 個）。</p>`;

    const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: `回復対象の選択: ${patient.name}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-uses-dialog"],
        position: { width: 420 },
        content: `<div class="tnx-uses-consume">${note}${rows}</div>`,
        buttons: [
            { action: "ok", icon: "fas fa-check", label: "決定", default: true,
              callback: (_e, _b, dialog) => usage.recoveryAll
                  ? candidates.map(e => e.id)
                  : [...dialog.element.querySelectorAll('input[name="recover"]:checked')].map(cb => cb.value) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    if (!picked) return null;
    if (!picked.length) { ui.notifications.warn("回復する状態が選ばれていません。"); return null; }
    if (!usage.recoveryAll && picked.length > max) {
        ui.notifications.warn(`回復できるのは最大 ${max} 個です。`);
        return null;
    }
    return candidates.filter(e => picked.includes(e.id));
}

/** 回復対象(1体)を解決する。ターゲット優先・無ければ確認して自分。null=中止。 */
async function resolveRecoveryPatient(actor) {
    const targeted = [...(game.user?.targets ?? [])].map(t => t?.actor).filter(Boolean);
    if (targeted.length) return targeted[0];
    const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "ターゲット未選択" },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>回復する対象がターゲットされていません。</p>`
            + `<p>「${foundry.utils.escapeHTML(actor?.name ?? "")}」自身を対象に続行しますか？</p>`,
        yes: { label: "自分を対象に続行", icon: "fas fa-user-check" },
        no:  { label: "キャンセル", icon: "fas fa-times" },
        modal: true,
    });
    return proceed ? actor : null;
}

/** 除去を実行する(所有権が無ければ treatmentApply ソケットで GM 委譲=治療と同じ経路)。 */
async function applyRecoveryRemoval(patient, removeIds) {
    if (patient.isOwner) {
        await patient.deleteEmbeddedDocuments("ActiveEffect", removeIds.filter(id => patient.effects.get(id)));
        return true;
    }
    if (game.users.activeGM) {
        TnxSocketHandler.emitTreatmentApply({ patientUuid: patient.uuid, removeIds });
        return true;
    }
    ui.notifications.warn("対象の所有権がなく GM も不在のため、回復を適用できません。");
    return false;
}

/**
 * 回復用途を使用する(アイテムロールから。declaration=即時/check=判定へ)。
 * @param {Item} item 回復用途を持つ技能
 * @param {object} usage recovery=true の用途エントリ
 */
export async function useRecovery(item, usage) {
    const actor = item.actor;
    if (!actor) { ui.notifications.warn("回復はアクターが所持している技能から使用してください。"); return; }
    if (!(usage.recoveryTargets ?? []).length) {
        ui.notifications.warn("回復対象の範囲が設定されていません（用途の〈回復〉で設定してください）。");
        return;
    }

    const patient = await resolveRecoveryPatient(actor);
    if (!patient) return;

    const candidates = listRecoverableEffects(patient, usage);
    if (!candidates.length) {
        ui.notifications.warn(`「${patient.name}」に回復対象となる状態がありません。`);
        return;
    }
    const selected = await promptRecoverySelection(patient, candidates, usage);
    if (!selected) return;
    const plan = buildRemovalPlan(patient, selected);

    // 消費(consumeTargets): 宣言=ここで適用・判定=カードプレイ時に適用(既存の check と同じ)
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const usesPlan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (usesPlan === null) return;

    // 宣言(判定なし): 即除去
    if (usage.type !== "check") {
        await applyConsumptionPlan(usesPlan);
        if (!await applyRecoveryRemoval(patient, plan.removeIds)) return;
        await postConditionOutcome(patient, {
            title: usage.name || item.name, tag: "回復", status: "success",
            label: plan.label, text: "を回復（BS の紐づく負傷は残る＝ダメージは治療されない）。",
        });
        return;
    }

    // 判定(check): 目標値を解決して通常の判定フローへ(完了継続 ctx.recovery)
    let targetValue = usage.targetValue === "number" ? (Number(usage.targetValueNumber) || 0) : null;
    if (usage.recoveryTargetFormula) {
        const plain = parsePlainNumber(usage.recoveryTargetFormula);
        if (plain !== null) {
            targetValue = plain;
        } else {
            const data = buildFormulaData(actor, null, item);
            data.condition = { magnitude: plan.magnitude, woundValue: plan.woundValue };
            const v = await evaluateFormula(usage.recoveryTargetFormula, data);
            if (v === null) {
                ui.notifications.warn("回復の目標値の式を評価できません（用途の目標値設定を使います）。");
            } else {
                targetValue = v;
            }
        }
    }

    const baseId = usage.baseSkillRef?.itemId || item.id;
    const comboIds = (usage.skillRefs ?? []).map(r => r.itemId).filter(id => id && actor.items.has(id));
    if (item.id !== baseId && !comboIds.includes(item.id)) comboIds.push(item.id);
    const allSkillIds = [baseId, ...comboIds.filter(id => id !== baseId)];
    const skillSystems = allSkillIds.map(id => actor.items.get(id)?.system).filter(Boolean);
    const validSuits = getComboSuits(skillSystems);
    if (!actor.items.get(baseId) || !validSuits.length) {
        ui.notifications.warn(`「${item.name}」で使用できるスートがありません。`);
        return;
    }
    const skillLabel = allSkillIds.map(id => actor.items.get(id)?.name ?? "").filter(Boolean).join("+");
    const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);

    await TnxCheckFlow.open({
        type:            "skillCheck",
        actorId:         actor.id,
        skillIds:        allSkillIds,
        skillLabel,
        validSuits,
        targetValue,
        bountyAvailable: comboUsesBounty(skillSystems) ? actorBounty : 0,
        consumeUses:     usesPlan,
        requestMessageId: null,
        checkBonuses:    usage.checkBonuses ?? [],
        checkBonusSelf:  usage.checkBonusSelf ?? "",
        sourceItemId:    item.id,
        allowSuitChange: usage.allowSuitChange === true,
        // 完了継続(TnxCheckFlow._execute → resolveRecoveryFromCheck)。継続処理のため再判定対象外
        recovery: {
            patientUuid: patient.uuid,
            removeIds:   plan.removeIds,
            label:       plan.label,
            usageName:   usage.name || item.name,
        },
    });
}

/**
 * 回復判定の完了継続(TnxCheckFlow._execute から)。成功で除去・失敗はそのまま。
 * 目標値なし(成否 null)は達成値の報告のみで除去せず、適用は卓裁定(結果カードから判断)。
 * @param {{patientUuid:string, removeIds:string[], label:string, usageName:string}} ctx
 * @param {object} result 判定結果
 */
export async function resolveRecoveryFromCheck(ctx, result) {
    const patient = await fromUuid(ctx.patientUuid).catch(() => null);
    if (!patient) return;

    if (result?.success === false || result?.fumble) {
        await postConditionOutcome(patient, {
            title: ctx.usageName, tag: "回復失敗", status: "failure",
            label: ctx.label, text: "は回復しませんでした。",
        });
        return;
    }
    if (result?.success !== true) return; // 目標値なし=成否は卓裁定(除去は手動)

    if (!await applyRecoveryRemoval(patient, ctx.removeIds)) return;
    await postConditionOutcome(patient, {
        title: ctx.usageName, tag: "回復", status: "success",
        label: ctx.label, text: "を回復（BS の紐づく負傷は残る＝ダメージは治療されない）。",
    });
}
