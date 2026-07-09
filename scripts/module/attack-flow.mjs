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
import { resolveNoReaction, resolveOpposed, attackReactionModes, formatAttackLabel, combineWeaponAttack } from "./attack-flow-logic.mjs";
import { hasAmmoTracking, consumeNormalAmmo } from "./weapon-ammo.mjs";
import { buildSkillOptions } from "./skill-select.mjs";
import { actorSkillsWithRole } from "./skill-roles.mjs";

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

/** リアクションモード → 技能役割(役割ベース検出。reaction は系統で自我/信用に分岐) */
function reactionRole(mode, category) {
    if (mode === "dodge") return "dodge";
    if (mode === "parry") return "parry";
    return category === "social" ? "socialReaction" : "mentalReaction";
}

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

    // 武器解決(物理のみ): weaponRefs(複数可) → 生身(baseAttack)フォールバック。
    // 複数武器は攻撃力を合算する(合算能力の表現・2026-07-09。純ロジックは combineWeaponAttack)。
    // FA は自動加算せず faOptions として持ち回し、ダメージ算出ダイアログで武器ごとに選択する。
    let weaponAttack = 0, damageType = "", attackSourceName = "", faOptions = [];
    if (category === "physical") {
        const weapons = (usage.weaponRefs ?? [])
            .map(r => (r?.itemId ? actor.items.get(r.itemId) : null))
            .filter(Boolean)
            .map(w => ({
                itemId:      w.id,
                name:        w.name,
                attackValue: Number(w.system.attack?.value) || 0,
                damageType:  w.system.attack?.damageType || "",
                isFullAuto:  w.system.isFullAuto === true,
                faValue:     Number(w.system.FAValue) || 0,
                consumesAmmo: hasAmmoTracking(w.system.ammo),
            }));
        ({ weaponAttack, damageType, attackSourceName, faOptions } =
            combineWeaponAttack(weapons, usage.damageType, actor.system.baseAttack ?? {}));
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

    // 通常(非FA)射撃の残弾消費: 数字モードの武器を 1 減らす(任意は FA でのみ空・2026-07-10)。
    // 物理攻撃のみ。FA による消費はダメージ算出時(consumeFaAmmo)に別途行う。
    if (category === "physical") {
        for (const r of (usage.weaponRefs ?? [])) {
            const w = r?.itemId ? actor.items.get(r.itemId) : null;
            if (w) await consumeNormalAmmo(w);
        }
    }

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
        checkBonusFormula: usage.checkBonus,
        attack: {
            attackerUuid: actor.uuid,
            attackerName: actor.name,
            targetUuid, targetName,
            category, damageType, weaponAttack, faOptions, attackSourceName,
            damageBonus: usage.damageBonus,
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
            // FA は自動加算せずダメージ算出ダイアログで選択するため、ここでは「FA 可」表示のみ
            hasFa:         (payload.faOptions?.length ?? 0) > 0,
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

    // state === "pending": リアクション導線。ドッジ/パリー/リアクションは攻撃対象に限らず
    // 他者が代行できる(操縦者が同乗者を庇う等・2026-07-09 確定)ため全員に表示し、実行アクター
    // (リアクター)の権限は押下時に判定する。「リアクションしない」は対象自身の宣言(制御値で
    // 受ける)なので対象の操作者(か GM)に限定する。
    const target = resolveSync(f.targetUuid);
    const canDeclareNone = game.user.isGM || target?.isOwner;
    addLine("tnx-attack-pending-note",
        `対象: ${esc(f.targetName || "?")} — リアクションを選択してください`);
    const btnRow = document.createElement("div");
    btnRow.className = "tnx-attack-btn-row";
    for (const mode of attackReactionModes(f.category)) {
        if (mode === "none" && !canDeclareNone) continue;
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

/**
 * リアクションを行うアクター(リアクター)を解決する。リアクションは攻撃対象に限らず他者が
 * 代行できる(操縦者が同乗者を庇う等・他者の被攻撃に代理反応する技能が複数存在する。
 * 2026-07-09 ユーザー確定)。既定は選択トークン→割り当てキャラクター。権限が無ければ弾く
 * (GM は常に可)。命中結果は従来どおり攻撃対象(f.targetUuid)に返る。
 * @returns {Actor|null} 解決できなければ警告して null
 */
function resolveReactor() {
    const controlled = canvas?.tokens?.controlled ?? [];
    const actor = controlled[0]?.actor ?? game.user.character ?? null;
    if (!actor) {
        ui.notifications.warn("リアクションを行うキャラクターのトークンを選択してください。");
        return null;
    }
    if (!actor.isOwner) {
        ui.notifications.warn(`「${actor.name}」を操作する権限がありません。`);
        return null;
    }
    return actor;
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
    // リアクター(実行アクター)は攻撃対象に限らない(他者が代行可)。選択トークン→割り当てキャラ、
    // 権限が無ければ弾く。判定は reactor 自身の技能・値で行い、命中結果は攻撃対象に返る。
    const reactor = resolveReactor();
    if (!reactor) return;

    // パリー: カット進行中は AR>0 を検証し AR−1 を即時適用(カット進行外は検証・消費なし)。
    // 受け値: パリー参照武器(weaponRefs.parry)の guardValue(判定成立なら敗北でも軽減に加算)
    let parryGuard = 0;
    if (mode === "parry") {
        if (isActorInStartedCombat(reactor)) {
            const ar = reactor.system.actionRank?.value ?? 0;
            if (ar <= 0) { ui.notifications.warn("AR が 0 のためパリーを行えません。"); return; }
            await reactor.update({ "system.actionRank.value": ar - 1 });
        }
        // パリー参照武器(character-base の weaponRefs.parryItemId)。未設定なら受け値なし
        const parryId = reactor.system.weaponRefs?.parryItemId || "";
        const parryWeapon = parryId ? reactor.items.get(parryId) : null;
        parryGuard = parryWeapon?.system.guardValue?.mode === "value"
            ? (Number(parryWeapon.system.guardValue.value) || 0) : 0;
    }

    // 技能選択(強制しない): リアクション役割(dodge/parry/mentalReaction/socialReaction)を持つ
    // 技能を検出。役割技能が無ければ全技能から選ばせる(移行フォールバック)。既定は先頭を初期選択
    const role = reactionRole(mode, f.category);
    let candidates = actorSkillsWithRole(reactor, role);
    if (!candidates.length) {
        candidates = reactor.items
            .filter(i => ["generalSkill", "styleSkill"].includes(i.type))
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    }
    if (!candidates.length) { ui.notifications.warn(`「${reactor.name}」に使用できる技能がありません。`); return; }
    const hint = mode === "reaction" ? REACTION_HINTS[f.category] : REACTION_HINTS[mode];
    const defaultSkill = mode === "reaction" ? REACTION_DEFAULT_SKILL[f.category] : REACTION_DEFAULT_SKILL[mode];
    const skillId = await TargetSelectionDialog.prompt({
        title: `${MODE_LABELS[mode]}: 使用技能の選択`,
        label: `${MODE_LABELS[mode]}に使用する技能を選択してください。${hint ? `（${hint}）` : ""}`,
        options: buildSkillOptions(candidates, { defaultName: defaultSkill }),
        selectLabel: "判定へ",
    });
    if (!skillId) return;
    const skill = reactor.items.get(skillId);

    // 参加技能・消費(用途があれば combo/消費・無ければ技能そのものをベースに判定)
    const usage = (skill.system.actions ?? []).find(a => a.type === "check" && !Number.isFinite(a.fixedResult)) ?? null;
    const baseId = usage?.baseSkillRef?.itemId || skill.id;
    const baseSkill = baseId === skill.id ? skill : reactor.items.get(baseId);
    const comboIds = (usage?.skillRefs ?? []).map(r => r.itemId).filter(id => id && reactor.items.has(id));
    if (skill.id !== baseId && !comboIds.includes(skill.id)) comboIds.push(skill.id);
    const allSkillIds = [baseId, ...comboIds.filter(id => id !== baseId)];
    const validSuits = getComboSuits(allSkillIds.map(id => reactor.items.get(id)?.system).filter(Boolean));
    if (!baseSkill || !validSuits.length) {
        ui.notifications.warn(`「${skill.name}」で使用できるスートがありません。`);
        return;
    }
    const rows = usage ? resolveConsumeRowsForActor(reactor, skill, usage.consumeTargets) : [];
    const usesPlan = await promptConsumption(reactor, rows, { title: `使用回数の消費: ${skill.name}` });
    if (usesPlan === null) return;

    const skillLabel = allSkillIds.map(id => reactor.items.get(id)?.name ?? "").filter(Boolean).join("+");
    const reactorBounty = (reactor.system.bountyBase ?? 0) + (reactor.system.bounty ?? 0);

    await TnxCheckFlow.open({
        type:            "skillCheck",
        actorId:         reactor.id,
        skillIds:        allSkillIds,
        skillLabel,
        validSuits,
        targetValue:     null,
        bountyAvailable: baseSkill.system.usesBounty === true ? reactorBounty : 0,
        consumeUses:     usesPlan,
        requestMessageId: null,
        checkBonusFormula: usage?.checkBonus,
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
