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
 * - パリー: 判定成立なら敗北でも受け値をダメージ軽減へ(parryGuard)。AR−1 は専用の自動化を
 *   廃止(2026-07-12 ユーザー確定)——AR 消費は用途の消費先設定(consumeTargets の
 *   type="actionRank")に一本化され、パリー技能の用途に「AR を消費」を設定して表す。
 * - 対決: 受動有利=攻撃達成値がリアクション達成値を上回れば命中・同値/未満は攻撃側敗北(攻撃終了)。
 * - リアクションの宣言タイミング・回数の進行管理はフェーズ13(ここでは強制しない)。
 *
 * 既知の制限: リアクション判定の実行アクターはワールドアクター前提(リンクなしトークンの
 * 合成アクターによるリアクションはフェーズ13 のトラッカー文脈で対応)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { SUIT_TO_ABILITY } from "./tnx-check-engine.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { resolveAttackTargetRefs } from "./target-resolution.mjs";
import { TargetSelectionDialog } from "./tnx-dialog.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { resolveNoReaction, resolveOpposed, formatAttackLabel, combineWeaponAttack, resolveAttackRecheckState, newlyHitTargets } from "./attack-flow-logic.mjs";
import { grantHitTimedEffects } from "./usage-effects.mjs";
import { resolveAttackWeapons, attackWeaponDisplayName, attackWeaponKindEligible } from "./attack-weapons.mjs";
import { isOutfitUnusable, isOutfitDestroyed } from "../data/item/helpers.mjs";
import { buildSkillOptions } from "./skill-select.mjs";
import { movementStagesFromAchievement } from "./vehicle-move-logic.mjs";
import { USAGE_TYPE_LABELS, attackCategoryOf, usageDisplayName, executionFormOf } from "./usage-types.mjs";
import {
    confrontationReactionTypes, confrontationSkillRows, confrontationHasCannot,
    asteriskSkillKeys, isOpposedConfrontation,
} from "./confrontation-logic.mjs";
import { findItemByIdentificationKey, resolveItemNameByKey } from "./identification.mjs";

const SCOPE = "tokyo-nova-axleration";

// 攻撃系統の明示表記(2026-07-15 ユーザー指摘: 判定カードで物理/精神/社会攻撃を明示)。
// ※物理攻撃が与えるのは肉体ダメージ(攻撃名とダメージ名がずれるのは物理のみ)。
export const ATTACK_CATEGORY_LABELS = Object.freeze({
    physical: "物理攻撃",
    mental:   "精神攻撃",
    social:   "社会攻撃",
});

// リアクション導線の表示ラベル(2026-07-17 再編: 手段=リアクション用途タイプと1:1。
// 「既定技能」(手段→技能の既定対応)は完全廃止=資格・候補は用途タイプの所持で決まる)。
// reaction=技能名行由来の汎用リアクション・none=リアクションしない。旧データの resolution
// 表示互換(dodge/parry/reaction)もこの表で賄う
const MODE_LABELS = Object.freeze({
    ...Object.fromEntries(["dodge", "parry", "mentalReaction", "socialReaction",
        "moveBlockReaction", "escapeBlockReaction"].map(k => [k, USAGE_TYPE_LABELS[k]])),
    reaction: "リアクション",
    none:     "リアクションしない",
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
    const category = attackCategoryOf(usage.type) || "physical";

    // 武器解決(物理のみ・2026-07-13 ユーザー確定): **一本目=戦闘タブの「攻撃で使用」**
    // (actor.system.weaponRefs.attackItemId・空欄=生身)・用途の weaponRefs は2本目以降の追加分。
    // どちらも無ければ生身(baseAttack)フォールバック。複数武器は攻撃力を合算する
    // (合算能力の表現・2026-07-09。純ロジックは combineWeaponAttack)。
    // FA(フルオート)の自動加算は廃止(2026-07-18 ユーザー確定)——FA 値は用途のダメージボーナス式で
    // 手動参照(@item.<識別キー>.system.FAValueTotal)する。残弾の自動消費も廃止(用途の消費設定のみ)。
    let weaponAttack = 0, damageType = "", attackSourceName = "", stunCapable = false;
    if (category === "physical") {
        // 白兵/射撃の区分フラグで使用武器を絞る(2026-07-17 ユーザー確定)。生身(生身書き換え装備・
        // cyborg 含む)は白兵武器として扱う。射撃攻撃は純粋な生身では行えない=射撃武器フラグの
        // 武器を準備していなければ「準備している武器が無い」扱いで判定不可
        const kind = usage.attackWeaponKind === "ranged" ? "ranged" : "melee";
        // 適格判定は attackWeaponKindEligible に一本化(用途シートの使用武器表示と同じ判定)
        const usedWeapons = resolveAttackWeapons(actor, usage, item).filter(w => attackWeaponKindEligible(w, kind));
        // 故障/破壊(2026-07-18): 使用武器が故障/破壊しているとその武器を使う攻撃は行えない。
        const brokenWeapon = usedWeapons.find(w => isOutfitUnusable(w.system));
        if (brokenWeapon) {
            const state = isOutfitDestroyed(brokenWeapon.system) ? "破壊" : "故障";
            ui.notifications.warn(`「${brokenWeapon.name}」は${state}しているため、攻撃に使用できません。`);
            return;
        }
        if (kind === "ranged" && !usedWeapons.length) {
            ui.notifications.warn("準備している武器が無いため、射撃攻撃を行えません。");
            return;
        }
        // 数値は実効値(total=AE込み)を読む(UI 表示と同じ値・素値 value は編集用ベース。
        // 素値読みで表示と食い違っていたのをユーザー指摘で修正=2026-07-14)
        const weapons = usedWeapons
            .map(w => ({
                itemId:      w.id,
                name:        attackWeaponDisplayName(w),
                attackValue: Number(w.system.attack?.total ?? w.system.attack?.value) || 0,
                damageType:  w.system.attack?.damageTypeTotal || w.system.attack?.damageType || "",
            }));
        // スタン可能(2026-07-15): 使用武器のいずれかがスタン可能 ∨ 生身(武器なし) ∨ 用途.canStun(技能効果)
        stunCapable = usage.canStun === true || usedWeapons.length === 0
            || usedWeapons.some(w => w.system.canStun === true);
        // 生身は value+mod が実効(AE はネイティブに value/mod へ乗る・UI 表示も value+mod)
        const baseAtk = actor.system.baseAttack ?? {};
        ({ weaponAttack, damageType, attackSourceName } =
            combineWeaponAttack(weapons, usage.damageType, {
                value: (Number(baseAtk.value) || 0) + (Number(baseAtk.mod) || 0),
                damageType: baseAtk.damageTypeTotal || baseAtk.damageType,
            }));
    }

    // 対象決定(2026-07-15 ユーザー確定): Foundry のターゲット(レティクル)を**全件**使う。判定も
    // ダメージも一括で全対象へ適用する(対象数の自動化はしない・一体に絞るダイアログは出さない)。
    // 未ターゲット時のトークン選択＋レティクル付与は target-resolution に一本化(2026-07-16)
    const targets = await resolveAttackTargetRefs(actor);
    if (targets === null) return; // キャンセル

    // 参加技能・報酬点・消費・適用効果は判定起動の共通前段で解決する(2026-07-16 一本化。従来この
    // 経路だけ報酬点ブロック(口座凍結/信用失墜)を読み落としていた)。攻撃対象の決定(上)を先に済ませて
    // から呼ぶ=適用効果のターゲット解決が攻撃対象と一致する
    const base = await buildUsageCheckContext(actor, item, usage);
    if (!base) return;

    // 残弾の自動消費は廃止(2026-07-18 ユーザー確定): 通常射撃・FA射撃を問わず、残弾の消費は
    // 用途の消費設定(resource="ammo")からのみ発生する(buildUsageCheckContext 内で処理済み)。

    await TnxCheckFlow.open({
        ...base,
        targetValue:  null, // 成否は対決判定カード上で確定(リアクションなし=制御値/対決=相手の達成値)
        usageEffects: null, // 適用効果は攻撃ペイロードで運ぶ(攻撃カード→ダメージカードに一本化)
        attack: {
            attackerUuid: actor.uuid,
            attackerName: actor.name,
            targets,   // 命中判定は全対象で共有・postAttackCard が対象ごとの状態へ展開(2026-07-15)
            isAttack: true,                    // 対決判定カードの攻撃項目を出す(2026-07-17 一般化)
            usageType: usage.type,
            // 対決欄(2026-07-17): リアクション導線の正本(手段行・技能名行・不可マスク)
            confrontation: foundry.utils.deepClone(usage.confrontation ?? []),
            category, damageType, weaponAttack, attackSourceName,
            damageBonuses: usage.damageBonuses ?? [],
            damageBonusSelf: usage.damageBonusSelf ?? "",
            sourceItemId: item.id,
            stunCapable,                       // スタン攻撃を宣言できるか(物理・武器/生身/用途canStun 由来・2026-07-15)
            stunDeclared: false,               // 判定ダイアログのトグルで宣言される(2026-07-15)
            skillLabel: base.skillLabel,
            usageName: usageDisplayName(usage, item.name),
            usageEffects: base.usageEffects,   // 付与効果ペイロード(null=効果なし)。攻撃カードのフラグへ
        },
    });
}

/**
 * 非攻撃の対決判定を起動する(2026-07-17 一般化)。対決欄に有効行のある判定タイプ
 * (判定/移動/離脱)が対象で、攻撃カードを一般化した対決判定カード(成否保留・対決欄由来の
 * リアクション導線)へ乗せる。攻撃専用項目(武器・ダメージ)は出さない。
 * 移動文脈(openExtra.movement)は対決判定カードに畳み込む(達成値÷10 段階を条件表示)。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage 対決欄に有効行のある判定系用途
 * @param {object} [openExtra] 起動元の追加文脈(TnxCheckFlow.open へ合流)
 */
export async function useOpposedCheck(item, usage, openExtra = {}) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("対決判定はアクターが所持しているアイテムからのみ使用できます。");
        return;
    }
    // 対象: 攻撃と同じ規約(Foundry のターゲット全件→未選択は選択ダイアログ・「対象なし」も許容)。
    // 対象なしの対決はカード上のオープンなリアクション導線で受ける(操縦移動など)
    const targets = await resolveAttackTargetRefs(actor);
    if (targets === null) return;

    const base = await buildUsageCheckContext(actor, item, usage);
    if (!base) return;

    // 移動文脈は対決判定カードのペイロードへ畳み込む(ctx.movement のままだと _execute が
    // 移動カード側の分岐に入るため。非対決の移動は従来どおり移動カード)
    const { movement, ...restExtra } = openExtra;

    await TnxCheckFlow.open({
        ...base,
        targetValue:  null, // 成否は対決判定カード上で確定(対決=相手の達成値)
        usageEffects: null, // 適用効果はペイロードで運ぶ(攻撃カードと同じ一本化)
        attack: {
            attackerUuid: actor.uuid,
            attackerName: actor.name,
            targets,
            isAttack: false,                   // 攻撃専用項目(武器・ダメージ)は出さない
            usageType: usage.type,
            confrontation: foundry.utils.deepClone(usage.confrontation ?? []),
            category: "", damageType: "", weaponAttack: 0, attackSourceName: "",
            damageBonuses: [], damageBonusSelf: "",
            sourceItemId: item.id,
            stunCapable: false, stunDeclared: false,
            skillLabel: base.skillLabel,
            usageName: usageDisplayName(usage, item.name),
            usageEffects: base.usageEffects,
            ...(movement ? { movement } : {}),
        },
        ...restExtra,
    });
}

// ─── 攻撃カードの投稿(判定完了時・TnxCheckFlow._execute から) ─────────────────

/**
 * 命中判定完了後に攻撃カードを投稿する(通常の結果カードの代わり)。
 * 成否は保留(state=pending)し、リアクション導線をカード上で提供する。
 * recheckCtx: 再判定用スナップショット(あればカードに「再判定」ボタンが出る・2026-07-11)。
 */
export async function postAttackCard({ payload, result, suit, cardCheckValue = null, card, fromDeck, trumpUsed, suitMismatch, recheckCtx = null, isRecheck = false }) {
    const attacker = await fromUuid(payload.attackerUuid).catch(() => null);

    // 全体の状態(命中判定は全対象で共有・2026-07-15 複数対象一括): ファンブル/スート不一致は
    // 判定全体が失敗。対象なしは open。それ以外は対象ごとに解決(active)
    let state;
    if (result.fumble) state = "fumble";
    else if (suitMismatch) state = "miss";
    else if (!(payload.targets?.length)) state = "open";
    else state = "active";

    // リアクション導線の有無は対決欄が正(2026-07-17 ユーザー確定)。「-」「なし」だけの攻撃は
    // 対決判定にならない=対象は制御値で確定する(リアクション不能)
    const opposed = isOpposedConfrontation(payload.confrontation);

    // 対象ごとの状態。controlValue=リアクションしなければ目標値になる対象の制御値(攻撃スート対応・
    // 攻撃のみ)。fumble/miss(スート不一致)は全対象を miss とし、リアクション導線を出さない
    const isAttack = payload.isAttack !== false;
    const ability = SUIT_TO_ABILITY[suit];
    const targets = [];
    for (const t of (payload.targets ?? [])) {
        const targetActor = await fromUuid(t.uuid).catch(() => null);
        const entry = {
            uuid: t.uuid, name: t.name,
            controlValue: isAttack ? (targetActor?.system?.[ability]?.totalControl ?? 0) : 0,
            state: (state === "fumble" || state === "miss") ? "miss" : "pending",
            resolution: null, reactionAchievement: null, diff: null, parryGuard: 0,
            // リアクション判定の成立(一般定義=ファンブル/スート不一致でなければ成立・勝敗不問・
            // Check_Rules「判定の成立」)。社会ダメージの報酬点軽減の起動条件(2026-07-17)
            reactionEstablished: false,
        };
        // 非対決(対決欄なし)の攻撃: リアクション不能=制御値で即確定(2026-07-17 ユーザー確定)。
        // 非攻撃の対決判定は useOpposedCheck が対決欄ありのときだけ通すためここには来ない
        if (entry.state === "pending" && !opposed) {
            const r = isAttack
                ? resolveNoReaction(result.achievement ?? 0, entry.controlValue)
                : { hit: true, diff: null };
            entry.state = r.hit ? "hit" : "miss";
            entry.resolution = "none";
            entry.diff = r.diff;
        }
        targets.push(entry);
    }

    // ダメージカードは命中判定のカードとは別に出す(Damage_Rules 2026-07-08)ため、攻撃カードは
    // ダメージ値を持たない(damageRolled=ダメージ・カードを出したかのみ)
    const flags = {
        ...payload,
        targets,        // 対象ごとの状態(payload.targets の素の {uuid,name} を上書き)
        state,
        achievement: result.achievement,
        // 判定に使用したカードの値(N◎VA数字・式の @card 用。21固定は A の数字=11・2026-07-11)
        cardValue: cardCheckValue === "FIXED_21" ? 11 : (Number.isFinite(cardCheckValue) ? cardCheckValue : 0),
        suit,
        damageRolled: false,
        // 対象なしの対決(操縦移動など・2026-07-17): カード上のオープンなリアクション導線で受ける。
        // 先着のリアクションで解決し、「リアクションしない」(実行者/RL)で確定できる
        ...(opposed && state === "open" ? { openReaction: { resolved: false } } : {}),
    };

    const content = await buildAttackCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, isRecheck });

    const attackMsg = await ChatMessage.create({
        content,
        speaker: attacker ? ChatMessage.getSpeaker({ actor: attacker }) : undefined,
        flags: {
            [SCOPE]: {
                // 対決読み取り等の互換のため通常判定と同じ checkResult も持たせる
                checkResult: { actorId: attacker?.id ?? "", result },
                attackCheck: flags,
                // 用途の適用効果(あれば)。攻撃カードに「効果を適用」ボタンを出す(2026-07-10)
                ...(payload.usageEffects ? { usageEffects: payload.usageEffects } : {}),
                // 再判定(あれば)。攻撃カードに「再判定」ボタンを出す(2026-07-11)
                ...(recheckCtx ? { checkRecheck: recheckCtx } : {}),
            },
        },
    });

    // 対象ごとの個別リアクションカードを投稿(active かつ対決判定のときのみ)。全体公開する——
    // 単体対象への攻撃でも他者がリアクションを代行でき(範囲攻撃へのリアクション等)、公開でないと
    // 肩代わりできないため(2026-07-15 ユーザー確定=全て公開)。目標リストは反応結果で更新される。
    if (state === "active" && opposed) {
        for (let i = 0; i < targets.length; i++) {
            await postReactionCard(attackMsg, i);
        }
    }

    // 命中時効果(2026-07-18): 非対決の攻撃は投稿時点で命中が確定している(resolveNoReaction)。
    // 確定済みの対象へ即時付与する(対決ありはリアクション解決時=completeReactionFromCheck)
    if (isAttack) {
        await grantHitTimedEffects(attackMsg, newlyHitTargets([], targets));
    }
}

/**
 * 対象ごとのリアクションカードを投稿する(全体公開・2026-07-15)。
 * 未解決=リアクションボタン(ドッジ/パリー/リアクションしない)、解決後=判定結果カード様の表示に
 * 置換する。状態領域は renderReactionCard がフラグから描画する。
 * @param {ChatMessage} attackMsg 攻撃カード
 * @param {number} targetIndex attackCheck.targets のインデックス
 */
/** 個別リアクションカードの本文を構築する(新規投稿と再判定後のリフレッシュで共用・2026-07-15)。 */
async function buildReactionCardContent({ attackerName, targetName, category, suit, achievement, isAttack = true, usageType = "" }) {
    const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
    return foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/reaction-card.hbs",
        {
            attackerName, targetName,
            categoryLabel: isAttack
                ? (ATTACK_CATEGORY_LABELS[category] ?? category)
                : (USAGE_TYPE_LABELS[usageType] ?? "判定"),
            isAttack,
            suit, suitSymbol: SUIT_SYMBOL[suit] ?? "",
            achievement,
        }
    );
}

export async function postReactionCard(attackMsg, targetIndex) {
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    const t = f?.targets?.[targetIndex];
    if (!t) return;
    const targetActor = await fromUuid(t.uuid).catch(() => null);
    const content = await buildReactionCardContent({
        attackerName: f.attackerName, targetName: t.name,
        category: f.category, suit: f.suit, achievement: f.achievement,
        isAttack: f.isAttack !== false, usageType: f.usageType ?? "",
    });
    await ChatMessage.create({
        content,
        speaker: targetActor ? ChatMessage.getSpeaker({ actor: targetActor }) : undefined,
        flags: { [SCOPE]: { attackReaction: {
            attackMessageId: attackMsg.id, targetIndex,
            targetUuid: t.uuid, targetName: t.name,
            category: f.category, suit: f.suit, achievement: f.achievement,
            isAttack: f.isAttack !== false, usageType: f.usageType ?? "",
            resolved: false,
        } } },
    });
}

/**
 * 攻撃カードの本文を構築する(新規投稿と再判定の置き換え着地で共用・2026-07-14 抽出)。
 * 状態領域(成否・ボタン群)は flags からのライブ描画(renderAttackCard)のため本文には含まれない。
 */
export async function buildAttackCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, isRecheck = false }) {
    const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
    return foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/attack-card.hbs",
        {
            skillLabel:    payload.skillLabel,
            // 攻撃=系統表記・非攻撃の対決判定=用途タイプのラベル(移動/離脱/判定・2026-07-17 一般化)
            categoryLabel: payload.isAttack === false
                ? (USAGE_TYPE_LABELS[payload.usageType] ?? "判定")
                : (ATTACK_CATEGORY_LABELS[payload.category] ?? payload.category),
            suit,
            suitSymbol:    SUIT_SYMBOL[suit] ?? "",
            cardName:      card?.name ?? "",
            fromDeck, trumpUsed, suitMismatch,
            // スート変更(2026-07-12): 使用不可スートを使用可能スートへ変更した事実を明示
            suitChangedDisplay: result.suitChangedFrom
                ? `${SUIT_SYMBOL[result.suitChangedFrom] ?? result.suitChangedFrom} → ${SUIT_SYMBOL[suit] ?? suit}`
                : null,
            isFixed21:     result.fixedAt21 === true,
            isFumble:      result.fumble === true,
            isPhysical:    payload.category === "physical",
            attackSourceName: payload.attackSourceName,
            attackLabel:   formatAttackLabel(payload.damageType, payload.weaponAttack),
            achievement:   result.achievement,
            isRecheck,     // 再判定で置き換えたカードには「再判定」タグを出す(2026-07-14 置き換え着地)
        }
    );
}

/**
 * 再判定(置き換え着地)で、共有された攻撃達成値の再ロールを対象リスト全体へ反映する
 * (2026-07-15 複数対象一括)。命中判定は全対象で共有のため、対象ごとに保存済みの相手値で
 * 成否・差分を再解決する(リアクションのやり直しはしない=resolveAttackRecheckState)。
 * 仕切り直し(pending へ戻る)対象は、対決系の保存値を初期化し、新スートの制御値を取り直す。
 * @param {Array<object>} prevTargets 元の attackCheck.targets
 * @param {{achievement:number, fumble:boolean, suitMismatch:boolean, suit:string}} next 再判定結果
 * @returns {Promise<Array<object>>} 置き換え後の targets
 */
export async function rebuildRecheckedTargets(prevTargets, next) {
    const ability = SUIT_TO_ABILITY[next.suit];
    const out = [];
    for (const t of (prevTargets ?? [])) {
        const st = resolveAttackRecheckState(
            { state: t.state, resolution: t.resolution, targetValue: t.controlValue,
                reactionAchievement: t.reactionAchievement, targetUuid: t.uuid },
            { achievement: next.achievement, fumble: next.fumble === true, suitMismatch: next.suitMismatch === true }
        );
        const nt = { ...t, state: st.state, resolution: st.resolution, diff: st.diff };
        if (st.targetValue !== undefined) {
            // 仕切り直し(リアクション未実施へ戻る): 対決系の保存値を初期化し、新スートの制御値を取り直す
            const actor = await fromUuid(t.uuid).catch(() => null);
            nt.controlValue = actor?.system?.[ability]?.totalControl ?? t.controlValue ?? 0;
            nt.reactionAchievement = null;
            nt.parryGuard = 0;
            nt.reactionEstablished = false; // リアクション自体をやり直すため成立も初期化
        }
        out.push(nt);
    }
    return out;
}

/**
 * 再判定後、未解決(pending)の個別リアクションカードを新しい攻撃値へ追従させる(2026-07-15)。
 * 攻撃全体が失敗(ファンブル/スート不一致)へ転じたときはリアクションの余地がないため未解決カードを
 * 削除する。解決済みカードは公開済みのため触らない。攻撃カードの author(=攻撃者)か GM が呼ぶ。
 * @param {ChatMessage} attackMessage 攻撃カード
 * @param {{achievement:number, suit:string, wholeFail:boolean}} next
 */
export async function refreshReactionCardsAfterRecheck(attackMessage, next) {
    const af = attackMessage.getFlag(SCOPE, "attackCheck");
    const cards = game.messages.filter(m => {
        const rf = m.getFlag(SCOPE, "attackReaction");
        return rf && rf.attackMessageId === attackMessage.id && rf.resolved !== true;
    });
    for (const rc of cards) {
        if (next.wholeFail) { await rc.delete(); continue; }
        const rf = rc.getFlag(SCOPE, "attackReaction");
        const content = await buildReactionCardContent({
            attackerName: af?.attackerName, targetName: rf.targetName,
            category: rf.category, suit: next.suit, achievement: next.achievement,
            isAttack: rf.isAttack !== false, usageType: rf.usageType ?? "",
        });
        await rc.update({
            content,
            [`flags.${SCOPE}.attackReaction.achievement`]: next.achievement,
            [`flags.${SCOPE}.attackReaction.suit`]: next.suit,
        });
    }
}

// ─── 攻撃カードのライブ描画(renderChatMessageHTML・tnx.mjs から登録) ─────────────

/** 対決判定カード(旧・攻撃カード)の状態領域を flags から描画する(未解決=ボタン群/解決後=成否表示に置換)。 */
export function renderAttackCard(message, html) {
    const f = message.getFlag(SCOPE, "attackCheck");
    if (!f) return;
    const area = html.querySelector(".tnx-attack-status");
    if (!area) return;
    area.replaceChildren();

    const esc = foundry.utils.escapeHTML;
    // 攻撃でしか必要のない項目は攻撃時のみ表示(2026-07-17 一般化・旧カードはフラグ無し=攻撃)
    const isAttack = f.isAttack !== false;
    const failWord = isAttack ? "攻撃失敗" : "判定失敗";
    const addLine = (cls, inner) => {
        const div = document.createElement("div");
        div.className = cls;
        div.innerHTML = inner;
        area.appendChild(div);
    };
    const addVerdict = (cls, icon, label) =>
        addLine(`cr-result ${cls}`, `<i class="fas ${icon}"></i> <span>${label}</span>`);

    // 移動(2026-07-17 統合): 達成値÷10(切り捨て)段階を条件表示。全体失敗・対決敗北は 0 段階
    const renderMovementLine = () => {
        if (!f.movement) return;
        const failed = f.state === "fumble" || f.state === "miss" || f.state === "failed";
        const stages = failed ? 0 : movementStagesFromAchievement(Number(f.achievement) || 0);
        addLine("cr-tn", `移動（${esc(f.movement.vehicleName ?? "")}・達成値÷10 切り捨て）: ${stages} 段階`);
    };

    if (f.state === "fumble") { addVerdict("cr-result--fumble", "fa-skull", `ファンブル！（${failWord}）`); renderMovementLine(); return; }
    if (f.state === "miss") { addVerdict("cr-result--failure", "fa-times", `${failWord}（スート不一致・判定不成立）`); renderMovementLine(); return; }
    // 攻撃を失敗させる/対決敗北(リアクション成功)で全体が失敗した場合。対象一覧は下に続けて表示する
    if (f.state === "failed") { addVerdict("cr-result--failure", "fa-times", `${failWord}（リアクションによる）`); }

    // 目標リスト(D&D 風・2026-07-15 複数対象一括): 各対象の防御値(リアクションしなければ目標値に
    // なる制御値=攻撃のみ)と、防御側の解決による結果(命中/回避・達成値)を表示。リアクションボタンは
    // 対象ごとの個別カード側にあり、このカードには置かない。
    const targets = f.targets ?? [];
    if (targets.length) {
        const list = document.createElement("div");
        list.className = "tnx-attack-targets";
        list.innerHTML = `<div class="tnx-attack-targets__head"><i class="fas fa-crosshairs"></i> 目標</div>`;
        for (let ti = 0; ti < targets.length; ti++) {
            const t = targets[ti];
            const row = document.createElement("div");
            // カバー済み: この対象は誰かにカバーされた(ダメージはカバーした側へ・ダメージカードで展開)
            if (t.coveredBy) {
                // カバー行は情報を1つに絞る(固定幅要素を2つ並べると狭い幅で内部折り返しするため)。
                // 「ダメージなし」はシールドアイコン＋「がカバー」で自明なので verdict には出さない
                row.className = "tnx-attack-target tnx-attack-target--miss";
                row.innerHTML = `<span class="tnx-attack-target__icon"><i class="fas fa-user-shield"></i></span>`
                    + `<span class="tnx-attack-target__name">${esc(t.name || "?")}</span>`
                    + `<span class="tnx-attack-target__verdict">${esc(t.coveredBy.name)}がカバー</span>`;
                list.appendChild(row);
                continue;
            }
            row.className = `tnx-attack-target tnx-attack-target--${t.state}`;
            const icon = t.state === "hit" ? "fa-burst" : (t.state === "miss" ? "fa-shield-halved" : "fa-hourglass-half");
            const verdict = t.state === "hit" ? (isAttack ? "命中" : "成功")
                : (t.state === "miss" ? (isAttack ? "回避/失敗" : "失敗") : "リアクション待ち");
            const noneText = isAttack ? `制御値 ${t.controlValue}` : "リアクションなし";
            const valueText = t.state === "pending"
                ? (isAttack ? `制御値 ${t.controlValue}` : "")
                : (t.resolution === "areaCover"
                    ? "範囲攻撃へのリアクション"
                    : t.resolution === "none"
                        ? noneText
                        : `${MODE_LABELS[t.resolution] ?? "対決"} 達成値 ${t.reactionAchievement}`);
            row.innerHTML = `<span class="tnx-attack-target__icon"><i class="fas ${icon}"></i></span>`
                + `<span class="tnx-attack-target__name">${esc(t.name || "?")}</span>`
                + `<span class="tnx-attack-target__val">${esc(valueText)}</span>`
                + `<span class="tnx-attack-target__verdict">${verdict}</span>`;
            // カバー待ち受け中(攻撃のみ): 命中対象をクリックしてカバーできる(ダメージ算出の直前=
            // ダメージカードを出す前のみ)。モード外のクリックは handleCoveringClick 側で無視される。
            if (isAttack && t.state === "hit" && !f.damageRolled) {
                row.classList.add("tnx-attack-coverable");
                row.addEventListener("click", () => handleCoveringClick(message, ti));
            }
            list.appendChild(row);
        }
        area.appendChild(list);
    } else if (f.state === "open" && !f.openReaction) {
        if (isAttack) addLine("tnx-attack-pending-note", "対象なし（ダメージ算出は対象を選択して行います）");
    }

    // 対象なしの対決(操縦移動など・2026-07-17): カード上のオープンなリアクション導線。
    // 先着のリアクションで解決し、「リアクションしない」(実行者/RL)で確定する
    if (f.openReaction) {
        const o = f.openReaction;
        if (o.resolved) {
            if (o.mode) {
                const calc = html.querySelector(".cr-calc-section") ?? area;
                const addRow = (label, value) => {
                    const d = document.createElement("div");
                    d.className = "cr-calc-row";
                    d.innerHTML = `<span class="cr-calc-label">${esc(label)}</span><span class="cr-calc-val">${esc(String(value))}</span>`;
                    calc.appendChild(d);
                };
                addRow("リアクション", `${MODE_LABELS[o.mode] ?? "対決"}（${o.reactorName ?? "?"}）`);
                addRow("リアクション達成値", o.reactionAchievement ?? 0);
                if (f.state !== "failed") addVerdict("cr-result--success", "fa-check", "判定成功（対決勝利）");
            }
        } else if (f.state === "open") {
            area.appendChild(buildReactionButtonRow(f, {
                onMode: (mode) => startOpenReaction(message, mode),
                onNone: () => handleOpenNoReaction(message),
                canDecline: game.user.isGM || resolveSync(f.attackerUuid)?.isOwner === true,
            }));
        }
    }

    renderMovementLine();

    // ダメージカードを出す(攻撃のみ): 全対象が解決済み(pending なし)で命中が1体以上、または対象なし
    const allResolved = targets.every(t => t.state !== "pending");
    const anyHit = targets.some(t => t.state === "hit");
    if (isAttack && (!targets.length || (allResolved && anyHit))) {
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
    }
}

/**
 * 対決欄からリアクション導線のボタン列を作る(個別リアクションカードとオープンリアクションで共用・
 * 2026-07-17)。手段行=リアクション用途タイプのボタン・技能名行があれば汎用「リアクション」・
 * 「リアクションしない」は canDecline のときのみ。導線は隠さず、資格(該当用途タイプの技能を
 * レベル1以上で所持・不可マスク)は押下時に判定して弾く(2026-07-17 ユーザー確定)。
 */
function buildReactionButtonRow(attackFlags, { onMode, onNone, canDecline }) {
    const rows = attackFlags.confrontation ?? [];
    const wrap = document.createElement("div");
    wrap.className = "tnx-reaction-actions";
    if (confrontationHasCannot(rows)) {
        const note = document.createElement("div");
        note.className = "tnx-attack-pending-note";
        note.textContent = "対決不可";
        wrap.appendChild(note);
    }
    const btnRow = document.createElement("div");
    btnRow.className = "tnx-attack-btn-row";
    const addBtn = (label, handler) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tnx-chat-btn";
        btn.textContent = label;
        btn.addEventListener("click", handler);
        btnRow.appendChild(btn);
    };
    for (const type of confrontationReactionTypes(rows)) {
        addBtn(MODE_LABELS[type] ?? type, () => onMode(type));
    }
    if (confrontationSkillRows(rows).length) {
        addBtn(MODE_LABELS.reaction, () => onMode("reaction"));
    }
    if (canDecline) addBtn(MODE_LABELS.none, onNone);
    wrap.appendChild(btnRow);
    return wrap;
}

function resolveSync(uuid) {
    if (!uuid) return null;
    try { return fromUuidSync(uuid); } catch { return null; }
}

/**
 * 個別リアクションカードの状態領域を flags から描画する(renderChatMessageHTML・tnx.mjs から登録)。
 * 未解決=リアクションボタン、解決後=判定結果カード様の表示(制御値/達成値・被弾/回避)。
 * カードは常に全体公開(単体対象でも他者が代行できるため・2026-07-15)。
 */
export function renderReactionCard(message, html) {
    const f = message.getFlag(SCOPE, "attackReaction");
    if (!f) return;
    const area = html.querySelector(".tnx-reaction-status");
    if (!area) return;
    area.replaceChildren();
    const esc = foundry.utils.escapeHTML;
    const isAttack = f.isAttack !== false;

    if (f.resolved) {
        // 目標値/差分は計算セクションへ足し、成否はフルバナーで表示(check-result と同型・
        // 余白は cr-calc-section / cr-result 既定に載せる・2026-07-15 余白統一)
        const calc = html.querySelector(".cr-calc-section") ?? area;
        const hit = f.hit === true;
        const addRow = (label, value, rowCls = "cr-calc-row", valCls = "cr-calc-val") => {
            const d = document.createElement("div");
            d.className = rowCls;
            d.innerHTML = `<span class="cr-calc-label">${label}</span><span class="${valCls}">${esc(String(value))}</span>`;
            calc.appendChild(d);
        };
        const modeLabel = MODE_LABELS[f.resolution] ?? "";
        // 別人が代行したときだけ実行者名を添える(自分のリアクションは名前が自明なので繰り返さない)
        const isCover = f.reactorName && f.reactorName !== f.targetName;
        if (f.resolution === "none") {
            // リアクションしない=攻撃は制御値で受けた(制御値と成否で十分)。非攻撃は制御値を持たない
            if (isAttack) addRow("制御値", f.control ?? 0);
        } else {
            // カードをプレイしたリアクション: モード＋達成値。達成値の総計行を renderRecheckButton が
            // 再判定/修正の対象として拾う(このカードが結果カードそのもの・2026-07-15)
            addRow("リアクション", isCover ? `${modeLabel}（${f.reactorName}）` : modeLabel);
            addRow("達成値", f.reactionAchievement ?? 0, "cr-calc-row cr-total-row", "cr-total-num");
        }
        if (Number.isFinite(f.diff)) addRow("差分値", f.diff >= 0 ? `+${f.diff}` : `${f.diff}`);
        // 成否表記(2026-07-15 ユーザー確定): ルールに無い言い換え(「受け」等)は使わない。リアクション成功=
        // 攻撃無効。リアクションしないで被弾しなかった場合はリアクションしていないため「攻撃無効」(ルール語)。
        // 非攻撃の対決(2026-07-17): 被弾/攻撃無効の語は使えないため「相手の判定成立/リアクション成功」
        const hitLabel = isAttack ? "被弾" : "相手の判定成立";
        const notHitLabel = f.resolution === "none"
            ? (isAttack ? "攻撃無効" : "判定不成立")
            : "リアクション成功";
        const verdict = document.createElement("div");
        verdict.className = `cr-result ${hit ? "cr-result--failure" : "cr-result--success"}`;
        verdict.innerHTML = `<i class="fas ${hit ? "fa-burst" : "fa-shield-halved"}"></i> <span>${hit ? hitLabel : notHitLabel}</span>`;
        area.appendChild(verdict);
        return;
    }

    // 未解決: リアクション導線は対決欄から導出する(2026-07-17 ユーザー確定=手段行・技能名行が正。
    // 資格は押下時に判定して弾くため、ボタンは全員に出す=他者の代行も可・2026-07-15)。実行アクターは
    // startReaction 側で reactor(割り当てキャラ→選択トークン)を解決する。「リアクションしない」は
    // 対象自身の宣言なので GM か対象所有者のみ。
    const attackF = game.messages.get(f.attackMessageId)?.getFlag(SCOPE, "attackCheck");
    const target = resolveSync(f.targetUuid);
    const canDeclineForTarget = game.user.isGM || target?.isOwner;
    const wrap = buildReactionButtonRow(attackF ?? { confrontation: [] }, {
        onMode: (mode) => startReaction(message, mode),
        onNone: () => handleNoReaction(message),
        canDecline: canDeclineForTarget,
    });
    const note = document.createElement("div");
    note.className = "tnx-attack-pending-note";
    note.textContent = `${isAttack ? "攻撃達成値" : "相手の達成値"} ${f.achievement} — リアクションを選択してください`;
    wrap.prepend(note);
    area.appendChild(wrap);
}

/**
 * リアクションを行うアクター(リアクター)を解決する。リアクションは攻撃対象に限らず他者が
 * 代行できる(操縦者が同乗者を庇う等・他者の被攻撃に代理反応する技能が複数存在する。
 * 2026-07-09 ユーザー確定)。**リアクターはクリックしたユーザーの割り当てキャラクターで決める**
 * (カードの発話者=攻撃対象で決めない・2026-07-15 ユーザー確定)。割り当てが無い場合(GM 等)のみ
 * 選択トークンにフォールバック。権限が無ければ弾く。命中結果は従来どおり攻撃対象(f.targetUuid)に返る。
 * @returns {Actor|null} 解決できなければ警告して null
 */
function resolveReactor() {
    // リアクターは「誰がクリックしたか」=クリックしたユーザーの割り当てキャラクターで決める
    // (カードの発話者=攻撃対象や、たまたま選択中のトークンで決めない・2026-07-15 ユーザー確定)。
    // 割り当てが無い場合(GM 等)のみ選択トークンにフォールバックする(NPC を代行して反応するため)。
    const actor = game.user.character ?? canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (!actor) {
        ui.notifications.warn("リアクションを行うキャラクターがありません（ユーザーにキャラクターを割り当てるか、トークンを選択してください）。");
        return null;
    }
    if (!actor.isOwner) {
        ui.notifications.warn(`「${actor.name}」を操作する権限がありません。`);
        return null;
    }
    return actor;
}

/**
 * 範囲攻撃へのリアクション/攻撃を失敗させるで攻撃が解決したとき、まだ未解決の他対象リアクションカードを
 * 閉じる(削除)。削除権限(GM か作者=攻撃者)がある場合のみ実行し、無ければ残す——その場合も
 * startReaction/handleNoReaction 側の「解決済み」ガードで誤った再解決は防がれる(2026-07-15)。
 */
async function closeUnresolvedReactionCards(attackMessage, exceptIndex) {
    const cards = game.messages.filter(m => {
        const rf = m.getFlag(SCOPE, "attackReaction");
        return rf && rf.attackMessageId === attackMessage.id && rf.resolved !== true && rf.targetIndex !== exceptIndex;
    });
    for (const rc of cards) {
        if (game.user.isGM || rc.isAuthor) await rc.delete();
    }
}

// ─── 命中確定(リアクションなし/対決) ─────────────────────────────────────────

/** 「リアクションしない」(個別リアクションカードから): 攻撃=制御値で成否を確定・
 *  非攻撃の対決=相手の判定がそのまま成立(制御値を持たない・2026-07-17)。 */
export async function handleNoReaction(reactionMsg) {
    const r = reactionMsg.getFlag(SCOPE, "attackReaction");
    if (!r || r.resolved) return;
    const target = await fromUuid(r.targetUuid).catch(() => null);
    if (!target) { ui.notifications.warn("対象を解決できません。"); return; }
    if (!game.user.isGM && !target.isOwner) {
        ui.notifications.warn("リアクションの選択は対象の操作者（または RL）が行います。");
        return;
    }
    const attackMsg = game.messages.get(r.attackMessageId);
    // 既に解決済み(範囲攻撃へのリアクション/攻撃を失敗させるで回避確定)の対象は再解決しない(2026-07-15)。
    const at = attackMsg?.getFlag(SCOPE, "attackCheck")?.targets?.[r.targetIndex];
    if (at && at.state !== "pending") { ui.notifications.info("この対象への攻撃は既に解決済みです。"); return; }
    if (r.isAttack === false) {
        if (attackMsg) await applyAttackTargetPatch(attackMsg, r.targetIndex,
            { state: "hit", resolution: "none", reactionAchievement: null, diff: null, parryGuard: 0 });
        await applyReactionPatch(reactionMsg,
            { resolved: true, resolution: "none", control: null, hit: true, diff: null, reactorName: target.name });
        return;
    }
    const ability = SUIT_TO_ABILITY[r.suit];
    const control = target.system[ability]?.totalControl ?? 0;
    const { hit, diff } = resolveNoReaction(r.achievement, control);
    if (attackMsg) await applyAttackTargetPatch(attackMsg, r.targetIndex,
        { state: hit ? "hit" : "miss", resolution: "none", reactionAchievement: null, diff, parryGuard: 0 });
    // 「リアクションしない」は対象自身が制御値で受ける宣言=リアクター=対象
    await applyReactionPatch(reactionMsg,
        { resolved: true, resolution: "none", control, hit, diff, reactorName: target.name });
}

/**
 * 対決欄とリアクターの状態から、リアクションに使用する技能を選ばせる(2026-07-17 再編)。
 * 資格はここ=押下時に判定して弾く(導線は隠さない・ユーザー確定):
 * - 手段行(mode=リアクション用途タイプ): そのタイプの用途を持つ技能をレベル1以上で所持。
 * - 技能名行(mode="reaction"): 列挙された無印技能のどれかをレベル1以上で所持。
 * - ※(必須)行: その技能すべてをレベル1以上で所持していなければ不可。候補=※技能。
 * - 「不可」マスク: 「対決不可にもリアクション可」(ignoresUnopposable)の用途を持つ技能のみ通る
 *   (その場合も下地の対決拘束は受ける)。
 * - **対決の特殊処理はヴィークル操縦時のみ**: 操縦中(準備済みヴィークル)のリアクターは、対決が
 *   自動的に「〈操縦〉※」になる(リアクター側状態由来・下地を置き換え・不可マスクは残る)。
 * 技能→用途の既定対応(旧・既定技能)は完全廃止=候補・資格は用途タイプの所持だけで決まる。
 * @returns {Promise<?{skill: Item, usageId: ?string}>} null=不適格・キャンセル(警告はここで出す)
 */
async function selectReactionSkill(reactor, confrontationRows, mode) {
    let rows = confrontationRows ?? [];
    const vehicle = reactor.items.find(i => i.type === "vehicle" && i.system.isPrepared && i.system.operateSkillKey);
    if (vehicle) {
        rows = [
            ...(confrontationHasCannot(rows) ? [{ value: "cannot", name: "" }] : []),
            { value: "skillNameAsterisk", name: vehicle.system.operateSkillKey },
        ];
    }
    const cannot = confrontationHasCannot(rows);
    const levelOk = (s) => (Number(s.system.levelTotal ?? s.system.level) || 0) >= 1;
    // 不可マスク下では「対決不可にもリアクション可」の用途だけが使える
    const usageEligible = (a, type) => executionFormOf(a) === "check"
        && (!type || a.type === type)
        && (!cannot || a.ignoresUnopposable === true);
    const skillEligible = (s, type) => levelOk(s) && (s.system.actions ?? []).some(a => usageEligible(a, type));

    // ※(必須)技能: すべて所持していなければリアクション不可。候補は※技能そのもの
    // (「必ずコンボに含める」=※技能を起点に判定する。コンボの構成はその用途の設定が担う)
    const asterisks = asteriskSkillKeys(rows);
    let candidates;
    const typeMode = mode !== "reaction" ? mode : null;
    if (asterisks.length) {
        candidates = [];
        for (const key of asterisks) {
            const s = findItemByIdentificationKey(reactor, key);
            if (!s || !levelOk(s)) {
                const name = resolveItemNameByKey(reactor, key) || key;
                ui.notifications.warn(`このリアクションには「${name}」（レベル1以上）が必要です。`);
                return null;
            }
            candidates.push(s);
        }
        candidates = candidates.filter(s => (s.system.actions ?? []).some(a => usageEligible(a, null)));
    } else if (typeMode) {
        // 手段行: そのリアクション用途タイプを持つ技能(2026-07-17=用途タイプが資格の正)
        candidates = reactor.items
            .filter(i => (i.type === "generalSkill" || i.type === "styleSkill") && skillEligible(i, typeMode))
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    } else {
        // 技能名行(無印): 列挙のどれか1つがコンボに含まれていればよい=列挙技能を候補にする
        candidates = confrontationSkillRows(rows)
            .filter(row => !row.asterisk)
            .map(row => findItemByIdentificationKey(reactor, row.key))
            .filter(s => s && skillEligible(s, null));
    }

    if (!candidates.length) {
        ui.notifications.warn(cannot
            ? "この判定は対決不可のため、リアクションできません。"
            : "リアクションに使用できる技能がありません（該当する用途をレベル1以上の技能で所持している必要があります）。");
        return null;
    }

    const skillId = await TargetSelectionDialog.prompt({
        title: `${MODE_LABELS[mode] ?? "リアクション"}: 使用技能の選択`,
        label: `${MODE_LABELS[mode] ?? "リアクション"}に使用する技能を選択`,
        options: buildSkillOptions(candidates),
        selectLabel: "判定へ",
    });
    if (!skillId) return null;
    const skill = reactor.items.get(skillId);
    if (!skill) return null;

    // 手段行は該当タイプの用途がただ1つなら直接起動する(複数なら通常のピッカーに委ねる)
    let usageId = null;
    if (typeMode) {
        const matches = (skill.system.actions ?? []).filter(a => usageEligible(a, typeMode));
        if (matches.length === 1) usageId = matches[0]._id;
    }
    return { skill, usageId };
}

/**
 * リアクションを開始する(個別リアクションカードから)。mode=リアクション用途タイプ
 * ("dodge"/"parry"/"mentalReaction"…)か "reaction"(技能名行由来の汎用)。
 * 判定は通常の技能判定フローで行い、完了時に completeReactionFromCheck が対決を解決する。
 */
export async function startReaction(reactionMsg, mode) {
    const r = reactionMsg.getFlag(SCOPE, "attackReaction");
    if (!r || r.resolved) return;
    // 既に解決済み(範囲攻撃へのリアクション/攻撃を失敗させるで回避確定)の対象は再解決しない(2026-07-15)。
    const attackMsg = game.messages.get(r.attackMessageId);
    const attackF = attackMsg?.getFlag(SCOPE, "attackCheck");
    const at0 = attackF?.targets?.[r.targetIndex];
    if (at0 && at0.state !== "pending") { ui.notifications.info("この対象への攻撃は既に解決済みです。"); return; }
    // リアクター(実行アクター)は攻撃対象に限らない(他者が代行可)。割り当てキャラ→選択トークン、
    // 権限が無ければ弾く。判定は reactor 自身の技能・値で行い、命中結果は攻撃対象に返る。
    const reactor = resolveReactor();
    if (!reactor) return;

    const sel = await selectReactionSkill(reactor, attackF?.confrontation ?? [], mode);
    if (!sel) return;

    // パリー: 受け値=パリー参照武器(weaponRefs.parry)の guardValue(判定成立なら敗北でも軽減に加算)。
    // AR−1 の専用自動化は廃止(2026-07-12)——パリー技能の用途の消費先設定(AR を消費)が担う
    let parryGuard = 0;
    if (mode === "parry") {
        // パリー参照武器(character-base の weaponRefs.parryItemId)。受け値は実効値(total=AE込み)を
        // 読み、未選択=生身(baseGuard.value+mod=戦闘タブ表示と同じ値)にフォールバックする
        // (2026-07-14・攻撃力と同じ素値読み/生身無視の是正)
        const parryId = reactor.system.weaponRefs?.parryItemId || "";
        const parryWeapon = parryId ? reactor.items.get(parryId) : null;
        if (parryWeapon) {
            parryGuard = parryWeapon.system.guardValue?.mode === "value"
                ? (Number(parryWeapon.system.guardValue.total ?? parryWeapon.system.guardValue.value) || 0) : 0;
        } else {
            const bg = reactor.system.baseGuard ?? {};
            parryGuard = (Number(bg.value) || 0) + (Number(bg.mod) || 0);
        }
    }

    // 起動は唯一の起動関数へ集約(2026-07-15 ユーザー確定)。用途・コンボ・消費・判定ボーナス・適用効果は
    // シートの技能クリックと全く同じ処理で解決し、ここではリアクション文脈だけを注入する
    // (組み合わせの可否はユーザー/RL が決めるものでシステムは制限しない)。
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(reactor, sel.skill, {
        ...(sel.usageId ? { usageId: sel.usageId } : {}),
        reaction: { reactionMessageId: reactionMsg.id, attackMessageId: r.attackMessageId, targetIndex: r.targetIndex, mode, parryGuard },
    });
}

/**
 * 対象なしの対決のリアクションを開始する(対決判定カード上のオープン導線・2026-07-17)。
 * 先着のリアクションで解決する。完了時は completeReactionFromCheck(open)が対決を解決し、
 * リアクション側勝利で判定全体を「失敗」にする(例: 操縦移動なら移動不可)。
 */
export async function startOpenReaction(attackMsg, mode) {
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    if (!f?.openReaction || f.openReaction.resolved || f.state !== "open") {
        ui.notifications.info("この判定は既に解決済みです。");
        return;
    }
    const reactor = resolveReactor();
    if (!reactor) return;
    const sel = await selectReactionSkill(reactor, f.confrontation ?? [], mode);
    if (!sel) return;
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(reactor, sel.skill, {
        ...(sel.usageId ? { usageId: sel.usageId } : {}),
        reaction: {
            attackMessageId: attackMsg.id, reactionMessageId: null, targetIndex: null,
            open: true, mode, parryGuard: 0, reactorId: reactor.id,
        },
    });
}

/** 「リアクションしない」(オープン対決・実行者/RL): 導線を閉じ、判定をそのまま確定する。 */
export async function handleOpenNoReaction(attackMsg) {
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    if (!f?.openReaction || f.openReaction.resolved) return;
    const attacker = resolveSync(f.attackerUuid);
    if (!game.user.isGM && !(attacker?.isOwner)) {
        ui.notifications.warn("「リアクションしない」の確定は実行者の操作者（または RL）が行います。");
        return;
    }
    await applyAttackPatch(attackMsg, { openReaction: { resolved: true, mode: null } });
}

/**
 * リアクション判定完了時の対決解決(TnxCheckFlow._execute から)。
 * **受動有利**: 攻撃達成値がリアクション達成値を**上回れば**命中・**同値はリアクション側勝利=攻撃回避**。
 * リアクション不成立(ファンブル/スート不一致)は達成値 0 として扱う。
 * パリーは判定成立なら敗北でも受け値をダメージ軽減へ(parryGuard)。
 */
export async function completeReactionFromCheck(payload, result, { suitMismatch = false, allowResolved = false, recheckCtx = null } = {}) {
    const attackMsg = game.messages.get(payload.attackMessageId);
    const reactionMsg = payload.reactionMessageId ? game.messages.get(payload.reactionMessageId) : null;
    if (!attackMsg) return;
    const f = attackMsg.getFlag(SCOPE, "attackCheck");

    // オープン対決(対象なし・2026-07-17): 先着のリアクションで解決する。リアクション側勝利で
    // 判定全体を「失敗」に(例: 操縦移動なら移動不可)。再判定/修正の再解決(allowResolved)は
    // 自分が解決した対決(同一リアクター)のみ適用する
    if (payload.open === true) {
        const o = f?.openReaction;
        if (!o) return;
        if (o.resolved && !(allowResolved && o.reactorId && o.reactorId === payload.reactorId)) return;
        if (!o.resolved && allowResolved) return;
        const okOpen = !result.fumble && !suitMismatch;
        const reactAchOpen = okOpen ? (result.achievement ?? 0) : 0;
        const opposedOpen = resolveOpposed(f.achievement, reactAchOpen);
        await applyAttackPatch(attackMsg, {
            state: opposedOpen.hit ? "open" : "failed",
            openReaction: {
                resolved: true, mode: payload.mode,
                reactorId: payload.reactorId ?? "",
                reactorName: game.actors.get(payload.reactorId)?.name ?? "?",
                reactionAchievement: reactAchOpen,
                established: okOpen,
            },
        });
        return;
    }

    const t = f?.targets?.[payload.targetIndex];
    // 通常は未解決のみ。再判定/修正での対決再解決(allowResolved)は解決済み(hit/miss)でも再解決する(2026-07-15)
    if (!t || (t.state !== "pending" && !allowResolved)) return;

    const ok = !result.fumble && !suitMismatch;
    const reactAch = ok ? (result.achievement ?? 0) : 0;
    const { hit, diff } = resolveOpposed(f.achievement, reactAch);
    const thisPatch = {
        state: hit ? "hit" : "miss",
        resolution: payload.mode,
        reactionAchievement: reactAch,
        diff,
        // 判定の成立(一般定義=ファンブル/スート不一致でなければ成立・勝敗不問)。
        // 社会ダメージの報酬点軽減の起動条件としてダメージカードへ引き継ぐ(2026-07-17)
        reactionEstablished: ok,
        // 受け値はパリー成立時のみ有効(勝利時は攻撃無効のため実質使用されない)
        parryGuard: payload.mode === "parry" && ok ? (payload.parryGuard ?? 0) : 0,
    };

    // 範囲攻撃へのリアクション / 攻撃を失敗させる(2026-07-15 ユーザー確定): リアクション成功(=攻撃回避)を
    // トリガーに、同じ攻撃の全対象を回避で解決する。攻撃を失敗させる場合は攻撃の overall state も「失敗」に
    // する(表示=攻撃失敗)。ファンブル/スート不一致(不成立)や被弾時は発火しない。
    const triggerAllAvoid = ok && !hit
        && (payload.reactionAreaAttack === true || payload.reactionFailsAttack === true);
    if (triggerAllAvoid) {
        // 全対象を単一パッチで一括解決(この対象=対決結果・他対象=範囲攻撃へのリアクションで回避)。
        // 対象個別パッチと分けると非作者クライアントのソケット委譲が競合して本人分を上書きしうるため、
        // f(解決前スナップショット)を基点に本人分も明示して 1 度で送る。
        const targets = foundry.utils.deepClone(f.targets ?? []);
        for (let i = 0; i < targets.length; i++) {
            if (i === payload.targetIndex) { Object.assign(targets[i], thisPatch); continue; }
            targets[i].state = "miss";
            targets[i].resolution = "areaCover"; // 範囲攻撃へのリアクションで回避(達成値を持たない)
            targets[i].reactionAchievement = null;
            targets[i].diff = null;
            targets[i].parryGuard = 0;
        }
        const patch = { targets };
        if (payload.reactionFailsAttack === true) patch.state = "failed";
        await applyAttackPatch(attackMsg, patch);
    } else {
        await applyAttackTargetPatch(attackMsg, payload.targetIndex, thisPatch);
    }

    // 命中時効果(2026-07-18): この対象が hit へ遷移したら付与する(再解決で既に hit だった対象は
    // 付与済み=再付与しない。全対象回避(triggerAllAvoid)はこの対象も miss なので来ない)
    if (f.isAttack !== false && thisPatch.state === "hit" && t.state !== "hit") {
        await grantHitTimedEffects(attackMsg, [{ uuid: t.uuid, name: t.name }]);
    }

    if (reactionMsg) {
        // 初回解決時: リアクションカードを結果カード化する(2026-07-15 ユーザー確定=別途の結果カードは出さない)。
        // 再判定/修正が読む checkResult/checkRecheck をリアクションカードに保存(再解決時は recheckCtx なし=触らない)
        // リアクションを行ったキャラ(=クリックしたユーザーのキャラ)をカードに明示する(対象と別人=肩代わり)
        const reactorName = recheckCtx?.actorId ? (game.actors.get(recheckCtx.actorId)?.name ?? null) : null;
        const extraFlags = {};
        if (recheckCtx) {
            extraFlags[`flags.${SCOPE}.checkResult`] = { actorId: recheckCtx.actorId, result };
            extraFlags[`flags.${SCOPE}.checkRecheck`] = recheckCtx;
            // リアクション用途の適用効果(あれば)。リアクションカードに「効果を適用」ボタンを出す
            // (renderUsageEffectButton は usageEffects フラグで発火・2026-07-15)
            if (recheckCtx.usageEffects) extraFlags[`flags.${SCOPE}.usageEffects`] = recheckCtx.usageEffects;
        }
        await applyReactionPatch(reactionMsg,
            { resolved: true, resolution: payload.mode, reactionAchievement: reactAch, hit, diff,
                ...(reactorName ? { reactorName } : {}) }, extraFlags);
    }

    // 全対象回避の場合、まだ未解決の他対象リアクションカードは不要になるので閉じる(権限のある側のみ)
    if (triggerAllAvoid) await closeUnresolvedReactionCards(attackMsg, payload.targetIndex);
}

// ─── カバー(ダメージ算出の直前に、他者への予定ダメージを自身へ付け替える・2026-07-16 ユーザー確定) ──

/**
 * カバー待ち受け中に、攻撃カードの命中対象がクリックされたときの処理。ダメージ算出の直前=ダメージ
 * カードを出す前(!damageRolled)のみ。その対象を文脈にカバーの判定(唯一の起動関数 `_activateItemCheck`・
 * covering 文脈)を起動する。成功で completeCoveringFromCheck が攻撃カードへ印を付ける。モード外の
 * クリックは無視(通常表示)。
 * @param {ChatMessage} attackMessage 攻撃カード
 * @param {number} targetIndex attackCheck.targets のインデックス
 */
export async function handleCoveringClick(attackMessage, targetIndex) {
    const state = TnxCheckFlow.peekAchievementAction("covering");
    if (!state) return; // モード外のクリックは無視
    const f = attackMessage.getFlag(SCOPE, "attackCheck");
    if (!f || f.damageRolled) { ui.notifications.warn("ダメージカードを出した後はカバーできません。"); return; }
    const t = (f.targets ?? [])[targetIndex];
    if (!t || t.state !== "hit" || t.coveredBy) return; // 命中していない/カバー済みは対象にしない
    const actor = game.actors.get(state.actorId);
    const skill = actor?.items.get(state.skillItemId);
    if (!skill) { TnxCheckFlow.cancelAchievementAction(); return; }
    TnxCheckFlow.cancelAchievementAction();
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(actor, skill, {
        covering: { attackMessageId: attackMessage.id, targetIndex, usageId: state.usageId },
    });
}

/**
 * カバーの完了継続(判定成功で攻撃カードの対象にカバーの印を付ける)。目標値「なし」運用ではスート一致
 * (不成立でない)で成功(result.success は null=未比較のため false 以外で成立)。成功なら対象に coveredBy
 * を付ける——ダメージカードを出すとき buildDamageTargets がこれを展開し、元対象は被弾なし・カバーした側
 * (受け値なし)へ付け替える。カバーした側が元々命中対象なら自分の行(受け値あり)は別に残る。
 * @param {{attackMessageId:string, targetIndex:number}} payload
 * @param {object} result 判定結果
 * @param {{suitMismatch?:boolean, coverer:Actor|null}} [opts]
 */
export async function completeCoveringFromCheck(payload, result, { suitMismatch = false, coverer = null } = {}) {
    const attackMsg = game.messages.get(payload.attackMessageId);
    if (!attackMsg) return;
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    if (!f) return;
    if (f.damageRolled) { ui.notifications.warn("ダメージカードを出した後はカバーできません。"); return; }
    const t = (f.targets ?? [])[payload.targetIndex];
    if (!t || t.state !== "hit" || t.coveredBy || !coverer) { ui.notifications.warn("この対象はカバーできません。"); return; }
    const ok = !result.fumble && !suitMismatch && result.success !== false;
    if (!ok) { ui.notifications.info(`「${coverer.name}」のカバーは成立しませんでした。`); return; }
    await applyAttackTargetPatch(attackMsg, payload.targetIndex, { coveredBy: { uuid: coverer.uuid, name: coverer.name } });
    ui.notifications.info(`「${coverer.name}」が「${t.name}」をカバーしました。`);
}

// ─── フラグ更新(権限がなければ GM へソケット委譲=applyMessagePatch に一本化・2026-07-16) ──

/** 攻撃カードのフラグを更新する(全クライアントでライブ書き換え)。 */
export async function applyAttackPatch(message, patch) {
    await TnxSocketHandler.applyMessagePatch(message, patch, "attackCheck");
}

/** 攻撃カードの特定対象(targets[index])を更新する(配列ごと差し替え・権限委譲は applyAttackPatch)。 */
async function applyAttackTargetPatch(attackMsg, index, patch) {
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    const targets = foundry.utils.deepClone(f?.targets ?? []);
    if (!targets[index]) return;
    Object.assign(targets[index], patch);
    await applyAttackPatch(attackMsg, { targets });
}

/** リアクションカードを更新する。GM/作者は直接・非作者は GM へ委譲(applyMessagePatch)。カードは
 *  投稿時から全体公開。extraFlags は attackReaction 以外の生フラグパス(結果カード化の
 *  checkResult/checkRecheck 等)を同時に更新する。 */
async function applyReactionPatch(reactionMsg, patch, extraFlags = {}) {
    const data = {};
    for (const [k, v] of Object.entries(patch)) data[`flags.${SCOPE}.attackReaction.${k}`] = v;
    Object.assign(data, extraFlags);
    await TnxSocketHandler.applyMessagePatch(reactionMsg, data);
}
