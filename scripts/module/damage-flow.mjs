/**
 * @fileoverview ダメージ算出フロー(フェーズ12-3/12-4・正本 Damage_Rules.md)。
 *
 * 攻撃カードの「ダメージ算出」から起動し、算出ダイアログ(カード+攻撃力+修正−軽減)で
 * 最終ダメージと参照段を確定→適用(applyDamageToTarget)。適用は対象の型で分岐する:
 * - cast/guest: applyDamageChartResult(フェーズ9 既存)でチャート参照→BS 付与
 * - troop(トループ/エニグマ): heads 減算(チャート不参照)
 * - troop(分身): 1点以上で消滅通知
 * - extra: ダメージ概念なし=適用不可警告
 *
 * damageBoost/damageReduce は同アクター/対象の用途を列挙し、formula を式ヘルパーで評価して
 * 修正に乗せる(@diff/@achievement 可)。消費先設定と連動。パリー受け値・社会の報酬点軽減も軽減へ。
 *
 * 適用(BS 付与=ActiveEffect 作成・heads 減算)は対象の所有者権限が要るため、
 * 所有権のないクライアントからは damageApply ソケットで GM に委譲する(attackUpdate と同型)。
 */

import { applyDamageChartResult } from "./condition-resolution.mjs";
import { aggregateDefence, defenceForType, computeDamage } from "./damage-logic.mjs";
import { evaluateFormula, buildCheckFormulaData } from "./tnx-formula.mjs";
import { resolveConsumeRowsForActor, applyConsumptionPlan } from "./usage-consumption.mjs";
import { getDamageChartKind } from "../data/damage-chart.mjs";
import { CONDITION_KINDS } from "./conditions.mjs";
import { applyAttackPatch } from "./attack-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";

const SCOPE = "tokyo-nova-axleration";
const CATEGORY_LABELS = { physical: "肉体", mental: "精神", social: "社会" };

/**
 * 攻撃カードからダメージ算出ダイアログを開く(命中確定後)。
 * @param {ChatMessage} message 攻撃カードのメッセージ
 */
export async function openDamageDialog(message) {
    const f = message.getFlag(SCOPE, "attackCheck");
    if (!f) return;
    if (f.damageApplied) { ui.notifications.info("この攻撃のダメージは適用済みです。"); return; }

    const attacker = await fromUuid(f.attackerUuid).catch(() => null);
    const target = f.targetUuid ? await fromUuid(f.targetUuid).catch(() => null) : null;
    const category = f.category || "physical";

    // 差分値・達成値を式コンテキストに供給(@diff/@achievement)
    const formulaData = buildCheckFormulaData({ diff: f.diff, achievement: f.achievement });

    // 軽減の自動取得: 物理のみ防御力(対象のダメージ種別対応)+パリー受け値。精神・社会は防御力なし
    let autoMitigation = 0;
    const mitigationParts = [];
    if (category === "physical" && target) {
        const def = aggregateDefence(target.items.contents ?? []);
        const dv = defenceForType(def, f.damageType);
        if (dv) { autoMitigation += dv; mitigationParts.push(`防御力(${f.damageType || "?"}) ${dv}`); }
    }
    if (f.parryGuard) { autoMitigation += f.parryGuard; mitigationParts.push(`パリー受け値 ${f.parryGuard}`); }

    // 攻撃側=damageBoost・対象側=damageReduce の用途を候補列挙(選択制)
    const boostRows = collectDamageUsages(attacker, "damageBoost");
    const reduceRows = collectDamageUsages(target, "damageReduce");

    // formula は事前評価して確定値を出す(@diff/@achievement は判定結果で固定)。
    // 評価不能な自由文は数値効果なし=表示のみ(手動修正欄で反映)
    for (const r of boostRows) {
        const v = await evaluateFormula(r.formula, formulaData);
        r.value = Number.isFinite(v) ? v : null;
        r.effectDisplay = usageEffectDisplay(r, "＋");
    }
    for (const r of reduceRows) {
        const v = await evaluateFormula(r.formula, formulaData);
        r.value = Number.isFinite(v) ? v : null;
        r.effectDisplay = usageEffectDisplay(r, "−");
    }

    const attackPower = category === "physical" ? (Number(f.weaponAttack) || 0) : 0;
    const damageCard = Number(f.damageCard) || 0;
    const faValue = category === "physical" ? (Number(f.faValue) || 0) : 0;

    // ライブプレビュー: 入力から最終値・参照段・適用先の見込みを再計算して表示する
    const updatePreview = (root) => {
        const v = readDamageForm(root);
        let modifier = faValue + v.manualMod;
        for (const id of v.boostIds) {
            const r = boostRows.find(b => b.id === id);
            if (r && r.value !== null) modifier += r.value;
        }
        let mitigation = v.mitigation + (category === "social" ? v.bountyMitigation : 0);
        for (const id of v.reduceIds) {
            const r = reduceRows.find(b => b.id === id);
            if (r && r.value !== null) mitigation += r.value;
        }
        const { final, stage } = computeDamage({ damageCard, attackPower, modifier, mitigation, stun: v.stun });
        const fin = root.querySelector(".tnx-damage-preview-final");
        const note = root.querySelector(".tnx-damage-preview-note");
        if (fin) fin.textContent = String(final);
        if (note) note.textContent = describeDamagePreview(target, category, final, stage);
    };

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/dialog/damage-dialog.hbs",
        {
            categoryLabel: CATEGORY_LABELS[category] ?? category,
            isPhysical: category === "physical",
            isSocial: category === "social",
            damageCard, attackPower,
            attackSourceName: f.attackSourceName,
            faValue: Number(f.faValue) || 0,
            autoMitigation, mitigationParts,
            boostRows, reduceRows,
            targetName: f.targetName,
        }
    );

    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `ダメージ算出: ${CATEGORY_LABELS[category] ?? category}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-dialog"],
        position: { width: 460 },
        content,
        buttons: [
            { action: "apply", icon: "fas fa-burst", label: "ダメージ適用", default: true,
              callback: (_e, _b, dialog) => readDamageForm(dialog.element) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        render: (_event, dialog) => {
            const root = dialog.element;
            root.addEventListener("input", () => updatePreview(root));
            root.addEventListener("change", () => updatePreview(root));
            updatePreview(root);
        },
        close: () => null,
    });
    if (!result) return;

    // 修正の合成: FA + 手動 + boost(加算) − reduce(減算)。事前評価済みの確定値を使い、
    // 結果カード用に適用した各行の内訳(appliedBoosts/appliedReduces)を残す
    let modifier = faValue + result.manualMod;
    let reduceSum = 0;
    const appliedBoosts = [];
    const appliedReduces = [];
    const consumePlans = [];
    for (const id of result.boostIds) {
        const r = boostRows.find(b => b.id === id); if (!r) continue;
        if (r.value !== null) modifier += r.value;
        appliedBoosts.push({ label: r.label, display: r.value !== null ? signedDisplay("＋", r.value) : `（${r.formula}）` });
        if (attacker) consumePlans.push([attacker, r]);
    }
    for (const id of result.reduceIds) {
        const r = reduceRows.find(b => b.id === id); if (!r) continue;
        if (r.value !== null) reduceSum += r.value;
        appliedReduces.push({ label: r.label, display: r.value !== null ? signedDisplay("−", r.value) : `（${r.formula}）` });
        if (target) consumePlans.push([target, r]);
    }
    const bounty = category === "social" ? result.bountyMitigation : 0;
    const mitigationTotal = result.mitigation + reduceSum + bounty;

    const { raw, final, stage } = computeDamage({ damageCard, attackPower, modifier, mitigation: mitigationTotal, stun: result.stun });

    // 結果カードの内訳(算出の根拠を全行表示する。委譲時もそのまま GM へ渡す)
    const breakdown = {
        categoryLabel: CATEGORY_LABELS[category] ?? category,
        isPhysical: category === "physical",
        targetName: f.targetName ?? target?.name ?? "",
        damageCard, attackPower,
        attackSourceName: f.attackSourceName,
        faValue,
        manualModDisplay: result.manualMod ? signedDisplay("＋", result.manualMod) : "",
        boosts: appliedBoosts,
        reduces: appliedReduces,
        mitigation: result.mitigation,
        mitigationNote: result.mitigation === autoMitigation ? mitigationParts.join("・") : "手動入力",
        bountyMitigation: bounty,
        stunCapped: result.stun && Math.max(0, raw - mitigationTotal) > 10,
        final, stage,
        // 参照段はチャートを参照する型(cast/guest・対象未指定)でのみ意味を持つ
        showStage: final > 0 && (!target || target.type === "cast" || target.type === "guest"),
    };

    // 対象の所有権がなければ適用を GM に委譲する(GM 不在なら消費前に中断)
    const needsDelegate = !!target && !target.isOwner;
    if (needsDelegate && !game.users.activeGM) {
        ui.notifications.warn("対象の所有権がなく、GM も接続していないためダメージを適用できません。");
        return;
    }

    // 消費先設定を適用(選択された damageBoost/damageReduce の用途)。
    // 所有権のないアクター分(対象側の damageReduce)は GM 委譲ペイロードへ回す
    const remotePlans = [];
    for (const [actor, r] of consumePlans) {
        const rows = resolveConsumeRowsForActor(actor, actor.items.get(r.itemId), r.usage.consumeTargets);
        const plan = planFromRows(rows, actor.id);
        if (actor.isOwner) await applyConsumptionPlan(plan);
        else remotePlans.push(...plan);
    }

    if (needsDelegate) {
        TnxSocketHandler.emitDamageApply({
            messageId: message.id,
            targetUuid: target.uuid,
            attackerUuid: f.attackerUuid ?? null,
            category, final, stage,
            breakdown,
            consumePlan: remotePlans,
        });
        ui.notifications.info(`「${target.name}」へのダメージ適用は GM が代行します。`);
        return;
    }

    // 対象へ適用(型分岐)
    let applyText = "";
    if (target) {
        applyText = await applyDamageToTarget(target, category, final, stage);
    } else {
        applyText = "対象未選択のため適用は手動";
    }

    // 攻撃カードを適用済みに(ライブ更新)+結果をチャットに残す
    await applyAttackPatch(message, { damageApplied: true });
    await postDamageChat(attacker, breakdown, applyText);
}

/**
 * damageApply ソケットで委譲された適用を GM クライアントで代行する。
 * 対象側の消費→適用→攻撃カードの適用済み化→結果チャットまでを一括で行う。
 */
export async function applyDamageDelegated({ messageId, targetUuid, attackerUuid, category, final, stage, breakdown, consumePlan }) {
    const message = game.messages.get(messageId);
    if (message?.getFlag(SCOPE, "attackCheck")?.damageApplied) return;

    const target = await fromUuid(targetUuid).catch(() => null);
    if (!target) return;
    if (Array.isArray(consumePlan) && consumePlan.length) await applyConsumptionPlan(consumePlan);
    const applyText = await applyDamageToTarget(target, category, final, stage);

    if (message) await applyAttackPatch(message, { damageApplied: true });
    const attacker = attackerUuid ? await fromUuid(attackerUuid).catch(() => null) : null;
    await postDamageChat(attacker, breakdown ?? { categoryLabel: CATEGORY_LABELS[category] ?? category, damageCard: "?", final, stage }, applyText);
}

/** ダメージ適用の結果カードを投稿する(算出の全内訳つき・damage-result.hbs)。 */
async function postDamageChat(attacker, breakdown, applyText) {
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/damage-result.hbs",
        { ...breakdown, applyText, applied: (breakdown.final ?? 0) > 0 }
    );
    await ChatMessage.create({
        speaker: attacker ? ChatMessage.getSpeaker({ actor: attacker }) : undefined,
        content,
    });
}

/** 符号つきの数値表示(負値は符号を反転して絶対値で示す)。 */
function signedDisplay(sign, n) {
    const flip = sign === "＋" ? "−" : "＋";
    return n < 0 ? `${flip}${Math.abs(n)}` : `${sign}${n}`;
}

/** 用途行の効果表示(評価値があれば確定値・式が生数値でなければ式も併記)。 */
function usageEffectDisplay(row, sign) {
    if (row.value === null) return row.formula ? `${row.formula}（自動計算不可・手動修正で反映）` : "";
    const plain = String(row.value) === String(row.formula).trim();
    return `${signedDisplay(sign, row.value)}${plain ? "" : `（${row.formula}）`}`;
}

/** 適用先の型に応じたプレビュー文(参照段・負傷名／heads 減算／消滅／適用不可)。 */
function describeDamagePreview(target, category, final, stage) {
    if (!target) return final > 0 ? `参照段 ${stage}` : "";
    if (target.type === "extra") return "エキストラ: 適用不可（宣言死）";
    if (target.type === "troop") {
        if (target.system.troopMode === "bunshin") return final > 0 ? "分身: 消滅" : "分身: 消滅せず";
        const label = target.system.troopMode === "enigma" ? "エニグマポイント" : "人数";
        return `${label} −${final}`;
    }
    if (final <= 0) return "負傷なし";
    const kind = getDamageChartKind(category, stage);
    const wound = kind ? CONDITION_KINDS[kind]?.label : "";
    return `参照段 ${stage}${wound ? `「${wound}」` : ""}`;
}

/** ダメージ算出ダイアログの入力を読む。 */
function readDamageForm(el) {
    const num = (name) => Number(el.querySelector(`[name="${name}"]`)?.value) || 0;
    const checkedIds = (cls) => [...el.querySelectorAll(`input.${cls}:checked`)].map(c => c.value);
    return {
        manualMod:       num("manualMod"),
        mitigation:      num("mitigation"),
        bountyMitigation: num("bountyMitigation"),
        stun:            !!el.querySelector('[name="stun"]')?.checked,
        boostIds:        checkedIds("dmg-boost"),
        reduceIds:       checkedIds("dmg-reduce"),
    };
}

/** アクターの damageBoost/damageReduce 用途を候補として集める。 */
function collectDamageUsages(actor, type) {
    if (!actor) return [];
    const rows = [];
    for (const item of actor.items) {
        for (const usage of (item.system.actions ?? [])) {
            if (usage.type !== type) continue;
            rows.push({
                id: `${item.id}.${usage._id}`,
                itemId: item.id,
                usage,
                label: `${item.name}${usage.name && usage.name !== item.name ? ` / ${usage.name}` : ""}`,
                formula: usage.formula || "",
            });
        }
    }
    return rows;
}

/** resolveConsumeRows の行から適用プランを組む(全チェック消費・残量不足は消費しない)。 */
function planFromRows(rows, fallbackActorId) {
    const plan = [];
    for (const row of rows) {
        if (row.inert || row.problem || !row.kind) continue;
        if ((row.remaining ?? 0) < row.amount) continue;
        plan.push({ actorId: row.targetActorId ?? fallbackActorId, itemId: row.itemId, kind: row.kind, amount: row.amount });
    }
    return plan;
}

/**
 * 対象へダメージを適用する(型分岐・12-4)。適用内容の説明文を返す。
 * @returns {Promise<string>}
 */
export async function applyDamageToTarget(target, category, final, stage) {
    if (target.type === "extra") {
        ui.notifications.warn(`「${target.name}」はエキストラのためダメージの概念がありません（宣言で死亡）。`);
        return "エキストラ: ダメージ適用なし（宣言死）";
    }
    if (target.type === "troop") {
        const mode = target.system.troopMode;
        if (mode === "bunshin") {
            if (final > 0) {
                ui.notifications.info(`分身「${target.name}」は被ダメージで消滅します（トークンを削除してください）。`);
                return "分身: 1点以上の被ダメージで消滅";
            }
            return "分身: ダメージ 0（消滅せず）";
        }
        // トループ/エニグマ: heads(人数/エニグマポイント)がダメージ分減少(チャート不参照)
        const cur = target.system.heads?.value ?? 0;
        const next = Math.max(0, cur - final);
        await target.update({ "system.heads.value": next }).catch(() =>
            ui.notifications.warn(`「${target.name}」の${mode === "enigma" ? "エニグマポイント" : "人数"}を減算できませんでした（権限を確認してください）。`));
        const label = mode === "enigma" ? "エニグマポイント" : "人数";
        return `${label} ${cur} → ${next}（−${cur - next}）`;
    }
    // cast/guest: チャート参照→負傷状態付与(フェーズ9 既存機構。BS カスケード等が連動)
    if (final <= 0) return "ダメージ 0（負傷なし）";
    await applyDamageChartResult(target, category, final);
    const kind = getDamageChartKind(category, stage);
    const woundLabel = kind ? CONDITION_KINDS[kind]?.label : "";
    return `${CATEGORY_LABELS[category] ?? category}チャート 段${stage}${woundLabel ? `「${woundLabel}」` : ""}を適用`;
}
