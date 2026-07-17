/**
 * @fileoverview 治療フロー(フェーズ12・正本 Damage_Rules.md「治療」)。
 *
 * 負傷(または戦闘不能)を対象に〈医療〉判定を行い、成功で「そのダメージチャートの効果」を
 * まとめて除去する。除去範囲(2026-07-09 ユーザー確定):
 * - 負傷本体＋その負傷に紐づく戦闘不能(woundSource)＋負傷自身の非BS効果 → すべて除去。
 * - BS は独立効果なので**除去しない**(BS 自身の解除条件/解除効果で回復する)。
 * - **社会ダメージは治療不可**。
 *
 * 目標値: 気絶/失神=15・仮死/昏睡=20・それ以外=そのダメージの数値(負傷付与時に woundValue 保存)。
 * 「1シーン1回」「回復後2シーン後から行動可」は時間管理=フェーズ15(ここでは扱わない)。
 *
 * 判定は判定システムの延長: 〈医療〉判定を TnxCheckFlow で行い、完了継続 ctx.treatment が
 * 成否に応じて除去/報告する(代用判定も可)。除去は患者の所有権が要るため、非所有時は GM 委譲。
 */

import { CONDITION_KINDS } from "./conditions.mjs";
import { getConditionKinds } from "./conditions.mjs";
import { TargetSelectionDialog } from "./tnx-dialog.mjs";
import { buildSkillOptions } from "./skill-select.mjs";
import { formatSkillName } from "./identification.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";

const SCOPE = "tokyo-nova-axleration";

/** 戦闘不能タグの治療目標値(気絶/失神=15・仮死/昏睡=20)。 */
const INCAP_TARGET_VALUE = Object.freeze({ faint: 15, swoon: 15, coma: 20, stupor: 20 });

/**
 * クリックされた状態から治療インスタンス(負傷＋紐づき、または孤立戦闘不能)を解決する。
 * @param {Actor} patient
 * @param {ActiveEffect} effect クリックされた状態(負傷 or 戦闘不能)
 * @returns {?{woundId:?string, removeIds:string[], targetValue:number, label:string}}
 *   社会の負傷(治療不可)・治療対象でない状態は null。
 */
export function resolveTreatmentInstance(patient, effect) {
    if (!effect) return null;
    const kind = getConditionKinds(effect)[0];
    const def = CONDITION_KINDS[kind];
    if (!def) return null;

    // 戦闘不能タグをクリック → 紐づく負傷があればその負傷を治療、なければ孤立戦闘不能を単独治療
    if (def.group === "incapacitation") {
        const woundId = effect.flags?.[SCOPE]?.woundSource || "";
        const wound = woundId ? patient.effects.get(woundId) : null;
        if (wound) return buildWoundInstance(patient, wound);
        // 孤立戦闘不能: 単独除去(目標値=タグ種別)
        return {
            woundId: null,
            removeIds: [effect.id],
            targetValue: INCAP_TARGET_VALUE[kind] ?? 15,
            label: def.label,
        };
    }

    // 負傷をクリック
    if (def.type === "wound") {
        if (def.group === "social") return null; // 社会ダメージは治療不可
        return buildWoundInstance(patient, effect);
    }
    return null; // BS 等は治療対象でない
}

/** 負傷 → 治療インスタンス(紐づく戦闘不能・非BS効果を除去対象に集め、目標値を決める)。 */
function buildWoundInstance(patient, wound) {
    const woundKind = getConditionKinds(wound)[0];
    if (CONDITION_KINDS[woundKind]?.group === "social") return null; // 社会は治療不可
    // 紐づき(woundSource=この負傷)のうち **BS 以外**(戦闘不能・非BS効果)を除去対象にする。
    // BS は独立効果なので治療では残す(BS 自身の解除条件で回復)。※制御判定の無効化では BS も消す(別経路)
    const linked = patient.effects.filter(e =>
        e.flags?.[SCOPE]?.woundSource === wound.id
        && CONDITION_KINDS[getConditionKinds(e)[0]]?.group !== "bs");
    const removeIds = [wound.id, ...linked.map(e => e.id)];

    // 目標値: 紐づく戦闘不能があればその種別(仮死/昏睡=20 優先・気絶/失神=15)、なければ負傷のダメージ値
    let targetValue = Number(wound.flags?.[SCOPE]?.woundValue) || 0;
    let incapTv = null;
    for (const e of linked) {
        const k = getConditionKinds(e)[0];
        // 支配(2026-07-12 ユーザー裁定): 上書き由来(replacedFrom あり=昏睡/精神崩壊の置換)は
        // 「昏睡と同じ」=目標値20。タグ追加由来は目標値に関与しない(除去は紐づきで負傷と同時)
        const tv = k === "dominated"
            ? (e.flags?.[SCOPE]?.replacedFrom ? 20 : undefined)
            : INCAP_TARGET_VALUE[k];
        if (tv !== undefined) incapTv = incapTv === null ? tv : Math.max(incapTv, tv);
    }
    if (incapTv !== null) targetValue = incapTv;

    return { woundId: wound.id, removeIds, targetValue, label: CONDITION_KINDS[woundKind]?.label ?? wound.name };
}

/**
 * 治療を開始する(負傷/戦闘不能のクリックから)。治療者を選び、〈医療〉判定を起動する。
 * @param {Actor} patient 負傷したアクター
 * @param {string} effectId クリックされた状態の AE id
 */
export async function startTreatment(patient, effectId) {
    const effect = patient.effects.get(effectId);
    const instance = resolveTreatmentInstance(patient, effect);
    if (!instance) {
        ui.notifications.warn("この状態は治療の対象ではありません（社会ダメージは治療不可）。");
        return;
    }

    // 治療者の選択: 操作可能なキャラクター(GM は全キャスト/ゲスト)。既定は自分の担当キャラ
    const treater = await pickTreater();
    if (!treater) return;

    // 治療タイプの用途を持つ技能を検出(2026-07-17 再編: 役割検出でなく用途タイプの所持が資格)。
    // 無ければ代用判定(別技能＋手動修正)。複数なら先頭(sort 順)を使う
    const typeSkills = (treater?.items ?? [])
        .filter(i => (i.type === "generalSkill" || i.type === "styleSkill")
            && (i.system.actions ?? []).some(a => a.type === "treatment"))
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    let skill = typeSkills[0] ?? null;
    let substitution = null;
    let manualMod = 0;
    if (!skill) {
        const sub = await promptSubstituteSkill(treater);
        if (!sub) return;
        skill = sub.skill;
        substitution = { requestedLabel: "治療", usedName: formatSkillName(sub.skill.name) };
        manualMod = sub.manualMod;
    }
    // 起動は唯一の起動関数へ集約(2026-07-15 ユーザー確定)。用途・コンボ・消費・判定ボーナス・適用効果は
    // シートの技能クリックと全く同じ処理で解決し、ここでは治療文脈(目標値上書き・代用・除去対象)だけを
    // 注入する(組み合わせの可否はユーザー/RL が決めるものでシステムは制限しない)。
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(treater, skill, {
        targetValue: instance.targetValue,
        substitution, manualMod,
        treatment: { patientUuid: patient.uuid, woundLabel: instance.label, removeIds: instance.removeIds },
    });
}

/**
 * 治療判定の完了継続(TnxCheckFlow._execute → ctx.treatment)。
 * 成功で除去対象(負傷＋紐づき戦闘不能＋非BS効果)を患者から削除する。BS は残す。
 * @param {{patientUuid:string, woundLabel:string, removeIds:string[]}} ctx
 * @param {object} result 判定結果
 */
export async function resolveTreatmentFromCheck(ctx, result) {
    const patient = await fromUuid(ctx.patientUuid).catch(() => null);
    if (!patient) return;

    const { postConditionOutcome } = await import("./condition-resolution.mjs");
    if (result?.success !== true) {
        await postConditionOutcome(patient, {
            title: "治療", tag: "失敗", status: "failure",
            label: ctx.woundLabel, text: "は回復しませんでした。",
        });
        return;
    }

    // 除去は患者の所有権が要る。非所有クライアントは GM へ委譲(treatmentApply ソケット)
    if (patient.isOwner) {
        await patient.deleteEmbeddedDocuments("ActiveEffect", ctx.removeIds.filter(id => patient.effects.get(id)));
    } else if (game.users.activeGM) {
        TnxSocketHandler.emitTreatmentApply({ patientUuid: patient.uuid, removeIds: ctx.removeIds });
    } else {
        ui.notifications.warn("患者の所有権がなく GM も不在のため、治療結果を適用できません。");
        return;
    }

    await postConditionOutcome(patient, {
        title: "治療", tag: "成功", status: "success",
        label: ctx.woundLabel, text: "を回復（BS は個別の解除条件で回復）。",
    });
}

/** GM が委譲された治療除去を代行する(socket)。 */
export async function applyTreatmentDelegated({ patientUuid, removeIds }) {
    const patient = await fromUuid(patientUuid).catch(() => null);
    if (!patient) return;
    const ids = (removeIds ?? []).filter(id => patient.effects.get(id));
    if (ids.length) await patient.deleteEmbeddedDocuments("ActiveEffect", ids);
}

// ─── ヘルパー ───────────────────────────────────────────────────────────────

/** 治療者を選ぶ(操作可能なキャスト/ゲスト。既定=担当キャラ)。1体だけなら即返す。 */
async function pickTreater() {
    const candidates = game.actors.filter(a =>
        (a.type === "cast" || a.type === "guest") && (game.user.isGM || a.isOwner));
    if (!candidates.length) { ui.notifications.warn("治療を行えるキャラクターがいません。"); return null; }
    if (candidates.length === 1) return candidates[0];

    const mine = game.user.character?.id;
    const options = candidates
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        .map(a => ({ value: a.id, label: a.name, selected: a.id === mine }));
    const id = await TargetSelectionDialog.prompt({
        title: "治療者の選択",
        label: "〈医療〉判定を行うキャラクターを選択してください。",
        options,
        selectLabel: "治療へ",
    });
    return id ? game.actors.get(id) : null;
}

/** 〈医療〉役割の技能が無い場合の代用判定: 別技能を選び手動修正を入力する。 */
async function promptSubstituteSkill(actor) {
    const skills = actor.items.filter(i => i.type === "generalSkill" || i.type === "styleSkill");
    if (!skills.length) { ui.notifications.warn(`「${actor.name}」に判定できる技能がありません。`); return null; }
    const esc = foundry.utils.escapeHTML;
    const options = buildSkillOptions(skills).map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
    const { spinnerDialogActions } = await import("./tnx-dialog.mjs");
    const res = await foundry.applications.api.DialogV2.wait({
        window: { title: "代用判定: 治療" },
        classes: ["tokyo-nova", "tnx-dialog"],
        position: { width: 360 },
        content: `<p>「${esc(actor.name)}」は治療の用途を持つ技能が無いため、別の技能で代用します（可否・修正の裁定は卓）。</p>
            <div class="form-group"><label>使用する技能</label><select name="skillId">${options}</select></div>
            <div class="form-group"><label>修正（手動・ペナルティは負数）</label>
                <div class="number-input-spinner">
                    <button type="button" class="tnx-btn" data-action="decrement" aria-label="Decrease">-</button>
                    <input type="number" name="manualMod" value="0" min="-99" max="99">
                    <button type="button" class="tnx-btn" data-action="increment" aria-label="Increase">+</button>
                </div>
            </div>`,
        actions: spinnerDialogActions,
        buttons: [
            { action: "ok", icon: "fas fa-diamond", label: "この技能で判定", default: true,
              callback: (_e, _b, dialog) => ({
                  skillId:   dialog.element.querySelector('[name="skillId"]')?.value ?? "",
                  manualMod: Number(dialog.element.querySelector('[name="manualMod"]')?.value) || 0,
              }) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    if (!res?.skillId) return null;
    const skill = actor.items.get(res.skillId);
    return skill ? { skill, manualMod: res.manualMod } : null;
}

