/**
 * @fileoverview 治療メニューの入口(2026-07-18 治療用途へ一本化・正本 Damage_Rules.md「治療」)。
 *
 * シートの状態(負傷/戦闘不能)クリックから治療を開始する。実行の実体は治療用途(usage type="treatment"
 * =recovery-flow)であり、本モジュールは入口の照合だけを担う:
 * 1. クリックされた状態をダメージインスタンス(負傷＋紐づき戦闘不能/支配)の kind 集合へ展開する
 *    (負傷と紐づく戦闘不能は同じ一つのダメージ=2026-07-09 ユーザー裁定。どの行をクリックしても同じ集合)。
 * 2. 治療者=操作可能なキャスト/ゲストから選択(既定=担当キャラクター・1体なら即決)。担当キャラ固定は
 *    不備(RL は複数のゲストを操作する=2026-07-18 ユーザー是正)。治療に使う技能はその治療者自身のもの。
 * 3. 治療者のアイテムから kind 集合に範囲適合(recoveryTargets/recoveryExcludes)する治療用途を検出。
 *    無ければ「治療できる技能が無い」で中止(代用判定は廃止=2026-07-18)。
 * 4. _activateItemCheck へ prebound 文脈(患者・クリック状態)を注入して起動(起動関数の一本化規範)。
 *    実行(消費・宣言/判定・除去)は recovery-flow が担う。
 *
 * 旧・治療専用機構(目標値ハードコード 気絶/失神=15・仮死/昏睡=20・それ以外=ダメージ値、
 * 社会ダメージのハードブロック、代用判定、完了継続 ctx.treatment)は撤去済み——分岐はすべて用途の
 * 範囲指定と目標値設定で表現する(通常ダメージ用の用途は戦闘不能系タグを全て除外に入れる設定規約。
 * チャート値=目標値式の @condition.woundValue)。
 */

import { CONDITION_KINDS, getConditionKinds, usageCanTreatKinds } from "./conditions.mjs";
import { TargetSelectionDialog } from "./tnx-dialog.mjs";
import { itemDisplayName } from "./identification.mjs";
import { usageDisplayName } from "./usage-types.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * クリックされた状態をダメージインスタンス(負傷＋紐づき戦闘不能/支配)の kind 集合へ展開する。
 * 用途照合(usageCanTreatKinds)に使う。治療メニューの対象でない状態(BS 等)は null
 * (BS の回復はアイテムロール経路=recovery-flow の対象選択で行う)。
 * @param {Actor} patient
 * @param {ActiveEffect} effect クリックされた状態(負傷 or 戦闘不能)
 * @returns {?string[]}
 */
export function resolveTreatmentKinds(patient, effect) {
    if (!effect) return null;
    const kind = getConditionKinds(effect)[0];
    const def = CONDITION_KINDS[kind];
    if (!def) return null;
    if (def.group === "incapacitation") {
        const woundId = effect.flags?.[SCOPE]?.woundSource || "";
        const wound = woundId ? patient.effects.get(woundId) : null;
        return wound ? woundInstanceKinds(patient, wound) : [kind]; // 孤立戦闘不能は単独
    }
    if (def.type === "wound") return woundInstanceKinds(patient, effect);
    return null;
}

/** 負傷の kind＋紐づく戦闘不能系(支配含む)の kind。BS は独立効果のためインスタンスに含めない。 */
function woundInstanceKinds(patient, wound) {
    const linked = patient.effects
        .filter(e => e.flags?.[SCOPE]?.woundSource === wound.id)
        .map(e => getConditionKinds(e)[0])
        .filter(k => CONDITION_KINDS[k]?.group === "incapacitation");
    return [getConditionKinds(wound)[0], ...linked];
}

/**
 * 治療を開始する(負傷/戦闘不能のクリックから)。範囲適合する治療用途を照合し、判定システムへ渡す。
 * @param {Actor} patient 負傷したアクター
 * @param {string} effectId クリックされた状態の AE id
 */
export async function startTreatment(patient, effectId) {
    const effect = patient.effects.get(effectId);
    const kinds = resolveTreatmentKinds(patient, effect);
    if (!kinds) {
        ui.notifications.warn("この状態は治療の対象ではありません。");
        return;
    }

    // 治療者の選択: 操作可能なキャスト/ゲスト(既定=担当キャラ)。担当キャラ固定は RL(複数ゲスト操作)で
    // 破綻するため選択制(2026-07-18 ユーザー是正)。治療に使う技能は選んだ治療者自身のものだけを照合する
    const treater = await pickTreater();
    if (!treater) return;

    // 範囲適合する治療用途の全数収集(アイテム型は不問=アイテムロール経路と同じ資格)。
    // 通常は除外設定の規約(通常ダメージ用途=戦闘不能系タグ全除外)でちょうど1つに決まる
    const matches = [];
    for (const item of [...treater.items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
        for (const usage of (item.system.actions ?? [])) {
            if (usage.type !== "treatment") continue;
            if (!usageCanTreatKinds(usage, kinds)) continue;
            matches.push({ item, usage });
        }
    }
    if (!matches.length) {
        ui.notifications.warn(`「${treater.name}」にこのダメージを治療できる技能がありません。`);
        return;
    }

    // 複数合致(タグ改変 AE の追加タグは除外の静的展開に掛からない等)は用途を選んでもらう
    let picked = matches[0];
    if (matches.length > 1) {
        const options = matches.map((m, i) => ({
            value: String(i),
            label: `${itemDisplayName(m.item)}: ${usageDisplayName(m.usage, m.item.name)}`,
        }));
        const idx = await TargetSelectionDialog.prompt({
            title: "治療に使用する用途の選択",
            label: "この治療に使用する用途を選択してください。",
            options,
            selectLabel: "治療へ",
        });
        if (idx === null || idx === undefined || idx === "") return;
        picked = matches[Number(idx)] ?? matches[0];
    }

    // 状態タブ起点は患者(状態の所有アクター)へレティクルを自動付与する(2026-07-18 ユーザー確定)——
    // 以後の対象解決(決定表駆動)と適用効果が患者をターゲットとして読める
    patient.getActiveTokens?.()[0]?.setTarget(true, { releaseOthers: true });

    // 起動は唯一の起動関数へ集約(2026-07-15 ユーザー確定)。患者とクリック状態を prebound 文脈として
    // 注入するだけで、実行(消費・宣言/判定・除去)は recovery-flow が担う
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(treater, picked.item, {
        usageId: picked.usage._id,
        treatment: { patientUuid: patient.uuid, effectId: effect.id },
    });
}

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
        label: "治療を行うキャラクターを選択してください。",
        options,
        selectLabel: "治療へ",
    });
    return id ? game.actors.get(id) : null;
}

/** GM が委譲された治療/回復の状態除去を代行する(treatmentApply ソケット)。 */
export async function applyTreatmentDelegated({ patientUuid, removeIds }) {
    const patient = await fromUuid(patientUuid).catch(() => null);
    if (!patient) return;
    const ids = (removeIds ?? []).filter(id => patient.effects.get(id));
    if (ids.length) await patient.deleteEmbeddedDocuments("ActiveEffect", ids);
}
