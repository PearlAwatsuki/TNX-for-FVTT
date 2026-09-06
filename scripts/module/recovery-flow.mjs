/**
 * @fileoverview 回復フロー(2026-07-13 ユーザー確定・正本 Conditions.md / Check_Rules.md)。
 *
 * BS・戦闘不能・負傷を除去する回復・治療系スタイル技能の表現。器は用途の回復設定
 * (recovery / recoveryTargets / recoveryExcludes / recoveryAll / recoveryCount /
 * recoveryTargetFormula)。使用は必ずアイテムロール。
 *
 * フロー:
 * 1. 使用 → 対象解決(ターゲット中のキャラクター・いなければ自分=し忘れの自動解決。
 *    対象欄の値では分岐・ブロックしない・2026-07-19 ユーザー裁定)
 * 2. **対象が現在受けている状態から回復対象を選択**(範囲=recoveryTargets・除外=recoveryExcludes。
 *    該当すべて(recoveryAll)は一覧確認のみ・それ以外は recoveryCount 個まで選択)
 * 3. declaration 用途=消費適用→即除去 / check 用途=判定へ(ctx.recovery 完了継続・成功で除去)
 *
 * 治療メニュー(シートの状態クリック=treatment-flow)起点も本フローへ一本化(2026-07-18 ユーザー確定):
 * 入口が範囲照合を済ませ、患者とクリック状態を prebound 文脈で渡す(手順1・2をスキップ)。
 * 旧・治療専用の目標値ハードコード(気絶/失神=15 等)と完了継続 ctx.treatment は廃止——目標値の
 * 分岐は用途の範囲指定＋目標値設定で表現する(通常ダメージ用の用途は戦闘不能系タグを全て除外に
 * 入れる設定規約)。
 *
 * 目標値: 発動タブの目標値設定に一本化(2026-07-13・回復専用の式欄は廃止)。解説参照/その他の
 * 自由記入欄の式は @condition.magnitude(選択した状態の強度・複数は最大)と
 * @condition.woundValue(負傷のダメージ値=治療対象のダメージのチャート値・同)を参照できる
 * (resolveUsageTargetValue に注入)。
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
import { stampCardOutcome } from "./chat-card.mjs";
import { nowrap } from "./chat-text.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { resolveTargetedOrSelf } from "./target-resolution.mjs";
import { CONDITION_KINDS, conditionDisplayName, getConditionKinds, recoveryKindMatches, recoveryKindExcluded, readCondition, woundChartValue } from "./conditions.mjs";
import { resolveConsumeRowsForActor, promptConsumption, applyConsumptionPlan } from "./usage-consumption.mjs";
import { executionFormOf } from "./usage-types.mjs";
import { buildPostTreatmentRest } from "./treatment-flow.mjs";
import { recoveryCandidateAllowed } from "./miracle-logic.mjs";
import { getSessionState } from "./session-state.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 対象アクターの現在の状態から、回復範囲に合致し除外に当たらない効果を列挙する。
 * 神業の治癒(防御タイプ「受けた後に消す」・17-2)の3条件——神業由来は神業でしか除去できない／
 * 受けたシーンの制限／BS・ダメージ以外の効果の解除——は純関数 recoveryCandidateAllowed が担う。
 * 状態でない効果は**どこから来たかを見ない**(2026-09-07 ユーザー指示)——選ぶのはダイアログ。
 * @param {Actor} patient
 * @param {object} usage
 * @param {{byMiracle?: boolean, currentScene?: ?{act?: string, number?: number}}} [ctx]
 *   byMiracle=用途の親が神業か・currentScene=上演中のシーン(アクト id とシーン番号)
 */
export function listRecoverableEffects(patient, usage, { byMiracle = false, currentScene = null } = {}) {
    const out = [];
    for (const e of (patient?.effects ?? [])) {
        const f = e.flags?.[SCOPE] ?? {};
        const kind = getConditionKinds(e)[0];
        const entry = {
            isCondition: !!kind,
            isTerminal: CONDITION_KINDS[kind]?.type === "terminal",
            fromMiracle: f.fromMiracle === true,
            receivedScene: f.receivedScene ?? null,
        };
        if (kind) {
            if (!recoveryKindMatches(kind, usage.recoveryTargets)) continue;
            if (recoveryKindExcluded(kind, usage.recoveryExcludes)) continue;
        }
        if (!recoveryCandidateAllowed(entry, usage, { byMiracle, currentScene })) continue;
        out.push(e);
    }
    return out;
}

/** 上演中のシーン(アクト id とシーン番号)。アクト外は act が空で、比較側は不明を通す。 */
function currentSceneRef() {
    const st = getSessionState();
    return { act: st.actId || null, number: Number.isFinite(st.sceneNumber) ? st.sceneNumber : null };
}

/** 負傷の除去範囲(治療と同じ: 負傷+紐づきの非BS。BS は残る)。 */
function woundRemovalIds(patient, wound) {
    const linked = patient.effects.filter(e =>
        e.flags?.[SCOPE]?.woundSource === wound.id
        && CONDITION_KINDS[getConditionKinds(e)[0]]?.group !== "bs");
    return [wound.id, ...linked.map(e => e.id)];
}

/** 選択された効果群から除去 ID 集合と式参照値(強度・ダメージ値の最大)を組む。
 *  表示名は状態と効果で分けて返す——状態は「回復」・効果は「解除」で言い方が違う。 */
function buildRemovalPlan(patient, effects) {
    const ids = new Set();
    let magnitude = 0;
    let woundValue = 0;
    const conditionLabels = [];
    const effectLabels = [];
    const addWoundRange = (wound) => {
        for (const id of woundRemovalIds(patient, wound)) ids.add(id);
        // チャート値: 保存値優先・無ければ kind から導出(手動付与の負傷は woundValue を持たない)
        woundValue = Math.max(woundValue, woundChartValue(wound));
    };
    for (const e of effects) {
        const kind = getConditionKinds(e)[0];
        const def = CONDITION_KINDS[kind];
        // 表示は名前の書式規約に従う(戦闘不能のタグ＝［］・BS/負傷などの名前＝「」)。
        // **負傷(ダメージ)を［］でくくらない**——戦闘不能と読み違えるため(2026-09-07 ユーザー指示)
        if (kind) conditionLabels.push(conditionDisplayName(kind, { quote: true }));
        else effectLabels.push(`「${e.name}」`);
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
    return { removeIds: [...ids], magnitude, woundValue,
        conditionLabel: conditionLabels.join("・"), effectLabel: effectLabels.join("・") };
}

/** 回復の帰結行(アイコンと文)。「誰の何を回復し、何を解除したか」を1行で示す。
 *  文は組み立て済みの HTML 断片(状態名の塊は描画時に、言い回しはここで折らないようにする)。 */
function recoveryOutcome(patientName, { conditionLabel = "", effectLabel = "" } = {}) {
    const esc = foundry.utils.escapeHTML;
    if (!conditionLabel && !effectLabel) return null;
    const parts = [];
    if (conditionLabel) parts.push(`${esc(conditionLabel)}${nowrap(effectLabel ? "を回復し、" : "を回復した")}`);
    if (effectLabel) parts.push(`${esc(effectLabel)}${nowrap("を解除した")}`);
    return { icon: "fa-kit-medical", text: `${esc(patientName)}の${parts.join("")}` };
}

/**
 * 回復対象の選択ダイアログ。
 * - 状態(BS・戦闘不能・負傷): recoveryAll=一覧確認のみ／それ以外=recoveryCount 個まで選択。
 * - BS・ダメージ以外の効果(recoveryEffects): **常に任意選択**(「該当すべて」でも一括では消さない)。
 *   効果文が「任意のスタイル技能の効果を解除する」(《人命救助》)「それらも同時に解除できる」(《腹心》)
 *   と任意にしているため。個数の上限も置かない(2026-09-07 ユーザー指示)。
 */
async function promptRecoverySelection(patient, candidates, usage) {
    const esc = foundry.utils.escapeHTML;
    const conditions = candidates.filter(e => getConditionKinds(e)[0]);
    const effects = candidates.filter(e => !getConditionKinds(e)[0]);
    const max = Math.max(1, Number(usage.recoveryCount) || 1);

    const conditionRows = conditions.map(e => {
        const kind = getConditionKinds(e)[0];
        const def = CONDITION_KINDS[kind];
        const mag = Number(readCondition(e)?.magnitude) || 0;
        const wv = woundChartValue(e);
        const linkedWound = def?.group === "incapacitation" && e.flags?.[SCOPE]?.woundSource
            ? patient.effects.get(e.flags[SCOPE].woundSource) : null;
        const extra = def?.type === "wound"
            ? `（ダメージ値 ${wv}・紐づく戦闘不能・効果も除去）`
            : linkedWound
                ? `（元の負傷${CONDITION_KINDS[getConditionKinds(linkedWound)[0]]
                    ? conditionDisplayName(getConditionKinds(linkedWound)[0], { quote: true })
                    : `「${linkedWound.name}」`}ごと治療）`
                : (mag ? `（強度 ${mag}）` : "");
        const input = usage.recoveryAll
            ? `<input type="checkbox" checked disabled>`
            : `<input type="checkbox" name="recover" value="${esc(e.id)}">`;
        return `<div class="tnx-uses-row"><label>${input}
            <span>${esc(def?.label ?? e.name)}${esc(extra)}</span></label></div>`;
    }).join("");
    const conditionNote = usage.recoveryAll
        ? "<p class=\"tnx-uses-note\">該当するすべての状態を回復します。</p>"
        : `<p class="tnx-uses-note">回復する状態を選んでください（最大 ${max} 個）。</p>`;

    const effectRows = effects.map(e =>
        `<div class="tnx-uses-row"><label>
            <input type="checkbox" name="recoverEffect" value="${esc(e.id)}">
            <span>${esc(e.name)}</span></label></div>`).join("");
    const effectNote = "<p class=\"tnx-uses-note\">解除する効果を選んでください。</p>";

    const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: `回復対象の選択: ${patient.name}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-uses-dialog"],
        position: { width: 420 },
        content: `<div class="tnx-uses-consume">`
            + (conditions.length ? conditionNote + conditionRows : "")
            + (effects.length ? effectNote + effectRows : "")
            + `</div>`,
        buttons: [
            { action: "ok", icon: "fas fa-check", label: "決定", default: true,
              callback: (_e, _b, dialog) => ({
                  conditions: usage.recoveryAll
                      ? conditions.map(e => e.id)
                      : [...dialog.element.querySelectorAll('input[name="recover"]:checked')].map(cb => cb.value),
                  effects: [...dialog.element.querySelectorAll('input[name="recoverEffect"]:checked')].map(cb => cb.value),
              }) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    // DialogV2 は「コールバックの戻り値 ?? ボタンの action」を返す——キャンセルの戻り値 null は
    // 文字列 "cancel" になって届く。中止は**選択結果(オブジェクト)でないこと**で判定する
    if (!picked || typeof picked !== "object") return null;
    if (!usage.recoveryAll && picked.conditions.length > max) {
        ui.notifications.warn(`回復できる状態は最大 ${max} 個です。`);
        return null;
    }
    const ids = [...picked.conditions, ...picked.effects];
    if (!ids.length) { ui.notifications.warn("回復・解除するものが選ばれていません。"); return null; }
    return candidates.filter(e => ids.includes(e.id));
}

/** 回復対象(1体)を解決する: ターゲット中のキャラクター(先頭)・いなければ自分(し忘れの自動解決・
 *  2026-07-19 ユーザー裁定=対象欄の値では分岐・ブロックしない)。
 *  複数ターゲット時は先頭の1体(回復は1体対象・数の自動化はしない)。 */
function resolveRecoveryPatient(actor) {
    return resolveTargetedOrSelf(actor);
}

/** 除去を実行する(所有権が無ければ treatmentApply ソケットで GM 委譲=治療と同じ経路)。 */
async function applyRecoveryRemoval(patient, removeIds) {
    if (patient.isOwner) {
        const ids = removeIds.filter(id => patient.effects.get(id));
        const rest = buildPostTreatmentRest(patient, ids);
        await patient.deleteEmbeddedDocuments("ActiveEffect", ids);
        if (rest) await patient.createEmbeddedDocuments("ActiveEffect", [rest]);
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
 * 治療用途を使用する(アイテムロールから・2026-07-17 タイプ化)。実行形式は用途の設定
 * (executionForm): 宣言=即時除去/判定=判定へ(完了継続で除去)。
 * 治療メニュー(状態クリック)起点は prebound 文脈(患者・クリック状態が確定済み)で呼ばれ、
 * 対象解決と回復対象の選択をスキップする(2026-07-18 一本化。範囲照合は入口=startTreatment が
 * ダメージインスタンスの kind 集合で済ませている——負傷行クリックにタグ範囲の用途が合致する
 * 組み合わせがあるため、ここでクリック状態単体の範囲を再検査しない)。
 * @param {Item} item 治療タイプの用途を持つアイテム
 * @param {object} usage type="treatment" の用途エントリ
 * @param {?{patientUuid:string, effectId:string}} [prebound] 治療メニュー起点の確定済み文脈
 */
export async function useRecovery(item, usage, prebound = null, { asOther = null } = {}) {
    const actor = item.actor;
    if (!actor) { ui.notifications.warn("治療はアクターが所持しているアイテムから使用してください。"); return; }
    if (!(usage.recoveryTargets ?? []).length) {
        ui.notifications.warn("回復対象の範囲が設定されていません（用途の〈治療〉で設定してください）。");
        return;
    }

    let patient;
    let selected;
    // 神業の治癒(17-2): 用途の親が神業なら印のゲートを通れる。受けたシーンの比較は上演中のシーン
    const byMiracle = item.type === "miracle";
    const currentScene = currentSceneRef();
    if (prebound) {
        patient = await fromUuid(prebound.patientUuid).catch(() => null);
        const effect = patient?.effects?.get(prebound.effectId);
        if (!effect) { ui.notifications.warn("治療対象の状態が見つかりません。"); return; }
        // 神業由来の状態は神業でしか治せない(印のゲートの受け側)
        if (effect.flags?.[SCOPE]?.fromMiracle === true && !byMiracle) {
            ui.notifications.warn("この状態は神業によるもので、神業以外では治療できません。");
            return;
        }
        selected = [effect];
    } else {
        patient = resolveRecoveryPatient(actor);

        const candidates = listRecoverableEffects(patient, usage, { byMiracle, currentScene });
        if (!candidates.length) {
            ui.notifications.warn(`「${patient.name}」に回復対象となる状態がありません。`);
            return;
        }
        selected = await promptRecoverySelection(patient, candidates, usage);
        if (!selected) return;
    }
    const plan = buildRemovalPlan(patient, selected);

    // 宣言形(判定なし・実行形式は用途の設定=2026-07-17): 消費(使用時に確定・適用)→即除去
    if (executionFormOf(usage) !== "check") {
        const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
        const usesPlan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
        if (usesPlan === null) return;
        await applyConsumptionPlan(usesPlan);
        if (!await applyRecoveryRemoval(patient, plan.removeIds)) return;
        // 回復したことは、**その使用を表しているカードの帰結行**として出す(2026-09-07 ユーザー指示)——
        // 帰結だけの短いカードを別に出さない。神業の治癒(17-2)は神業カード(神業の使用を卓に提示する・
        // 使用ログの記帳点・17-5)、それ以外は他の宣言用途と同じアイテムの解説カード
        const outcome = recoveryOutcome(patient.name, plan);
        if (item.type === "miracle") {
            const { postMiracleCard } = await import("./miracle-flow.mjs");
            await postMiracleCard(item, { asOther, outcome });
        } else {
            await item.postDescriptionCard({ outcome });
        }
        return true; // 発動した(神業の要求カードが使用済みを記録する・17-4)
    }

    // 判定(check): 共通前段(不備検知・参加技能・報酬点・消費・適用効果・目標値)で解決して通常の
    // 判定フローへ(2026-07-16 一本化。従来この経路だけ適用効果・再判定可能・報酬点ブロックを
    // 読み落としていた)。目標値は発動タブの設定に一本化(2026-07-13)——解説参照/その他の式には
    // 選択した状態の @condition.magnitude/@condition.woundValue を注入する
    const base = await buildUsageCheckContext(actor, item, usage, {
        targetValueExtra: { condition: { magnitude: plan.magnitude, woundValue: plan.woundValue } },
    });
    if (!base) return;

    await TnxCheckFlow.open({
        ...base,
        // 完了継続(TnxCheckFlow._execute → resolveRecoveryFromCheck)
        recovery: {
            patientUuid:    patient.uuid,
            removeIds:      plan.removeIds,
            conditionLabel: plan.conditionLabel,
            effectLabel:    plan.effectLabel,
        },
    });
}

/**
 * 回復判定の完了継続(TnxCheckFlow._execute から)。成功で除去・失敗はそのまま。
 * 目標値なし(成否 null)は達成値の報告のみで除去せず、適用は卓裁定(結果カードから判断)。
 * 回復したことは**判定結果カードの帰結行**として刻む(2026-09-07 ユーザー指示・別カードを出さない)。
 * 失敗は結果カード自身が「失敗」と示すため、帰結行は刻まない。
 * @param {{patientUuid:string, removeIds:string[], conditionLabel:string, effectLabel:string}} ctx
 * @param {object} result 判定結果
 * @param {{messageId?: ?string}} [args] messageId=帰結行を刻む判定結果カード
 */
export async function resolveRecoveryFromCheck(ctx, result, { messageId = null } = {}) {
    const patient = await fromUuid(ctx.patientUuid).catch(() => null);
    if (!patient) return;

    if (result?.success !== true) return; // 失敗・目標値なし(成否は卓裁定=除去は手動)

    if (!await applyRecoveryRemoval(patient, ctx.removeIds)) return;
    const message = messageId ? game.messages.get(messageId) : null;
    // 旧いカードの再判定スナップショットは label 1本(状態のみ)——そのまま状態の名前として読む
    const outcome = recoveryOutcome(patient.name, {
        conditionLabel: ctx.conditionLabel ?? ctx.label ?? "", effectLabel: ctx.effectLabel ?? "",
    });
    if (message && outcome) await stampCardOutcome(message, outcome);
}
