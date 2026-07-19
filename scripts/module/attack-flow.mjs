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
import { resolveUsageTargetRefs } from "./target-resolution.mjs";
import { TargetSelectionDialog } from "./tnx-dialog.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { resolveNoReaction, resolveOpposed, formatAttackLabel, combineWeaponAttack, resolveAttackRecheckState } from "./attack-flow-logic.mjs";
import { resolveTargetDefense, resolveOpenReactions, reactionButtonPlan } from "./reaction-logic.mjs";
import { buildCheckCardContext, suitSymbolOf } from "./check-card-context.mjs";
import { resolveAttackWeapons, attackWeaponDisplayName, attackWeaponKindEligible } from "./attack-weapons.mjs";
import { isOutfitUnusable, isOutfitDestroyed } from "../data/item/helpers.mjs";
import { buildSkillOptions } from "./skill-select.mjs";
import { movementStagesFromAchievement } from "./vehicle-move-logic.mjs";
import { USAGE_TYPE_LABELS, attackCategoryOf, usageDisplayName, executionFormOf } from "./usage-types.mjs";
import {
    confrontationHasCannot, asteriskSkillKeys, isOpposedConfrontation,
    confrontationReactionTypes, confrontationSkillRows,
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

// リアクション導線の表示ラベル(2026-07-18 大改修: ボタン=ドッジ/パリー/リアクション/
// リアクション（その他）。精神/社会/移動妨害等の系統別タイプ行は「リアクション」1ボタンへ集約され、
// 新規の resolution は "reaction"/"other" で保存される。系統タイプキーは旧カードの表示互換)。
// none=リアクションしない(スキップ=制御値受け・旧カード互換の表示にも使う)
const MODE_LABELS = Object.freeze({
    ...Object.fromEntries(["dodge", "parry", "mentalReaction", "socialReaction",
        "moveBlockReaction", "escapeBlockReaction"].map(k => [k, USAGE_TYPE_LABELS[k]])),
    reaction: "リアクション",
    other:    "リアクション（その他）",
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

    // 対象決定(2026-07-18 決定表駆動): 用途の「対決」×「対象」で解決する(レティクル全件・
    // 対象数の自動化はしない)。対象なし群(-/解説参照/その他)は対象なし=オープンリアクションへ。
    // 未ターゲット時のダイアログ/自動セルフ・妥当性警告は target-resolution に一本化
    const targets = await resolveUsageTargetRefs(actor, usage);
    if (targets === null) return; // キャンセル/ターゲット不正

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
    // 対象: 攻撃と同じ決定表駆動(2026-07-18)。対象なし群(移動・離脱の既定=対象「-」等)は
    // 対象要求をせず、カード上のオープンなリアクション導線で受ける(KI-030 是正)
    const targets = await resolveUsageTargetRefs(actor, usage);
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
export async function postAttackCard({ payload, result, suit, cardCheckValue = null, card, fromDeck, trumpUsed, suitMismatch, checkSources = [], recheckCtx = null, isRecheck = false }) {
    const attacker = await fromUuid(payload.attackerUuid).catch(() => null);

    // 全体の状態(命中判定は全対象で共有・2026-07-15 複数対象一括): ファンブル/スート不一致は
    // 判定全体が失敗。対象なしは open。それ以外は対象ごとに解決(active)
    let state;
    if (result.fumble) state = "fumble";
    else if (suitMismatch) state = "miss";
    else if (!(payload.targets?.length)) state = "open";
    else state = "active";

    // 移動(2026-07-19 ユーザー確定): 達成値が10に満たない(=0段階)場合はその時点で**移動失敗=
    // 判定失敗扱い**(移動を妨害するまでもないため)。リアクション導線も出さない
    const movementFailed = !!payload.movement && !result.fumble && !suitMismatch
        && movementStagesFromAchievement(Number(result.achievement) || 0) === 0;
    if (movementFailed) state = "failed";

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
            // Check_Rules「判定の成立」)。社会ダメージの報酬点軽減の起動条件(2026-07-17。
            // 2026-07-18 裁定: 代理の成立でも開く=resolveTargetDefense が導出)
            reactionEstablished: false,
            // 複数リアクション併存(2026-07-18): 本人の決断(null=未決断/reacted/skipped)と
            // 本人＋代理のリアクション要素。state 等の従来フィールドは resolveTargetDefense の導出値
            selfDecision: null,
            reactions: [],
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
        // 移動失敗(達成値10未満・2026-07-19): 成否バナーの文言判別用
        ...(movementFailed ? { failedReason: "movement" } : {}),
        // 対象なしの対決(移動・離脱・「判定」の対決等・2026-07-18 任意・複数化): カード上の
        // 「リアクション」ボタンを任意のキャラクターがクリックする(キャラごとに1回)。
        // 結果=成立したリアクションの最高達成値1件のみ。明示の確定操作は無い(ライブ成否)。
        // 移動失敗(failed)でも器は敷く=再判定/事後修正で 10 以上へ回復したとき導線が開くように
        ...(opposed && !(payload.targets?.length) && !result.fumble && !suitMismatch
            ? { openReactions: [] } : {}),
    };

    const content = await buildAttackCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, checkSources, isRecheck });

    // リアクションカードの事前一括投稿は廃止(2026-07-18 大改修): 入口は対象リストの名前クリック
    // (本人/代理ダイアログ)・オープンは「リアクション」ボタン。カードはリアクションすると決めた
    // キャラクターの分だけ、シークレット(GM＋本人)で都度作成される(createReactionCard)。
    await ChatMessage.create({
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
}

/** 個別リアクションカード(未解決=シークレット)の本文を構築する(新規作成と再判定後のリフレッシュで共用)。 */
async function buildReactionCardContent({ attackerName, targetName, category, suit, achievement,
    isAttack = true, usageType = "", reactorName = "", isSelf = true }) {
    return foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/reaction-card.hbs",
        {
            resolved: false,
            attackerName, targetName,
            categoryLabel: isAttack
                ? (ATTACK_CATEGORY_LABELS[category] ?? category)
                : (USAGE_TYPE_LABELS[usageType] ?? "判定"),
            isAttack,
            suit, suitSymbol: suitSymbolOf(suit),
            achievement,
            // 代理リアクション(2026-07-18): リアクターを明示(本人のときは自明なので出さない)
            reactorName: isSelf ? "" : reactorName,
        }
    );
}

/**
 * 解決済みリアクションカード(=リアクション判定の結果カード)の本文を構築する(2026-07-19 基底化)。
 * 判定結果カードの基底(buildCheckCardContext=カード値・能力値・報酬点・判定ボーナス等の内訳)に
 * 対決情報(攻撃者→対象・攻撃達成値・リアクション手段)を足す。初回解決(completeReactionFromCheck)と
 * 再判定の置き換え着地(_applyRecheckReplacement)で共用。差分値・成否バナーは flags からのライブ描画。
 */
export async function buildReactionResultContent({ reactionFlags, mode, skillLabel, card, suit, result,
    fromDeck = false, trumpUsed = false, suitMismatch = false, checkSources = [], isRecheck = false }) {
    const r = reactionFlags ?? {};
    return foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/reaction-card.hbs",
        {
            resolved: true,
            ...buildCheckCardContext({
                skillLabel, typeLabel: "リアクション",
                card, suit, result, fromDeck, trumpUsed, suitMismatch, checkSources, isRecheck,
            }),
            isAttack: r.isAttack !== false,
            attackerName: r.attackerName ?? "",
            targetName: r.targetName ?? "",
            // 代理のときだけリアクターを明示(本人は自明)
            reactorName: r.isSelf === true ? "" : (r.reactorName ?? ""),
            attackSuit: r.suit ?? "",
            attackSuitSymbol: suitSymbolOf(r.suit),
            attackAchievement: r.achievement ?? 0,
            modeLabel: MODE_LABELS[mode] ?? "対決",
        }
    );
}

/**
 * シークレットリアクションカードを作成する(対象ありの対決・2026-07-18 新フロー)。クリックした
 * ユーザーと GM のみに whisper され、解決時に結果カード化して全体公開される。リアクター(実行
 * アクター)は作成時に固定する。オープンリアクションはカードを挟まず直接起動する
 * (handleOpenReactionClick・2026-07-19 ユーザー是正)。
 * @param {ChatMessage} attackMsg 対決判定カード
 * @param {number} targetIndex attackCheck.targets のインデックス
 * @param {Actor} reactor リアクター
 * @param {boolean} isSelf 攻撃対象本人のリアクションか
 */
export async function createReactionCard(attackMsg, targetIndex, reactor, isSelf) {
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    const t = f?.targets?.[targetIndex];
    if (!t) return;
    // 同一リアクターの未解決カードの二重作成を防ぐ(やり直しは既存カードで行う)
    const pending = game.messages.find(m => {
        const rf = m.getFlag(SCOPE, "attackReaction");
        return rf && rf.attackMessageId === attackMsg.id && rf.resolved !== true
            && rf.reactorUuid === reactor.uuid && rf.targetIndex === targetIndex;
    });
    if (pending) {
        ui.notifications.info(`「${reactor.name}」のリアクション選択中のカードがあります。`);
        return;
    }
    const content = await buildReactionCardContent({
        attackerName: f.attackerName, targetName: t.name,
        category: f.category, suit: f.suit, achievement: f.achievement,
        isAttack: f.isAttack !== false, usageType: f.usageType ?? "",
        reactorName: reactor.name, isSelf,
    });
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ actor: reactor }),
        // シークレット(GM＋クリックしたユーザー・2026-07-18 ユーザー確定)。解決時に whisper 解除で公開
        whisper: [...new Set([...gmIds, game.user.id])],
        flags: { [SCOPE]: { attackReaction: {
            attackMessageId: attackMsg.id, targetIndex,
            attackerName: f.attackerName ?? "",
            targetUuid: t.uuid, targetName: t.name,
            reactorUuid: reactor.uuid, reactorName: reactor.name, isSelf,
            category: f.category, suit: f.suit, achievement: f.achievement,
            isAttack: f.isAttack !== false, usageType: f.usageType ?? "",
            resolved: false,
        } } },
    });
}

/**
 * 対決判定カードの本文を構築する(新規投稿と再判定の置き換え着地で共用・2026-07-14 抽出)。
 * 判定結果カードの基底(buildCheckCardContext)に攻撃情報を足す形式(2026-07-19 基底化=従来は
 * カード値・能力値・報酬点・判定ボーナス等の内訳を独自設計で落としていた)。
 * 状態領域(成否・ボタン群)は flags からのライブ描画(renderAttackCard)のため本文には含まれない。
 */
export async function buildAttackCardContent({ payload, result, suit, card, fromDeck, trumpUsed, suitMismatch, checkSources = [], isRecheck = false }) {
    return foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/attack-card.hbs",
        {
            ...buildCheckCardContext({
                skillLabel: payload.skillLabel,
                // 攻撃=系統表記・非攻撃の対決判定=用途タイプのラベル(移動/離脱/判定・2026-07-17 一般化)
                typeLabel: payload.isAttack === false
                    ? (USAGE_TYPE_LABELS[payload.usageType] ?? "判定")
                    : (ATTACK_CATEGORY_LABELS[payload.category] ?? payload.category),
                card, suit, result, fromDeck, trumpUsed, suitMismatch, checkSources, isRecheck,
            }),
            // 攻撃固有の追加情報
            isPhysical:    payload.category === "physical",
            attackSourceName: payload.attackSourceName,
            attackLabel:   formatAttackLabel(payload.damageType, payload.weaponAttack),
            // 移動固有の追加情報(2026-07-19 是正): 使用ヴィークル=攻撃力と同じ計算行スロット。
            // 段階数は renderAttackCard が達成値の直下へライブ挿入(事後修正・再判定に追随)
            vehicleName: payload.movement?.vehicleName ?? "",
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
    const wholeFail = next.fumble === true || next.suitMismatch === true;
    const out = [];
    for (const t of (prevTargets ?? [])) {
        // 新形式(複数リアクション併存・2026-07-18): 解決の進んだ対象(決断済み or リアクションあり)は
        // リアクションをやり直さず、保存済みの防御要素で新しい攻撃値に対して再合成する
        const hasComposite = Array.isArray(t.reactions) && (t.reactions.length || t.selfDecision);
        if (!wholeFail && hasComposite) {
            const nt = { ...t };
            Object.assign(nt, resolveTargetDefense(next.achievement, {
                controlValue: t.controlValue, selfDecision: t.selfDecision ?? null, reactions: t.reactions,
            }));
            out.push(nt);
            continue;
        }
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
            nt.selfDecision = null;         // 本人の決断・併存リアクションも仕切り直す(2026-07-18)
            nt.reactions = [];
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
            reactorName: rf.reactorName ?? "", isSelf: rf.isSelf !== false,
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

    // 移動: 段階数=主情報を**達成値の直下**へ総計行と同じ強調でライブ挿入する(2026-07-19 是正。
    // f.achievement 由来のため事後修正・再判定に追随。使用ヴィークル行は本文=基底へ焼き込み済み)。
    // 全体失敗(移動失敗・対決敗北)は 0 段階。ファンブルは計算セクション自体が無いため挿入なし
    if (f.movement) {
        const totalRow = html.querySelector(".cr-calc-section .cr-total-row");
        if (totalRow) {
            const failedState = ["fumble", "miss", "failed"].includes(f.state);
            const stages = failedState ? 0 : movementStagesFromAchievement(Number(f.achievement) || 0);
            const row = document.createElement("div");
            row.className = "cr-calc-row cr-total-row";
            row.innerHTML = `<span class="cr-calc-label">移動</span>`
                + `<span class="cr-total-num">${stages}<span class="cr-total-unit"> 段階</span></span>`;
            totalRow.after(row);
        }
    }

    if (f.state === "fumble") { addVerdict("cr-result--fumble", "fa-skull", `ファンブル！（${failWord}）`); return; }
    if (f.state === "miss") { addVerdict("cr-result--failure", "fa-times", `${failWord}（スート不一致・判定不成立）`); return; }
    // 全体失敗: 移動失敗(達成値10未満=0段階・2026-07-19)／攻撃を失敗させる・対決敗北(リアクション成功)。
    // 対象一覧は下に続けて表示する
    if (f.state === "failed") {
        addVerdict("cr-result--failure", "fa-times",
            f.failedReason === "movement" ? "移動失敗"
                : f.movement ? "移動失敗（リアクションによる）"
                    : `${failWord}（リアクションによる）`);
    }
    // 移動は妨害されないこともある=能動側の判定が成功した時点で移動成功が既定(2026-07-19 ユーザー確定)。
    // リアクション確定前でも「移動成功」を表示し、妨害が勝ったときだけ失敗へ覆す(離脱は対象外)
    if (f.movement && f.state === "open") {
        addVerdict("cr-result--success", "fa-check", "移動成功");
    }

    // 目標リスト(D&D 風・2026-07-15 複数対象一括 → 2026-07-18 大改修): 各対象の防御値と解決結果を
    // 表示する。**対象の名前クリックがリアクションの入口**(本人=決定/スキップのダイアログ・
    // 他者=代理確認ダイアログ→シークレットリアクションカード)。複数リアクションはサブ行で列挙し、
    // メイン行には適用(最高達成値)の1件を表示する。
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
            list.appendChild(row);

            // 併存リアクションのサブ行(2026-07-18): 2件以上、または代理1件のとき、各リアクションを
            // 「手段（リアクター名） 達成値N/不成立」で列挙(対象名は繰り返さない)。
            // 本人スキップ＋代理ありのときは放棄(制御値受け)もサブ行で明示する
            const reactions = t.reactions ?? [];
            const needSubRows = reactions.length >= 2 || reactions.some(r => !r.isSelf);
            if (needSubRows) {
                for (const r of reactions) {
                    const sub = document.createElement("div");
                    sub.className = "tnx-attack-target-sub";
                    const label = `${MODE_LABELS[r.mode] ?? "対決"}（${r.reactorName || "?"}）`;
                    const val = r.established ? `達成値 ${Number(r.achievement) || 0}` : "不成立";
                    sub.innerHTML = `<span class="tnx-attack-target-sub__label">${esc(label)}</span>`
                        + `<span class="tnx-attack-target-sub__val">${esc(val)}</span>`;
                    list.appendChild(sub);
                }
                if (t.selfDecision === "skipped" && isAttack) {
                    const sub = document.createElement("div");
                    sub.className = "tnx-attack-target-sub";
                    sub.innerHTML = `<span class="tnx-attack-target-sub__label">リアクション放棄</span>`
                        + `<span class="tnx-attack-target-sub__val">${esc(`制御値 ${t.controlValue}`)}</span>`;
                    list.appendChild(sub);
                }
            }

            // 対象行クリック(2026-07-18 大改修): カバー待ち受け中の命中対象クリック=カバー(最優先・
            // 2026-07-16)、それ以外はリアクションの入口。締切=ダメージカード。
            // 非対決(制御値即確定)はカバーの命中対象クリックのみ・全体失敗後はどちらも不可
            const opposed = isOpposedConfrontation(f.confrontation);
            const coverable = isAttack && t.state === "hit";
            if (!f.damageRolled && f.state !== "failed" && (opposed || coverable)) {
                row.classList.add("tnx-attack-clickable");
                if (coverable) row.classList.add("tnx-attack-coverable");
                row.addEventListener("click", () => handleTargetRowClick(message, ti));
            }
        }
        area.appendChild(list);
    } else if (f.state === "open" && !f.openReactions && !f.openReaction) {
        if (isAttack) addLine("tnx-attack-pending-note", "対象なし（ダメージ算出は対象を選択して行います）");
    }

    // オープンリアクション(対象なしの対決・2026-07-18 任意・複数化): 「リアクション」ボタンを
    // 任意のキャラクターがクリックする(キャラごとに1回)。結果=成立の最高達成値1件のみを
    // 「最終的な目標値」として表示し、成否はライブ導出(明示の確定操作は無い)。
    // 自分(識別アクター)が未リアクションなら結果とボタンを併置・リアクション済みなら結果のみ
    if (f.openReactions) {
        const list = f.openReactions;
        const { effective } = resolveOpenReactions(f.achievement, list);
        if (effective) {
            const calc = html.querySelector(".cr-calc-section") ?? area;
            const addRow = (label, value) => {
                const d = document.createElement("div");
                d.className = "cr-calc-row";
                d.innerHTML = `<span class="cr-calc-label">${esc(label)}</span><span class="cr-calc-val">${esc(String(value))}</span>`;
                calc.appendChild(d);
            };
            addRow("リアクション", `${MODE_LABELS[effective.mode] ?? "対決"}（${effective.reactorName ?? "?"}）`);
            addRow("リアクション達成値", effective.achievement ?? 0);
            // 移動は上の「移動成功」バナーが常設のため対決勝利の重複表示はしない(2026-07-19)
            if (f.state !== "failed" && !f.movement) addVerdict("cr-result--success", "fa-check", "判定成功（対決勝利）");
        }
        if (f.state === "open" && !f.damageRolled) {
            const identity = resolveUserIdentityActor({ warn: false });
            const already = identity && list.some(r => r.reactorUuid === identity.uuid);
            if (!already) {
                const wrap = document.createElement("div");
                wrap.className = "tnx-reaction-actions";
                if (confrontationHasCannot(f.confrontation ?? [])) {
                    const note = document.createElement("div");
                    note.className = "tnx-attack-pending-note";
                    note.textContent = "対決不可";
                    wrap.appendChild(note);
                }
                const btnRow = document.createElement("div");
                btnRow.className = "tnx-attack-btn-row";
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "tnx-chat-btn";
                btn.textContent = MODE_LABELS.reaction;
                btn.addEventListener("click", () => handleOpenReactionClick(message));
                btnRow.appendChild(btn);
                wrap.appendChild(btnRow);
                area.appendChild(wrap);
            }
        }
    } else if (f.openReaction) {
        // 旧形式(先着1件・2026-07-17)の解決済みカードの表示互換
        const o = f.openReaction;
        if (o.resolved && o.mode) {
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
    }

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
 * 対決欄からリアクション手段のボタン列を作る(シークレットリアクションカード用・2026-07-18 大改修)。
 * 構成は reactionButtonPlan(純ロジック)が正:
 * - ドッジ/パリー行=専用ボタン。
 * - 系統別リアクション行(精神/社会/移動妨害等)・技能名行・汎用行=**「リアクション」1ボタンに集約**
 *   (資格=該当行のタイプ∪汎用「リアクション」タイプ∪列挙技能・2026-07-18 ユーザー確定)。
 * - 「リアクション（その他）」=統合ボタンが無いときだけ(資格ゲートなしの自由技能選択)。
 * 「リアクションしない」ボタンは廃止(スキップは対象行クリックのダイアログが担う)。
 * 導線は隠さず、資格(用途タイプの所持・不可マスク)は押下時に判定して弾く(2026-07-17 ユーザー確定)。
 */
function buildReactionButtonRow(attackFlags, { onMode }) {
    const rows = attackFlags.confrontation ?? [];
    const plan = reactionButtonPlan(rows);
    const wrap = document.createElement("div");
    wrap.className = "tnx-reaction-actions";
    if (plan.cannot) {
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
    if (plan.dodge) addBtn(MODE_LABELS.dodge, () => onMode("dodge"));
    if (plan.parry) addBtn(MODE_LABELS.parry, () => onMode("parry"));
    if (plan.reaction) addBtn(MODE_LABELS.reaction, () => onMode("reaction"));
    if (plan.other) addBtn(MODE_LABELS.other, () => onMode("other"));
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
        // 本文が結果カード化済み(2026-07-19 基底化=カード値・能力値等の内訳とリアクション行は
        // buildReactionResultContent が焼き込み済み)ならライブ描画は差分値・成否バナーのみ。
        // 旧カード(contentResolved なし)は従来どおり全行をライブで足す(表示互換)
        if (!f.contentResolved) {
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

    // 未解決(シークレット・2026-07-18): リアクション手段のボタンを表示する(ドッジ/パリー/
    // リアクション/リアクション（その他）=対決欄からの導出は buildReactionButtonRow)。
    // リアクターはカード作成時に固定済み(f.reactorUuid)。資格は押下時に判定して弾く
    const attackF = game.messages.get(f.attackMessageId)?.getFlag(SCOPE, "attackCheck");
    const wrap = buildReactionButtonRow(attackF ?? { confrontation: [] }, {
        onMode: (mode) => startReaction(message, mode),
    });
    const note = document.createElement("div");
    note.className = "tnx-attack-pending-note";
    note.textContent = `${isAttack ? "攻撃達成値" : "相手の達成値"} ${f.achievement} — リアクションを選択してください`;
    wrap.prepend(note);
    area.appendChild(wrap);
}

/**
 * ユーザーの「自分のアクター」を解決する(2026-07-18 ユーザー裁定)。
 * **選択中トークンのアクターを所有していればそれ**(GM の包括所有を含む——GM は他ユーザーに
 * 割り当てられた PC を選択中にリアクションを押さないよう注意する運用)、**でなければ割り当て
 * キャラクター**。対象行クリックの本人/代理の判別と、リアクター(実行アクター)の決定に使う。
 * @param {{warn?: boolean}} [opts] warn=解決できないとき警告を出すか
 * @returns {Actor|null}
 */
function resolveUserIdentityActor({ warn = true } = {}) {
    const sel = canvas?.tokens?.controlled?.[0]?.actor ?? null;
    if (sel?.isOwner) return sel;
    const assigned = game.user.character ?? null;
    if (assigned) return assigned;
    if (warn) {
        ui.notifications.warn("リアクションを行うキャラクターがありません（トークンを選択するか、ユーザーにキャラクターを割り当ててください）。");
    }
    return null;
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

/**
 * 対象行クリックのディスパッチ(2026-07-18 大改修)。カバー待ち受け中の命中対象クリック=カバー
 * (最優先・2026-07-16)、それ以外はリアクションの入口(本人=決定/スキップ・他者=代理確認)。
 */
async function handleTargetRowClick(attackMessage, targetIndex) {
    const f = attackMessage.getFlag(SCOPE, "attackCheck");
    const t = f?.targets?.[targetIndex];
    if (!t) return;
    if (TnxCheckFlow.peekAchievementAction("covering") && f.isAttack !== false && t.state === "hit") {
        return handleCoveringClick(attackMessage, targetIndex);
    }
    return handleTargetRowReactionClick(attackMessage, targetIndex);
}

/**
 * 対象行クリック=リアクションの入口(2026-07-18 ユーザー確定)。
 * - 本人(クリック対象=自分のアクター): 「リアクションを行いますか？」(決定/スキップ・✖=やり直し)。
 *   スキップ=リアクションを放棄して制御値で受ける(即時確定・シークレットカードは出さない)。
 * - 他者: 「他者への攻撃に対してリアクションを行なおうとしています。よろしいですか？」(確認/キャンセル)。
 * 決定/確認でシークレットリアクションカードを作成する。締切=ダメージカード(2026-07-18 裁定)。
 */
async function handleTargetRowReactionClick(attackMessage, targetIndex) {
    const f = attackMessage.getFlag(SCOPE, "attackCheck");
    const t = f?.targets?.[targetIndex];
    if (!t || t.coveredBy) return;
    if (f.damageRolled) { ui.notifications.info("ダメージカードを出した後はリアクションできません。"); return; }
    if (["fumble", "miss", "failed"].includes(f.state)) return; // 判定全体が失敗済み=リアクション不要
    if (!isOpposedConfrontation(f.confrontation)) return;        // 非対決(制御値即確定)は導線なし
    const identity = resolveUserIdentityActor();
    if (!identity) return;

    if (identity.uuid === t.uuid) {
        // 本人フロー。旧形式(単一解決・2026-07-15)で解決済みの対象も決断済みとして扱う
        const legacyDecided = !Array.isArray(t.reactions)
            && (t.state === "hit" || t.state === "miss") && !!t.resolution;
        if (t.selfDecision || legacyDecided) { ui.notifications.info("既にリアクションを選択済みです。"); return; }
        const isAttack = f.isAttack !== false;
        const skipNote = isAttack
            ? "スキップするとリアクションを放棄し、制御値で受けます。"
            : "スキップすると相手の判定がそのまま成立します。";
        const choice = await foundry.applications.api.DialogV2.wait({
            window: { title: "リアクション" },
            classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
            position: { width: 320 },
            content: `<p>リアクションを行いますか？</p><p>${skipNote}</p>`,
            buttons: [
                { action: "act",  icon: "fas fa-shield-halved", label: "決定", default: true, callback: () => "act" },
                { action: "skip", icon: "fas fa-forward",       label: "スキップ", callback: () => "skip" },
            ],
            close: () => null, // ✖=やり直し(何もしない)
        });
        if (choice === "act") await createReactionCard(attackMessage, targetIndex, identity, true);
        else if (choice === "skip") await applySelfSkip(attackMessage, targetIndex);
        return;
    }

    // 代理フロー
    if (t.state === "miss") { ui.notifications.info("この対象への攻撃は既に回避されています。"); return; }
    if ((t.reactions ?? []).some(r => r.reactorUuid === identity.uuid)) {
        ui.notifications.info(`「${identity.name}」は既にこの対象へリアクションしています。`);
        return;
    }
    const ok = await foundry.applications.api.DialogV2.wait({
        window: { title: "リアクション" },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
        position: { width: 320 },
        content: `<p>他者への攻撃に対してリアクションを行なおうとしています。よろしいですか？</p>`
            + `<p>リアクター: ${foundry.utils.escapeHTML(identity.name)}</p>`,
        buttons: [
            { action: "confirm", icon: "fas fa-check", label: "確認", default: true, callback: () => true },
            { action: "cancel",  icon: "fas fa-times", label: "キャンセル", callback: () => false },
        ],
        close: () => false,
    });
    if (ok) await createReactionCard(attackMessage, targetIndex, identity, false);
}

/**
 * 本人スキップ=リアクションを放棄して制御値で受ける(2026-07-18)。シークレットカードは出さず、
 * 対象行を即時に解決する(既に付いている代理リアクションとの合成は resolveTargetDefense)。
 */
async function applySelfSkip(attackMessage, targetIndex) {
    const f = attackMessage.getFlag(SCOPE, "attackCheck");
    const targets = foundry.utils.deepClone(f?.targets ?? []);
    const t = targets[targetIndex];
    if (!t || t.selfDecision) return;
    seedLegacyTarget(t);
    t.selfDecision = "skipped";
    Object.assign(t, resolveTargetDefense(f.achievement, {
        controlValue: t.controlValue, selfDecision: "skipped", reactions: t.reactions,
    }));
    await applyAttackPatch(attackMessage, { targets });
}

/**
 * 旧形式(単一解決・2026-07-15)の対象エントリに複数リアクションのフィールドを敷く(表示互換)。
 * 解決済みの旧対象は保存値から本人のリアクション/スキップを復元し、以後の合成に含める。
 * 対象は deepClone 済みの前提(このまま書き換えてよい)。
 */
function seedLegacyTarget(t) {
    if (Array.isArray(t.reactions)) {
        t.selfDecision = t.selfDecision ?? null;
        return;
    }
    t.reactions = [];
    t.selfDecision = t.selfDecision ?? null;
    if (t.state === "hit" || t.state === "miss") {
        if (t.resolution === "none") {
            t.selfDecision = "skipped";
        } else if (t.resolution && t.resolution !== "areaCover") {
            t.reactions.push({
                reactorUuid: "", reactorName: "", isSelf: true, mode: t.resolution,
                achievement: t.reactionAchievement ?? 0, established: t.reactionEstablished === true,
                parryGuard: t.parryGuard ?? 0, messageId: null,
            });
            t.selfDecision = "reacted";
        }
    }
}

/**
 * 対決欄とリアクターの状態から、リアクションに使用する技能を選ばせる(2026-07-18 大改修)。
 * 資格はここ=押下時に判定して弾く(導線は隠さない・2026-07-17 ユーザー確定):
 * - mode="dodge"/"parry": そのタイプの用途を持つ技能をレベル1以上で所持。
 * - mode="reaction"(統合ボタン): **該当行のタイプ∪汎用「リアクション」タイプ**の用途を持つ技能
 *   ∪ 無印技能名行の列挙技能(2026-07-18 ユーザー確定=系統タイプと汎用のどちらかの用途で起動できる)。
 * - mode="other": **資格ゲートなしの自由技能選択**(全技能から・不可マスクのみ通す。
 *   「対応する全ての種類のリアクションとして扱える」・2026-07-18 ユーザー確定)。
 * - ※(必須)行: その技能すべてをレベル1以上で所持していなければ不可。候補=※技能(その他を除く)。
 * - 「不可」マスク: 「対決不可にもリアクション可」(ignoresUnopposable)の用途を持つ技能のみ通る
 *   (その場合も下地の対決拘束は受ける)。
 * - **対決の特殊処理はヴィークル操縦時のみ**: 操縦中(準備済みヴィークル)のリアクターは、対決が
 *   自動的に「〈操縦〉※」になる(リアクター側状態由来・下地を置き換え・不可マスクは残る)。
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
    // 不可マスク下では「対決不可にもリアクション可」の用途だけが使える。types=null はタイプ不問
    const usageEligible = (a, types) => executionFormOf(a) === "check"
        && (!types || types.includes(a.type))
        && (!cannot || a.ignoresUnopposable === true);
    const skillEligible = (s, types) => levelOk(s) && (s.system.actions ?? []).some(a => usageEligible(a, types));
    const isSkillItem = (i) => i.type === "generalSkill" || i.type === "styleSkill";

    // モードごとの資格タイプ(null=タイプ不問)。統合「リアクション」は行のタイプ∪汎用(純ロジック)。
    // "open"=オープンリアクションの1ボタン(2026-07-19 直接起動): 対決欄の**全**手段行タイプ∪汎用
    const plan = reactionButtonPlan(rows);
    const gateTypes = (mode === "dodge" || mode === "parry") ? [mode]
        : mode === "reaction" ? (plan.reaction?.types ?? ["reaction"])
            : mode === "open" ? [...new Set([...confrontationReactionTypes(rows), "reaction"])]
                : null;

    // ※(必須)技能: すべて所持していなければリアクション不可。候補は※技能そのもの
    // (「必ずコンボに含める」=※技能を起点に判定する。コンボの構成はその用途の設定が担う)。
    // その他(資格ゲートなし)は※の拘束も受けない=自由枠(卓判断)
    const asterisks = mode === "other" ? [] : asteriskSkillKeys(rows);
    let candidates;
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
    } else if (mode === "other") {
        // 資格ゲートなし: 全技能から選ぶ(不可マスクのみ通す)
        candidates = reactor.items
            .filter(i => isSkillItem(i) && skillEligible(i, null))
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    } else {
        // タイプ資格の候補 ∪ (統合/オープンのリアクション)無印技能名行の列挙技能
        const byType = reactor.items
            .filter(i => isSkillItem(i) && skillEligible(i, gateTypes))
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        const enumeratedKeys = mode === "reaction" ? (plan.reaction?.skillKeys ?? [])
            : mode === "open" ? confrontationSkillRows(rows).filter(r => !r.asterisk).map(r => r.key)
                : [];
        const enumerated = enumeratedKeys
            .map(key => findItemByIdentificationKey(reactor, key))
            .filter(s => s && skillEligible(s, null));
        const seen = new Set();
        candidates = [...byType, ...enumerated].filter(s => !seen.has(s.id) && seen.add(s.id));
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

    // 資格に合致する用途がただ1つなら直接起動する(複数なら通常のピッカーに委ねる)。
    // 列挙技能(タイプ資格なし)はタイプ不問で数える
    let usageId = null;
    let matches = gateTypes ? (skill.system.actions ?? []).filter(a => usageEligible(a, gateTypes)) : [];
    if (!matches.length) matches = (skill.system.actions ?? []).filter(a => usageEligible(a, null));
    if (matches.length === 1) usageId = matches[0]._id;
    return { skill, usageId };
}

/**
 * リアクションを開始する(シークレットリアクションカードの手段ボタンから・2026-07-18 大改修)。
 * mode="dodge"/"parry"/"reaction"(統合)/"other"(資格ゲートなし)。リアクター(実行アクター)は
 * **カード作成時に固定済み**(attackReaction.reactorUuid)。判定は通常の技能判定フローで行い、
 * 完了時に completeReactionFromCheck が防御合成を再解決する。
 */
export async function startReaction(reactionMsg, mode) {
    const r = reactionMsg.getFlag(SCOPE, "attackReaction");
    if (!r || r.resolved) return;
    const attackMsg = game.messages.get(r.attackMessageId);
    const attackF = attackMsg?.getFlag(SCOPE, "attackCheck");
    if (!attackF) { ui.notifications.warn("対決判定カードが見つかりません。"); return; }
    if (attackF.damageRolled) { ui.notifications.info("ダメージカードを出した後はリアクションできません。"); return; }
    if (["fumble", "miss", "failed"].includes(attackF.state)) {
        ui.notifications.info("この判定は既に失敗しています。");
        return;
    }
    // 既に回避確定(範囲攻撃へのリアクション/攻撃を失敗させる等)の対象は再解決しない(2026-07-15)
    const at0 = attackF.targets?.[r.targetIndex];
    if (at0 && at0.state === "miss") { ui.notifications.info("この対象への攻撃は既に回避されています。"); return; }

    // リアクター=カード作成時に固定(2026-07-18)。旧形式カード(reactorUuid なし・大改修前の公開カード)は
    // 押下時の識別アクター(選択中所有→割り当て)で解決する(表示互換)。権限が無ければ弾く
    const reactorDoc = r.reactorUuid ? await fromUuid(r.reactorUuid).catch(() => null) : null;
    const reactor = reactorDoc?.actor ?? reactorDoc ?? (!r.reactorUuid ? resolveUserIdentityActor() : null);
    if (!reactor) { ui.notifications.warn("リアクターを解決できません。"); return; }
    if (!game.user.isGM && !reactor.isOwner) {
        ui.notifications.warn(`「${reactor.name}」を操作する権限がありません。`);
        return;
    }

    const sel = await selectReactionSkill(reactor, attackF.confrontation ?? [], mode);
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
        reaction: {
            reactionMessageId: reactionMsg.id, attackMessageId: r.attackMessageId,
            targetIndex: r.targetIndex, open: false, mode, parryGuard,
            reactorUuid: reactor.uuid, reactorName: reactor.name, isSelf: r.isSelf === true,
        },
    });
}

/**
 * オープンリアクションの「リアクション」ボタン(対決判定カード上・2026-07-18 任意・複数化)。
 * **押下で直接リアクションを起動する**(2026-07-19 ユーザー是正=シークレットカードを挟まない。
 * 手段はこの1ボタンに集約済みで、中継カードは選択も秘匿も担わない無機能の段だった)。
 * 識別アクター(選択中所有→割り当て)を解決し、技能選択→判定へ直行する(キャラごとに1回)。
 * 結果はリアクターごとの**通常の判定結果カード**(カード値・能力値等の計算内訳つき・公開)として
 * TnxCheckFlow が投稿し、対決の帰結はこの対決判定カードにライブ表示される。
 */
export async function handleOpenReactionClick(attackMsg) {
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    if (!f?.openReactions || f.state !== "open") {
        ui.notifications.info("この判定は既に解決済みです。");
        return;
    }
    if (f.damageRolled) { ui.notifications.info("ダメージカードを出した後はリアクションできません。"); return; }
    const identity = resolveUserIdentityActor();
    if (!identity) return;
    if (f.openReactions.some(r => r.reactorUuid === identity.uuid)) {
        ui.notifications.info(`「${identity.name}」は既にリアクションしています。`);
        return;
    }
    const sel = await selectReactionSkill(identity, f.confrontation ?? [], "open");
    if (!sel) return;
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(identity, sel.skill, {
        ...(sel.usageId ? { usageId: sel.usageId } : {}),
        reaction: {
            reactionMessageId: null, attackMessageId: attackMsg.id, targetIndex: null,
            open: true, mode: "reaction", parryGuard: 0,
            reactorUuid: identity.uuid, reactorName: identity.name, isSelf: false,
        },
    });
}

/**
 * リアクション判定完了時の対決解決(TnxCheckFlow._execute から)。
 * **受動有利**: 攻撃達成値がリアクション達成値を**上回れば**命中・**同値はリアクション側勝利=攻撃回避**。
 * リアクション不成立(ファンブル/スート不一致)は達成値 0 として扱う。
 * パリーは判定成立なら敗北でも受け値をダメージ軽減へ(parryGuard)。
 */
export async function completeReactionFromCheck(payload, result, { suitMismatch = false, allowResolved = false, recheckCtx = null, render = null } = {}) {
    const attackMsg = game.messages.get(payload.attackMessageId);
    const reactionMsg = payload.reactionMessageId ? game.messages.get(payload.reactionMessageId) : null;
    if (!attackMsg) return;
    const f = attackMsg.getFlag(SCOPE, "attackCheck");
    if (!f) return;

    const ok = !result.fumble && !suitMismatch;
    const reactAch = ok ? (result.achievement ?? 0) : 0;
    // このリアクション自身の勝敗(特性フラグの発火・リアクションカードの成否表示用)
    const { hit, diff } = resolveOpposed(f.achievement, reactAch);
    const entry = {
        reactorUuid: payload.reactorUuid ?? "",
        reactorName: payload.reactorName ?? "?",
        isSelf: payload.isSelf === true,
        mode: payload.mode,
        achievement: result.achievement ?? 0,
        established: ok,
        // 受け値はパリー成立時のみ有効(実効値は resolveTargetDefense が成立パリーの最大1つを採る)
        parryGuard: payload.mode === "parry" && ok ? (payload.parryGuard ?? 0) : 0,
        messageId: payload.reactionMessageId ?? null,
    };

    let triggerAllAvoid = false;

    if (payload.open === true) {
        // オープンリアクション(対象なし・2026-07-18 任意・複数化 → 2026-07-19 直接起動): キャラごとに
        // 1回追記し、成立の最高達成値1件で成否をライブ導出(受動有利)。個別の結果カードは通常の
        // 判定結果カードとして TnxCheckFlow._execute が投稿する(計算内訳つき・公開)。
        // 再判定/修正の再解決(allowResolved)は同一リアクターの要素を置き換える
        if (!f.openReactions) return; // 旧形式(先着1件)のカードへの新規追記はしない
        const list = foundry.utils.deepClone(f.openReactions);
        const idx = list.findIndex(r => r.reactorUuid && r.reactorUuid === entry.reactorUuid);
        if (idx >= 0) {
            if (!allowResolved) return; // キャラごとに1回
            list[idx] = entry;
        } else {
            if (allowResolved) return; // 再解決対象が見つからない
            list.push(entry);
        }
        const { failed } = resolveOpenReactions(f.achievement, list);
        await applyAttackPatch(attackMsg, { state: failed ? "failed" : "open", openReactions: list });
        return;
    }
    {
        const targets = foundry.utils.deepClone(f.targets ?? []);
        const t = targets[payload.targetIndex];
        if (!t) return;
        seedLegacyTarget(t);
        const list = t.reactions;
        const idx = list.findIndex(r => r.messageId && r.messageId === entry.messageId);
        if (idx >= 0) {
            if (!allowResolved) return;
            list[idx] = entry;
        } else {
            if (allowResolved) return; // 再解決対象が見つからない
            // 既に回避確定(範囲攻撃へのリアクション等)の対象は再解決しない(2026-07-15 ガード維持)
            if (t.state === "miss") return;
            if (entry.reactorUuid && list.some(r => r.reactorUuid === entry.reactorUuid)) return;
            list.push(entry);
        }
        if (entry.isSelf) t.selfDecision = "reacted";

        // 防御合成(2026-07-18 裁定): 制御値(本人スキップ時)＋本人・代理の各リアクション(独立対決・
        // 受動有利)の全要素を破って命中。表示=最高達成値の適用1件・受け値=成立パリー最大1つ・
        // 成立ゲート(社会軽減)=代理でも成立で開く
        Object.assign(t, resolveTargetDefense(f.achievement, {
            controlValue: t.controlValue, selfDecision: t.selfDecision ?? null, reactions: list,
        }));

        // 範囲攻撃へのリアクション / 攻撃を失敗させる(2026-07-15 ユーザー確定): **このリアクション自身の
        // 勝利**(高い方に負けた代理の特殊効果は発火しない・2026-07-18)をトリガーに、同じ攻撃の全対象を
        // 回避で解決する。ファンブル/スート不一致(不成立)や被弾時は発火しない
        triggerAllAvoid = ok && !hit
            && (payload.reactionAreaAttack === true || payload.reactionFailsAttack === true);
        if (triggerAllAvoid) {
            for (let i = 0; i < targets.length; i++) {
                if (i === payload.targetIndex) continue;
                targets[i].state = "miss";
                targets[i].resolution = "areaCover"; // 範囲攻撃へのリアクションで回避(達成値を持たない)
                targets[i].reactionAchievement = null;
                targets[i].diff = null;
                targets[i].parryGuard = 0;
            }
        }
        const patch = { targets };
        if (triggerAllAvoid && payload.reactionFailsAttack === true) patch.state = "failed";
        await applyAttackPatch(attackMsg, patch);
    }

    if (reactionMsg) {
        // 解決時: リアクションカードを「リアクション判定の結果カード」化(本文=基底＋対決情報・
        // カード値・能力値等の計算内訳つき・2026-07-19 基底化)し、**whisper を解除して全体公開**する。
        // 再判定/修正が読む checkResult/checkRecheck をリアクションカードに保存(再解決時は recheckCtx なし=触らない)
        const extraFlags = { whisper: [] };
        if (recheckCtx) {
            extraFlags[`flags.${SCOPE}.checkResult`] = { actorId: recheckCtx.actorId, result };
            extraFlags[`flags.${SCOPE}.checkRecheck`] = recheckCtx;
            // リアクション用途の適用効果(あれば)。リアクションカードに「効果を適用」ボタンを出す
            // (renderUsageEffectButton は usageEffects フラグで発火・2026-07-15)
            if (recheckCtx.usageEffects) extraFlags[`flags.${SCOPE}.usageEffects`] = recheckCtx.usageEffects;
        }
        if (render) {
            extraFlags.content = await buildReactionResultContent({
                reactionFlags: reactionMsg.getFlag(SCOPE, "attackReaction"),
                mode: payload.mode,
                skillLabel: render.skillLabel, card: render.card, suit: render.suit,
                result, fromDeck: render.fromDeck, trumpUsed: render.trumpUsed,
                suitMismatch, checkSources: render.checkSources ?? [],
            });
        }
        await applyReactionPatch(reactionMsg,
            { resolved: true, resolution: payload.mode, reactionAchievement: reactAch, hit, diff,
                ...(render ? { contentResolved: true } : {}),
                ...(payload.reactorName ? { reactorName: payload.reactorName } : {}) }, extraFlags);
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
