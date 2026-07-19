/**
 * @fileoverview 判定起動の共通前段(2026-07-16 一本化)。用途から通常判定(TnxCheckFlow.open)へ
 * 渡すコンテキストの組み立てを、ここ一箇所に集約する。
 *
 * 従来はアクターシートの技能クリック(_activateItemCheck)・攻撃(useAttack)・NPC取得
 * (useCheckAcquire)・回復(useRecovery)がそれぞれ同じ前処理(不備検知→参加技能解決→報酬点→
 * 消費→適用効果→目標値→判定ボーナス)をコピーして持っており、後から足した仕様(報酬点ブロック・
 * 適用効果・目標値欄・再判定可能)が専用フロー側に反映されない取りこぼしが繰り返されていた
 * (2026-07-16 ユーザー指摘の監査で確定)。専用フローは固有の前処理(武器・対象・回復対象の解決)と
 * 固有ペイロード(attack/npcAcquire/recovery)だけを持ち、共通部は本モジュールを通す。
 */

import { getComboSuits, comboUsesBounty } from "./tnx-check-engine.mjs";
import { resolveConsumeRowsForActor, promptConsumption } from "./usage-consumption.mjs";
import { prepareUsageEffectPayload } from "./usage-effects.mjs";
import { resolveUsageTargetValue } from "./usage-target-value.mjs";
import { executionFormOf, effectiveBaseSkillId } from "./usage-types.mjs";
import { formatSkillName } from "./identification.mjs";

/**
 * 技能ベース用途(check)の参加技能を解決する。ベース技能(用途の baseSkillRef 優先・未設定は親アイテム)＋
 * コンボ技能(skillRefs)＋非ベースの親技能の自動追加、および全技能の共通スート(getComboSuits)を返す。
 * 用途不備検知と判定実行で共用する(旧 TnxCharacterSheetBase._resolveSkillSet)。
 */
export function resolveUsageSkillSet(item, usage, actor) {
    // ベース id は共通リゾルバに集約(2026-07-18)。起動時の最終フォールバック(未永続の瞬間に親へ)。
    const baseSkillId = effectiveBaseSkillId(usage, item);
    const baseSkill = actor?.items.get(baseSkillId) ?? null;
    const comboSkillIds = (usage.skillRefs ?? [])
        .map(r => r.itemId)
        .filter(id => id && actor?.items.has(id));
    // 用途を所持する技能がベースでない(非アクション技能からの起動)場合は自動的にコンボへ追加
    if (item.id !== baseSkillId && !comboSkillIds.includes(item.id)) comboSkillIds.push(item.id);
    const allSkillIds = [baseSkillId, ...comboSkillIds];
    const allSkillSystems = allSkillIds.map(id => actor?.items.get(id)?.system).filter(Boolean);
    const validSuits = getComboSuits(allSkillSystems);
    return { baseSkillId, baseSkill, comboSkillIds, allSkillIds, allSkillSystems, validSuits };
}

/**
 * 用途不備検知(機能): 設定済みの用途に不備があれば不備内容(文字列)を、無ければ null を返す。
 * 2026-07-17 行動種別再編: 判定を行う用途すべて(攻撃・リアクション・移動・治療(判定形)等)が対象
 * (旧 type==="check" 限定だと新タイプがベース技能・共通スートの検知を素通りする)。
 */
export function detectUsageDefect(item, usage, actor) {
    // 宣言形は判定を行わない・固定達成値の用途は技能・スートを使わないため対象外(フェーズ11-5)
    if (executionFormOf(usage) !== "check" || Number.isFinite(usage.fixedResult)) return null;
    const { baseSkill, validSuits } = resolveUsageSkillSet(item, usage, actor);
    if (!baseSkill) return "ベース技能が見つかりません";
    if (!validSuits.length) return "参加技能に共通スートがありません";
    return null;
}

/**
 * 通常判定の open コンテキスト共通部を組み立てる(判定起動の共通前段)。
 * エキストラ制限 → 不備検知 → 参加技能解決 → 報酬点(usesBounty) →
 * 使用回数の消費確認 → 適用効果ペイロード → 目標値解決、の順で確定する。
 * 呼び出し側は戻り値に固有ペイロード(attack/npcAcquire/recovery/extraOpen)を重ねて
 * TnxCheckFlow.open へ渡す(targetValue 等の上書きも呼び出し側で行う)。
 * @param {Actor} actor 起動アクター
 * @param {Item} item 用途の親アイテム
 * @param {object} usage 用途エントリ
 * @param {object} [opts]
 * @param {Array|undefined} [opts.effectTargetOverride] 適用効果の対象上書き
 *   (リアクション=攻撃者へ返す等。undefined=通常のターゲット解決)
 * @param {object|undefined} [opts.targetValueExtra] 目標値式の追加コンテキスト
 *   (回復の @condition.magnitude/@condition.woundValue 等)
 * @returns {Promise<object|null>} open へ渡す共通部。null=不備/キャンセルで中止(通知済み)
 */
export async function buildUsageCheckContext(actor, item, usage, {
    effectTargetOverride = undefined,
    targetValueExtra = undefined,
} = {}) {
    // 能力値を持たないアクター(extra)は通常判定を行えない(固定値判定のみ＝Check_Rules「固定値判定」。
    // 固定達成値の用途は呼び出し側の分岐で処理済み)。攻撃・NPC取得・回復の判定も通常判定の一種
    if (actor.type === "extra") {
        ui.notifications.warn("エキストラは固定値の判定のみ行えます。");
        return null;
    }

    // 用途不備検知: 設定済みの用途に不備があれば必ず通知して中止する
    const defect = detectUsageDefect(item, usage, actor);
    if (defect) {
        ui.notifications.warn(`「${item.name}」の用途に不備があります（${defect}）。`);
        return null;
    }

    // 対象解決(2026-07-18 決定表駆動): 用途の「対象」×「対決」で解決する(自身/単体の自動セルフ・
    // 未ターゲット時ダイアログ)。攻撃/対決フローは呼び出し前に解決済み=レティクルが
    // 立っているためここでは素通りする。適用効果の対象はこの時点のレティクルが正
    const { resolveUsageTargetRefs } = await import("./target-resolution.mjs");
    if (await resolveUsageTargetRefs(actor, usage) === null) return null;

    // 参加技能(ベース＋コンボ)の解決
    const { allSkillIds, allSkillSystems, validSuits } = resolveUsageSkillSet(item, usage, actor);
    // 技能名の表示は 〈〉 整形(2026-07-18 ユーザー確定): 例「〈白兵〉+〈運動〉」
    const skillLabel = allSkillIds
        .map(id => formatSkillName(actor.items.get(id)?.name ?? ""))
        .filter(Boolean)
        .join("+");

    // 報酬点: 参加技能のいずれかが usesBounty なら可(ベース限定は誤り・2026-07-10 ユーザー確定)。
    // 報酬点使用不可(口座凍結/信用失墜)は消費時点の状態で判定するため、ここでは見ない——
    // TnxCheckFlow._execute の報酬点ダイアログ直前の一元ゲートが全経路(情報収集・再判定含む)を塞ぐ
    const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);
    const bountyAvailable = comboUsesBounty(allSkillSystems) ? actorBounty : 0;

    // 使用回数の消費を確認(用途の消費先設定＝consumeTargets 由来・11-6。残量不足でチェック時は
    // ブロック)。分身は本体側カウンターへ差し替えて共有(Troops.md)。確定した平プランは判定実行時に適用
    const consumeRows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const usesPlan = await promptConsumption(actor, consumeRows, { title: `使用回数の消費: ${item.name}` });
    if (usesPlan === null) return null;

    // 用途の適用効果: ターゲットしたキャラクターへ付与するペイロードを用意(ノーターゲットは確認)。
    // 結果カードに載せ、対象所有者/GM がボタンで付与する(2026-07-10)
    const usageEffects = await prepareUsageEffectPayload(actor, item, usage,
        effectTargetOverride !== undefined ? { targetOverride: effectTargetOverride } : {});
    if (usageEffects === "cancel") return null;

    return {
        type:            "skillCheck",
        actorId:         actor.id,
        skillIds:        allSkillIds,
        skillLabel,
        validSuits,
        // 目標値(2026-07-13 ユーザー確定): 数字=そのまま目標値・解説参照/その他=自由記入欄の
        // 式を評価(空/評価不能はなし)・制御値/達成値/登場目標値=別メカニクス(具体値は引かない)
        targetValue:     await resolveUsageTargetValue(usage, actor, item, targetValueExtra ?? {}),
        bountyAvailable,
        consumeUses:     usesPlan,
        requestMessageId: null,
        checkBonuses:    usage.checkBonuses ?? [],
        checkBonusSelf:  usage.checkBonusSelf ?? "",
        sourceItemId:    item.id,   // 用途の親アイテム(@item.self の解決に使う)
        usageEffects,               // 付与効果ペイロード(null=効果なし)
        allowRecheck:    usage.allowRecheck === true, // 再判定可能(用途の設定・2026-07-11)
        allowSuitChange: usage.allowSuitChange === true, // スート変更可能(用途の設定・2026-07-12)
    };
}
