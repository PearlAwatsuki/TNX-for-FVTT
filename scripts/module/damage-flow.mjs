/**
 * @fileoverview ダメージフロー(フェーズ12-3/12-4・正本 Damage_Rules.md)。
 *
 * D&D 5e のダメージ・ロールと同型(2026-07-08 ユーザー確定):
 * - 攻撃カードの命中確定後「ダメージカードを出す」→ 最小ダイアログ(FA 選択・手動修正)を
 *   開いたまま待ち受け、**手札は HUD のカードを直接クリック**して出す
 *   (判定と同じ操作系=専用の選択ダイアログは使わない)。山札はダイアログの[山札から1枚めくる]。
 *   **カードプレイが確定トリガー**。HUD 側は TnxCheckFlow と同様に isDamageCardPending →
 *   executeDamageCardFromHand で本モジュールへ配線される。
 * - ダメージカードは命中判定のカードとは**別**で、**判定ではない**(判定ルールは適用されず、
 *   山札の絵札もファンブルにならない)。数字は N◎VA 数字(絵札=10・A=11)=N◎VA 全体に
 *   通底する規約。ジョーカーはワイルドカード(数字を宣言)。
 * - **複数枚は合算**(カブキ〈ラッキーストライク〉等の特殊技能で使用)。枚数・可否の検証は
 *   システムは行わない(技能を強制しない方針と同じ)。
 * - ダメージ・チャットカードに台帳(カード行+攻撃力+FA+修正)と攻撃側合計を表示し、
 *   [カードを追加で出す](攻撃側)/[ダメージ適用](対象の操作者または RL)を全幅ボタンで置く。
 * - 適用時は**軽減ダイアログ**(防御力+パリー受け値自動・手動の状況軽減)で確定 → 型分岐適用
 *   (cast/guest=チャート・troop=heads 減算・分身=消滅通知・extra=不可警告)。
 *   社会の報酬点軽減は**リアクション成立時に対象行の数字クリック**(算出後〜適用前・実減算・
 *   2026-07-17 ユーザー確定=promptBountyMitigation)。メッセージのフラグ更新のみ GM へ委譲
 *   (applyMessagePatch・2026-07-16 一本化)。
 */

import { applyDamageChartResult } from "./condition-resolution.mjs";
import { aggregateDefence, defenceForType, computeDamage, splitSharedBonusRows } from "./damage-logic.mjs";
import { evaluateBonusRows, evaluateSelfBonus } from "./tnx-formula.mjs";
import { applyConsumptionPlan } from "./usage-consumption.mjs";
import { getDamageChartKind } from "../data/damage-chart.mjs";
import { CONDITION_KINDS, getEffectiveConditions, hasBountyBlock, isWetActor } from "./conditions.mjs";
import { applyAttackPatch } from "./attack-flow.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { TnxActionHandler } from "./tnx-action-handler.mjs";
import { getCardCheckValue } from "./tnx-check-engine.mjs";
import { formatAttackLabel } from "./attack-flow-logic.mjs";
import { gatherDamageVsSources, gatherDamageDealtSources, gatherDamageTakenSources, collectActorEffectBuffs, targetStyleWorksKeys } from "../data/item/helpers.mjs";
import { splitEffectsByTiming } from "./usage-effects.mjs";
import { spinnerDialogActions } from "./tnx-dialog.mjs";
import { rlGrantAmount, rlGrantLedgerRow, rlGrantTypeLabel, buildRlDamageRollFlag } from "./rl-grant-logic.mjs";
import { unprotectedTargetIndices, defencePreventPlan } from "./miracle-logic.mjs";

const SCOPE = "tokyo-nova-axleration";
const CATEGORY_LABELS = { physical: "肉体", mental: "精神", social: "社会" };
const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };

/**
 * ダメージカードの待ち受け状態(TnxCheckFlow._context と同じ役割・同時に1つ)。
 * kind="roll"=初回(ロールダイアログを開いたまま HUD クリック待ち)・"add"=追加のカード。
 * @type {{kind:"roll"|"add", dialog:object|null, done:boolean, [key:string]:any}|null}
 */
let _pending = null;

/** ダメージカードの待ち受け中か(HUD の手札クリック分岐用)。 */
export function isDamageCardPending() {
    return _pending !== null;
}

/**
 * HUD の手札クリックからダメージカードを出す(TnxCheckFlow.executeFromHand と同型)。
 * @param {string} cardId
 * @returns {Promise<boolean>} true=ダメージカードとして処理(通常のカードプレイはしない)
 */
export async function executeDamageCardFromHand(cardId) {
    const ctx = _pending;
    if (!ctx) return false;
    // フォームはカードを出す前に読む(確定後にダイアログを閉じるため)
    const form = ctx.kind === "roll" && ctx.dialog?.element
        ? readRollForm(ctx.dialog.element)
        : { manualMod: 0 };
    const played = await playHandCardForDamage(cardId);
    if (!played) return true; // ワイルドカード宣言キャンセル等 → 待ち受け継続
    ctx.done = true;
    _pending = null;
    await ctx.dialog?.close().catch(() => {});
    if (ctx.kind === "roll") await finalizeDamageRoll(ctx, form, played);
    else await appendDamageCard(ctx.message, played);
    return true;
}

/** 進行中の待ち受けを解除する(新しい待ち受けを張る前・ダイアログも閉じる)。 */
async function cancelPending() {
    const old = _pending;
    if (!old) return;
    _pending = null;
    await old.dialog?.close().catch(() => {});
}

/** ロールダイアログの入力を読む。 */
function readRollForm(el) {
    return {
        manualMod:  Number(el.querySelector('[name="manualMod"]')?.value) || 0,
    };
}

// ─── 起動(攻撃カードの「ダメージカードを出す」) ─────────────────────────────────

/**
 * 攻撃カードからダメージ・ロールを開始する(命中確定後・攻撃側)。
 * 最小ダイアログで修正を決め、カードを出した瞬間にダメージ・チャットカードを投稿する。
 * @param {ChatMessage} attackMessage 攻撃カードのメッセージ
 */
export async function openDamageRollDialog(attackMessage) {
    const f = attackMessage.getFlag(SCOPE, "attackCheck");
    if (!f) return;
    if (f.damageRolled) { ui.notifications.info("この攻撃のダメージカードは出されています。"); return; }
    // RL 任意ダメージの固定モード(2026-07-24): カードを出さず、指定値のダメージカードを直接生成する
    // (カードモードはこの下の通常フローへ合流＝攻撃者=RL・攻撃力=基準値・命中確定済みの通常攻撃と同型)
    if (f.rlGrant?.mode === "fixed") return openRlFixedDamage(attackMessage);

    const attacker = await fromUuid(f.attackerUuid).catch(() => null);
    if (!(game.user.isGM || attacker?.isOwner)) {
        ui.notifications.warn("ダメージカードは攻撃側（または RL）が出します。");
        return;
    }
    const category = f.category || "physical";
    const attackPower = category === "physical" ? (Number(f.weaponAttack) || 0) : 0;
    // FA(フルオート)の自動加算は廃止(2026-07-18 ユーザー確定)——FA 値は用途のダメージボーナス式で
    // 手動参照する。ダメージダイアログの FA 選択・FA 値加算・弾数消費はすべて撤去。

    // 命中した対象(複数対象一括・2026-07-15)。**ダメージ修正は対象ごとに評価する**
    // (2026-09-01 ユーザー確定=チャットカードが対象行を単位に表示する以上、計算も同じ単位で回す。
    // 旧実装の「先頭の命中対象で近似」は撤廃)。共有なのは判定・カード値・攻撃力・手動修正まで。
    const hitTargets = (f.targets ?? []).filter(t => t.state === "hit");
    // 用途の親アイテム(@item.self の解決に使う。攻撃者所持のアイテム)
    const parentItem = f.sourceItemId ? attacker?.items.get(f.sourceItemId) : null;
    const result = { diff: f.diff, achievement: f.achievement, cardValue: f.cardValue ?? null };

    // 対象行(カバー展開済み)を先に作り、その各行＝被弾者ごとにダメージ修正を評価する
    const damageTargets = buildDamageTargets(hitTargets);
    const { noTargetRows } = await evaluateDamageBonusesPerTarget(damageTargets, {
        f, attacker, parentItem, result, category,
    });
    // ダイアログのプレビュー: 全対象で同じなら1つの数字・対象ごとに違うならその旨を添える
    const sums = damageTargets.map(t => (t.bonusRows ?? []).reduce((s, r) => s + (Number(r.value) || 0), 0));
    const previewSum = damageTargets.length
        ? sums[0]
        : noTargetRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
    const previewVaries = sums.some(v => v !== sums[0]);

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/dialog/damage-roll-dialog.hbs",
        {
            categoryLabel: CATEGORY_LABELS[category] ?? category,
            isPhysical: category === "physical",
            attackLabel: formatAttackLabel(f.damageType, attackPower),
            attackSourceName: f.attackSourceName,
            targetName: hitTargets.map(t => `「${t.name}」`).join("・") || "（対象なし）",
            damageBonus: previewSum,
            damageBonusVaries: previewVaries,
        }
    );

    // 待ち受け開始: ダイアログを開いたまま、手札は HUD クリック(executeDamageCardFromHand)・
    // 山札はダイアログのボタンで出す(判定と同じ操作系)
    await cancelPending();
    const ctx = { kind: "roll", attackMessage, f, attacker, category, attackPower, damageBonusRows: noTargetRows, damageTargets, hitTargets, dialog: null, done: false };
    _pending = ctx;

    const chosen = await foundry.applications.api.DialogV2.wait({
        window: { title: `ダメージカードを出す: ${CATEGORY_LABELS[category] ?? category}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-dialog"],
        position: { width: 440 },
        content,
        actions: spinnerDialogActions,
        buttons: [
            { action: "deck", icon: "fas fa-clone", label: "山札から1枚めくる",
              callback: (_e, _b, dialog) => readRollForm(dialog.element) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        render: (_event, dialog) => { ctx.dialog = dialog; },
        close: () => null,
    });
    if (_pending === ctx) _pending = null;
    if (ctx.done) return;   // HUD の手札クリックで確定済み
    if (!chosen) return;    // キャンセル

    // 山札から出す(=確定トリガー)。失敗・宣言キャンセル時は何も消費せず中断
    const played = await playDamageCardFromDeck();
    if (!played) return;
    await finalizeDamageRoll(ctx, chosen, played);
}

/**
 * ダメージ修正を**対象ごとに**評価し、各対象行へ `bonusRows` として書き込む
 * (2026-09-01 ユーザー確定。旧「先頭の命中対象で近似」を置き換える)。
 *
 * 対象ごとに変わりうるもの: 用途のダメージ修正行と自身の修正値(**対象条件**・`@target.*` の式)、
 * AE の `damage.vsStyle`/`vsWorks`/`vsWet`/`vsNotWet`。対象に依らないもの(`damage.dealt`)は
 * 1 回だけ集計して全対象に同じ行として乗せる(表示側が共有行として畳む)。
 *
 * 対象が 0 体(RL 手動運用の対象なし攻撃)のときは、対象なしで評価した行を返す
 * (対象未解決では対象条件でゲートしない＝一貫した規約)。
 *
 * @param {Array<{uuid:string, bonusRows?:Array}>} damageTargets 被弾者の行(この配列を書き換える)
 * @param {{f:object, attacker:Actor|null, parentItem:Item|null, result:object, category:string}} ctx
 * @returns {Promise<{noTargetRows:Array<{name:string, value:number, note?:string}>}>}
 *   noTargetRows=対象なしのときの行(対象がいる場合は空配列)
 */
async function evaluateDamageBonusesPerTarget(damageTargets, { f, attacker, parentItem, result, category }) {
    // 対象非依存の AE(与えるダメージ +値)は 1 回だけ集計する
    const dealtRows = gatherDamageDealtSources(collectActorEffectBuffs(attacker), category);
    const evaluateFor = async (targetActor) => {
        const self = await evaluateSelfBonus(f.damageBonusSelf, attacker, result, targetActor, parentItem,
            f.damageBonusSelfCondition ?? null);
        const { sources } = await evaluateBonusRows(f.damageBonuses, attacker, result, null, targetActor, parentItem);
        const vsRows = targetActor ? collectDamageVsBonuses(attacker, targetActor, category) : [];
        return [...(self ? [self] : []), ...sources, ...dealtRows, ...vsRows];
    };
    if (!damageTargets.length) return { noTargetRows: await evaluateFor(null) };
    for (const t of damageTargets) {
        const targetActor = await resolveTargetActor(t.uuid);
        t.bonusRows = await evaluateFor(targetActor);
    }
    return { noTargetRows: [] };
}

/**
 * ダメージ・ロールを確定する(カードが出た後):
 * ダメージ・チャットカードの投稿→攻撃カードの damageRolled 化。
 * @param {object} ctx  待ち受けコンテキスト(kind="roll")
 * @param {{manualMod:number}} form ロールダイアログの入力
 * @param {{name:string, suit:string, value:number}} played 出したダメージカード
 */
async function finalizeDamageRoll(ctx, form, played) {
    const { attackMessage, f, attacker, category, attackPower, damageBonusRows, damageTargets, hitTargets } = ctx;

    // 用途の適用効果(2026-07-18 確定): 一般(命中時)効果は攻撃カードの効果セクションが担う。
    // ダメージカードへは**ダメージ時効果(damageEffects 由来)だけ**を引き継ぎ、このカードの
    // 効果セクションで手動適用する(「1点でも」等の条件はコード化せず卓判断)。ダメージ時の
    // 代償効果(self)も同乗して引き継がれる(2026-08-30)。
    // 対象なし攻撃(RL 手動運用)は命中解決が無い=一般効果も従来どおりこのカードで拾えるよう残す
    const attackEffects = attackMessage.getFlag(SCOPE, "usageEffects") ?? null;
    const dataEntries = (attackEffects?.effects ?? []).filter(e => e?.data);
    const carriedEntries = hitTargets.length ? splitEffectsByTiming(dataEntries).damage : dataEntries;
    let usageEffects = null;
    if (attackEffects && carriedEntries.length) {
        usageEffects = { ...attackEffects, effects: carriedEntries };
    }

    await ChatMessage.create({
        content: await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs",
            { categoryLabel: CATEGORY_LABELS[category] ?? category }
        ),
        speaker: attacker ? ChatMessage.getSpeaker({ actor: attacker }) : undefined,
        flags: {
            [SCOPE]: {
                ...(usageEffects ? { usageEffects } : {}),
                damageRoll: {
                    attackMessageId: attackMessage.id,
                    attackerUuid: f.attackerUuid,
                    // 命中対象(複数対象一括・2026-07-15): カード値・攻撃力・手動修正が共有で、
                    // **ダメージ修正・軽減・チャートは対象ごと**(2026-09-01)。各行は自分の
                    // bonusRows(対象ごとに評価したダメージ修正の内訳)を持つ。
                    // parryGuard は各対象のリアクション(パリー成立)で決まった受け値を引き継ぐ。
                    // カバー(2026-07-16): 攻撃カードで付いた coveredBy を展開＝元対象(被弾なし)＋カバー行
                    // (カバーした側・受け値なし)。カバーした側が元々対象なら自分の行(受け値あり)も別に残る。
                    targets: damageTargets ?? buildDamageTargets(hitTargets),
                    category,
                    damageType: f.damageType ?? "",
                    attackPower,
                    // 対象なし(RL 手動運用)のときの修正行。対象がいる場合は各対象の bonusRows が正
                    damageBonuses: damageBonusRows,
                    mods: [],   // 事後修正(modifyDamage 用途・攻撃側合計クリックで適用)
                    attackSourceName: f.attackSourceName ?? "",
                    diff: f.diff ?? null,
                    achievement: f.achievement ?? null,
                    cardValue: f.cardValue ?? null,   // 命中判定のカード値(式の @card 用)
                    cards: [played],
                    manualMod: form.manualMod,
                    stun: f.stunDeclared === true,   // 攻撃宣言時のスタン/説得(攻撃側合計を10上限・軽減より前)
                    // 「ウェットの対象には効果がない」(用途・2026-09-01 承認): ウェットの対象行は
                    // ダメージ算出全体を 0 にする(対象ごと・内訳に「ウェット無効」)
                    noEffectVsWet: f.noEffectVsWet === true,
                    applied: false,
                    appliedResult: null,
                },
            },
        },
    });

    await applyAttackPatch(attackMessage, { damageRolled: true });
}

/**
 * RL 任意ダメージ(固定モード)の「ダメージを算出」(2026-07-24 ユーザー確定)。中間カード(ダメージ
 * 算出前・カバー可)の命中確定対象へ、指定した固定値のダメージカードを直接生成する(カードは出さない)。
 * カバーの印(coveredBy)は buildDamageTargets が展開する(元対象=被弾なし・カバーした側の行へ付け替え)。
 * 以降は既存のダメージカードフロー(軽減・チャート適用等)に合流する。RL=攻撃者なしのため GM が押す。
 * @param {ChatMessage} stagingMessage 中間カード(attackCheck・rlGrant.mode="fixed")
 */
async function openRlFixedDamage(stagingMessage) {
    const f = stagingMessage.getFlag(SCOPE, "attackCheck");
    if (!f) return;
    if (f.damageRolled) { ui.notifications.info("このダメージは算出済みです。"); return; }
    const attacker = await fromUuid(f.attackerUuid).catch(() => null);
    if (!(game.user.isGM || attacker?.isOwner)) {
        ui.notifications.warn("ダメージの算出は RL（または攻撃側）が行います。");
        return;
    }
    const category = f.category || "physical";
    const hitTargets = (f.targets ?? []).filter(t => t.state === "hit");

    // 固定値のダメージカード。対象行はカバー展開(buildDamageTargets)で作り、RL 由来は rlGrant で持つ
    const damageRoll = buildRlDamageRollFlag({
        targets: [], category, value: f.rlGrant?.value, damageType: f.damageType, note: f.rlGrant?.note,
    });
    damageRoll.targets = buildDamageTargets(hitTargets);
    damageRoll.attackMessageId = stagingMessage.id;

    await ChatMessage.create({
        content: await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs",
            { categoryLabel: CATEGORY_LABELS[category] ?? category }
        ),
        speaker: attacker ? ChatMessage.getSpeaker({ actor: attacker }) : undefined,
        flags: { [SCOPE]: { damageRoll } },
    });

    await applyAttackPatch(stagingMessage, { damageRolled: true });
}

// ─── ダメージカードのプレイ(手札=HUD クリック/山札・ジョーカー=ワイルドカード) ────

/** HUD でクリックされた手札カードをダメージカードとして出す。中断・失敗は null。 */
async function playHandCardForDamage(cardId) {
    const { getUserFlagData } = await import("./user-flag-schema.mjs");
    const handId = getUserFlagData(game.user).handPileId;
    const hand = handId ? await fromUuid(handId).catch(() => null) : null;
    const card = hand?.cards.get(cardId);
    if (!card) {
        ui.notifications.warn("指定されたカードが手札に見つかりませんでした。");
        return null;
    }
    const value = await resolveDamageCardValue(card);
    if (value === null) return null;
    await TnxActionHandler.playCard(card.id);
    // 手札を使用した直後に上限まで自動補充(判定時と同じ挙動・2026-07-08 ユーザー指示)
    await TnxActionHandler.autoReplenishHand();
    game.tnx.hud?.render(false);
    return { name: card.name, suit: card.suit ?? "", value };
}

/** 山札から1枚めくってダメージカードとして出す。中断・失敗は null。 */
async function playDamageCardFromDeck() {
    const card = await TnxActionHandler.flipFromDeck();
    if (!card) return null;
    const value = await resolveDamageCardValue(card);
    // ジョーカー宣言キャンセル時はカードだけめくれた状態になる(実卓と同じ=出し直し)
    if (value === null) {
        ui.notifications.warn("ジョーカーの数字が宣言されませんでした。もう一度カードを出してください。");
        return null;
    }
    return { name: card.name, suit: card.suit ?? "", value };
}

/**
 * ダメージカードの数字を解決する。ダメージカードは判定ではないため判定ルール
 * (山札の絵札=ファンブル・A の21固定)は適用されず、N◎VA 数字(絵札=10・A=11)のみ使う
 * (2026-07-08 ユーザー確定: カードの数字は N◎VA 全体に通底する規約)。
 * ジョーカーはワイルドカード=数字を宣言(衰弱ドローと同じ前例)。
 */
async function resolveDamageCardValue(card) {
    if (card.suit === "joker" || card.value === 99) {
        return promptWildcardValue();
    }
    const v = getCardCheckValue({ numericValue: card.value });
    return typeof v === "number" ? v : (Number(card.value) || 0);
}

/** ジョーカーのワイルドカード数字を宣言させる。キャンセルは null。 */
async function promptWildcardValue() {
    return foundry.applications.api.DialogV2.wait({
        window: { title: "ジョーカー（ワイルドカード）" },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>ジョーカーをワイルドカードとして使います。数字を宣言してください。</p>
            <div class="form-group"><label>数字</label>
                <div class="number-input-spinner">
                    <button type="button" class="tnx-btn" data-action="decrement" aria-label="Decrease">-</button>
                    <input type="number" name="value" value="1" min="1">
                    <button type="button" class="tnx-btn" data-action="increment" aria-label="Increase">+</button>
                </div></div>`,
        actions: spinnerDialogActions,
        buttons: [
            { action: "ok", icon: "fas fa-check", label: "この数字で確定", default: true,
              callback: (_e, _b, dialog) => Math.max(1, Number(dialog.element.querySelector('[name="value"]')?.value) || 1) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
}

// ─── ダメージ・チャットカードのライブ描画(renderChatMessageHTML・tnx.mjs から登録) ──

/** 台帳(カード行+攻撃力+FA+修正→攻撃側合計)と状態領域(ボタン/適用結果)をフラグから描画する。 */
export function renderDamageCard(message, html) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f) return;
    const ledger = html.querySelector(".tnx-damage-ledger");
    const area = html.querySelector(".tnx-damage-status");
    if (!ledger || !area) return;
    ledger.replaceChildren();
    area.replaceChildren();

    const esc = foundry.utils.escapeHTML;
    const row = (parent, label, val, rowCls = "cr-calc-row", valCls = "cr-calc-val") => {
        const div = document.createElement("div");
        div.className = rowCls;
        div.innerHTML = `<span class="cr-calc-label">${label}</span><span class="${valCls}">${val}</span>`;
        parent.appendChild(div);
    };
    const line = (parent, cls, inner) => {
        const div = document.createElement("div");
        div.className = cls;
        div.innerHTML = inner;
        parent.appendChild(div);
    };

    // ── 台帳 ──
    // 対象(複数対象一括・2026-07-15): 被弾者を列挙。カバーされた元対象は buildDamageTargets で載っていない
    // (カバーした側の行だけ)ので、ここは実際の被弾者だけ＝「対象N体」も正しく数える(2026-07-16 是正)。
    const dmgTargets = f.targets ?? [];
    // 防がれた対象行は消える(防御タイプ「適用前に防ぐ」・17-2): 台帳の対象・状態領域の行・適用の
    // 対象のすべてから外す(データには protectedBy として残る=再描画で復活しない)
    const liveIdx = unprotectedTargetIndices(f);
    const liveTargets = liveIdx.map(i => dmgTargets[i]);
    if (liveTargets.length) row(ledger, liveTargets.length > 1 ? `対象（${liveTargets.length}体）` : "対象",
        liveTargets.map(t => `「${esc(t.name)}」`).join("・"));
    // ダメージ修正は対象ごとに評価される(2026-09-01)。**全対象で同じ行は共有台帳に1回**・
    // 対象で異なる行だけ各対象の内訳へ回す(単体対象・対象非依存の式では従来と同じ見た目)。
    // 旧カード(bonusRows なし)は共有行にフォールバックする
    const { shared: sharedBonusRows, extras: perTargetBonusRows } = bonusRowsSplit(f);
    const { attackerTotal } = damageRollTotals(f, { bonusRows: sharedBonusRows });
    const cards = f.cards ?? [];
    cards.forEach((c, i) => {
        const suitMark = SUIT_SYMBOL[c.suit] ? `<span class="cr-suit suit-${c.suit}">${SUIT_SYMBOL[c.suit]}</span> ` : "";
        row(ledger, `ダメージカード${cards.length > 1 ? ` ${i + 1}` : ""}（${suitMark}${esc(c.name)}）`,
            i === 0 ? String(c.value) : `＋${c.value}`);
    });
    // RL 任意付与(2026-07-20): 判定を経由しないため攻撃力の段を持たない。自由記述を行のラベルに使う
    const rlRow = rlGrantLedgerRow(f);
    if (rlRow) {
        row(ledger, esc(rlRow.label), String(rlRow.value));
        // 種別はどの防御力で軽減されるか(X なら対応防御力が無く軽減なし)の根拠になるため台帳に出す
        const typeLabel = rlGrantTypeLabel(f);
        if (typeLabel) row(ledger, "ダメージ種別", esc(typeLabel));
    }
    if (!rlRow && f.category === "physical") {
        // 攻撃力はアウトフィットの表記(種別+符号つき数値・例 I+4)を踏襲。
        // FA 値は用途のダメージ修正(下の damageBonuses)として現れる(2026-07-18 手動一本化)
        row(ledger, `攻撃力（${esc(f.attackSourceName || "生身")}）`, formatAttackLabel(f.damageType, f.attackPower));
    }
    for (const b of sharedBonusRows) {
        // 対象条件で無効化された行は「（名前・理由）」で 0 の根拠を示す(2026-09-01・黙って落とさない)
        row(ledger, `ダメージ修正（${esc(b.name || "用途")}${b.note ? `・${esc(b.note)}` : ""}）`,
            signedDisplay("＋", b.value), "cr-calc-row cr-calc-row--wrap");
    }
    if (f.manualMod) row(ledger, "修正（手動）", signedDisplay("＋", f.manualMod));
    // 物理攻撃＝スタン・精神攻撃＝説得(別メカニクス。系統ごとに専用表記・2026-07-15 ユーザー指摘)。
    // 10上限は恒久軽減(防御力・受け値=対象ごと)の後＝算出の一番最後(2026-07-16 裁定=KI-024)の
    // ため、共有台帳には出さず各対象行の内訳に表示する
    const stunLabel = f.category === "mental" ? "説得" : "スタン";
    // 事後修正(modifyDamage 用途・攻撃側合計クリックで適用済みの行=算出後〜適用前・対象ごとの
    // 10上限の後に乗る)。上書きは「→N」表記
    for (const m of (f.mods ?? [])) {
        row(ledger, `事後修正（${esc(m.label || "用途")}）`,
            m.overrideTo !== undefined ? `→${m.overrideTo}` : signedDisplay("＋", m.value),
            "cr-calc-row cr-calc-row--wrap");
    }
    row(ledger, `攻撃側合計${f.stun ? `（${stunLabel}宣言）` : ""}`, String(attackerTotal), "cr-calc-row cr-total-row", "cr-total-num");
    // ダメージクリック待ち(modifyDamage): 適用前のダメージの攻撃側合計をクリック可能に
    // (達成値クリックと同じ装飾クラス。モード外のクリックは無視)
    if (!f.applied) {
        const totalNum = ledger.lastElementChild?.querySelector(".cr-total-num");
        if (totalNum && !totalNum.classList.contains("tnx-recheck-target")) {
            totalNum.classList.add("tnx-recheck-target");
            totalNum.addEventListener("click", () => handleDamageModifyClick(message));
        }
    }

    // ── 状態領域 ──
    // 適用後(複数対象一括): 対象ごとに軽減・最終ダメージ・適用先を表示する
    if (f.applied && f.appliedResult) {
        // 別のダメージとして適用した場合は差し替え先の系統を明示(元系統で軽減→この系統のチャートへ)
        if (f.appliedResult.applyCategory) {
            line(area, "tnx-damage-altnote",
                `<i class="fas fa-shuffle"></i> 「${esc(CATEGORY_LABELS[f.appliedResult.applyCategory] ?? f.appliedResult.applyCategory)}」ダメージとして適用`);
        }
        for (const tr of (f.appliedResult.targets ?? [])) {
            // 対象ごとに見出し(名前)は1回だけ＝軽減の内訳は名前を繰り返さない小注記に畳む(はみ出し回避)。
            // 内訳は適用順(恒久軽減→10上限→事後修正→手動→報酬点)に並べる(2026-07-16 裁定)
            const nameLabel = tr.coveringFor ? `${esc(tr.name)}（${esc(tr.coveringFor)}をカバー）` : esc(tr.name);
            row(area, nameLabel, String(tr.final), "cr-calc-row cr-total-row", "cr-total-num");
            const parts = [];
            // 新形式=算出時軽減の内訳(防御力・受け値・受けるダメージ軽減 AE を符号つきで格納・2026-07-17)。
            // 旧カード(内訳なし/旧形式)は合計のみの旧表示にフォールバック
            // その対象だけに効いたダメージ修正(対象ごと評価・2026-09-01)を軽減の前に出す
            if ((tr.ownBonusRows ?? []).length) line(area, "tnx-damage-sub", esc(formatOwnBonusRows(tr.ownBonusRows)));
            // ウェット無効(2026-09-01)は mitigationParts が「ウェット無効」を運ぶ(二重表示しない)
            if (tr.mitigationParts) parts.push(tr.mitigationParts);
            else if (tr.autoMitigation) parts.push(`防御力・受け値 −${tr.autoMitigation}`);
            if (tr.stunCapped) parts.push(`${stunLabel}（10上限）`);
            if (tr.defenderMod) parts.push(`ダメージ修正 ${signedDisplay("＋", tr.defenderMod)}`);
            if (tr.bounty) parts.push(`報酬点 −${tr.bounty}`);
            if (tr.manual) parts.push(`手動軽減 −${tr.manual}`);
            if (parts.length) line(area, "tnx-damage-sub", esc(parts.join("・")));
            line(area, `cr-result ${tr.final > 0 ? "cr-result--damage" : "cr-result--nodamage"}`,
                `<i class="fas ${tr.final > 0 ? "fa-burst" : "fa-shield-halved"}"></i> ${esc(tr.applyText ?? "")}`);
        }
        return;
    }

    // 対象ごとの最終ダメージ(2026-07-16 ユーザー確定): 防御力・受け値は「ダメージ算出」で適用済み＝各行に
    // 軽減後の最終ダメージを表示する。攻撃側合計はレジャーに残す(攻撃側の事後増強のため)。社会の報酬点軽減と
    // 手動の状況軽減だけ適用時のダイアログで入れる。
    for (const i of liveIdx) {
        const t = dmgTargets[i];
        // 対象ごとに見出し(名前)＝最終ダメージを1行・軽減の内訳は名前を繰り返さない小注記に畳む(はみ出し回避)。
        // 内訳は適用順(防御力・受け値→10上限→事後修正→報酬点)に並べる(2026-07-16 裁定=KI-024)
        const p = targetPlannedPreview(f, t);
        const nameLabel = t.coveringFor ? `${esc(t.name)}（${esc(t.coveringFor)}をカバー）` : esc(t.name);
        row(area, nameLabel, String(p.final), "cr-calc-row cr-total-row", "cr-total-num");
        // 防御(適用前に防ぐ)の発動点(17-2): 対象行の名前クリック。クリック待ちモード外は無視
        // (装飾クラスは攻撃側合計クリックと同じ)
        const nameEl = area.lastElementChild?.querySelector(".cr-calc-label");
        if (nameEl && !nameEl.classList.contains("tnx-recheck-target")) {
            nameEl.classList.add("tnx-recheck-target");
            nameEl.addEventListener("click", () => handleDamageProtectClick(message, i));
        }
        // 社会ダメージの報酬点による軽減(2026-07-17 ユーザー確定): リアクション判定が成立
        // (一般定義=ファンブル/スート不一致でなければ成立・勝敗不問)した対象は、適用前まで
        // 自分の最終ダメージの数字をクリックして報酬点で軽減できる(対象の所有者/RL のみ装飾)
        if (f.category === "social" && t.reactionEstablished === true) {
            const tActor = resolveSync(t.uuid);
            const num = area.lastElementChild?.querySelector(".cr-total-num");
            if (num && (game.user.isGM || tActor?.isOwner === true)) {
                num.classList.add("tnx-recheck-ready", "tnx-recheck-target");
                num.title = "クリックで報酬点による軽減";
                num.addEventListener("click", () => promptBountyMitigation(message, i));
            }
        }
        // その対象だけに効いた(効かなかった)ダメージ修正を、軽減の内訳とは別行で先に出す
        // (算出の順序＝修正→恒久軽減→10上限→事後修正→報酬点。2026-09-01)
        const own = perTargetBonusRows[i] ?? [];
        if (!p.wetNullified && own.length) line(area, "tnx-damage-sub", esc(formatOwnBonusRows(own)));
        const parts = [];
        if (p.wetNullified) parts.push("ウェット無効");
        if (p.defence) parts.push(`防御力 −${p.defence}`);
        if (p.parry) parts.push(`受け値 −${p.parry}`);
        // 受けるダメージ軽減 AE(恒久軽減・効果名で帰属)。負=軽減・正=増加を符号つきで示す
        for (const tr of (p.takenRows ?? [])) {
            if (tr.value) parts.push(`${tr.name} ${signedDisplay("＋", tr.value)}`);
        }
        if (p.capped) parts.push(`${stunLabel}（10上限）`);
        if (p.otherModsSum) parts.push(`修正 ${signedDisplay("＋", p.otherModsSum)}`);
        if (p.bountySum) parts.push(`報酬点 −${Math.abs(p.bountySum)}`);
        if (parts.length) line(area, "tnx-damage-sub", esc(parts.join("・")));
    }

    const attacker = resolveSync(f.attackerUuid);
    // 全対象が防がれたら(17-2)適用も追加も無い=状態領域は空のまま(理由の行は残さない。直前に神業カードが出ている)
    if (dmgTargets.length && !liveTargets.length) return;
    // RL 任意付与はカードを出さない(値の直接指定)ため、カードの追加は出さない
    if (!rlRow && (game.user.isGM || attacker?.isOwner)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.innerHTML = '<i class="fas fa-clone"></i> カードを追加で出す';
        btn.addEventListener("click", () => addDamageCard(message));
        area.appendChild(btn);
    }
    // ダメージ適用は1ボタン(複数対象一括・2026-07-15): 各自が算出後〜適用前の増強/軽減を切り終えたら、
    // RL(GM)か攻撃者が押して全対象へ一括適用する(アクセス=RL と攻撃者・ユーザー確定)。
    const canApply = game.user.isGM || attacker?.isOwner;
    if (!dmgTargets.length) {
        line(area, "cr-tn", "対象未選択（適用は手動で行ってください）");
    } else if (canApply) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.innerHTML = '<i class="fas fa-burst"></i> ダメージ適用';
        btn.addEventListener("click", () => openMitigationDialog(message));
        area.appendChild(btn);
        // 別のダメージとして適用(2026-07-16 ユーザー確定): 展開式で他系統のチャートへ適用する導線。
        // 軽減は元系統のまま行い、軽減後の値を選んだ系統のチャートへ流す(常に選べる=RL裁量)。
        const details = document.createElement("details");
        details.className = "tnx-damage-altapply";
        const summary = document.createElement("summary");
        summary.innerHTML = '<i class="fas fa-shuffle"></i> 別のダメージとして適用';
        details.appendChild(summary);
        for (const cat of ["physical", "mental", "social"]) {
            if (cat === f.category) continue;
            const alt = document.createElement("button");
            alt.type = "button";
            alt.className = "tnx-chat-btn";
            alt.innerHTML = `<i class="fas fa-burst"></i> 「${CATEGORY_LABELS[cat]}」ダメージとして適用`;
            alt.addEventListener("click", () => openMitigationDialog(message, cat));
            details.appendChild(alt);
        }
        area.appendChild(details);
    } else {
        line(area, "cr-tn", "（適用は対象の操作者または RL が行います）");
    }
}

/**
 * ダメージ・チャットカードの対象行クリック(防御「適用前に防ぐ」のクリック待ち中)の処理(17-2)。
 * 防御タイプの神業のアイテムロールで TnxCheckFlow のクリック待ち(kind=protect)に入り、ここで
 * 計画(defencePreventPlan=範囲×系統×クリック行)を立てて対象行に protectedBy を刻む。刻まれた行は
 * 描画・適用から消える。拒否(適用済み/系統外/防ぎ済み)はモードを維持したまま警告する(別のカードを
 * 選び直せる)。消費(用途の consumeTargets・待ち受け開始時に確定したプラン)は発動の確定時。
 * @param {ChatMessage} message ダメージ・チャットカードのメッセージ
 * @param {number} srcIndex クリックした対象行(f.targets の添字)
 */
export async function handleDamageProtectClick(message, srcIndex) {
    const state = TnxCheckFlow.peekAchievementAction("protect");
    if (!state) return; // モード外のクリックは無視(通常表示)
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f) return;
    const actor = game.actors.get(state.actorId);
    const skill = actor?.items.get(state.skillItemId);
    if (!skill) { TnxCheckFlow.cancelAchievementAction(); return; }
    const usage = (skill.system.actions ?? []).find(a => a._id === state.usageId) ?? null;
    const plan = defencePreventPlan(f, usage ?? {}, {
        rowIndex: srcIndex, by: { itemId: skill.id, name: skill.name, actorId: actor.id },
    });
    if (!plan.ok) {
        const msg = {
            applied:          "適用済みのダメージは防げません（受けてしまった後から防ぐことはできません）。",
            category:         `「${skill.name}」は${CATEGORY_LABELS[f.category] ?? ""}ダメージを防げません。`,
            noTargets:        "このダメージカードには対象がありません。",
            alreadyProtected: "この対象は既に防がれています。",
        }[plan.reason] ?? "防げません。";
        ui.notifications.warn(msg);
        return;
    }
    TnxCheckFlow.cancelAchievementAction();
    if (state.consumeUses?.length) await applyConsumptionPlan(state.consumeUses);
    const targets = foundry.utils.deepClone(f.targets ?? []);
    for (const i of plan.indices) targets[i] = { ...targets[i], protectedBy: plan.by };
    await applyDamagePatch(message, { targets });
}

/**
 * ダメージ・チャットカードの攻撃側合計クリック(ダメージクリック待ちモード中)の処理。
 * 用途「ダメージを修正」(modifyDamage)のアイテムロール使用で TnxCheckFlow のクリック待ちに入り、
 * ここで修正値(damageBonusSelf・式。空/評価不能なら手入力)をそのダメージへ適用する
 * (増加=正・軽減=負)。有効なのはダメージ算出後〜適用前(適用済みは警告)。
 * 修正の内訳はフラグ mods に積み、台帳へ「事後修正」行としてライブ描画される。
 * @param {ChatMessage} message ダメージ・チャットカードのメッセージ
 */
export async function handleDamageModifyClick(message) {
    const state = TnxCheckFlow.peekAchievementAction("modifyDamage");
    if (!state) return; // モード外のクリックは無視(通常表示)
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f) return;
    if (f.applied) {
        ui.notifications.warn("適用済みのダメージは修正できません。");
        return;
    }
    const actor = game.actors.get(state.actorId);
    const skill = actor?.items.get(state.skillItemId);
    if (!skill) { TnxCheckFlow.cancelAchievementAction(); return; }
    TnxCheckFlow.cancelAchievementAction();

    // 使用者が命中対象の一人(=防御側)なら、その対象の予定ダメージにだけ効かせる(per-target・2026-07-15
    // ユーザー確定)。攻撃側/GM 代行は共有の攻撃側合計(全対象の起点)に効かせる。発動方法(攻撃側合計
    // クリック)は不変。上書きの基準も対象ごと(その対象の攻撃側合計)にする。
    const targetIndex = (f.targets ?? []).findIndex(t => resolveSync(t.uuid)?.id === actor.id);
    // 上書きの基準=表示中の攻撃側合計(攻撃側の数字＝共有事後修正込み。10上限・軽減は対象ごとの
    // 算出に掛かるため基準には含めない)。防御側(命中対象)は**その対象のダメージ修正**
    // (2026-09-01・対象ごと評価)と自分の事後修正も基準に足す
    const ownRows = targetIndex >= 0 ? (f.targets[targetIndex].bonusRows ?? null) : null;
    const totals = damageRollTotals(f, ownRows ? { bonusRows: ownRows } : {});
    const baseTotal = targetIndex >= 0
        ? totals.attackerTotal + (f.targets[targetIndex].mods ?? []).reduce((s, m) => s + (Number(m.value) || 0), 0)
        : totals.attackerTotal;

    // 修正値: 用途のダメージ修正値(式・@item.self=親技能・@card/@diff/@achievement=命中判定由来)。
    // 空/評価不能/0 は手入力(軽減は負の値)
    const usage = (skill.system.actions ?? []).find(a => a._id === state.usageId) ?? null;
    const targetActor = await resolveTargetActor((f.targets ?? [])[targetIndex >= 0 ? targetIndex : 0]?.uuid);
    let mod = null;
    let modLabel = state.skillName;   // 対象条件で無効化されたときは理由を添える(下)
    const self = await evaluateSelfBonus(usage?.damageBonusSelf ?? "", actor,
        { diff: f.diff ?? null, achievement: f.achievement ?? null, cardValue: f.cardValue ?? null },
        targetActor, skill, usage?.damageBonusSelfCondition ?? null);
    if (self) {
        mod = self.value;
        // 対象条件で無効化された場合(value=0)は理由を帰属名に添えて台帳へ残す
        if (self.note) modLabel = `${state.skillName}・${self.note}`;
    }
    let overrideTo;
    if (mod === null) {
        // 手入力は「上書き」チェック可=入力値をそのまま新しい攻撃側合計にする(2026-07-14)
        const { AmountInputDialog } = await import("./tnx-dialog.mjs");
        const input = await AmountInputDialog.prompt({
            title: `ダメージの修正: ${skill.name}`,
            label: "ダメージへの修正値（軽減は負の値）",
            initialValue: 0, min: -99, max: 99, okLabel: "適用",
            allowOverride: true, overrideLabel: "上書き（入力値をそのまま新しい攻撃側合計にする）",
        });
        if (!input || !Number.isFinite(input.value)) return;
        if (input.override) { overrideTo = input.value; mod = input.value - baseTotal; }
        else mod = input.value;
        if (mod === 0 && overrideTo === undefined) return;
    }

    // 消費(用途の consumeTargets・クリック待ち開始時に確定したプラン)は適用の確定時
    if (state.consumeUses?.length) await applyConsumptionPlan(state.consumeUses);

    const modRow = { label: modLabel, value: mod, ...(overrideTo !== undefined ? { overrideTo } : {}) };
    if (targetIndex >= 0) {
        // 防御側=その対象の mods に積む(対象ごと)
        const targets = foundry.utils.deepClone(f.targets ?? []);
        targets[targetIndex].mods = [...(targets[targetIndex].mods ?? []), modRow];
        await applyDamagePatch(message, { targets });
    } else {
        // 攻撃側/GM=共有の攻撃側合計に積む(全対象の起点)
        await applyDamagePatch(message, { mods: [...(f.mods ?? []), modRow] });
    }
}

/**
 * 社会ダメージの報酬点による軽減(2026-07-17 ユーザー確定)。
 * - 起動条件: その対象の**リアクション判定が成立**していること(一般定義=ファンブル/スート不一致で
 *   なければ成立・勝敗不問・Check_Rules「判定の成立」)。「リアクションしない」(制御値受け)は不可。
 * - タイミング: ダメージ軽減技能(modifyDamage=事後修正)と同じ**算出後〜適用前**。導線は
 *   ダメージカードの**その対象行の数字クリック**(対象の所有者/RL)。適用ダイアログの報酬点欄は撤去。
 * - 消費: 所持報酬点(bountyBase+bounty)を上限に、宣言時に **system.bounty から実減算**する。
 *   報酬点使用不可(口座凍結/信用失墜)は消費時点でゲート(判定の報酬点と同じ規約)。
 * - 着地: その対象の t.mods(per-target 事後修正)へ「報酬点による軽減 −N」行(bounty マーカー=
 *   内訳で「報酬点 −N」に分離表示)。フラグ更新は applyDamagePatch(非作者は GM 委譲)。
 * @param {ChatMessage} message ダメージ・チャットカード
 * @param {number} targetIndex f.targets のインデックス
 */
async function promptBountyMitigation(message, targetIndex) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f) return;
    if (f.applied) { ui.notifications.warn("適用済みのダメージは軽減できません。"); return; }
    if ((f.category || "physical") !== "social") return;
    const t = (f.targets ?? [])[targetIndex];
    if (!t || t.reactionEstablished !== true) return;
    const actor = await resolveTargetActor(t.uuid);
    if (!actor) return;
    if (!(game.user.isGM || actor.isOwner)) {
        ui.notifications.warn(`報酬点による軽減は「${actor.name}」の操作者（または RL）が行います。`);
        return;
    }
    // 報酬点使用不可(口座凍結/信用失墜)は消費時点の状態でゲート(無視ゲート済みの行は数えない)
    if (hasBountyBlock(getEffectiveConditions(actor).filter(c => !c.effectIgnored))) {
        ui.notifications.warn(`「${actor.name}」は報酬点を使用できない状態です。`);
        return;
    }
    const available = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);
    if (available <= 0) {
        ui.notifications.warn(`「${actor.name}」に使用できる報酬点がありません。`);
        return;
    }
    const { AmountInputDialog } = await import("./tnx-dialog.mjs");
    // allowOverride なしの prompt は数値をそのまま返す(キャンセル=null)
    const input = await AmountInputDialog.prompt({
        title: `報酬点による軽減: ${actor.name}`,
        label: `使用する報酬点（0〜${available}・1点 = 軽減 1）`,
        initialValue: 0, min: 0, max: available, okLabel: "軽減",
    });
    if (input === null) return;
    const amount = Math.max(0, Math.min(Number(input) || 0, available));
    if (!amount) return;
    // 実減算(有効報酬点 = bountyBase + bounty。増減は bounty 側に載せる=シートの±ボタンと同じ着地)
    await actor.update({ "system.bounty": (actor.system.bounty ?? 0) - amount });
    const targets = foundry.utils.deepClone(f.targets ?? []);
    if (!targets[targetIndex]) return;
    targets[targetIndex].mods = [...(targets[targetIndex].mods ?? []),
        { label: "報酬点による軽減", value: -amount, bounty: true }];
    await applyDamagePatch(message, { targets });
}

/**
 * GMメニュー「ダメージを修正(手動)」(2026-07-14 ユーザー確定): 手入力の修正値を mods 行(手動修正)
 * として合算する(用途経由の modifyDamage と同じ着地・消費なし)。達成値の手動修正と同じく
 * 卓の最終裁定ツールのため適用済みでも制限しない(2026-07-14 ユーザー確定・適用済みの実ダメージは
 * 巻き戻さない=台帳の記録訂正。用途経由の modifyDamage は従来どおり適用前まで)。
 */
export async function manualEditDamage(message) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f) return;
    // 手動修正も mods(事後修正)に積むため、基準は表示中の攻撃側合計(共有事後修正込みの攻撃側の数字。
    // 対象ごとのダメージ修正は含まない＝台帳の「攻撃側合計」と同じ数字・2026-09-01)
    const current = damageRollTotals(f, { bonusRows: bonusRowsSplit(f).shared }).attackerTotal;
    const { AmountInputDialog } = await import("./tnx-dialog.mjs");
    const input = await AmountInputDialog.prompt({
        title: `ダメージを修正（攻撃側合計 ${current}）`,
        label: "ダメージへの修正値（軽減は負の値）",
        initialValue: 0, min: -99, max: 99, okLabel: "適用",
        allowOverride: true, overrideLabel: "上書き（入力値をそのまま新しい攻撃側合計にする）",
    });
    if (!input || !Number.isFinite(input.value)) return;
    const overrideTo = input.override ? input.value : undefined;
    const mod = input.override ? input.value - current : input.value;
    if (mod === 0 && overrideTo === undefined) return;
    await applyDamagePatch(message, { mods: [...(f.mods ?? []),
        { label: "手動修正", value: mod, ...(overrideTo !== undefined ? { overrideTo } : {}) }] });
}

/**
 * 対象行の下に出す「その対象だけのダメージ修正」の注記文字列(2026-09-01)。
 * 軽減の内訳(「防御力 −2・受け値 −1」)と同じ体裁＝名前＋符号つきの値を「・」で連ねる。
 * 対象条件で無効化された行は名前に理由を添えて 0 のまま残す。
 * @param {Array<{name?:string, value?:number, note?:string}>} rows
 * @returns {string}
 */
function formatOwnBonusRows(rows) {
    return `ダメージ修正: ${rows
        .map(b => `${b.name || "用途"}${b.note ? `・${b.note}` : ""} ${signedDisplay("＋", b.value)}`)
        .join("・")}`;
}

/**
 * ダメージカードの「共有台帳に出す修正行」と「対象ごとの残り」を求める(2026-09-01)。
 * ダメージ修正は対象ごとに評価されるため、全対象で同じ行だけを共有台帳の合計に含める
 * (＝台帳の「攻撃側合計」は対象に依らない数字。対象固有の分は各対象の行に出る)。
 * 対象なし・旧カード(bonusRows を持たない)は `f.damageBonuses` をそのまま共有行とする。
 * @param {object} f damageRoll フラグ
 * @returns {{shared:Array<object>, extras:Array<Array<object>>}}
 */
function bonusRowsSplit(f) {
    const targets = f.targets ?? [];
    if (!targets.length) return { shared: f.damageBonuses ?? [], extras: [] };
    return splitSharedBonusRows(targets.map(t => t.bonusRows ?? f.damageBonuses ?? []));
}

/** 攻撃対象(命中確定済み)のアクターを解決する。トークンドキュメントならアクターへ。 */
async function resolveTargetActor(targetUuid) {
    if (!targetUuid) return null;
    const resolved = await fromUuid(targetUuid).catch(() => null);
    return resolved?.actor ?? resolved ?? null;
}

/**
 * 攻撃対象のスタイル/ワークスに応じた AE ダメージバフ(`damage.vsStyle.*` / `damage.vsWorks.*`)を
 * 集計する。攻撃対象が持つスタイル(`type:"style"` アイテムの識別キー)・ワークス(ワークス技能の
 * 組織)で照合し、供給元(効果名)別のフラット寄与を返す。判定バフのダメージ・対象参照版。
 * `damage.vsWet[.系統]` / `damage.vsNotWet[.系統]`(2026-09-01)は対象のウェット状態で照合する。
 * @param {Actor} attacker
 * @param {Actor|null} target  解決済みの攻撃対象アクター
 * @param {"physical"|"mental"|"social"} [category] 攻撃の系統(wet 系の系統セレクタ用)
 * @returns {Array<{name:string, value:number}>}
 */
function collectDamageVsBonuses(attacker, target, category) {
    if (!attacker || !target?.items) return [];
    const { styles, works } = targetStyleWorksKeys(target);
    // wet 系(vsWet/vsNotWet・2026-09-01)は対象がウェットか否か+攻撃の系統で照合する
    return gatherDamageVsSources(collectActorEffectBuffs(attacker), {
        styles, works, isWet: isWetActor(target), category: category || "physical",
    });
}

/**
 * 受けるダメージ軽減 AE(`damage.taken[.<系統|種別>]`・`damage.fromStyle/fromWorks.*`・2026-07-17)を
 * **受け手(対象)の effects** から集計する。値=受けるダメージへの加算(負=軽減・正=増加)で、
 * 恒久軽減の成分としてダメージ算出時(スタン/説得の10上限の**前**)に効く(2026-07-16 裁定の順序)。
 * 攻撃者条件(from*)は攻撃者のスタイル/ワークスで照合(vsStyle/vsWorks の対称)。対象ごとに
 * 評価するため、攻撃側 vs* のような先頭対象近似は生じない。
 * @param {Actor|null} defender ダメージを受ける側
 * @param {object} f damageRoll フラグ(category / damageType / attackerUuid を参照)
 * @returns {Array<{name:string, value:number}>}
 */
function collectDamageTakenRows(defender, f) {
    if (!defender) return [];
    const attacker = resolveSync(f.attackerUuid);
    const { styles, works } = attacker ? targetStyleWorksKeys(attacker) : { styles: [], works: [] };
    return gatherDamageTakenSources(collectActorEffectBuffs(defender), {
        category: f.category || "physical",
        damageType: f.damageType || "",
        attackerStyles: styles,
        attackerWorks: works,
    });
}

/**
 * 攻撃カードの命中対象からダメージカードの対象行を組み立てる。カバー(coveredBy)が付いた元対象は
 * 被弾しないのでダメージカードに載せず、**カバーした側の行だけ**作る(uuid=カバー側・受け値なし・
 * coveringFor で誰をカバーしたか)。カバーした側が元々命中対象なら、その自分の行(受け値あり)は別に残る。
 * reactionEstablished=その対象のリアクション判定の成立(一般定義・勝敗不問)。社会ダメージの
 * 報酬点軽減の起動条件(2026-07-17)。カバーした側は自分ではリアクションしていないため受け値と同様に不成立扱い。
 * @param {Array<{uuid:string,name:string,parryGuard?:number,reactionEstablished?:boolean,coveredBy?:{uuid:string,name:string}}>} hitTargets
 */
function buildDamageTargets(hitTargets) {
    const out = [];
    for (const t of (hitTargets ?? [])) {
        if (t.coveredBy) {
            out.push({ uuid: t.coveredBy.uuid, name: t.coveredBy.name, parryGuard: 0, reactionEstablished: false, coveringFor: t.name });
        } else {
            out.push({ uuid: t.uuid, name: t.name, parryGuard: Number(t.parryGuard) || 0, reactionEstablished: t.reactionEstablished === true });
        }
    }
    return out;
}

/**
 * ダメージの合計(Damage_Rules「算出の適用順序」1〜6・2026-07-16 裁定=KI-024)。
 * 攻撃側の加算(カード合算+攻撃力+用途のダメージ修正(FA 値含む)+手動修正)→恒久軽減(防御力・受け値=
 * permanentMitigation・対象ごと)→スタン/説得の10上限(算出の一番最後)→事後修正(mods=modifyDamage・
 * 算出後〜適用前=キャップ後に乗る)→適用時の軽減(applyMitigation=手動・社会報酬点)。
 * extraPostMods は対象ごとの防御側事後修正(t.mods)を共有の事後修正と同じ段に合流させる。
 * bonusRows はその対象のダメージ修正行(2026-09-01・対象ごと評価)。省略時は対象なし用の
 * `f.damageBonuses`(旧カードもここに全行を持つため互換で動く)。
 * @returns {{cardSum:number, modsSum:number, attackerTotal:number, raw:number, calc:number,
 *   attack:number, final:number, stage:number, capped:boolean}}
 *   attackerTotal=攻撃側の数字(raw+共有事後修正。上限・軽減に依存しない)
 */
function damageRollTotals(f, { bonusRows = null, permanentMitigation = 0, extraPostMods = 0, applyMitigation = 0 } = {}) {
    const cardSum = (f.cards ?? []).reduce((s, c) => s + (Number(c.value) || 0), 0);
    const bonusSum = (bonusRows ?? f.damageBonuses ?? []).reduce((s, b) => s + (Number(b.value) || 0), 0);
    const modsSum = (f.mods ?? []).reduce((s, m) => s + (Number(m.value) || 0), 0);
    const r = computeDamage({
        damageCard: cardSum,
        attackPower: Number(f.attackPower) || 0,
        // RL 任意付与(2026-07-20)は判定を経由しないため、カードでも攻撃力でもない素の値として乗る
        modifier: bonusSum + (Number(f.manualMod) || 0) + rlGrantAmount(f),
        mitigation: permanentMitigation,
        postModifier: modsSum + extraPostMods,
        applyMitigation,
        stun: f.stun === true,
    });
    return { cardSum, modsSum, attackerTotal: r.raw + modsSum, ...r };
}

/**
 * 対象ごとの適用予定ダメージ(2026-07-15): 共有の攻撃側合計に、その対象の恒久軽減(物理=防御力・
 * パリー受け値=算出の内)→スタン/説得の10上限→防御側 modifyDamage(事後修正)を反映した適用前の
 * 見込み値。手動軽減はダイアログで最終調整するためここには含めない。防御側の軽減が他対象へ
 * 波及しないよう、mods はその対象の値にだけ乗せる。
 * @param {object} f damageRoll フラグ
 * @param {object} t f.targets の要素
 */
function targetPlannedPreview(f, t) {
    const modsSum = (t.mods ?? []).reduce((s, m) => s + (Number(m.value) || 0), 0);
    // 報酬点による軽減(bounty マーカー行・2026-07-17)は同じ事後修正の段だが、内訳表示では
    // 「報酬点 −N」として技能等の「修正」と分けて示す
    const bountySum = (t.mods ?? []).filter(m => m.bounty === true)
        .reduce((s, m) => s + (Number(m.value) || 0), 0);
    const category = f.category || "physical";
    const actor = resolveSync(t.uuid);
    // この対象のダメージ修正(2026-09-01・対象ごと評価)。旧カードは共有行にフォールバック
    const bonusRows = t.bonusRows ?? f.damageBonuses ?? [];
    // 「ウェットの対象には効果がない」(用途 noEffectVsWet・2026-09-01 承認): この対象への
    // ダメージ算出全体を 0 にする(軽減・上限も通らない)。内訳は「ウェット無効」の注記一本
    if (wetNullified(f, actor)) {
        return { final: 0, auto: 0, defence: 0, parry: 0, takenRows: [], modsSum: 0,
            bountySum: 0, otherModsSum: 0, capped: false, wetNullified: true, bonusRows: [] };
    }
    // 防御力・受け値は「ダメージ算出」の一部＝各キャラの最終ダメージに含めて表示する(2026-07-16 ユーザー確定)
    let defence = 0;
    if (actor && category === "physical") {
        const dv = defenceForType(aggregateDefence(actor.items.contents ?? []), f.damageType);
        if (dv) defence = dv;
    }
    const parry = Number(t.parryGuard) || 0;
    // 受けるダメージ軽減 AE(taken・負=軽減)は恒久軽減の成分=防御力・受け値と同じ算出時に効く。
    // 符号を反転して軽減合計へ合流(正値=増加は軽減を目減りさせる)
    const takenRows = actor ? collectDamageTakenRows(actor, f) : [];
    const takenSum = takenRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
    const auto = defence + parry - takenSum;
    const { final, capped } = damageRollTotals(f, { bonusRows, permanentMitigation: auto, extraPostMods: modsSum });
    return { final, auto, defence, parry, takenRows, modsSum, bountySum, otherModsSum: modsSum - bountySum, capped, bonusRows };
}

function resolveSync(uuid) {
    if (!uuid) return null;
    try { return fromUuidSync(uuid); } catch { return null; }
}

/**
 * 「ウェットの対象には効果がない」(用途 noEffectVsWet・2026-09-01 承認)がこの対象に効くか。
 * 効く場合、その対象の最終ダメージは対象ごとに 0(判定・対決自体はブロックしない一般規範のまま)。
 * @param {object|null} f damageRoll フラグ
 * @param {Document|null} doc 対象(TokenDocument または Actor)
 * @returns {boolean}
 */
function wetNullified(f, doc) {
    if (f?.noEffectVsWet !== true) return false;
    const actor = doc?.actor ?? doc;
    return isWetActor(actor);
}

// ─── カードの追加(複数枚=合算・攻撃側) ─────────────────────────────────────────

/**
 * ダメージカードを追加で出す(適用前まで・出すたび台帳と合計がライブ更新)。
 * 初回と同じ待ち受け方式: 手札は HUD クリック・山札はダイアログのボタン。
 */
async function addDamageCard(message) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f || f.applied) return;

    await cancelPending();
    const ctx = { kind: "add", message, dialog: null, done: false };
    _pending = ctx;

    const chosen = await foundry.applications.api.DialogV2.wait({
        window: { title: "カードを追加で出す" },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-dialog"],
        position: { width: 360 },
        content: `<p class="tnx-damage-note">手札のカードを直接クリックするか、山札からめくってください（複数枚は合算されます）。</p>`,
        buttons: [
            { action: "deck", icon: "fas fa-clone", label: "山札から1枚めくる", default: true, callback: () => "deck" },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        render: (_event, dialog) => { ctx.dialog = dialog; },
        close: () => null,
    });
    if (_pending === ctx) _pending = null;
    if (ctx.done) return;         // HUD の手札クリックで確定済み
    if (chosen !== "deck") return;
    const played = await playDamageCardFromDeck();
    if (!played) return;
    await appendDamageCard(message, played);
}

/** 出したカードをダメージ・カードの台帳に追記する(合算・ライブ更新)。 */
async function appendDamageCard(message, played) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f || f.applied) return;
    await applyDamagePatch(message, { cards: [...(f.cards ?? []), played] });
}

// ─── 適用(防御側の軽減ダイアログ→型分岐適用) ─────────────────────────────────────

/**
 * ダメージ適用を開始する(複数対象一括・2026-07-15)。命中対象を1ダイアログにまとめ、対象ごとの
 * 軽減欄(防御力+パリー受け値自動・手動の状況軽減)で確定し、全対象へ適用する。
 * 社会の報酬点軽減は本ダイアログでなく対象行クリック(promptBountyMitigation・2026-07-17)。
 * GM か命中対象のいずれかの操作者が押せる。
 *
 * **別のダメージとして適用(2026-07-16 ユーザー確定)**: applyCategory を渡すと、軽減は元の系統
 * (f.category)のまま行い(防具軽減など全部)、その**軽減後の最終値を applyCategory のチャートへ**
 * 適用する(値は再計算せずそのまま保持。系統のみ差し替え=参照チャートが変わる)。null=元系統どおり。
 * @param {ChatMessage} message
 * @param {"physical"|"mental"|"social"|null} [applyCategory] 差し替え先の系統(チャート)
 */
async function openMitigationDialog(message, applyCategory = null) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f || f.applied) return;

    // 命中対象を解決(カバーされた元対象は buildDamageTargets で載っていない=カバーした側の行だけ)。
    // srcIndex=フラグ上の対象インデックス(解決できない対象があっても内訳の対応がずれないように持つ)
    const resolvedTargets = [];
    for (const [srcIndex, t] of (f.targets ?? []).entries()) {
        if (t.protectedBy) continue; // 防がれた対象(17-2)は適用しない
        const actor = await fromUuid(t.uuid).catch(() => null);
        // t.mods=その対象の防御側 modifyDamage(per-target・2026-07-15)。攻撃側合計へ対象ごとに反映する。
        // t.bonusRows=その対象のダメージ修正(2026-09-01・対象ごと評価。旧カードは共有行へフォールバック)
        if (actor) resolvedTargets.push({ actor, name: t.name, parryGuard: Number(t.parryGuard) || 0, mods: t.mods ?? [],
            coveringFor: t.coveringFor ?? null, bonusRows: t.bonusRows ?? f.damageBonuses ?? [], srcIndex });
    }
    if (!resolvedTargets.length) { ui.notifications.warn("対象が見つかりません。"); return; }
    if (!(game.user.isGM || resolvedTargets.some(r => r.actor.isOwner))) {
        ui.notifications.warn("ダメージ適用は対象の操作者（または RL）が行います。");
        return;
    }

    // 軽減・値の算出は元の系統(category)で行う。参照するチャート(applyCat)だけ差し替え可
    const category = f.category || "physical";
    const applyCat = applyCategory || category;
    const isAltApply = applyCat !== category;
    // ダイアログ見出しの攻撃側合計は共有部分(対象ごとのダメージ修正は各行のプレビューに出る)
    const { attackerTotal } = damageRollTotals(f, { bonusRows: bonusRowsSplit(f).shared });
    const stun = f.stun === true;                                    // 攻撃宣言で確定済み(再確認しない)
    const stunLabel = category === "mental" ? "説得" : "スタン";
    const esc = foundry.utils.escapeHTML;

    // 対象ごとの自動軽減(物理=種別対応の防御力・X は軽減なし＋パリー受け値＋受けるダメージ軽減 AE)を算出。
    // 対象ごとのダメージ修正のうち「その対象だけの分」は適用済み表示に残すため取り分けておく
    const { extras: ownRowsByTarget } = bonusRowsSplit(f);
    const rows = resolvedTargets.map((r, i) => {
        let auto = 0; const parts = [];
        const ownBonusRows = ownRowsByTarget[r.srcIndex] ?? [];
        // ウェット無効(noEffectVsWet・2026-09-01): この対象は算出全体が 0=軽減の内訳も出さない
        if (wetNullified(f, r.actor)) {
            return { ...r, index: i, autoMitigation: 0, mitigationParts: ["ウェット無効"], modsSum: 0,
                wetNullified: true, ownBonusRows: [] };
        }
        if (category === "physical") {
            const dv = defenceForType(aggregateDefence(r.actor.items.contents ?? []), f.damageType);
            if (dv) { auto += dv; parts.push(`防御力(${f.damageType || "?"}) −${dv}`); }
        }
        if (r.parryGuard) { auto += r.parryGuard; parts.push(`パリー受け値 −${r.parryGuard}`); }
        // 受けるダメージ軽減 AE(恒久軽減・2026-07-17)。値=受けるダメージへの加算(負=軽減)なので
        // 符号を反転して軽減合計へ合流。内訳は効果名で帰属(符号つき)
        for (const tr of collectDamageTakenRows(r.actor, f)) {
            if (!tr.value) continue;
            auto -= tr.value;
            parts.push(`${tr.name} ${signedDisplay("＋", tr.value)}`);
        }
        // その対象の防御側 modifyDamage(事後修正)。共有の攻撃側合計と同じ段=10上限の後に乗せる。負=軽減
        const modsSum = (r.mods ?? []).reduce((s, m) => s + (Number(m.value) || 0), 0);
        return { ...r, index: i, autoMitigation: auto, mitigationParts: parts, modsSum, ownBonusRows };
    });

    // 複数対象の適用をまとめた1ダイアログ。防御力・受け値は算出で適用済み(固定表示)。ここで入れるのは
    // 手動の状況軽減だけ(2026-07-16 ユーザー確定=ダイアログ縮小。社会の報酬点軽減は 2026-07-17 に
    // リアクション成立時の対象行クリック=算出後〜適用前の事後修正へ移動し、この欄は撤去)。
    const rowsHtml = rows.map(r => `
        <div class="tnx-damage-target-row" data-index="${r.index}">
            <div class="tnx-damage-target-name">${esc(r.name)}${r.coveringFor ? `（${esc(r.coveringFor)}をカバー）` : ""}</div>
            ${r.ownBonusRows.length ? `<div class="tnx-damage-fixed">${esc(formatOwnBonusRows(r.ownBonusRows))}</div>` : ""}
            <div class="tnx-damage-fixed">軽減（算出済み）: <b>${signedDisplay("−", r.autoMitigation)}</b>${r.mitigationParts.length ? `（${esc(r.mitigationParts.join("・"))}）` : ""}</div>
            <div class="form-group">
                <label>手動の状況軽減</label>
                <div class="number-input-spinner">
                    <button type="button" class="tnx-btn" data-action="decrement" aria-label="Decrease">-</button>
                    <input type="number" name="manual-${r.index}" value="0" min="-99" max="99">
                    <button type="button" class="tnx-btn" data-action="increment" aria-label="Increase">+</button>
                </div>
            </div>
            <div class="tnx-damage-preview"><span class="tnx-damage-preview-label">最終ダメージ</span><span class="tnx-damage-preview-note" data-note="${r.index}"></span><span class="tnx-damage-preview-final" data-final="${r.index}">–</span></div>
        </div>`).join("");
    // 別のダメージとして適用: 元系統で軽減し、軽減後の値を applyCat のチャートへ流す旨を明示
    const altNote = isAltApply
        ? `<p class="tnx-damage-altnote"><i class="fas fa-shuffle"></i> 「${CATEGORY_LABELS[category] ?? category}」で軽減し、軽減後の値を「${CATEGORY_LABELS[applyCat] ?? applyCat}」ダメージチャートへ適用します。</p>`
        : "";
    const content = `<div class="tnx-damage-form">
        <p class="tnx-damage-summary">${CATEGORY_LABELS[category] ?? category}ダメージ（攻撃側合計 <b>${attackerTotal}</b>${stun ? `・${stunLabel}宣言（10上限）` : ""}）を <b>${rows.length}</b> 体へ</p>
        ${altNote}
        ${rowsHtml}
    </div>`;

    const readRow = (root, i) => ({
        manual: Number(root.querySelector(`[name="manual-${i}"]`)?.value) || 0,
    });
    const updatePreview = (root) => {
        for (const r of rows) {
            const v = readRow(root, r.index);
            // 防御力・受け値(autoMitigation)=恒久軽減(算出の内・10上限の前)。手動軽減は
            // 適用時の軽減(10上限・事後修正より後)=applyMitigation(2026-07-16 裁定=KI-024)。
            // ウェット無効の対象は常に 0(stage=min(final,21) の規約どおり 0)
            const { final, stage } = r.wetNullified ? { final: 0, stage: 0 } : damageRollTotals(f, {
                bonusRows: r.bonusRows,
                permanentMitigation: r.autoMitigation,
                extraPostMods: r.modsSum,
                applyMitigation: v.manual,
            });
            const fin  = root.querySelector(`[data-final="${r.index}"]`);
            const note = root.querySelector(`[data-note="${r.index}"]`);
            if (fin)  fin.textContent = String(final);
            if (note) note.textContent = describeDamagePreview(r.actor, applyCat, final, stage);
        }
    };

    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `ダメージ適用: ${rows.length}体` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-dialog"],
        position: { width: 460 },
        content,
        actions: spinnerDialogActions, // ± ボタン(number-input-spinner)。step 後に input 発火→ライブプレビュー更新
        buttons: [
            { action: "apply", icon: "fas fa-burst", label: "ダメージ適用（全対象）", default: true,
              callback: (_e, _b, dialog) => rows.map(r => readRow(dialog.element, r.index)) },
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

    // 適用効果はここでは付与しない(2026-07-18 ユーザー確定=ダメージ時効果もカードの
    // 「効果を適用」ボタンで手動適用。「1点でも」等の条件はコード化せず卓判断に委ねる)

    // 全対象へ適用(対象ごとに恒久軽減→10上限→事後修正→適用時軽減→最終→チャート・2026-07-16 裁定)
    const appliedTargets = [];
    for (const r of rows) {
        const v = result[r.index] ?? { manual: 0 };
        // 防御力・受け値(autoMitigation)=恒久軽減(算出の内・10上限の前)。手動軽減は適用時の軽減
        // (applyMitigation)。r.modsSum=その対象の防御側事後修正(per-target・キャップ後。
        // 報酬点による軽減=bounty マーカー行もこの段=対象行クリックで宣言済みの値・2026-07-17)。
        // ウェット無効の対象は算出全体が 0(2026-09-01 承認)
        const { final, stage, capped } = r.wetNullified
            ? { final: 0, stage: 0, capped: false }
            : damageRollTotals(f, {
                bonusRows: r.bonusRows,
                permanentMitigation: r.autoMitigation,
                extraPostMods: r.modsSum,
                applyMitigation: v.manual,
            });
        // 説得(精神攻撃のスタン宣言)は、チャートの効果タグ(戦闘不能)を付けず BS のみ付与する。
        // 別系統として適用する場合は説得の意味論が対応しないため付けない(元系統=精神の通常適用時のみ)
        const applyText = await applyDamageToTarget(r.actor, applyCat, final, stage,
            { persuade: stun && category === "mental" && applyCat === "mental" });
        // 報酬点による軽減(bounty マーカー行)は適用済み表示で「報酬点 −N」に分離する(正の数で記録)
        const bountySum = (r.mods ?? []).filter(m => m.bounty === true)
            .reduce((s, m) => s + (Number(m.value) || 0), 0);
        appliedTargets.push({
            name: r.name,
            coveringFor: r.coveringFor ?? null,
            autoMitigation: r.autoMitigation,
            mitigationParts: r.mitigationParts.join("・"),
            manual: v.manual,
            // 防御側 modifyDamage の合計(報酬点行を除く・あれば適用済み表示に出す)
            defenderMod: (r.modsSum - bountySum) || 0,
            // スタン/説得の10上限がこの対象で効いたか(適用済み表示の内訳用・2026-07-16 裁定)
            stunCapped: capped,
            // ウェット無効(2026-09-01): 適用済み表示の内訳用
            wetNullified: r.wetNullified === true,
            // その対象だけに効いたダメージ修正(対象ごと評価・2026-09-01)。適用済み表示にも残す
            ownBonusRows: r.ownBonusRows ?? [],
            bounty: Math.abs(bountySum), final, stage, applyText,
        });
    }

    await applyDamagePatch(message, {
        applied: true,
        appliedResult: { targets: appliedTargets, ...(isAltApply ? { applyCategory: applyCat } : {}) },
    });
}

// ─── フラグ更新(権限がなければ GM へソケット委譲=applyMessagePatch に一本化・2026-07-16) ──

/** ダメージ・カードのフラグを更新する(全クライアントでライブ書き換え)。 */
export async function applyDamagePatch(message, patch) {
    await TnxSocketHandler.applyMessagePatch(message, patch, "damageRoll");
}

// ─── 共通ヘルパー ───────────────────────────────────────────────────────────────

/** 符号つきの数値表示(負値は符号を反転して絶対値で示す)。 */
function signedDisplay(sign, n) {
    const flip = sign === "＋" ? "−" : "＋";
    return n < 0 ? `${flip}${Math.abs(n)}` : `${sign}${n}`;
}

/** 適用先の型に応じたプレビュー文(負傷名／heads 減算／消滅／適用不可)。 */
function describeDamagePreview(target, category, final, stage) {
    if (!target) return "";
    if (target.type === "extra") return "エキストラ: 適用不可（宣言死）";
    if (target.type === "troop") {
        if (target.system.troopMode === "bunshin") return final > 0 ? "分身: 消滅" : "分身: 消滅せず";
        const label = target.system.troopMode === "enigma" ? "エニグマポイント" : "人数";
        return `${label} −${final}`;
    }
    if (final <= 0) return "負傷なし";
    const kind = getDamageChartKind(category, stage);
    const wound = kind ? CONDITION_KINDS[kind]?.label : "";
    return wound ? `「${wound}」` : "";
}

/**
 * 対象へダメージを適用する(型分岐・12-4)。適用内容の説明文を返す。
 * @returns {Promise<string>}
 */
export async function applyDamageToTarget(target, category, final, stage, { persuade = false } = {}) {
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
    await applyDamageChartResult(target, category, final, { persuade });
    const kind = getDamageChartKind(category, stage);
    const woundLabel = kind ? CONDITION_KINDS[kind]?.label : "";

    // 派生ダメージ(社会9→精神・社会19→肉体 等): チャート効果が別ダメージを発生させる場合、
    // その派生は軽減不可・直接ダメージ扱い(Damage_Rules 2026-07-09)。同じ対象へ続けて適用する
    const derived = kind ? CONDITION_KINDS[kind]?.derivedDamage : null;
    let derivedText = "";
    if (derived && (target.type === "cast" || target.type === "guest")) {
        derivedText = await applyDerivedDamage(target, derived);
    }
    return `${CATEGORY_LABELS[category] ?? category}ダメージチャート${woundLabel ? `「${woundLabel}」` : ""}を適用${derivedText}`;
}

/**
 * 派生ダメージを適用する(軽減不可・直接ダメージ扱い)。山札から cards 枚めくって合算し、
 * 指定系統のチャートを同じ対象へ適用する(軽減ダイアログを挟まない)。
 * @param {Actor} target
 * @param {{category:"physical"|"mental"|"social", cards:number}} derived
 * @returns {Promise<string>} 追記用の説明文
 */
async function applyDerivedDamage(target, derived) {
    const n = Math.max(1, Number(derived.cards) || 1);
    let total = 0;
    const drawn = [];
    for (let i = 0; i < n; i++) {
        const card = await TnxActionHandler.flipFromDeck();
        if (!card) break;
        const v = await resolveDamageCardValue(card);
        if (v === null) continue;
        total += v;
        drawn.push(`${card.name}=${v}`);
    }
    const stage = Math.min(total, 21);
    // 軽減を挟まず直接チャート適用(applyDamageToTarget を再帰・型分岐/更なる派生も自然に連鎖)
    const applyText = await applyDamageToTarget(target, derived.category, total, stage);
    const label = CATEGORY_LABELS[derived.category] ?? derived.category;
    const esc = foundry.utils.escapeHTML;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: target }),
        content: `<div class="tnx-check-result tnx-damage-card tokyo-nova">
            <div class="cr-head"><span class="cr-skill-name">派生ダメージ</span><span class="cr-type-tag">${label}・軽減不可</span></div>
            <div class="cr-calc-section">
                ${drawn.length ? `<div class="cr-calc-row"><span class="cr-calc-label">めくったカード</span><span class="cr-calc-val">${esc(drawn.join("・"))}</span></div>` : ""}
                <div class="cr-calc-row cr-total-row"><span class="cr-calc-label">ダメージ</span><span class="cr-total-num">${total}</span></div>
            </div>
            <div class="cr-result cr-result--damage"><i class="fas fa-burst"></i> ${esc(applyText)}</div>
        </div>`,
    });
    return `／派生: ${label}ダメージ ${total}`;
}
