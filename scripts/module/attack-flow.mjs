/**
 * @fileoverview 攻撃フロー(フェーズ12-2・正本 Damage_Rules.md / Check_Rules.md「差分値」/
 * Phase_12_Tasks_Detail 12-1 確定設計)。
 *
 * attack 用途の起動→命中判定(達成値まで算出・成否保留)→攻撃カード→系統別リアクション→
 * 対決解決→命中確定、までを担う。ダメージ算出は damage-flow.mjs(12-3)へ続く。
 *
 * - 起動: アイテムロール(アクターシート)と使用ボタンの両対応。
 * - 対象: Foundry のターゲット指定を優先→選択ダイアログ→「対象なし」も許容(RL 手動運用)。
 *   参照は UUID(トークンの合成アクターにも命中するように)。
 * - 攻撃カード: 成否保留で投稿し、リアクション導線を系統別に表示(物理=ドッジ/パリー/
 *   リアクションしない・精神/社会=リアクション/リアクションしない)。**解決後はボタン領域を
 *   丸ごと成否表示に置換**(フラグ+renderChatMessageHTML のライブ書き換え=checkRequest と同型)。
 * - パリー: カット進行中は AR>0 検証+AR−1 を即時適用(規約の「メインプロセス終了時」への
 *   厳密化はフェーズ13 のプロセス管理で載せ替え可能)。判定成立なら敗北でも受け値を
 *   ダメージ軽減へ(parryGuard)。
 * - 対決: 相手のリアクション判定の達成値を目標値として攻撃達成値≥で命中・未満は攻撃終了。
 * - リアクションの宣言タイミング・回数の進行管理はフェーズ13(ここでは強制しない)。
 *
 * 既知の制限: リアクション判定の実行アクターはワールドアクター前提(リンクなしトークンの
 * 合成アクターによるリアクションはフェーズ13 のトラッカー文脈で対応)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { getComboSuits, SUIT_TO_ABILITY } from "./tnx-check-engine.mjs";
import { resolveConsumeRowsForActor, promptConsumption } from "./usage-consumption.mjs";
import { TargetSelectionDialog } from "./tnx-dialog.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { isActorInStartedCombat } from "../data/helpers.mjs";
import { resolveNoReaction, resolveOpposed, attackReactionModes, formatAttackLabel } from "./attack-flow-logic.mjs";
import { buildSkillOptions } from "./skill-select.mjs";

const SCOPE = "tokyo-nova-axleration";

export const ATTACK_CATEGORY_LABELS = Object.freeze({
    physical: "物理",
    mental:   "精神",
    social:   "社会",
});

/** リアクションの既定候補の案内(技能は強制しない=表示のみ) */
const REACTION_HINTS = Object.freeze({
    dodge:    "既定候補: 〈回避〉（ヴィークル搭乗時は対応する〈操縦〉）",
    parry:    "既定候補: 〈白兵〉",
    mental:   "既定候補: 〈自我〉",
    social:   "既定候補: 〈信用〉",
});

/** リアクションの規定の指定技能(正準名・プルダウンの初期選択に使う) */
const REACTION_DEFAULT_SKILL = Object.freeze({
    dodge: "回避", parry: "白兵", mental: "自我", social: "信用",
});

const MODE_LABELS = Object.freeze({
    dodge: "ドッジ", parry: "パリー", reaction: "リアクション", none: "リアクションしない",
});

// ─── 起動(attack 用途の使用) ─────────────────────────────────────────────────

/**
 * attack 用途の使用(エントリポイント)。
 * @param {Item} item 用途を持つアイテム(技能・武器等)
 * @param {object} usage attack 用途エントリ
 */
export async function useAttack(item, usage) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("攻撃はアクターが所持しているアイテムからのみ使用できます。");
        return;
    }
    const category = usage.damageCategory || "physical";

    // 武器解決(物理のみ): weaponRef → 生身(baseAttack)フォールバック
    let weaponAttack = 0, damageType = "", faValue = 0, attackSourceName = "";
    if (category === "physical") {
        const weapon = usage.weaponRef?.itemId ? actor.items.get(usage.weaponRef.itemId) : null;
        if (weapon) {
            weaponAttack = Number(weapon.system.attack?.value) || 0;
            damageType = usage.damageType || weapon.system.attack?.damageType || "";
            faValue = weapon.system.isFullAuto ? (Number(weapon.system.FAValue) || 0) : 0;
            attackSourceName = weapon.name;
        } else {
            weaponAttack = Number(actor.system.baseAttack?.value) || 0;
            damageType = usage.damageType || actor.system.baseAttack?.damageType || "I";
            attackSourceName = "生身";
        }
    }

    // 対象決定: ターゲット指定 → 選択ダイアログ(シーン上のトークン) → 対象なし許容
    let targetUuid = "", targetName = "";
    const targeted = [...game.user.targets][0];
    if (targeted?.actor) {
        targetUuid = targeted.actor.uuid;
        targetName = targeted.actor.name;
    } else {
        const seen = new Set();
        const options = [{ value: "", label: "（対象なし）" }];
        if (canvas?.ready) {
            for (const t of canvas.tokens.placeables) {
                const a = t.actor;
                if (!a || a.uuid === actor.uuid || seen.has(a.uuid)) continue;
                seen.add(a.uuid);
                options.push({ value: a.uuid, label: a.name });
            }
        }
        const sel = await TargetSelectionDialog.prompt({
            title: "攻撃対象の選択",
            label: "攻撃の対象を選択してください（Foundry のターゲット指定があればそちらが優先されます）。",
            options,
            selectLabel: "決定",
        });
        if (sel === null || sel === undefined) return; // キャンセル
        if (sel) {
            const doc = await fromUuid(sel).catch(() => null);
            targetUuid = doc ? sel : "";
            targetName = doc?.name ?? "";
        }
    }

    // 参加技能の解決(check と同じ: ベース=baseSkillRef または親・コンボ=skillRefs)
    const baseId = usage.baseSkillRef?.itemId || item.id;
    const baseSkill = baseId === item.id ? item : actor.items.get(baseId);
    if (!baseSkill) {
        ui.notifications.warn(`「${item.name}」の用途に不備があります（ベース技能が見つかりません）。`);
        return;
    }
    const comboIds = (usage.skillRefs ?? []).map(r => r.itemId).filter(id => id && actor.items.has(id));
    if (item.id !== baseId && !comboIds.includes(item.id)) comboIds.push(item.id);
    const allSkillIds = [baseId, ...comboIds.filter(id => id !== baseId)];
    const validSuits = getComboSuits(allSkillIds.map(id => (id === item.id ? item : actor.items.get(id))?.system).filter(Boolean));
    if (!validSuits.length) {
        ui.notifications.warn(`「${item.name}」の用途に不備があります（参加技能に共通スートがありません）。`);
        return;
    }

    // 消費(消費先設定・判定実行時に適用)
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const usesPlan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (usesPlan === null) return;

    const skillLabel = allSkillIds
        .map(id => (id === item.id ? item : actor.items.get(id))?.name ?? "")
        .filter(Boolean)
        .join("+");
    const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);

    await TnxCheckFlow.open({
        type:            "skillCheck",
        actorId:         actor.id,
        skillIds:        allSkillIds,
        skillLabel,
        validSuits,
        targetValue:     null, // 成否は攻撃カード上で確定(リアクションなし=制御値/対決=相手の達成値)
        bountyAvailable: baseSkill.system.usesBounty === true ? actorBounty : 0,
        consumeUses:     usesPlan,
        requestMessageId: null,
        attack: {
            attackerUuid: actor.uuid,
            attackerName: actor.name,
            targetUuid, targetName,
            category, damageType, weaponAttack, faValue, attackSourceName,
            skillLabel,
            usageName: usage.name || item.name,
        },
    });
}

// ─── 攻撃カードの投稿(判定完了時・TnxCheckFlow._execute から) ─────────────────

/**
 * 命中判定完了後に攻撃カードを投稿する(通常の結果カードの代わり)。
 * 成否は保留(state=pending)し、リアクション導線をカード上で提供する。
 */
export async function postAttackCard({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch }) {
    const attacker = await fromUuid(payload.attackerUuid).catch(() => null);
    const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };

    let state = "pending";
    let resolution = null;
    if (result.fumble) { state = "fumble"; resolution = "fumble"; }
    else if (suitMismatch) { state = "miss"; resolution = "mismatch"; }
    else if (!payload.targetUuid) { state = "open"; }

    // ダメージカードは命中判定のカードとは別に出す(Damage_Rules 2026-07-08 訂正)ため、
    // 攻撃カードはダメージ値を持たない(damageRolled=ダメージ・カードを出したかのみ)
    const flags = {
        ...payload,
        state, resolution,
        achievement: result.achievement,
        suit,
        reactionAchievement: null,
        targetValue: null,
        diff: null,
        parryGuard: 0,
        damageRolled: false,
    };

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/attack-card.hbs",
        {
            skillLabel:    payload.skillLabel,
            categoryLabel: ATTACK_CATEGORY_LABELS[payload.category] ?? payload.category,
            suit,
            suitSymbol:    SUIT_SYMBOL[suit] ?? "",
            cardName:      card?.name ?? "",
            fromDeck, trumpUsed, suitMismatch,
            isFixed21:     result.fixedAt21 === true,
            isFumble:      result.fumble === true,
            isPhysical:    payload.category === "physical",
            targetName:    payload.targetName,
            attackSourceName: payload.attackSourceName,
            attackLabel:   formatAttackLabel(payload.damageType, payload.weaponAttack),
            faValue:       payload.faValue,
            achievement:   result.achievement,
        }
    );

    await ChatMessage.create({
        content,
        speaker: attacker ? ChatMessage.getSpeaker({ actor: attacker }) : undefined,
        flags: {
            [SCOPE]: {
                // 対決読み取り等の互換のため通常判定と同じ checkResult も持たせる
                checkResult: { actorId: attacker?.id ?? "", result },
                attackCheck: flags,
            },
        },
    });
}

// ─── 攻撃カードのライブ描画(renderChatMessageHTML・tnx.mjs から登録) ─────────────

/** 攻撃カードの状態領域を flags から描画する(未解決=ボタン群/解決後=成否表示に置換)。 */
export function renderAttackCard(message, html) {
    const f = message.getFlag(SCOPE, "attackCheck");
    if (!f) return;
    const area = html.querySelector(".tnx-attack-status");
    if (!area) return;
    area.replaceChildren();

    const esc = foundry.utils.escapeHTML;
    const addLine = (cls, inner) => {
        const div = document.createElement("div");
        div.className = cls;
        div.innerHTML = inner;
        area.appendChild(div);
    };
    // 成否は短い1行、目標値/対決/差分値は台帳行に分ける(判定結果カードと同じ構造。
    // 1本の flex 行に詰め込むと狭いカードで日本語が文字割れするため=2026-07-09 修正)
    const addVerdict = (cls, icon, label) =>
        addLine(`cr-result ${cls}`, `<i class="fas ${icon}"></i> <span>${label}</span>`);
    const addRow = (label, value) =>
        addLine("cr-calc-row", `<span class="cr-calc-label">${label}</span><span class="cr-calc-val">${value}</span>`);
    const diffText = Number.isFinite(f.diff) ? (f.diff >= 0 ? `+${f.diff}` : `${f.diff}`) : null;

    if (f.state === "fumble") {
        addVerdict("cr-result--fumble", "fa-skull", "ファンブル！（攻撃失敗）");
        return;
    }
    if (f.state === "miss") {
        addVerdict("cr-result--failure", "fa-times", "攻撃失敗");
        const why = f.resolution === "mismatch" ? "スート不一致（判定不成立）"
            : f.resolution === "none" ? `制御値 ${f.targetValue} に届かず`
            : `${MODE_LABELS[f.resolution] ?? "リアクション"}成功（達成値 ${f.reactionAchievement}）`;
        addRow("理由", esc(why));
        return;
    }
    if (f.state === "hit" || f.state === "open") {
        if (f.state === "hit") {
            addVerdict("cr-result--success", "fa-check", "命中");
            if (f.resolution === "none") addRow("目標値（制御値）", f.targetValue);
            else addRow(`対決（${MODE_LABELS[f.resolution] ?? "リアクション"}）`, `達成値 ${f.reactionAchievement}`);
            if (diffText) addRow("差分値", diffText);
        } else {
            addLine("tnx-attack-pending-note", "対象なし（ダメージ算出は対象を選択して行います）");
        }
        if (!f.damageRolled) {
            const attacker = resolveSync(f.attackerUuid);
            if (game.user.isGM || attacker?.isOwner) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "tnx-chat-btn tnx-attack-damage-btn";
                btn.innerHTML = '<i class="fas fa-clone"></i> ダメージカードを出す';
                btn.addEventListener("click", async () => {
                    const { openDamageRollDialog } = await import("./damage-flow.mjs");
                    openDamageRollDialog(message);
                });
                area.appendChild(btn);
            }
        } else {
            addLine("cr-tn", "（ダメージカードを出しました）");
        }
        return;
    }

    // state === "pending": 系統別のリアクション導線(対象の所有者と GM に表示)
    const target = resolveSync(f.targetUuid);
    const canReact = game.user.isGM || target?.isOwner;
    addLine("tnx-attack-pending-note",
        `対象: ${foundry.utils.escapeHTML(f.targetName || "?")} — リアクションを選択してください`);
    if (!canReact) {
        addLine("cr-tn", "（対象の操作者の選択待ち）");
        return;
    }
    const btnRow = document.createElement("div");
    btnRow.className = "tnx-attack-btn-row";
    for (const mode of attackReactionModes(f.category)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.textContent = MODE_LABELS[mode];
        if (mode !== "none") {
            const hint = mode === "reaction" ? REACTION_HINTS[f.category] : REACTION_HINTS[mode];
            if (hint) btn.title = hint;
        }
        btn.addEventListener("click", () => {
            if (mode === "none") handleNoReaction(message);
            else startReaction(message, mode);
        });
        btnRow.appendChild(btn);
    }
    area.appendChild(btnRow);
}

function resolveSync(uuid) {
    if (!uuid) return null;
    try { return fromUuidSync(uuid); } catch { return null; }
}

// ─── 命中確定(リアクションなし/対決) ─────────────────────────────────────────

/** 「リアクションしない」: 目標値=対象の制御値(出したスートに対応)で成否・差分値を確定。 */
export async function handleNoReaction(message) {
    const f = message.getFlag(SCOPE, "attackCheck");
    const target = await fromUuid(f.targetUuid).catch(() => null);
    if (!target) { ui.notifications.warn("対象を解決できません。"); return; }
    if (!game.user.isGM && !target.isOwner) {
        ui.notifications.warn("リアクションの選択は対象の操作者（または RL）が行います。");
        return;
    }
    const ability = SUIT_TO_ABILITY[f.suit];
    const control = target.system[ability]?.totalControl ?? 0;
    const { hit, diff, targetValue } = resolveNoReaction(f.achievement, control);
    await applyAttackPatch(message, { state: hit ? "hit" : "miss", resolution: "none", targetValue, diff });
}

/**
 * リアクション(ドッジ/パリー/精神・社会のリアクション)を開始する。
 * 技能は強制しない(既定候補は案内のみ)。判定は通常の技能判定フローで行い、
 * 完了時に completeReactionFromCheck が対決を解決する。
 */
export async function startReaction(message, mode) {
    const f = message.getFlag(SCOPE, "attackCheck");
    const target = await fromUuid(f.targetUuid).catch(() => null);
    if (!target) { ui.notifications.warn("対象を解決できません。"); return; }
    if (!game.user.isGM && !target.isOwner) {
        ui.notifications.warn("リアクションは対象の操作者（または RL）が行います。");
        return;
    }

    // パリー: カット進行中は AR>0 を検証し AR−1 を即時適用(カット進行外は検証・消費なし)。
    // 受け値: パリー参照武器(weaponRefs.parry)の guardValue(判定成立なら敗北でも軽減に加算)
    let parryGuard = 0;
    if (mode === "parry") {
        if (isActorInStartedCombat(target)) {
            const ar = target.system.actionRank?.value ?? 0;
            if (ar <= 0) { ui.notifications.warn("AR が 0 のためパリーを行えません。"); return; }
            await target.update({ "system.actionRank.value": ar - 1 });
        }
        // パリー参照武器(character-base の weaponRefs.parryItemId)。未設定なら受け値なし
        const parryId = target.system.weaponRefs?.parryItemId || "";
        const parryWeapon = parryId ? target.items.get(parryId) : null;
        parryGuard = parryWeapon?.system.guardValue?.mode === "value"
            ? (Number(parryWeapon.system.guardValue.value) || 0) : 0;
    }

    // 技能選択(強制しない): 対象の一般技能・スタイル技能から選ぶ。既定の指定技能は初期選択・
    // 並び順はシートと同じ(一般→スタイル・item.sort)。既定候補はヒント表示のみ
    const skills = target.items
        .filter(i => ["generalSkill", "styleSkill"].includes(i.type)
            && (i.system.actions ?? []).some(a => a.type === "check" && !Number.isFinite(a.fixedResult)));
    if (!skills.length) { ui.notifications.warn("対象に判定用途を持つ技能がありません。"); return; }
    const hint = mode === "reaction" ? REACTION_HINTS[f.category] : REACTION_HINTS[mode];
    const defaultSkill = mode === "reaction" ? REACTION_DEFAULT_SKILL[f.category] : REACTION_DEFAULT_SKILL[mode];
    const skillId = await TargetSelectionDialog.prompt({
        title: `${MODE_LABELS[mode]}: 使用技能の選択`,
        label: `${MODE_LABELS[mode]}に使用する技能を選択してください。${hint ? `（${hint}）` : ""}`,
        options: buildSkillOptions(skills, { defaultName: defaultSkill }),
        selectLabel: "判定へ",
    });
    if (!skillId) return;
    const skill = target.items.get(skillId);
    const usage = (skill.system.actions ?? []).find(a => a.type === "check" && !Number.isFinite(a.fixedResult));
    if (!usage) { ui.notifications.warn(`「${skill.name}」に判定用途がありません。`); return; }

    // 参加技能・消費(通常の判定と同じ)
    const baseId = usage.baseSkillRef?.itemId || skill.id;
    const baseSkill = baseId === skill.id ? skill : target.items.get(baseId);
    const comboIds = (usage.skillRefs ?? []).map(r => r.itemId).filter(id => id && target.items.has(id));
    if (skill.id !== baseId && !comboIds.includes(skill.id)) comboIds.push(skill.id);
    const allSkillIds = [baseId, ...comboIds.filter(id => id !== baseId)];
    const validSuits = getComboSuits(allSkillIds.map(id => target.items.get(id)?.system).filter(Boolean));
    if (!baseSkill || !validSuits.length) {
        ui.notifications.warn(`「${skill.name}」の用途に不備があります（ベース技能・共通スートを確認してください）。`);
        return;
    }
    const rows = resolveConsumeRowsForActor(target, skill, usage.consumeTargets);
    const usesPlan = await promptConsumption(target, rows, { title: `使用回数の消費: ${skill.name}` });
    if (usesPlan === null) return;

    const skillLabel = allSkillIds.map(id => target.items.get(id)?.name ?? "").filter(Boolean).join("+");
    const targetBounty = (target.system.bountyBase ?? 0) + (target.system.bounty ?? 0);

    await TnxCheckFlow.open({
        type:            "skillCheck",
        actorId:         target.id,
        skillIds:        allSkillIds,
        skillLabel,
        validSuits,
        targetValue:     null,
        bountyAvailable: baseSkill.system.usesBounty === true ? targetBounty : 0,
        consumeUses:     usesPlan,
        requestMessageId: null,
        reaction: { attackMessageId: message.id, mode, parryGuard },
    });
}

/**
 * リアクション判定完了時の対決解決(TnxCheckFlow._execute から)。
 * 相手のリアクション判定の達成値を目標値として攻撃達成値≥で命中。
 * リアクション不成立(ファンブル/スート不一致)は達成値 0 として扱う。
 * パリーは判定成立なら敗北でも受け値をダメージ軽減へ(parryGuard)。
 */
export async function completeReactionFromCheck(payload, result, { suitMismatch = false } = {}) {
    const message = game.messages.get(payload.attackMessageId);
    if (!message) return;
    const f = message.getFlag(SCOPE, "attackCheck");
    if (!f || f.state !== "pending") return;

    const ok = !result.fumble && !suitMismatch;
    const reactAch = ok ? (result.achievement ?? 0) : 0;
    const { hit, diff, targetValue } = resolveOpposed(f.achievement, reactAch);
    await applyAttackPatch(message, {
        state: hit ? "hit" : "miss",
        resolution: payload.mode,
        reactionAchievement: reactAch,
        targetValue, diff,
        // 受け値はパリー成立時のみ有効(勝利時は攻撃無効のため実質使用されない)
        parryGuard: payload.mode === "parry" && ok ? (payload.parryGuard ?? 0) : 0,
    });
}

// ─── フラグ更新(権限がなければ GM へソケット委譲) ──────────────────────────────

/** 攻撃カードのフラグを更新する(全クライアントでライブ書き換え)。 */
export async function applyAttackPatch(message, patch) {
    if (game.user.isGM || message.isAuthor) {
        const data = {};
        for (const [k, v] of Object.entries(patch)) data[`flags.${SCOPE}.attackCheck.${k}`] = v;
        await message.update(data);
    } else {
        TnxSocketHandler.emitAttackUpdate(message.id, patch);
    }
}
