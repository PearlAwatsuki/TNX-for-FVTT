/**
 * @fileoverview 判定起動の共通前段(2026-07-16 一本化)。用途から通常判定(TnxCheckFlow.open)へ
 * 渡すコンテキストの組み立てを、ここ一箇所に集約する。
 *
 * 従来はアクターシートの技能クリック(activateItemCheck)・攻撃(useAttack)・NPC取得
 * (useCheckAcquire)・回復(useRecovery)がそれぞれ同じ前処理(不備検知→参加技能解決→報酬点→
 * 消費→適用効果→目標値→判定ボーナス)をコピーして持っており、後から足した仕様(報酬点ブロック・
 * 適用効果・目標値欄・再判定可能)が専用フロー側に反映されない取りこぼしが繰り返されていた
 * (2026-07-16 ユーザー指摘の監査で確定)。専用フローは固有の前処理(武器・対象・回復対象の解決)と
 * 固有ペイロード(attack/npcAcquire/recovery)だけを持ち、共通部は本モジュールを通す。
 */

import { getComboSuits, comboUsesBounty } from "../rules/tnx-check-engine.mjs";
import { resolveConsumeRowsForActor, promptConsumption } from "./usage-consumption.mjs";
import { prepareUsageEffectPayload } from "./usage-effects.mjs";
import { applyInterruptGrantForUsage } from "./interrupt-grant.mjs";
import { resolveUsageTargetValue } from "../rules/usage-target-value.mjs";
import { executionFormOf, effectiveBaseSkillId, usageDisplayName } from "../rules/usage-types.mjs";
import { formatSkillName } from "../core/identification.mjs";
import { effectiveUsageTiming } from "../data/item/modification-params.mjs";
import { resolveUsageTargetRefs } from "./target-resolution.mjs";

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
 * 判定要求(checkRequest)への応答として起動できる用途か(KI-025・2026-07-19)。
 * **「判定」タイプの用途に限定**(2026-07-19 ユーザー裁定。当初の Code 設計「通常判定へ流れない
 * フローだけ除外」を置き換え——リアクション・移動等の行動種別タイプは各自のフローから起動する
 * ものであり、判定要求への応答は素の判定用途)。判定タイプ内でも通常判定へ流れないもの
 * (固定値判定・NPC取得・クリック待ち系のバフ宣言フラグ)は要求カードに結果を返せないため除外。
 * 指定技能自身の用途とコンボ候補の両方にこの規則を適用する。
 */
function canAnswerCheckRequest(usage) {
    if (usage?.type !== "check") return false;
    if (Number.isFinite(usage.fixedResult)) return false;
    if (usage.npcAcquire === true) return false;
    if (usage.grantRecheck === true || usage.modifyCheck === true
        || usage.modifyDamage === true || usage.grantSuitChange === true) return false;
    return true;
}

/**
 * 判定要求への応答候補: 指定技能を参加技能(ベース/組み合わせ)に含む「他アイテムの用途」を
 * 列挙する(KI-025・2026-07-17 ユーザー指摘=組み合わせ判定は要求への正当な応答であり、
 * 代用判定(卓裁定つき)へ誤誘導しない)。指定技能そのもの(excludeItemId)は従来どおり
 * アイテム起動＝用途ピッカー側が受け持つため除外する。参加技能の一致は識別キーで判定。
 * 不備のある用途(ベース技能不明・共通スート無し)は起動しても中止されるため除外する。
 * @param {Actor} actor 応答するアクター
 * @param {string} identificationKey 要求された技能の識別キー
 * @param {{excludeItemId?: string}} [opts]
 * @returns {Array<{item: Item, usage: object}>}
 */
export function enumerateRequestComboCandidates(actor, identificationKey, { excludeItemId = "" } = {}) {
    if (!actor || !identificationKey) return [];
    const out = [];
    for (const item of actor.items) {
        if (!item?.system?.actions?.length) continue;
        if (excludeItemId && item.id === excludeItemId) continue;
        for (const usage of item.system.actions) {
            if (!canAnswerCheckRequest(usage)) continue;
            if (detectUsageDefect(item, usage, actor)) continue;
            const { allSkillIds } = resolveUsageSkillSet(item, usage, actor);
            const matches = allSkillIds.some(id =>
                actor.items.get(id)?.system?.identificationKey === identificationKey);
            if (matches) out.push({ item, usage });
        }
    }
    return out;
}

/**
 * 判定要求の「〈技能名〉で判定」で選ばせる用途リスト(KI-025 改・2026-07-19 ユーザー指示:
 * ボタン列挙は量が多いとあふれるため二段階化=第2段のプルダウンの中身)。
 * 指定技能自身の用途+コンボ候補の統合で、**どちらも「判定」タイプ限定**
 * (canAnswerCheckRequest・2026-07-19 ユーザー裁定=技能クリックの実行対象規則より狭い)。
 * ラベルは用途の実効名(usageDisplayName)＝親名は**素の名前**(「判定（知覚）」・実効名規約
 * 2026-07-17 確定。〈〉整形は技能名単体表示の一般則であり実効名内には適用しない=2026-07-19
 * ユーザー指摘で是正)。コンボ候補の名前つき用途は「用途名（親名）」で由来を判別可能にする。
 * 長すぎるラベルは**用途名の側だけ**を「…」省略する(2026-07-19 ユーザー指示: 技能名(親名)は
 * 確実に表示。閉じたセレクトは末尾=親名側から見切れるため、生成時に文字数で丸める)。
 * @param {Item|null} matchedItem 指定技能アイテム
 * @param {Array<{item: Item, usage: object}>} [comboCandidates] enumerateRequestComboCandidates の結果
 * @returns {Array<{item: Item, usage: object, label: string}>}
 */
// 第2段プルダウンのラベル上限(全角ベースの文字数・ダイアログ幅 360px の閉じたセレクトに収まる目安)
const REQUEST_USAGE_LABEL_MAX = 22;
// 省略後も残す用途名の最小文字数(親名が長くても用途の判別が全滅しないように)
const REQUEST_USAGE_NAME_MIN = 4;

/**
 * 「用途名（親名）」を上限に収める(2026-07-19 ユーザー指示: 技能名(親名)は確実に表示し、
 * 長すぎる用途名の側を「…」で省略する)。親名は削らない——親名(＋括弧)だけで上限に迫る場合は
 * 用途名を最小長まで残して超過を許容する。
 */
function fitRequestUsageLabel(name, parentName) {
    const suffix = `（${parentName}）`;
    if ((name + suffix).length <= REQUEST_USAGE_LABEL_MAX) return name + suffix;
    const keep = Math.max(REQUEST_USAGE_NAME_MIN, REQUEST_USAGE_LABEL_MAX - suffix.length - 1);
    return `${name.slice(0, keep)}…${suffix}`;
}

export function buildRequestUsageChoices(matchedItem, comboCandidates = []) {
    // 指定技能自身の用途: 名前つきは名前のみ(技能名はダイアログ題名「〈技能名〉で判定」が担う)。
    // 上限超過は末尾を「…」省略。未命名は「判定（親名）」=タイプ名が短いため親名を削らずそのまま
    const own = matchedItem
        ? (matchedItem.system?.actions ?? []).filter(canAnswerCheckRequest).map(usage => {
            const name = (usage.name ?? "").trim();
            const label = name
                ? (name.length > REQUEST_USAGE_LABEL_MAX
                    ? `${name.slice(0, REQUEST_USAGE_LABEL_MAX - 1)}…` : name)
                : usageDisplayName(usage, matchedItem.name);
            return { item: matchedItem, usage, label };
        })
        : [];
    const combos = (comboCandidates ?? []).map(({ item, usage }) => {
        const name = (usage.name ?? "").trim();
        return { item, usage, label: name ? fitRequestUsageLabel(name, item.name) : usageDisplayName(usage, item.name) };
    });
    return [...own, ...combos];
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

    // 用途の適用効果: 付与ペイロードを用意して結果カードに載せる(2026-07-10)。適用は
    // カードの効果セクション(トレイ)から対象所有者/GM が行う(2026-08-30 再設計)
    const usageEffects = await prepareUsageEffectPayload(actor, item, usage,
        effectTargetOverride !== undefined ? { targetOverride: effectTargetOverride } : {});

    // 割り込み許可(13-5): grantsInterrupt の用途は対象へ割り込み許可を立てる(適用効果と同じ対象)。
    await applyInterruptGrantForUsage(actor, usage,
        effectTargetOverride !== undefined ? { targetOverride: effectTargetOverride } : {});

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
        // メジャーアクション記帳の判定に使う(2026-07-26 一般則)。ドラッグ改造の
        // マイナーアクション化(16-4)は実効タイミングとしてここで解決される
        usageTiming:     effectiveUsageTiming(usage, item.system),
        usageEffects,               // 付与効果ペイロード(null=効果なし)
        allowRecheck:    usage.allowRecheck === true, // 再判定可能(用途の設定・2026-07-11)
        allowSuitChange: usage.allowSuitChange === true, // スート変更可能(用途の設定・2026-07-12)
    };
}
