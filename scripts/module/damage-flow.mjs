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
 * - 適用時は**防御側に軽減ダイアログ**(防御力+パリー受け値自動・社会の報酬点軽減・手動欄)を
 *   出して確定 → 型分岐適用(cast/guest=チャート・troop=heads
 *   減算・分身=消滅通知・extra=不可警告)。適用者は対象の所有者のため効果付与の権限委譲は
 *   不要。メッセージのフラグ更新のみ damageUpdate ソケットで委譲(attackUpdate と同型)。
 */

import { applyDamageChartResult } from "./condition-resolution.mjs";
import { aggregateDefence, defenceForType, computeDamage } from "./damage-logic.mjs";
import { evaluateBonusRows, evaluateSelfBonus } from "./tnx-formula.mjs";
import { applyConsumptionPlan } from "./usage-consumption.mjs";
import { getDamageChartKind } from "../data/damage-chart.mjs";
import { CONDITION_KINDS } from "./conditions.mjs";
import { applyAttackPatch } from "./attack-flow.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { TnxActionHandler } from "./tnx-action-handler.mjs";
import { getCardCheckValue } from "./tnx-check-engine.mjs";
import { formatAttackLabel } from "./attack-flow-logic.mjs";
import { consumeFaAmmo } from "./weapon-ammo.mjs";
import { gatherDamageVsSources, gatherDamageDealtSources, collectActorEffectBuffs, targetStyleWorksKeys } from "../data/item/helpers.mjs";
import { applyUsageEffectsFromMessage } from "./usage-effects.mjs";

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
        : { manualMod: 0, faItemIds: [] };
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
        faItemIds:  [...el.querySelectorAll("input.dmg-fa:checked")].map(c => c.value),
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

    const attacker = await fromUuid(f.attackerUuid).catch(() => null);
    if (!(game.user.isGM || attacker?.isOwner)) {
        ui.notifications.warn("ダメージカードは攻撃側（または RL）が出します。");
        return;
    }
    const category = f.category || "physical";
    const attackPower = category === "physical" ? (Number(f.weaponAttack) || 0) : 0;
    // FA は自動加算せず、FA 可能武器を候補として出しダイアログで武器ごとに選ぶ(2026-07-09)
    const faOptions = category === "physical" ? (f.faOptions ?? []) : [];

    // 攻撃対象(防御側)を一度だけ解決する。式の @target.* と AE ダメージ対象バフの照合に用いる。
    const targetActor = await resolveTargetActor(f.targetUuid);
    // 用途の親アイテム(@item.self の解決に使う。攻撃者所持のアイテム)
    const parentItem = f.sourceItemId ? attacker?.items.get(f.sourceItemId) : null;
    const result = { diff: f.diff, achievement: f.achievement, cardValue: f.cardValue ?? null };

    // 用途自身のダメージ修正(専用欄・@item.self=用途の親アイテム・台帳は親名で帰属)＋供給元つきの
    // 追加行(式は @system.*・@item.<識別キー>.*・@item.self・@target.*・@diff/@achievement を参照可)。
    const selfDamage = await evaluateSelfBonus(f.damageBonusSelf, attacker, result, targetActor, parentItem);
    const { total: rowsTotal, sources: rowSources } =
        await evaluateBonusRows(f.damageBonuses, attacker, result, null, targetActor, parentItem);
    const damageBonusRows = [...(selfDamage ? [selfDamage] : []), ...rowSources];
    const damageBonus = (selfDamage?.value ?? 0) + rowsTotal;

    // AE ダメージバフ(実行時評価・台帳では用途のダメージ修正と同じ行=供給元は効果名で帰属):
    // - damage.dealt[.<系統>](2026-07-11): 与えるダメージ +値(この攻撃の系統に合致するもの)
    // - damage.vsStyle/vsWorks(2026-07-10): 攻撃対象のスタイル/所属条件つき +値
    const dealtRows = gatherDamageDealtSources(collectActorEffectBuffs(attacker), category);
    const vsRows = collectDamageVsBonuses(attacker, targetActor);
    const aeRows = [...dealtRows, ...vsRows];
    const damageBonusRowsAll = [...damageBonusRows, ...aeRows];
    const damageBonusTotal = damageBonus + aeRows.reduce((s, r) => s + (Number(r.value) || 0), 0);

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/dialog/damage-roll-dialog.hbs",
        {
            categoryLabel: CATEGORY_LABELS[category] ?? category,
            isPhysical: category === "physical",
            attackLabel: formatAttackLabel(f.damageType, attackPower),
            faOptions,
            attackSourceName: f.attackSourceName,
            targetName: f.targetName,
            damageBonus: damageBonusTotal,
        }
    );

    // 待ち受け開始: ダイアログを開いたまま、手札は HUD クリック(executeDamageCardFromHand)・
    // 山札はダイアログのボタンで出す(判定と同じ操作系)
    await cancelPending();
    const ctx = { kind: "roll", attackMessage, f, attacker, category, attackPower, faOptions, damageBonusRows: damageBonusRowsAll, targetActor, dialog: null, done: false };
    _pending = ctx;

    const chosen = await foundry.applications.api.DialogV2.wait({
        window: { title: `ダメージカードを出す: ${CATEGORY_LABELS[category] ?? category}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-dialog"],
        position: { width: 440 },
        content,
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
 * ダメージ・ロールを確定する(カードが出た後):
 * ダメージ・チャットカードの投稿→攻撃カードの damageRolled 化。
 * @param {object} ctx  待ち受けコンテキスト(kind="roll")
 * @param {{manualMod:number, faItemIds:string[]}} form ロールダイアログの入力
 * @param {{name:string, suit:string, value:number}} played 出したダメージカード
 */
async function finalizeDamageRoll(ctx, form, played) {
    const { attackMessage, f, attacker, category, attackPower, faOptions, damageBonusRows } = ctx;

    // FA 射撃(武器ごとに任意選択・2026-07-09): 選んだ FA 武器の FA 値を合算しダメージへ。
    // 選んだ武器の残弾を空にする(自動給弾を除く=consumeFaAmmo が判定)。
    const chosenFa = (faOptions ?? []).filter(o => (form.faItemIds ?? []).includes(o.itemId));
    const faValue = chosenFa.reduce((s, o) => s + (Number(o.faValue) || 0), 0);
    for (const o of chosenFa) {
        const weapon = o.itemId ? attacker?.items.get(o.itemId) : null;
        if (weapon) await consumeFaAmmo(weapon);
    }

    // 用途の適用効果はフローの一番最後(2026-07-11 ユーザー確定)=ダメージ算出後に適用する。
    // 攻撃カードのペイロードをダメージカードへ引き継ぐ(適用済み状態ごと。攻撃カード側の表示は
    // damageRolled で消える=適用ボタンはこのカードに一本化される)
    const usageEffects = attackMessage.getFlag(SCOPE, "usageEffects") ?? null;

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
                    targetUuid: f.targetUuid ?? "",
                    targetName: f.targetName ?? "",
                    category,
                    damageType: f.damageType ?? "",
                    attackPower, faValue,
                    damageBonuses: damageBonusRows,
                    mods: [],   // 事後修正(modifyDamage 用途・攻撃側合計クリックで適用)
                    attackSourceName: f.attackSourceName ?? "",
                    parryGuard: Number(f.parryGuard) || 0,
                    diff: f.diff ?? null,
                    achievement: f.achievement ?? null,
                    cardValue: f.cardValue ?? null,   // 命中判定のカード値(式の @card 用)
                    canStun: f.canStun === true,      // スタン可能(適用の選択はダメージ確定直前)
                    cards: [played],
                    manualMod: form.manualMod,
                    stun: false,   // スタン/説得は適用時(ダメージ確定直前)に選択する(2026-07-11)
                    applied: false,
                    appliedResult: null,
                },
            },
        },
    });

    await applyAttackPatch(attackMessage, { damageRolled: true });
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
            <div class="form-group"><label>数字</label><input type="number" name="value" value="1" min="1"></div>`,
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
    if (f.targetName) row(ledger, "対象", esc(f.targetName));
    const { raw } = damageRollTotals(f);
    const cards = f.cards ?? [];
    cards.forEach((c, i) => {
        const suitMark = SUIT_SYMBOL[c.suit] ? `<span class="cr-suit suit-${c.suit}">${SUIT_SYMBOL[c.suit]}</span> ` : "";
        row(ledger, `ダメージカード${cards.length > 1 ? ` ${i + 1}` : ""}（${suitMark}${esc(c.name)}）`,
            i === 0 ? String(c.value) : `＋${c.value}`);
    });
    if (f.category === "physical") {
        // 攻撃力はアウトフィットの表記(種別+符号つき数値・例 I+4)を踏襲
        row(ledger, `攻撃力（${esc(f.attackSourceName || "生身")}）`, formatAttackLabel(f.damageType, f.attackPower));
        if (f.faValue) row(ledger, "FA", `＋${f.faValue}`);
    }
    for (const b of (f.damageBonuses ?? [])) {
        row(ledger, `ダメージ修正（${esc(b.name || "用途")}）`, signedDisplay("＋", b.value));
    }
    if (f.manualMod) row(ledger, "修正（手動）", signedDisplay("＋", f.manualMod));
    // 事後修正(modifyDamage 用途・攻撃側合計クリックで適用済みの行)
    for (const m of (f.mods ?? [])) {
        row(ledger, `事後修正（${esc(m.label || "用途")}）`, signedDisplay("＋", m.value));
    }
    row(ledger, `攻撃側合計${f.stun ? "（スタン／説得）" : ""}`, String(raw), "cr-calc-row cr-total-row", "cr-total-num");
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
    if (f.applied && f.appliedResult) {
        const r = f.appliedResult;
        if (r.mitigation) row(area, `軽減${r.mitigationNote ? `（${esc(r.mitigationNote)}）` : ""}`, `−${r.mitigation}`);
        if (r.bounty) row(area, "報酬点による軽減", `−${r.bounty}`);
        if (r.stunCapped) row(area, "スタン／説得（10 以上→10）", "→10");
        row(area, "最終ダメージ", String(r.final), "cr-calc-row cr-total-row", "cr-total-num");
        line(area, `cr-result ${r.final > 0 ? "cr-result--damage" : "cr-result--nodamage"}`,
            `<i class="fas ${r.final > 0 ? "fa-burst" : "fa-shield-halved"}"></i> ${esc(r.applyText ?? "")}`);
        return;
    }

    const attacker = resolveSync(f.attackerUuid);
    const target = resolveSync(f.targetUuid);
    if (game.user.isGM || attacker?.isOwner) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.innerHTML = '<i class="fas fa-clone"></i> カードを追加で出す';
        btn.title = "特殊な技能でダメージカードを複数枚出す場合（合算）";
        btn.addEventListener("click", () => addDamageCard(message));
        area.appendChild(btn);
    }
    if (!f.targetUuid) {
        line(area, "cr-tn", "対象未選択（適用は手動で行ってください）");
    } else if (game.user.isGM || target?.isOwner) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.innerHTML = '<i class="fas fa-burst"></i> ダメージ適用';
        btn.addEventListener("click", () => openMitigationDialog(message));
        area.appendChild(btn);
    } else {
        line(area, "cr-tn", "（適用は対象の操作者または RL が行います）");
    }
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

    // 修正値: 用途のダメージ修正値(式・@item.self=親技能・@card/@diff/@achievement=命中判定由来)。
    // 空/評価不能/0 は手入力(軽減は負の値)
    const usage = (skill.system.actions ?? []).find(a => a._id === state.usageId) ?? null;
    const targetActor = await resolveTargetActor(f.targetUuid);
    let mod = null;
    const self = await evaluateSelfBonus(usage?.damageBonusSelf ?? "", actor,
        { diff: f.diff ?? null, achievement: f.achievement ?? null, cardValue: f.cardValue ?? null },
        targetActor, skill);
    if (self) mod = self.value;
    if (mod === null) {
        const { AmountInputDialog } = await import("./tnx-dialog.mjs");
        mod = await AmountInputDialog.prompt({
            title: `ダメージの修正: ${skill.name}`,
            label: "ダメージへの修正値（軽減は負の値）",
            initialValue: 0, min: -99, max: 99,
        });
        if (!Number.isFinite(mod) || mod === 0) return;
    }

    // 消費(用途の consumeTargets・クリック待ち開始時に確定したプラン)は適用の確定時
    if (state.consumeUses?.length) await applyConsumptionPlan(state.consumeUses);

    await applyDamagePatch(message, { mods: [...(f.mods ?? []), { label: state.skillName, value: mod }] });
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
    const { AmountInputDialog } = await import("./tnx-dialog.mjs");
    const mod = await AmountInputDialog.prompt({
        title: "ダメージを修正（手動）",
        label: "ダメージへの修正値（軽減は負の値）",
        initialValue: 0, min: -99, max: 99,
    });
    if (!Number.isFinite(mod) || mod === 0) return;
    await applyDamagePatch(message, { mods: [...(f.mods ?? []), { label: "手動修正", value: mod }] });
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
 * @param {Actor} attacker
 * @param {Actor|null} target  解決済みの攻撃対象アクター
 * @returns {Array<{name:string, value:number}>}
 */
function collectDamageVsBonuses(attacker, target) {
    if (!attacker || !target?.items) return [];
    const { styles, works } = targetStyleWorksKeys(target);
    if (!styles.length && !works.length) return [];
    return gatherDamageVsSources(collectActorEffectBuffs(attacker), { styles, works });
}

/** 攻撃側合計(カード合算+攻撃力+FA+用途のダメージ修正+手動修正+事後修正)。 */
function damageRollTotals(f) {
    const cardSum = (f.cards ?? []).reduce((s, c) => s + (Number(c.value) || 0), 0);
    const bonusSum = (f.damageBonuses ?? []).reduce((s, b) => s + (Number(b.value) || 0), 0);
    const modsSum = (f.mods ?? []).reduce((s, m) => s + (Number(m.value) || 0), 0);
    const raw = cardSum + (Number(f.attackPower) || 0) + (Number(f.faValue) || 0)
        + bonusSum + modsSum + (Number(f.manualMod) || 0);
    return { cardSum, raw };
}

function resolveSync(uuid) {
    if (!uuid) return null;
    try { return fromUuidSync(uuid); } catch { return null; }
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
 * ダメージ適用を開始する(対象の操作者または RL)。防御側の軽減ダイアログ
 * (防御力+パリー受け値自動・社会の報酬点軽減・手動欄)で確定する。
 */
async function openMitigationDialog(message) {
    const f = message.getFlag(SCOPE, "damageRoll");
    if (!f || f.applied) return;
    const target = await fromUuid(f.targetUuid).catch(() => null);
    if (!target) { ui.notifications.warn("対象が見つかりません。"); return; }
    if (!(game.user.isGM || target.isOwner)) {
        ui.notifications.warn("ダメージ適用は対象の操作者（または RL）が行います。");
        return;
    }

    const category = f.category || "physical";
    const { raw } = damageRollTotals(f);

    // 軽減の自動取得: 物理のみ防御力(ダメージ種別対応・X は軽減なし)+パリー受け値
    let autoMitigation = 0;
    const mitigationParts = [];
    if (category === "physical") {
        const dv = defenceForType(aggregateDefence(target.items.contents ?? []), f.damageType);
        if (dv) { autoMitigation += dv; mitigationParts.push(`防御力(${f.damageType || "?"}) ${dv}`); }
    }
    if (f.parryGuard) { autoMitigation += f.parryGuard; mitigationParts.push(`パリー受け値 ${f.parryGuard}`); }

    // スタン/説得(2026-07-11 ユーザー確定): 用途の「スタン可能」ON の攻撃のみ、ダメージ確定の
    // 直前に適用するかを選ぶ(肉体=スタン・精神=説得。社会は対象外)
    const stunLabel = category === "mental" ? "説得" : "スタン";
    const stunEligible = f.canStun === true && (category === "physical" || category === "mental");

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/dialog/damage-mitigation-dialog.hbs",
        {
            categoryLabel: CATEGORY_LABELS[category] ?? category,
            raw,
            canStun: stunEligible,
            stunLabel,
            isSocial: category === "social",
            targetName: target.name,
            autoMitigation, mitigationParts,
        }
    );

    const readForm = (el) => ({
        mitigation: Number(el.querySelector('[name="mitigation"]')?.value) || 0,
        bounty:     Number(el.querySelector('[name="bountyMitigation"]')?.value) || 0,
    });

    // ライブプレビュー: 軽減の入力から最終値と適用先の見込み(負傷名等)を再計算
    const updatePreview = (root) => {
        const v = readForm(root);
        const mitigation = v.mitigation + (category === "social" ? v.bounty : 0);
        // プレビューはスタン未適用の値(適用の選択は確定直前の別ダイアログ)
        const { final, stage } = computeDamage({ damageCard: raw, mitigation });
        const fin = root.querySelector(".tnx-damage-preview-final");
        const note = root.querySelector(".tnx-damage-preview-note");
        if (fin) fin.textContent = String(final);
        if (note) note.textContent = describeDamagePreview(target, category, final, stage);
    };

    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `ダメージ軽減: ${target.name}` },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-dialog"],
        position: { width: 440 },
        content,
        buttons: [
            { action: "apply", icon: "fas fa-burst", label: "ダメージ適用", default: true,
              callback: (_e, _b, dialog) => readForm(dialog.element) },
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

    // 軽減の合成(手動+社会の報酬点。用途タイプのダメージ軽減は廃止=手動軽減欄に入力する・2026-07-11)
    let mitigationTotal = result.mitigation;
    const bounty = category === "social" ? result.bounty : 0;
    mitigationTotal += bounty;

    // スタン/説得の適用選択(ダメージ確定の直前・「スタン可能」ON の攻撃のみ・2026-07-11)
    let stun = false;
    if (stunEligible) {
        stun = await foundry.applications.api.DialogV2.confirm({
            window: { title: `${stunLabel}の適用` },
            classes: ["tokyo-nova", "tnx-dialog"],
            content: `<p>この攻撃は${stunLabel}が可能です。${stunLabel}を適用しますか？</p>`
                + `<p>（適用すると最終ダメージ 10 以上を 10 とみなします）</p>`,
            yes: { label: `${stunLabel}を適用`, icon: "fas fa-hand-fist" },
            no:  { label: "適用しない", icon: "fas fa-xmark" },
            modal: true,
        });
    }

    // 適用効果の同時適用(2026-07-12 ユーザー確定): 用途の適用効果はダメージ適用と**同時に自動で**
    // 対象へ付与する(手動ボタンの押し順=順序依存を消す。チャート適用より先に付与するため、
    // タグ改変 AE(damage.replaceTag/addTag)が同じクリックの中で正しく効く)。未適用時のみ動く
    await applyUsageEffectsFromMessage(message);

    const { final, stage } = computeDamage({ damageCard: raw, mitigation: mitigationTotal, stun });
    const applyText = await applyDamageToTarget(target, category, final, stage);

    await applyDamagePatch(message, {
        applied: true,
        stun,   // 台帳の「攻撃側合計（スタン／説得）」表示用
        appliedResult: {
            mitigation: result.mitigation,
            mitigationNote: result.mitigation === autoMitigation ? mitigationParts.join("・") : "手動入力",
            bounty,
            stunCapped: stun && Math.max(0, raw - mitigationTotal) > 10,
            final, stage,
            applyText,
        },
    });
}

// ─── フラグ更新(権限がなければ GM へソケット委譲・attackUpdate と同型) ─────────────

/** ダメージ・カードのフラグを更新する(全クライアントでライブ書き換え)。 */
export async function applyDamagePatch(message, patch) {
    if (game.user.isGM || message.isAuthor) {
        const data = {};
        for (const [k, v] of Object.entries(patch)) data[`flags.${SCOPE}.damageRoll.${k}`] = v;
        await message.update(data);
    } else {
        TnxSocketHandler.emitDamageUpdate(message.id, patch);
    }
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
