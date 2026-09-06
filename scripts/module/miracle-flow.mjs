/**
 * @fileoverview 神業の使用フロー(フェーズ17-1・Foundry 依存側)。純ロジックは miracle-logic.mjs。
 *
 * 神業はゴールデンルール「RL の絶対権限」のひとつ下に位置する強制力の強いルール(Miracle_Rules
 * 「神業の位置づけ」)。挙動は既存の用途の器で表現し、用途は前提条件にしない——**用途が0件でも
 * 機能する**(ロール→残回数ゲート→使用回数の消費→神業カード)。固有の挙動(打ち消し・防御・
 * ダメージ等)は用途のフラグで乗る(17-2 以降)。
 *
 * 神業由来の印(miracleOriginOf)は神業カードのフラグ `miracle` に刻む。読み手は isMiracleOrigin。
 * 起動は唯一の起動関数 `_activateItemCheck` からのみ(旧 _onUseMiracle は撤去)。
 */

import {
    miracleUseGate, miracleConsumeUpdate, buildMiracleCardData, miracleOriginOf,
    negateCheckGate, negatedCheckMods, evadePlan, miracleIdentityMatches,
    buildMiracleDamageFlag, terminalKindFor,
    interferenceCandidates, addUseEffectSource, miracleLogCandidates, conditionSwapPlan,
} from "./miracle-logic.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { applyConsumptionPlan, resolveConsumeRowsForActor, promptConsumption } from "./usage-consumption.mjs";
import { resolveUsageTargetRefs, currentTargetActors } from "./target-resolution.mjs";
import { TargetSelectionDialog, AmountInputDialog } from "./tnx-dialog.mjs";
import { conditionDisplayName } from "./conditions.mjs";
import { keepTogether, nowrap } from "./chat-text.mjs";
import { cardField, cardResult } from "./chat-card.mjs";
import { getDamageChartKind } from "../data/damage-chart.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { isOutfitDestroyed } from "../data/item/helpers.mjs";
import { buildGrantedEffectDataFrom } from "./usage-effects.mjs";
import { getSessionState } from "./session-state.mjs";
import { listAppearingActors } from "./appearance-state.mjs";
import { applyInterruptGrantForUsage } from "./interrupt-grant.mjs";

const SCOPE = "tokyo-nova-axleration";
const CATEGORY_LABELS = { physical: "肉体", mental: "精神", social: "社会" };

// ─── 即死・社会戦(17-3)＝神業版のダメージカード ─────────────────────────────────
// 効果文《死の舞踏》「［完全死亡］させる…代わりに任意の肉体戦ダメージを与えても良い」《神の御言葉》「［精神崩壊］
// …任意の精神戦ダメージ」《制裁》「任意の社会戦ダメージ…好きなものを選ぶ…抹殺でもよい」《暴露》「RL が任意に
// 決定する。判断に迷った場合は山札から2枚めくってカードの数字を合計し、社会戦ダメージチャートを参照」。
// 結果を選んで神業版のダメージカード(damage-flow.renderMiracleDamageCard)を出す。軽減は一切通さない。

/** チャートの値(1〜21)の選択肢(値: 負傷名)。 */
function chartValueOptions(category) {
    const out = [];
    for (let v = 1; v <= 21; v++) {
        const kind = getDamageChartKind(category, v);
        out.push({ value: `chart:${v}`, label: `${v}: ${conditionDisplayName(kind)}` });
    }
    return out;
}

/**
 * 結果の選択(使用時)。即死=終端状態か任意ダメージ(チャートの値)／社会戦=決め方の設定で分岐
 * (choose=使用者がチャートの行か抹殺を選ぶ／rl=RL が値を入力するか山札から2枚めくる)。
 * @returns {Promise<?{kind: "terminal"|"chart", value?: number, drawn?: string[]}>} キャンセルは null
 */
async function promptMiracleDamageResult(item, usage, category, targets = []) {
    // 終端の選択肢の呼び名は対象で変わる: トループは壊滅(頭数を 0 にする)、キャスト/ゲストは終端状態
    const kinds = await Promise.all((targets ?? []).map(async (t) => {
        const doc = await fromUuid(t.uuid).catch(() => null);
        return (doc?.actor ?? doc)?.type ?? null;
    }));
    const hasTroop = kinds.includes("troop");
    const hasOther = kinds.some(k => k && k !== "troop");
    const terminalLabel = hasTroop && !hasOther ? "壊滅"
        : hasTroop ? `${conditionDisplayName(terminalKindFor(category))}／壊滅`
        : conditionDisplayName(terminalKindFor(category));
    if (usage.type === "miracleSocial" && (usage.socialDecide || "choose") === "rl") {
        const how = await TargetSelectionDialog.prompt({
            title: `${item.name}: 社会戦ダメージ`, label: "社会戦ダメージの決め方（RL）",
            options: [{ value: "input", label: "値を入力する" }, { value: "draw", label: "山札から2枚めくって合計する" }],
        });
        if (!how) return null;
        if (how === "draw") {
            const { drawDamageValueFromDeck } = await import("./damage-flow.mjs");
            const { total, drawn } = await drawDamageValueFromDeck(2);
            return { kind: "chart", value: total, drawn };
        }
        const input = await AmountInputDialog.prompt({
            title: `${item.name}: 社会戦ダメージ`, label: "社会戦ダメージの値（チャート参照）",
            initialValue: 10, min: 1, max: 21, okLabel: "決定",
        });
        if (!input || !Number.isFinite(input.value)) return null;
        return { kind: "chart", value: input.value };
    }
    const options = [{ value: "terminal", label: terminalLabel }, ...chartValueOptions(category)];
    const picked = await TargetSelectionDialog.prompt({
        title: `${item.name}: 結果の選択`, label: `${CATEGORY_LABELS[category]}ダメージの結果`, options,
    });
    if (!picked) return null;
    if (picked === "terminal") return { kind: "terminal" };
    return { kind: "chart", value: Number(picked.replace("chart:", "")) || 0 };
}

/**
 * 即死・社会戦タイプの使用(17-3): 対象解決→消費→結果の選択→神業版のダメージカード。
 * @param {Actor} actor
 * @param {Item} item 神業
 * @param {object} usage 即死/社会戦タイプの用途(既定消費は起動関数で補われている)
 */
export async function useMiracleDamage(actor, item, usage, { asOther = null } = {}) {
    const category = usage.type === "miracleSocial" ? "social" : (usage.killCategory || "physical");
    const refs = await resolveUsageTargetRefs(actor, usage);
    if (refs === null) return false;
    if (!refs.length) { ui.notifications.warn("対象をターゲットしてから使用してください。"); return false; }
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (plan === null) return false;
    const result = await promptMiracleDamageResult(item, usage, category, refs);
    if (!result) return false;
    await applyConsumptionPlan(plan);
    const flag = buildMiracleDamageFlag({
        by: { ...miracleOriginOf(item, asOther), actorId: actor.id }, category, targets: refs, result,
    });
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs", { categoryLabel: CATEGORY_LABELS[category] });
    await ChatMessage.create({
        user: game.user.id, speaker: ChatMessage.getSpeaker({ actor }), content,
        flags: { "core.canPopout": true, [SCOPE]: { damageRoll: flag } },
    });
    return true;
}

/** 神業版のダメージカードの見出しクリック(打ち消し待ち中): 全対象を防いだ扱いにして消す。 */
export async function handleNegateMiracleDamageClick(message) {
    const ns = negateState();
    if (!ns) return;
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f?.miracle) return;
    if (f.negatedBy) { ui.notifications.warn("この神業は既に打ち消されています。"); return; }
    if (f.applied) { ui.notifications.warn("適用済みの神業は打ち消せません（時間をさかのぼって打ち消すことはできません）。"); return; }
    if (!await negateLimitOk(ns.state, f.miracle)) return;
    // 打ち消しそのものを後で打ち消せるよう、当時の値を控える
    await commitNegate(ns.state, [{ messageId: message.id, patch: {
        [`flags.${SCOPE}.damageRoll.targets`]:   foundry.utils.deepClone(f.targets ?? []),
        [`flags.${SCOPE}.damageRoll.negatedBy`]: f.negatedBy ?? null,
    } }]);
    const { applyDamagePatch } = await import("./damage-flow.mjs");
    const targets = (f.targets ?? []).map(t => ({ ...t, protectedBy: ns.by }));
    await applyDamagePatch(message, { targets, negatedBy: ns.by });
}

// ─── 破壊(17-3・《天変地異》《突破》) ────────────────────────────────────────────
// 効果文「アウトフィットをひとつ［破壊］」。アウトフィットの破壊のみ(トループ壊滅は即死に含める=
// ユーザー裁定 2026-09-04)。使用→対象解決→未破壊のアウトフィットから1つ選ぶ→神業カードに結果行と
// 適用ボタン(対象の操作者/RL)→isDestroyed を立てる。キャスト・ゲストへの直接ダメージは無い。

/**
 * 破壊タイプの使用(17-3)。
 * @param {Actor} actor
 * @param {Item} item 神業
 * @param {object} usage 破壊タイプの用途
 */
export async function useMiracleDestroy(actor, item, usage, { asOther = null } = {}) {
    const target = await resolveSingleTarget(actor, usage);
    if (!target) return false;
    const candidates = (target.items?.contents ?? []).filter(i => OUTFIT_ITEM_TYPES.has(i.type) && !isOutfitDestroyed(i.system));
    if (!candidates.length) { ui.notifications.warn(`「${target.name}」に破壊できるアウトフィットがありません。`); return false; }
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (plan === null) return false;
    const picked = await TargetSelectionDialog.prompt({
        title: `${item.name}: 破壊するアウトフィット`, label: `「${target.name}」のアウトフィット`,
        options: candidates.map(i => ({ value: i.id, label: i.name })), selectLabel: "破壊",
    });
    if (!picked) return false;
    const outfit = target.items.get(picked);
    if (!outfit) return false;
    await applyConsumptionPlan(plan);
    await postMiracleCard(item, { destroy: { targetUuid: target.uuid, targetName: target.name, itemId: outfit.id, itemName: outfit.name }, asOther });
    return true;
}

/**
 * 対象1人を解決する(対象の操作者が後で適用/使用する流れの共通前段)。0人は警告、複数は中止
 * (「他のキャラクター」「アウトフィットをひとつ」=1人への効果)。トークン uuid はそのアクターへ。
 * @returns {Promise<?Actor>} 中止なら null
 */
async function resolveSingleTarget(actor, usage) {
    let refs = await resolveUsageTargetRefs(actor, usage);
    if (refs === null) return null;
    // 用途の「対象」欄が空でも、**ターゲットされていればそれを対象にする**——これらの神業は
    // 効果文で対象が決まっている(「他人に」等)ので、欄の設定でターゲットを無視しない(2026-09-06)
    if (!refs.length) refs = currentTargetActors().map(a => ({ uuid: a.uuid, name: a.name }));
    if (!refs.length) { ui.notifications.warn("対象をターゲットしてから使用してください。"); return null; }
    if (refs.length > 1) { ui.notifications.warn("対象は1人にしてください。"); return null; }
    const doc = await fromUuid(refs[0].uuid).catch(() => null);
    const target = doc?.actor ?? doc;
    if (!target) { ui.notifications.warn("対象が見つかりません。"); return null; }
    return target;
}

/** uuid のアクター(トークンならそのアクター)を自分が所有しているか。 */
function isOwnerOfUuid(uuid) {
    let target = null;
    try { const doc = fromUuidSync(uuid); target = doc?.actor ?? doc; } catch { target = null; }
    return target?.isOwner === true;
}

/** カードのボタン(適用/使用)を押せるのは対象の操作者か RL。 */
function isTargetOperator(targetUuid) {
    return game.user.isGM || isOwnerOfUuid(targetUuid);
}

// ─── 宣言の効果(17-6): 《神出鬼没》《タイムリー》《買収》《不可知》 ─────────────────────
// 《神出鬼没》「“宿主”が受けたあらゆるダメージや状況はカゲムシャが引き受けることになるし、その逆も発生する」
// 《タイムリー》「《タイムリー》で得たアウトフィットは［常備化］できない」《買収》「（入手品は）［常備化］できない」
// 《不可知》「完全に姿を消して、即座に好きな行動をひとつとれる。カット進行中の場合、この行動はアクションランクを
// 消費しない。この行動に対しては、神業を使用しない限り、一切のリアクションやアウトフィットの使用などを行うことは
// できない。…《不可知》でダメージを与えた場合、神業によってしか治療を行えない」

/**
 * 《神出鬼没》: 対象は取らない。宿主(キャストの system.host・アクトごとに RL が決定)と自分のダメージ・状態を
 * **宣言した時点で**丸ごと入れ替える。宿主のアクターへの書き込みは RL のクライアントへ委譲する
 * (既存の RL 委譲ソケットと同じ形)。宿主が未設定なら警告して中止。
 * @returns {Promise<boolean>} 発動したか
 */
export async function useMiracleSwap(actor, item, usage, { asOther = null } = {}) {
    const hostUuid = actor.system?.host?.uuid ?? "";
    if (!hostUuid) { ui.notifications.warn(`「${actor.name}」の宿主が決まっていません（RL がキャストシートで設定します）。`); return false; }
    const hostDoc = await fromUuid(hostUuid).catch(() => null);
    const host = hostDoc?.actor ?? hostDoc;
    if (!host) { ui.notifications.warn("宿主のアクターが見つかりません。"); return false; }
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (plan === null) return false;
    await applyConsumptionPlan(plan);
    if (game.user.isGM) await swapConditionsBetween(actor, host);
    else TnxSocketHandler.emitMiracleSwap({ actorUuid: actor.uuid, hostUuid: host.uuid });
    await postMiracleCard(item, { swap: { hostUuid: host.uuid, hostName: host.name }, asOther });
    return true;
}

/** 両者の状態(conditionKind)を丸ごと入れ替える。カスケードの子は移した親から再生する。 */
export async function swapConditionsBetween(A, B) {
    const plan = conditionSwapPlan(A.effects.contents, B.effects.contents);
    const toData = (effects) => effects.map(e => { const d = e.toObject(); delete d._id; return d; });
    const dataToB = toData(plan.moveToB);
    const dataToA = toData(plan.moveToA);
    if (plan.deleteA.length) await A.deleteEmbeddedDocuments("ActiveEffect", plan.deleteA);
    if (plan.deleteB.length) await B.deleteEmbeddedDocuments("ActiveEffect", plan.deleteB);
    if (dataToA.length) await A.createEmbeddedDocuments("ActiveEffect", dataToA);
    if (dataToB.length) await B.createEmbeddedDocuments("ActiveEffect", dataToB);
}

/** 入れ替えの RL 側代行(ソケット): 宣言者のクライアントが宿主を書けないときに呼ばれる。 */
export async function applyMiracleSwapDelegated({ actorUuid, hostUuid } = {}) {
    const resolve = async (uuid) => { const d = await fromUuid(uuid).catch(() => null); return d?.actor ?? d; };
    const A = await resolve(actorUuid);
    const B = await resolve(hostUuid);
    if (!A || !B) return;
    await swapConditionsBetween(A, B);
}

/**
 * 《タイムリー》《買収》: 辞典ブラウザで選んだアウトフィット(uuid)の複製を付与する(購入判定の入手と同じ器・
 * 購入値や外界の条件は問わない)。複製に神業由来の印(fromMiracle)を刻む=常備化できない。
 * @returns {Promise<boolean>} 発動したか
 */
export async function useMiracleAcquire(actor, item, usage, { uuid, asOther = null } = {}) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) { ui.notifications.warn("入手するアウトフィットを解決できませんでした。"); return false; }
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (plan === null) return false;
    await applyConsumptionPlan(plan);
    const { grantPurchasedItem } = await import("./purchase-flow.mjs");
    const created = await grantPurchasedItem(actor, uuid);
    if (!created) return false;
    await created.update({ [`flags.${SCOPE}.fromMiracle`]: true });
    await postMiracleCard(item, { acquire: { itemId: created.id, itemName: created.name }, asOther });
    return true;
}

/**
 * 《不可知》: 消費→自分に「次の行動」の印(flags.insensible=神業由来の印)と、**完全な割り込み**の許可。
 * 印は次の判定の実行で消費され、攻撃カードのリアクション不可・ダメージの状態への神業由来の印に効く。
 * 割り込みは既存の挿入メイン(サスペンド／レジューム)を consumesAr=偽で自分に許可する=誰かのメイン
 * プロセスの途中(命中判定の直後・リアクション解決の直前など)にも差し込め、AR を消費しない
 * (ゆえに CSカレント 0 の記帳も無い=一般則 AR−1⟺CS0。追加行動の割り込みと同じ扱い・
 * ユーザー言語化 2026-09-04「完全な割り込みです」「CSカレントが0になるのはARが消費されるからです」)。
 * @returns {Promise<boolean>} 発動したか
 */
export async function useMiracleInsensible(actor, item, usage, { asOther = null } = {}) {
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (plan === null) return false;
    await applyConsumptionPlan(plan);
    await actor.setFlag(SCOPE, "insensible", { ...miracleOriginOf(item, asOther), actorId: actor.id });
    await applyInterruptGrantForUsage(actor, { grantsInterrupt: true, interruptConsumesAr: false },
        { targetOverride: [{ uuid: actor.uuid }] });
    await postMiracleCard(item, { insensible: true, asOther });
    return true;
}

// ─── 他の神業への干渉(17-4・《ファイト！》《プリーズ！》) ─────────────────────────────
// 効果文《ファイト！》「他のキャラクターの持つ神業の使用回数を、1回増やす。…すでに使用されているものでも…
// アクトが終了した後に持ち越すことはできない」「《ファイト！》を《ファイト！》することはできない」／
// 《プリーズ！》「他人(キャストでもゲストでもよい)に、神業を使わせることができる。…相手の神業は使用済みに
// ならない」(一覧: 使用済みも可)。「お願いの内容は神業の使用に限らなくても良い」は口頭裁定の領域で、
// この器は RL が迷ったときの限定形「神業の使用」そのもの。

/**
 * 干渉の使用: 対象1人→(使用回数+1: 対象の神業を1つ選ぶ)→消費→神業カードに結果の段。
 * 適用(+1 の効果を載せる)と使用(神業を使う)は対象の操作者/RL がカードのボタンで行う。
 * @returns {Promise<boolean>} 発動したか
 */
export async function useMiracleInterference(actor, item, usage, { asOther = null } = {}) {
    const mode = usage.miracleEffect;
    const target = await resolveSingleTarget(actor, usage);
    if (!target) return false;
    const candidates = interferenceCandidates(target.items?.contents ?? [], { mode, byName: item.name });
    if (!candidates.length) { ui.notifications.warn(`「${target.name}」に対象にできる神業がありません。`); return false; }
    let picked = null;
    if (mode === "addUse") {
        if (candidates.length === 1) picked = candidates[0];
        else {
            const id = await TargetSelectionDialog.prompt({
                title: `${item.name}: 使用回数を増やす神業`, label: `「${target.name}」の神業`,
                options: candidates.map(c => ({ value: c.id, label: c.name })), selectLabel: "決定",
            });
            picked = candidates.find(c => c.id === id) ?? null;
            if (!picked) return false;
        }
    }
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (plan === null) return false;
    await applyConsumptionPlan(plan);
    const base = { targetUuid: target.uuid, targetName: target.name };
    if (mode === "addUse") {
        await postMiracleCard(item, { addUse: { ...base, miracleId: picked.id, miracleName: picked.name,
            sourceUuid: item.uuid, img: item.img ?? "", applied: false }, asOther });
    } else {
        await postMiracleCard(item, { request: { ...base, miracles: candidates, used: null }, asOther });
    }
    return true;
}

// ─── 効果の参照(17-5・《万能道具》《神意》)と見聞きした神業のコピー(《突然変異》) ─────────
// 効果文《万能道具》「取得している〈フォルム〉によって、異なるスタイルの神業と同等の効果が発生する」＋対応表／
// 《突然変異》「そのアクト中に使用された神業をコピーして使用する…あなたが登場したシーンで使用されたものに
// 限られる…効果が適用される前であっても、コピーすることは可能」。選び方はアイテム側の設定(asOther)、
// 実行は唯一の起動関数への再入(参照先の用途を元の神業の名前・回数・印で実行)。

/** 候補から1つ選ぶ(1つなら自動)。 */
async function pickMiracleRef(item, candidates, label) {
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    const picked = await TargetSelectionDialog.prompt({
        title: `${item.name}: ${label}`, label: "神業",
        options: candidates.map(c => ({ value: c.uuid, label: c.name })), selectLabel: "決定",
    });
    return candidates.find(c => c.uuid === picked) ?? null;
}

/** uuid を参照先(神業)に解決する。 */
async function collectMiracleRefs(item, uuids) {
    const out = [];
    for (const uuid of uuids) {
        const doc = await fromUuid(uuid).catch(() => null);
        if (doc?.type === "miracle") out.push({ uuid, name: doc.name, source: doc });
        else ui.notifications.warn(`「${item.name}」の参照先の神業が見つかりません。`);
    }
    return out;
}

/**
 * 効果の参照(アイテム側の設定)を**実体として写す**。選んだ神業の用途一式と経験点の取得条件を
 * この神業へコピーする(2026-09-06 ユーザー承認の方針A)。
 *
 * 実行時に別アイテムを解決する形(間接参照)をやめた理由: 万能道具は万能道具であって
 * 「他の神業として使う」ものではなく、アイテムとしての同一性(名前・ふりがな・効果文・識別キー・
 * 使用回数)は自分のものを保つべきだから。写すのは**振る舞い(用途)と経験点の取得条件**だけで、
 * 用途タブを開けば実際に動くものがそこに見える。
 * 参照先を後から直しても写し済みのキャラクターには追随しない(スタイル・技能の写しと同じ)。
 * @param {Item} miracle 効果の参照を持つ神業(アクター所有)
 * @returns {Promise<boolean>} 写したか
 */
export async function applyAsOtherEffectCopy(miracle) {
    const cfg = miracle?.system?.asOther;
    if (cfg?.mode !== "choice" || !cfg.selected) return false;
    const patch = await asOtherCopyUpdate(miracle, cfg.selected);
    if (!patch) return false;
    await miracle.update(patch);
    return true;
}

/**
 * 参照先から写す内容(用途一式と経験点の取得条件)を組む。**選択と同じ update にまとめる**ため、
 * 更新そのものは呼び出し側が行う——文書の作成フックの中で更新を2回に分けると、後の更新が
 * 作成中の値に負けて落ちることがある(2026-09-06 実機で確認)。
 * @param {Item} miracle 写し先の神業(名前の警告に使う)
 * @param {string} uuid 参照先の神業の uuid
 * @returns {Promise<?object>} update に渡す差分。参照先が見つからなければ null
 */
export async function asOtherCopyUpdate(miracle, uuid) {
    const source = await fromUuid(uuid).catch(() => null);
    if (source?.type !== "miracle") {
        ui.notifications.warn(`「${miracle?.name ?? "神業"}」の参照先の神業が見つかりません。`);
        return null;
    }
    ui.notifications.info(`神業「${miracle?.name ?? ""}」の効果を《${source.name}》と同じにしました。`);
    return {
        "system.actions":        foundry.utils.duplicate(source.system.actions ?? []),
        "system.usageCondition": source.system.usageCondition ?? "",
    };
}

/**
 * このアクトで見聞きした神業のコピー(《突然変異》・宣言の効果)。自分が登場したシーンに使われた
 * ものが候補(1つなら自動・0なら警告して中止)。**コピーであって「その神業として使う」ではない**
 * (2026-09-06 ユーザー訂正)ため、アイテム側の設定ではなく宣言の効果として置く。
 * @returns {Promise<?{uuid: string, name: string, source: Item}>} 中止なら null
 */
export async function resolveMiracleCopyFromLog(actor, item) {
    const st = getSessionState();
    const list = miracleLogCandidates(st.miracleUseLog ?? [], {
        actorId: actor.id, sceneNumber: st.sceneNumber, appearedNow: listAppearingActors().map(a => a.id),
    });
    const candidates = await collectMiracleRefs(item, list.map(c => c.uuid));
    if (!candidates.length) {
        ui.notifications.warn(`このアクトで「${actor.name}」が登場したシーンに使われた神業がありません。`);
        return null;
    }
    return pickMiracleRef(item, candidates, "コピーする神業");
}

/**
 * 使用回数+1 の適用(神業カードのボタン・対象の操作者/RL): 対象の神業にアクト中の効果を載せる。
 * 付与コピーの印(grantedFrom=使った神業)を刻み、アクト終了の境界で付与コピーとして失効させる。
 */
async function applyMiracleAddUse(message) {
    const mf = message.getFlag(SCOPE, "miracle");
    const a = mf?.addUse;
    if (!a || a.applied) return;
    const targetDoc = await fromUuid(a.targetUuid).catch(() => null);
    const target = targetDoc?.actor ?? targetDoc;
    const miracle = target?.items?.get(a.miracleId);
    if (!miracle) { ui.notifications.warn("使用回数を増やす神業が見つかりません。"); return; }
    if (!(game.user.isGM || target.isOwner)) { ui.notifications.warn("適用は対象の操作者（または RL）が行います。"); return; }
    const data = buildGrantedEffectDataFrom(addUseEffectSource({ name: mf.name, img: a.img }), a.sourceUuid ?? null);
    await miracle.createEmbeddedDocuments("ActiveEffect", [data]);
    await TnxSocketHandler.applyMessagePatch(message, { [`flags.${SCOPE}.miracle.addUse.applied`]: true });
}

/**
 * 神業を使わせる(神業カードのボタン・対象の操作者/RL): 対象の神業を唯一の起動関数で
 * miracleFree 文脈つきで起動する(残回数ゲートも消費も無い)。発動したらカードに使用を記録する。
 */
async function handleMiracleRequestClick(message, miracleId) {
    const mf = message.getFlag(SCOPE, "miracle");
    const r = mf?.request;
    if (!r || r.used) return;
    const targetDoc = await fromUuid(r.targetUuid).catch(() => null);
    const target = targetDoc?.actor ?? targetDoc;
    const miracle = target?.items?.get(miracleId);
    if (!miracle) { ui.notifications.warn("使わせる神業が見つかりません。"); return; }
    if (!(game.user.isGM || target.isOwner)) { ui.notifications.warn("神業の使用は対象の操作者（または RL）が行います。"); return; }
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    const fired = await TnxCharacterSheetBase._activateItemCheck(target, miracle, { miracleFree: { messageId: message.id } });
    if (fired !== true) return;
    await TnxSocketHandler.applyMessagePatch(message, {
        [`flags.${SCOPE}.miracle.request.used`]: { id: miracle.id, name: miracle.name },
    });
}

/** 破壊の適用(神業カードのボタン・対象の操作者/RL): アウトフィットの isDestroyed を立てる。 */
async function applyMiracleDestroy(message) {
    const mf = message.getFlag(SCOPE, "miracle");
    const d = mf?.destroy;
    if (!d || d.applied) return;
    const targetDoc = await fromUuid(d.targetUuid).catch(() => null);
    const target = targetDoc?.actor ?? targetDoc;
    const outfit = target?.items?.get(d.itemId);
    if (!outfit) { ui.notifications.warn("破壊するアウトフィットが見つかりません。"); return; }
    if (!(game.user.isGM || target.isOwner)) { ui.notifications.warn("適用は対象の操作者（または RL）が行います。"); return; }
    await outfit.update({ "system.isDestroyed": true });
    await TnxSocketHandler.applyMessagePatch(message, { [`flags.${SCOPE}.miracle.destroy.applied`]: true });
}

// ─── 打ち消し(防御タイプ・17-2) ────────────────────────────────────────────────
// 正本: Miracle_Rules「打ち消しの範囲」= 判定に対しては失敗させる／宣言に対しては効果の適用を
// キャンセルする。いずれも適用前に限る(遡及不可)。発動はクリック待ち(kind=negate)で、発動点は
// 結果カード/攻撃カードの達成値・宣言カードの効果トレイ見出し・神業カードの見出し。
// 打ち消されたものはカードから消える(理由の行は残さない=直前に神業カードが出ている)。

/** クリック待ち(negate)の状態から打ち消す神業と印を解決する。モード外なら null。 */
function negateState() {
    const state = TnxCheckFlow.peekAchievementAction("negate");
    if (!state) return null;
    const actor = game.actors.get(state.actorId);
    const skill = actor?.items.get(state.skillItemId);
    if (!skill) { TnxCheckFlow.cancelAchievementAction(); return null; }
    return { state, actor, skill, by: { ...miracleOriginOf(skill, state.asOther), actorId: actor.id } };
}

/**
 * 打ち消しの限定(用途の「打ち消せる神業」)。指定があるとその神業しか打ち消せない
 * (《真実に対する不可触》等)。指定が無ければ何でも打ち消せる。
 * @param {object} state クリック待ちの状態(usage を持つ)
 * @param {?{uuid?: string, name?: string}} target 打ち消される神業の印(判定の打ち消しは null)
 * @returns {Promise<boolean>} 打ち消してよいか(不可なら警告を出す)
 */
async function negateLimitOk(state, target) {
    const limit = state?.usage?.negateMiracle;
    if (!limit) return true;
    const want = await fromUuid(limit).catch(() => null);
    if (!want) return true;
    const got = target?.uuid ? await fromUuid(target.uuid).catch(() => null) : null;
    const ok = miracleIdentityMatches(
        { identificationKey: want.system?.identificationKey, name: want.name },
        { identificationKey: got?.system?.identificationKey, name: got?.name ?? target?.name });
    if (!ok) ui.notifications.warn(`この神業で打ち消せるのは《${want.name}》だけです。`);
    return ok;
}

/**
 * 神業が他のカードへ与えた変更を戻す(打ち消し・防御を打ち消されたとき・2026-09-06)。
 * undo は {messageId, patch} の並びで、patch は**当時の値**(フラグのパス→値)。
 * 対象のカードが消えている・既に別の神業に触られている場合でも、そのまま当時の値へ戻す
 * (卓の裁定で戻すのが打ち消しの意味なので、後勝ちで構わない)。
 * @param {object} mf 打ち消された神業カードのフラグ
 */
async function revertMiracleUndo(mf) {
    for (const step of (mf?.undo ?? [])) {
        const msg = game.messages.get(step.messageId);
        if (!msg || !step.patch) continue;
        await TnxSocketHandler.applyMessagePatch(msg, step.patch);
    }
}

/** 打ち消しの確定: モード解除と消費(待ち受け開始時に確定したプラン)、発動した神業のカード(17-5 の記帳点)。 */
async function commitNegate(state, undo = null) {
    TnxCheckFlow.cancelAchievementAction();
    if (state.consumeUses?.length) await applyConsumptionPlan(state.consumeUses);
    const skill = game.actors.get(state.actorId)?.items.get(state.skillItemId);
    if (skill) await postMiracleCard(skill, { asOther: state.asOther, undo });
}

/**
 * 結果カード/攻撃カードの達成値クリック(打ち消し待ち中): その判定を失敗させる。
 * 攻撃なら攻撃カードを全体失敗(failedReason=negated)にし、出ているダメージカードは全対象を
 * 防いだ扱いにして消す(適用済みがあれば拒否)。それ以外は事後修正の器(checkMods)に打ち消し行を
 * 積み、成否を失敗に固定する(達成値は変えない)。
 * @param {ChatMessage} message
 */
export async function handleNegateAchievementClick(message) {
    const ns = negateState();
    if (!ns) return;
    const checkF = message.getFlag(SCOPE, "checkResult");
    const attackF = message.getFlag(SCOPE, "attackCheck");
    if (!checkF && !attackF) return;
    const rc = message.getFlag(SCOPE, "checkRecheck") ?? {};
    const damageCards = attackF
        ? [...game.messages].filter(m => m.getFlag(SCOPE, "damageRoll")?.attackMessageId === message.id)
        : [];
    if ((attackF?.failedReason === "negated") || (message.getFlag(SCOPE, "checkMods")?.rows ?? []).some(r => r?.negatedBy)) {
        ui.notifications.warn("この判定は既に打ち消されています。");
        return;
    }
    if (!await negateLimitOk(ns.state, message.getFlag(SCOPE, "miracle") ?? null)) return;
    const gate = negateCheckGate({ recheck: rc, damageCards: damageCards.map(m => ({ applied: m.getFlag(SCOPE, "damageRoll")?.applied === true })) });
    if (!gate.ok) {
        ui.notifications.warn("この判定の効果は適用済みのため打ち消せません（時間をさかのぼって打ち消すことはできません）。");
        return;
    }
    const undo = [{ messageId: message.id, patch: attackF ? {
        [`flags.${SCOPE}.attackCheck.state`]:        attackF.state ?? "open",
        [`flags.${SCOPE}.attackCheck.failedReason`]: attackF.failedReason ?? null,
        [`flags.${SCOPE}.attackCheck.negatedBy`]:    attackF.negatedBy ?? null,
    } : {
        [`flags.${SCOPE}.checkMods`]:                    foundry.utils.deepClone(message.getFlag(SCOPE, "checkMods") ?? null),
        [`flags.${SCOPE}.checkResult.result.success`]:   checkF?.result?.success ?? null,
        [`flags.${SCOPE}.negatedBy`]:                    message.getFlag(SCOPE, "negatedBy") ?? null,
    } }];
    for (const dm of damageCards) {
        const df = dm.getFlag(SCOPE, "damageRoll");
        undo.push({ messageId: dm.id, patch: {
            [`flags.${SCOPE}.damageRoll.targets`]:   foundry.utils.deepClone(df?.targets ?? []),
            [`flags.${SCOPE}.damageRoll.negatedBy`]: df?.negatedBy ?? null,
        } });
    }
    await commitNegate(ns.state, undo);

    if (attackF) {
        const { applyAttackPatch } = await import("./attack-flow.mjs");
        await applyAttackPatch(message, { state: "failed", failedReason: "negated", negatedBy: ns.by });
        const { applyDamagePatch } = await import("./damage-flow.mjs");
        for (const dm of damageCards) {
            const f = dm.getFlag(SCOPE, "damageRoll");
            const targets = (f.targets ?? []).map(t => ({ ...t, protectedBy: ns.by }));
            await applyDamagePatch(dm, { targets, negatedBy: ns.by });
        }
        return;
    }
    const mods = negatedCheckMods(message.getFlag(SCOPE, "checkMods"), {
        achievement: message.getFlag(SCOPE, "checkMods")?.achievement ?? checkF.result?.achievement ?? 0,
        targetValue: rc?.targetValue ?? null,
        by: ns.by,
    });
    await TnxSocketHandler.applyMessagePatch(message, {
        [`flags.${SCOPE}.checkMods`]: mods,
        [`flags.${SCOPE}.checkResult.result.success`]: false,
        [`flags.${SCOPE}.checkResult.result.diff`]: null,
        [`flags.${SCOPE}.negatedBy`]: ns.by,
    });
    // 判定要求由来なら要求カードの結果表示を追随させる(失敗に)
    if (rc?.requestMessageId) {
        const result = foundry.utils.deepClone(checkF.result);
        result.success = false; result.diff = null;
        TnxSocketHandler.emitCheckResult(rc.requestMessageId, rc.actorId, result);
    }
}

/**
 * 宣言カードの効果トレイ見出しクリック(打ち消し待ち中): 効果の適用をキャンセルする。
 * usageEffects に negatedBy を刻み、トレイは描画されなくなる(usageEffectTrayContext が null)。
 * 適用済みかどうかはカードが状態を持たないため判別しない(適用前に限るのは卓の運用)。
 * @param {ChatMessage} message
 */
export async function handleNegateTrayClick(message) {
    const ns = negateState();
    if (!ns) return;
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload) return;
    if (payload.negatedBy) { ui.notifications.warn("この効果は既に打ち消されています。"); return; }
    if (!await negateLimitOk(ns.state, message.getFlag(SCOPE, "miracle") ?? null)) return;
    await commitNegate(ns.state, [{ messageId: message.id, patch: {
        [`flags.${SCOPE}.usageEffects.negatedBy`]: payload.negatedBy ?? null,
    } }]);
    await TnxSocketHandler.applyMessagePatch(message, { [`flags.${SCOPE}.usageEffects.negatedBy`]: ns.by });
}

/**
 * 神業カードの見出しクリック(打ち消し待ち中): その神業を打ち消す。効果文・条件・効果トレイ
 * (・17-3 で載る適用ボタン)が消え、枠(タグと名前)だけ残る。
 * @param {ChatMessage} message
 */
export async function handleNegateMiracleCardClick(message) {
    const ns = negateState();
    if (!ns) return;
    const mf = message.getFlag(SCOPE, "miracle");
    if (!mf?.itemId) return;
    if (mf.negatedBy) { ui.notifications.warn("この神業は既に打ち消されています。"); return; }
    if (!await negateLimitOk(ns.state, mf)) return;
    await commitNegate(ns.state, [{ messageId: message.id, patch: {
        [`flags.${SCOPE}.miracle.negatedBy`]: mf.negatedBy ?? null,
        ...(message.getFlag(SCOPE, "usageEffects")
            ? { [`flags.${SCOPE}.usageEffects.negatedBy`]: message.getFlag(SCOPE, "usageEffects").negatedBy ?? null } : {}),
    } }]);
    // 打ち消し・防御そのものを打ち消したときは、その神業が他のカードへ与えた変更を戻す
    // (2026-09-06 ユーザー指摘「撃ち消しや防御はそれ自体を打ち消すこともできます」)
    await revertMiracleUndo(mf);
    const patch = { [`flags.${SCOPE}.miracle.negatedBy`]: ns.by };
    if (message.getFlag(SCOPE, "usageEffects")) patch[`flags.${SCOPE}.usageEffects.negatedBy`] = ns.by;
    await TnxSocketHandler.applyMessagePatch(message, patch);
}

// ─── 回避(防御タイプ・17-2・《脱出》) ─────────────────────────────────────────
// 効果文「あなた、もしくはあなたの操縦するヴィークルへの物理攻撃をかわす（その場合、位置は
// 変わらない）」。回避は命中の段階の動作で、発動点は攻撃カードの自分の対象行(名前)。
// ヴィークルへの攻撃は操縦者を対象にするため「自分の行」に含まれる。同乗者は同乗を持たないため手動。

/**
 * 攻撃カードの対象行クリック(回避待ち中): その行を回避(miss・由来=神業)にする。位置は変えない。
 * @param {ChatMessage} message 攻撃カード
 * @param {number} rowIndex クリックした対象行(f.targets の添字)
 * @returns {Promise<boolean>} 回避待ち中に処理した(モード外は false=既存のリアクション入口へ)
 */
export async function handleAttackEvadeClick(message, rowIndex) {
    const state = TnxCheckFlow.peekAchievementAction("evade");
    if (!state) return false;
    const actor = game.actors.get(state.actorId);
    const skill = actor?.items.get(state.skillItemId);
    if (!skill) { TnxCheckFlow.cancelAchievementAction(); return true; }
    const f = message.getFlag(SCOPE, "attackCheck");
    if (!f) return true;
    const by = { ...miracleOriginOf(skill, state.asOther), actorId: actor.id };
    const resolveActorId = (uuid) => {
        try { const d = fromUuidSync(uuid); return (d?.actor ?? d)?.id ?? null; } catch { return null; }
    };
    const plan = evadePlan(f, { rowIndex, actorId: actor.id, by, resolveActorId });
    if (!plan.ok) {
        ui.notifications.warn({
            noTarget:     "この対象行は見つかりません。",
            category:     `「${skill.name}」で回避できるのは物理攻撃だけです。`,
            damageRolled: "ダメージカードが出た後の攻撃は回避できません（ダメージを防ぐのは防御神業の領分です）。",
            notSelf:      `「${skill.name}」で回避できるのは自分（または自分の操縦するヴィークル）への攻撃だけです。`,
            alreadyMiss:  "この対象は既に回避／失敗しています。",
        }[plan.reason] ?? "回避できません。");
        return true;
    }
    TnxCheckFlow.cancelAchievementAction();
    if (state.consumeUses?.length) await applyConsumptionPlan(state.consumeUses);
    await postMiracleCard(skill, { asOther: state.asOther }); // 発動した神業を卓に提示(17-5 の記帳点)
    const { applyAttackTargetPatch } = await import("./attack-flow.mjs");
    await applyAttackTargetPatch(message, plan.index, {
        state: "miss", resolution: "miracleEvade", reactionAchievement: null, diff: null, parryGuard: 0, evadedBy: by,
    });
    return true;
}

/**
 * 神業カードの描画フック(`renderChatMessageHTML`・フラグ miracle を持つカード)。
 * 打ち消された神業は中身(効果文・条件・残り回数・効果エリア)が消え、見出しだけ残る。
 * 見出しは打ち消し待ちの発動点(モード外のクリックは無視)。
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderMiracleCard(message, html) {
    const mf = message.getFlag(SCOPE, "miracle");
    if (!mf?.itemId) return;
    const card = html.querySelector(".tnx-miracle-card");
    if (!card) return;
    if (mf.negatedBy) {
        // 効果は消えるが、**消えたことを明示する**——黙って中身が消えると打ち消されたのか
        // 分からない(2026-09-06 ユーザー指摘)。効果文の畳みと残り回数は読めるまま残す
        html.querySelector(".tnx-usage-effect-area")?.remove();
        for (const sel of [".mc-destroy", ".mc-interfere", ".mc-effect", ".mc-as-other"]) card.querySelector(sel)?.remove();
        card.classList.add("tnx-miracle-card--negated");
        const body = card.querySelector(".tnx-card__body") ?? card;
        if (!card.querySelector(".mc-negated")) {
            const esc = foundry.utils.escapeHTML;
            const line = cardResult(`<i class="fas fa-ban"></i> 《${esc(mf.negatedBy.name ?? "神業")}》${nowrap("で打ち消された")}`,
                { modifier: "tnx-card__result--nodamage mc-negated" });
            body.prepend(line);
        }
        return;
    }
    renderMiracleEffectRows(message, card, mf);
    // 効果の参照/コピー(17-5): 見出しは元の神業、本文の先頭に「効果 《参照先》」
    if (mf.asOther?.name && !card.querySelector(".mc-as-other")) {
        const esc = foundry.utils.escapeHTML;
        const body = card.querySelector(".tnx-card__body") ?? card;
        body.insertAdjacentHTML("afterbegin", keepTogether(`<div class="tnx-card__field mc-as-other"><span class="tnx-card__field-label">効果</span>`
            + `<span class="tnx-card__field-value">《${esc(mf.asOther.name)}》</span></div>`));
    }
    const head = card.querySelector(".tnx-card__head");
    if (head && !head.classList.contains("tnx-recheck-target")) {
        head.classList.add("tnx-recheck-target");
        head.addEventListener("click", () => handleNegateMiracleCardClick(message));
    }
    // 破壊(17-3): 結果行「破壊: 対象のアウトフィット」と適用ボタン(対象の操作者/RL)。適用後はボタンを消す
    const d = mf.destroy;
    if (d && !card.querySelector(".mc-destroy")) {
        const esc = foundry.utils.escapeHTML;
        const body = card.querySelector(".tnx-card__body") ?? card;
        const wrap = document.createElement("div");
        wrap.className = "mc-destroy";
        wrap.appendChild(cardField("破壊", `${esc(d.targetName)}の「${esc(d.itemName)}」${d.applied ? "（破壊済み）" : ""}`,
            { modifier: "mc-destroy__row" }));
        if (!d.applied && isTargetOperator(d.targetUuid)) {
            wrap.appendChild(chatButton("fa-burst", "破壊を適用", () => applyMiracleDestroy(message)));
        }
        body.appendChild(wrap);
    }
    // 使用回数+1(17-4・《ファイト！》): 結果行「使用回数+1: 対象の《神業》」と適用ボタン(対象の操作者/RL)
    const a = mf.addUse;
    if (a && !card.querySelector(".mc-interfere")) {
        const esc = foundry.utils.escapeHTML;
        const body = card.querySelector(".tnx-card__body") ?? card;
        const wrap = document.createElement("div");
        wrap.className = "mc-interfere";
        wrap.appendChild(cardField("使用回数+1", `${esc(a.targetName)}の《${esc(a.miracleName)}》${a.applied ? "（適用済み）" : ""}`));
        if (!a.applied && isTargetOperator(a.targetUuid)) {
            wrap.appendChild(chatButton("fa-plus", "適用", () => applyMiracleAddUse(message)));
        }
        body.appendChild(wrap);
    }
    // 神業を使わせる(17-4・《プリーズ！》): お願いの段=対象と、その神業ごとのボタン(対象の操作者/RL)。
    // 使ったら「使用: 《神業》」に置き換わりボタンは消える(1回のお願い=1回の使用)
    const r = mf.request;
    if (r && !card.querySelector(".mc-interfere")) {
        const esc = foundry.utils.escapeHTML;
        const body = card.querySelector(".tnx-card__body") ?? card;
        const wrap = document.createElement("div");
        wrap.className = "mc-interfere";
        wrap.appendChild(cardField("お願い", esc(r.targetName)));
        if (r.used) {
            wrap.appendChild(cardField("使用", `《${esc(r.used.name)}》`));
        } else if (isTargetOperator(r.targetUuid)) {
            for (const m of (r.miracles ?? [])) {
                wrap.appendChild(chatButton("fa-hand-sparkles", `《${m.name}》を使う`, () => handleMiracleRequestClick(message, m.id)));
            }
        }
        body.appendChild(wrap);
    }
}

/** 宣言の効果(17-6)の段: 入れ替え(適用ボタン)／入手(常備化できない)／次の行動(不可知)。 */
function renderMiracleEffectRows(message, card, mf) {
    if (card.querySelector(".mc-effect")) return;
    const esc = foundry.utils.escapeHTML;
    const body = card.querySelector(".tnx-card__body") ?? card;
    const wrap = document.createElement("div");
    wrap.className = "mc-effect";
    const field = (label, value) => wrap.appendChild(cardField(esc(label), value));
    if (mf.swap) {
        field("宿主", esc(mf.swap.hostName ?? ""));
    } else if (mf.acquire) {
        field("入手", `「${esc(mf.acquire.itemName)}」`);
    } else if (mf.insensible) {
        field("次の行動", "神業以外では妨げられない");
        field("割り込み", "AR を消費しない");
    } else {
        return;
    }
    body.appendChild(wrap);
}

/** チャットカードのボタン(全幅・縦積み=既存の .tnx-chat-btn)。 */
function chatButton(icon, label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tnx-chat-btn";
    btn.innerHTML = `<i class="fas ${icon}"></i> `;
    // ボタンのラベルも塊(《神業》)で折らない
    btn.insertAdjacentHTML("beforeend", keepTogether(foundry.utils.escapeHTML(label)));
    btn.addEventListener("click", onClick);
    return btn;
}

/**
 * 神業カードを投稿する。効果文と条件はここでエンリッチし、描画データは純関数で組む。
 * 適用効果(usageEffects)があれば解説カードと同じ器(tnx-usage-use-card ＋ 効果エリア)で包み、
 * 「効果を適用」トレイは renderChatMessageHTML フックが差し込む。
 * @param {Item} item 神業アイテム
 * @param {{usageEffects?: ?object}} [opts]
 * @returns {Promise<ChatMessage>}
 */
export async function postMiracleCard(item, { usageEffects = null, destroy = null, addUse = null, request = null, swap = null, acquire = null, insensible = false, asOther = null, undo = null } = {}) {
    const TE = foundry.applications.ux.TextEditor;
    // 解説の段(効果文と条件)は**常に畳んだ状態でカードの最上部**に置く(2026-09-05 ユーザー指示)。
    // 他の神業として使う(17-5)ときは参照先の文を出す(条件も参照先と同じ)
    const textHost = asOther?.source ?? item;
    const [description, condition] = await Promise.all([
        TE.enrichHTML(textHost.system?.description ?? "", { relativeTo: textHost }),
        TE.enrichHTML(textHost.system?.usageCondition ?? "", { relativeTo: textHost }),
    ]);
    const { remaining, max } = miracleUseGate(item.system);
    const data = buildMiracleCardData(item, { description, condition, remaining, max });
    const card = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/miracle-card.hbs", data);
    return ChatMessage.create({
        user:    game.user.id,
        speaker: ChatMessage.getSpeaker({ actor: item.actor ?? undefined }),
        content: usageEffects
            ? `<div class="tnx-usage-use-card">${card}<div class="tnx-usage-effect-area"></div></div>`
            : card,
        flags: {
            "core.canPopout": true,
            [SCOPE]: {
                // destroy(17-3): 破壊の結果(対象と選んだアウトフィット)／addUse・request(17-4): 干渉の結果。
                // 描画フックが結果行と適用/使用ボタンを足す
                miracle: {
                    ...miracleOriginOf(item, asOther),
                    ...(destroy ? { destroy } : {}), ...(addUse ? { addUse } : {}), ...(request ? { request } : {}),
                    ...(swap ? { swap } : {}), ...(acquire ? { acquire } : {}), ...(insensible ? { insensible: true } : {}),
                    // undo(2026-09-06): この神業が**他のカードへ与えた変更を戻す手順**。
                    // 打ち消し・防御はそれ自体を打ち消せるので、打ち消されたらここを逆に当てる
                    ...(undo?.length ? { undo } : {}),
                },
                ...(usageEffects ? { usageEffects } : {}),
            },
        },
    });
}

/**
 * 用途を持たない神業の使用(既定挙動)。残回数ゲート→消費→神業カード。
 * @param {Item} item 神業アイテム
 * @param {{free?: boolean}} [opts] free=《プリーズ！》で使わされる(ゲートも消費も無い・17-4)
 * @returns {Promise<boolean>} 使用したら true(残り無しで中止なら false)
 */
export async function useMiracleWithoutUsage(item, { free = false, asOther = null } = {}) {
    if (!free) {
        const gate = miracleUseGate(item.system);
        if (!gate.ok) {
            ui.notifications.warn(`神業「${item.name}」はこれ以上使用できません。`);
            return false;
        }
        await item.update(miracleConsumeUpdate(item.system));
    }
    // 用途を持たない神業＝宣言そのものが効果
    await postMiracleCard(item, { asOther });
    return true;
}
