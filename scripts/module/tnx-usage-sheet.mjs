/**
 * @fileoverview TnxUsageSheet - 用途エントリの編集シート
 *
 * 用途データはアイテムの system.actions[] に格納されている。
 * このシートは item と usageId を受け取り、対象エントリを
 * 読み書きする疑似ドキュメントシートとして機能する。
 *
 * D&D 5e の Activity Sheet を参考に設計:
 *   - タブ構成: 基本 / 発動 / 効果
 *   - 発動タブ: タイミング・対象・射程・目標値・対決不可（＋参加技能からの自動入力）
 *   - 効果タブ: 種別固有設定（コンボ・武器・ダメージ・改造）＋適用される ActiveEffect
 *   - タイプは作成時に固定（UI 上で変更不可）
 */

import { TnxSkillUtils } from "./tnx-skill-utils.mjs";
import { getComboSuits } from "./tnx-check-engine.mjs";
import { resolveUsageSkills, comboLockAnalysis, isComboRequired } from "./skill-chain-resolution.mjs";
import { deriveConsumeTargets } from "./usage-consumption.mjs";
import { CONDITION_KINDS } from "./conditions.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { readFlag } from "../data/item/helpers.mjs";
import { resolveAttackWeapons, attackWeaponDisplayName, resolveAttackRangeValue } from "./attack-weapons.mjs";
import { loadSkillChoices, SKILL_PACKS } from "./skill-dictionary.mjs";

const CHAIN_SKILL_TYPES = ["generalSkill", "styleSkill"];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// 用途タイプは check/declaration の2つに一本化(2026-07-13 ユーザー確定)。
// 攻撃=check+damageCategory(2026-07-09)・旧 damageBoost/damageReduce=宣言へ変換(2026-07-11)・
// 旧 modification=check へ移行・旧 npcAcquire=フラグ化(いずれも migrateData)
export const USAGE_TYPES = Object.freeze({
    check:        "判定",
    declaration:  "宣言",
});

/**
 * NPC取得のモード(取得類型・フェーズ11-6・Troops.md「NPC取得」)。
 * 参照先の種類からの導出はしない=モードは明示選択(2026-07-04 ユーザー裁定)。
 * extra=判定なしで派生取得+場に出す / troop・enigma=判定して達成値=人数・ポイント /
 * bunshin=判定・目標値10(達成値10以上で成功)
 */
export const ACQUIRE_MODES = Object.freeze({
    extra:   "エキストラ",
    troop:   "トループ",
    enigma:  "エニグマ",
    bunshin: "分身",
});

/** 回復範囲の大分類ラベル(group=CONDITION_KINDS の group 値・2026-07-13)。 */
const RECOVERY_GROUP_LABELS = Object.freeze({
    bs:             "BS",
    incapacitation: "戦闘不能",
    physical:       "負傷（肉体）",
    mental:         "負傷（精神）",
    social:         "負傷（社会）",
});

// ─── 発動パラメータ優先度（自動入力で使用） ───────────────────────────────────
// ルール正本: llm-wiki/01_Wiki/Game_Rules/Check_Rules.md（対象優先度・射程優先度）

/** 対象優先度（高→低）: 自身 > 単体※ > チーム > シーン(選択) > シーン > 範囲(選択) > 範囲 > 単体 */
function targetRank(target, isFixed) {
    switch (target) {
        case "self":        return 8;
        case "single":      return isFixed ? 7 : 1;
        case "team":        return 6;
        case "sceneSelect": return 5;
        case "scene":       return 4;
        case "areaSelect":  return 3;
        case "area":        return 2;
        default:            return 0; // blank / other / explanation は無視
    }
}

/** 射程の物理的な短さ順（小さいほど近い）。※複数時の「短い方を優先」に使用 */
const RANGE_PHYSICAL = { close: 0, short: 1, middle: 2, long: 3, superLong: 4, weapon: 5 };

/** 射程優先度（高→低）: 至近※ > 武器 > 超遠 > 遠 > 中 > 近 > 至近 */
function rangeRank(range, isFixed) {
    if (range === "close" && isFixed) return 7;
    switch (range) {
        case "weapon":    return 6;
        case "superLong": return 5;
        case "long":      return 4;
        case "middle":    return 3;
        case "short":     return 2;
        case "close":     return 1;
        default:          return 0;
    }
}

/** 参加技能群の対象を優先度で解決。null=有効な対象なし */
function resolveTarget(entries) {
    let best = null, bestRank = 0;
    for (const e of entries) {
        const r = targetRank(e.target, e.isFixed);
        if (r > bestRank) { bestRank = r; best = e; }
    }
    return best ? { target: best.target, isFixed: best.isFixed } : null;
}

/** 参加技能群の射程を優先度で解決。変更不可（※）が複数なら最短を優先 */
function resolveRange(entries) {
    const valid = entries.filter(e => rangeRank(e.range, e.isFixed) > 0);
    if (!valid.length) return null;
    const fixed = valid.filter(e => e.isFixed);
    if (fixed.length >= 2) {
        const shortest = fixed.reduce((a, b) =>
            (RANGE_PHYSICAL[b.range] ?? 99) < (RANGE_PHYSICAL[a.range] ?? 99) ? b : a);
        return { range: shortest.range, isFixed: true };
    }
    const best = valid.reduce((a, b) =>
        rangeRank(b.range, b.isFixed) > rangeRank(a.range, a.isFixed) ? b : a);
    return { range: best.range, isFixed: best.isFixed };
}

/**
 * 使用武器の射程を解決する(射程「武器」の実体解決・2026-07-13 再設計)。
 * 一本目=シートの「攻撃で使用」武器・以降=用途の追加分(resolveAttackWeapons)。
 * 武器が無い(生身)・射程を持たない場合は至近(close)=生身の射程(ユーザー確定)。
 */
function resolveWeaponRangeValue(usage, item, actor) {
    return resolveAttackRangeValue(resolveAttackWeapons(actor, usage, item));
}

/** 参加技能群の目標値を解決。数値があれば最大、なければ最初の非blank型を採用 */
function resolveTargetValue(entries) {
    const numerics = entries.filter(e => e.targetValue === "number");
    if (numerics.length) {
        return { targetValue: "number", targetValueNumber: Math.max(...numerics.map(e => e.number ?? 0)) };
    }
    const typed = entries.find(e => e.targetValue && e.targetValue !== "blank" && e.targetValue !== "none");
    return typed ? { targetValue: typed.targetValue } : null;
}

/** actor 技能アイテムをチェーン解決用に正規化する(モジュール共通・インスタンス版は委譲) */
function normalizeSkillItemDoc(it) {
    return {
        id: it.id,
        identificationKey: it.system?.identificationKey ?? "",
        isAction: it.system?.isAction === true,
        isSubstitute: it.system?.isSubstitute === true,
        substituteTarget: Array.isArray(it.system?.substituteTarget) ? it.system.substituteTarget : [],
        comboSkill: it.system?.comboSkill ?? [],
    };
}

/**
 * アイテムの判定系用途に技能チェーンの既定(ベース技能・必須コンボ)を適用する(冪等)。
 * 用途シートを開いたときの _enforceComboRequirements と同じ規則を、**アクターへの
 * インポート(作成)直後に一括適用**する(2026-07-08 修正)。辞典/ワールドで用途を設定してから
 * インポートすると、用途シートを開くまでベース技能の自動設定が効かなかった問題への対処。
 * あわせて、別コレクション時代の解決不能な参照(ベース・コンボの itemId)を掃除する。
 * @param {Item} item アクター直下の generalSkill / styleSkill
 */
export async function enforceUsageChainDefaultsOnImport(item) {
    const actor = item?.actor;
    if (!actor || !CHAIN_SKILL_TYPES.includes(item.type)) return;
    const actions = foundry.utils.deepClone(item.system.actions ?? []);
    if (!actions.length) return;

    const skillItems = actor.items
        .filter(i => CHAIN_SKILL_TYPES.includes(i.type))
        .map(normalizeSkillItemDoc);
    const isActionSkill = (id) => {
        const it = id === item.id ? item : actor.items.get(id);
        return it?.system?.isAction === true;
    };
    const parentIsAction = item.system.isAction === true;

    let changed = false;
    for (const usage of actions) {
        if (usage.type !== "check") continue;

        // 参照の掃除: アクター上で解決できない itemId(辞典/ワールド時代の別コレクション ID)を落とす
        const cleanedRefs = (usage.skillRefs ?? [])
            .map(r => r.itemId)
            .filter(id => id && actor.items.has(id));
        let baseId = usage.baseSkillRef?.itemId ?? "";
        if (baseId && baseId !== item.id && !actor.items.has(baseId)) baseId = "";

        // 用途の「無視する指定技能」を反映(該当技能の指定技能を必須補完で再追加しない)
        const ignoreKeys = (usage.ignoreComboSkills ?? []).filter(Boolean);
        const res = resolveUsageSkills(normalizeSkillItemDoc(item), skillItems, cleanedRefs, ignoreKeys);
        if (res && !res.defect) {
            const baseCandidates = parentIsAction ? [item.id]
                : (res.baseLocked ? (res.baseCandidateItemIds ?? []) : null);
            if (parentIsAction) baseId = item.id;
            else if (baseCandidates && !baseCandidates.includes(baseId)) baseId = res.baseItemId ?? baseCandidates[0] ?? "";
            else if (!baseId && !res.manual && res.baseItemId && res.baseItemId !== item.id) baseId = res.baseItemId;
        }

        // ベース・アクション技能を除外し、必須コンボ(クロージャ)を補完する
        const refs = cleanedRefs.filter(id => id !== baseId && !isActionSkill(id));
        if (res && !res.defect) {
            const have = new Set(refs);
            for (const id of (res.mandatoryItemIds ?? [])) {
                if (id !== baseId && id !== item.id && !have.has(id) && !isActionSkill(id)) {
                    refs.push(id);
                    have.add(id);
                }
            }
        }

        const prevBase = usage.baseSkillRef?.itemId ?? "";
        const prevRefs = (usage.skillRefs ?? []).map(r => r.itemId);
        if (baseId !== prevBase || refs.length !== prevRefs.length || refs.some((id, i) => id !== prevRefs[i])) {
            usage.baseSkillRef = { ...(usage.baseSkillRef ?? {}), itemId: baseId };
            usage.skillRefs = refs.map(id => ({ itemId: id }));
            changed = true;
        }
    }
    if (changed) await item.update({ "system.actions": actions });
}

/**
 * 参加技能の固有値から発動パラメータと消費行を導出する(11-6 追補・2026-07-06 承認)。
 * 用途作成時の一回適用と「参加技能から自動入力」ボタンの両方で使う。**ライブ追従はしない**
 * (コンボ変更で設定を黙って書き換えない)。消費行は可視の入力補助であり、実行時の権威は
 * consumeTargets のまま(導出規則=親×1+isLimit つき参加技能×1・deriveConsumeTargets)。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage 用途エントリ(平データで可)
 * @returns {object} _patchUsage 形式のパッチ(ドットパスキーを含む)
 */
export function deriveUsageAutoFill(item, usage) {
    const actor = item.actor;
    const baseId = item.system.isAction === true ? item.id : (usage.baseSkillRef?.itemId || item.id);
    const ids = new Set([item.id, baseId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean));
    const skills = [...ids].map(id => (id === item.id ? item : actor?.items.get(id))).filter(Boolean);
    // 発動パラメータ(target/range/timing/targetValue/confrontation)は**技能**の固有値から導出する。
    // アウトフィット(式神符等)への NPC取得用途など非技能ベースでは、これらは技能形でないため対象外
    // (2026-07-09 修正: 旧実装は item.system.timing 等を無条件に読み .find で TypeError)。
    const skillItems = skills.filter(s => s.type === "generalSkill" || s.type === "styleSkill");

    const patch = {};
    const t = resolveTarget(skillItems.map(s => ({ target: s.system.target, isFixed: !!s.system.isFixedTarget })));
    if (t) { patch.target = t.target; patch.isFixedTarget = t.isFixed; }

    const r = resolveRange(skillItems.map(s => ({ range: s.system.range, isFixed: !!s.system.isFixedRange })));
    if (r) {
        patch.range = r.range;
        patch.isFixedRange = r.isFixed;
        // 射程「武器」(2026-07-13 再設計): 優先度はそのまま(武器=至近※に次ぐ)で、「武器」が
        // 勝った場合に使用武器(一本目=シートの「攻撃で使用」・以降=用途の追加分)の実射程へ解決する。
        // 武器が無い(生身)なら至近=生身の射程(ユーザー確定)
        if (r.range === "weapon") {
            patch.range = resolveWeaponRangeValue(usage, item, actor);
        }
    }

    // 目標値: NPC取得はモードで確定する(トループ/エニグマ=なし・分身=10固定)ため導出しない
    if (usage.npcAcquire !== true) {
        const tv = resolveTargetValue(skillItems.map(s => ({ targetValue: s.system.targetValue, number: s.system.targetValueNumber })));
        if (tv) {
            patch.targetValue = tv.targetValue;
            if (tv.targetValueNumber !== undefined) patch.targetValueNumber = tv.targetValueNumber;
        }
    }

    // タイミング: ベース技能の最初の非 blank timing を採用（best-effort・非技能ベースはスキップ）
    const baseSkill = skillItems.find(s => s.id === baseId) ?? null;
    const bt = (Array.isArray(baseSkill?.system.timing) ? baseSkill.system.timing : []).find(x => x?.value && x.value !== "blank");
    if (bt) {
        patch["timing.value"]       = bt.value;
        patch["timing.actionName"]  = bt.actionName ?? "blank";
        patch["timing.processName"] = bt.processName ?? "blank";
        patch["timing.timingOther"] = bt.timingOther ?? "";
    }

    // 対決不可: 参加技能が固有に「対決不可」なら true（外す方向には自動更新しない）
    if (skillItems.some(s => (s.system.confrontation ?? []).some(c => c.value === "cannot"))) {
        patch.isUnopposable = true;
    }

    // 消費行: 導出結果で置き換え(既存自動入力と同じ「明示的な上書き」の意味論)
    patch.consumeTargets = deriveConsumeTargets(item.id, skills);

    return patch;
}

/**
 * 射程「武器」のライブ再解決(2026-07-13 ユーザー指摘で追加)。使用武器の変更時に、参加技能の
 * 射程優先度の勝者が「武器」である用途に限り、射程を武器の実射程へ解決したパッチを返す
 * (勝者が武器でない=手動設定や他射程が勝つ用途には触らない・武器未解決は「武器」表示に戻す)。
 * 自動入力の「ライブ追従はしない」原則の例外——射程「武器」は値の実体が使用武器に委譲されて
 * おり、武器の選択に追従しないと値が成立しないため。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage 用途エントリ(weaponRefs 更新後の状態)
 * @returns {?{range:string, isFixedRange:boolean}}
 */
function deriveWeaponRangeLive(item, usage) {
    const actor = item.actor;
    const baseId = item.system.isAction === true ? item.id : (usage.baseSkillRef?.itemId || item.id);
    const ids = new Set([item.id, baseId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean));
    const skills = [...ids]
        .map(id => (id === item.id ? item : actor?.items.get(id)))
        .filter(s => s && (s.type === "generalSkill" || s.type === "styleSkill"));
    const r = resolveRange(skills.map(s => ({ range: s.system.range, isFixed: !!s.system.isFixedRange })));
    if (!r || r.range !== "weapon") return null;
    return { range: resolveWeaponRangeValue(usage, item, actor), isFixedRange: r.isFixed };
}

export class TnxUsageSheet extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(item, usageId, options = {}) {
        super(options);
        this._item = item;
        this._usageId = usageId;
    }

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "tnx-usage-sheet"],
        position: { width: 640, height: 560 },
        window: { resizable: true },
        tag: "form",
        form: {
            handler: TnxUsageSheet._onSubmit,
            submitOnChange: true,
            closeOnSubmit: false,
        },
        actions: {
            skillRefDelete:        TnxUsageSheet._onSkillRefDelete,
            ignoreComboDelete:     TnxUsageSheet._onIgnoreComboDelete,
            weaponRefDelete:       TnxUsageSheet._onWeaponRefDelete,
            checkBonusAdd:         TnxUsageSheet._onCheckBonusAdd,
            checkBonusDelete:      TnxUsageSheet._onCheckBonusDelete,
            damageBonusAdd:        TnxUsageSheet._onDamageBonusAdd,
            damageBonusDelete:     TnxUsageSheet._onDamageBonusDelete,
            effectRemove:          TnxUsageSheet._onEffectRemove,
            autoFill:              TnxUsageSheet._onAutoFill,
            incrementTargetValue:  TnxUsageSheet._onTvIncrement,
            decrementTargetValue:  TnxUsageSheet._onTvDecrement,
            incrementFixedResult:  TnxUsageSheet._onFixedIncrement,
            decrementFixedResult:  TnxUsageSheet._onFixedDecrement,
            consumeRowAdd:         TnxUsageSheet._onConsumeRowAdd,
            consumeRowDelete:      TnxUsageSheet._onConsumeRowDelete,
            recoveryRowAdd:        TnxUsageSheet._onRecoveryRowAdd,
            recoveryRowDelete:     TnxUsageSheet._onRecoveryRowDelete,
            recoveryExcludeDelete: TnxUsageSheet._onRecoveryExcludeDelete,
            incrementRecoveryCount: TnxUsageSheet._onRecoveryCountInc,
            decrementRecoveryCount: TnxUsageSheet._onRecoveryCountDec,
            incrementConsumeAmount: TnxUsageSheet._onConsumeAmountInc,
            decrementConsumeAmount: TnxUsageSheet._onConsumeAmountDec,
            acquireRefDelete:      TnxUsageSheet._onAcquireRefDelete,
            acquireActorClear:     TnxUsageSheet._onAcquireActorClear,
            incrementAcquireCount: TnxUsageSheet._onAcquireCountInc,
            decrementAcquireCount: TnxUsageSheet._onAcquireCountDec,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs" },
    };

    tabGroups = { primary: "identity" };

    // ─── ゲッター ──────────────────────────────────────────────────────────────

    get usage() {
        return this._item.system.actions?.find(a => a._id === this._usageId) ?? null;
    }

    get title() {
        const name = this.usage?.name;
        return name ? `用途: ${name}` : "用途";
    }

    /** 用途の参加技能（親＋ベース＋コンボ）を Item 配列で返す（check / attack 用） */
    _gatherParticipatingSkills(usage) {
        const actor = this._item.actor;
        const baseId = this._item.system.isAction === true
            ? this._item.id
            : (usage.baseSkillRef?.itemId || this._item.id);
        const ids = new Set([this._item.id, baseId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));
        return [...ids]
            .map(id => (id === this._item.id ? this._item : actor?.items.get(id)))
            .filter(Boolean);
    }

    // ─── コンテキスト準備 ───────────────────────────────────────────────────────

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const usage = this.usage;
        if (!usage) {
            this.close();
            return context;
        }

        context.usage      = foundry.utils.deepClone(usage);
        context.item       = this._item;
        context.noCombo    = this._item.system?.noCombo === true; // 組み合わせ不可: コンボ(組み合わせ技能)の設定を抑止
        context.editable   = this._item.isOwner;
        context.skillOpts  = TnxSkillUtils.getSkillOptions();
        context.typeLabel  = USAGE_TYPES[usage.type] ?? usage.type;

        // タイプ判定フラグ
        context.isCheckType        = usage.type === "check";
        // 固定値判定(フェーズ11-5・2026-07-04 確定): fixedResult が設定された check 用途。
        // スート・レベル・カード・能力値を読まないため、発動タブは固定達成値のみ・効果タブは出さない
        context.isFixedCheck       = usage.type === "check" && Number.isFinite(usage.fixedResult);
        // 攻撃は判定の一種(2026-07-09): check かつ damageCategory 設定=攻撃。固定値判定は攻撃にしない
        context.isAttack           = context.isCheckType && !context.isFixedCheck && !!usage.damageCategory;
        // ダメージを修正(2026-07-11): 攻撃セクション所属(isAttack と排他=ラジオ)。使用はアイテムロール
        context.isModifyDamage     = context.isCheckType && !context.isFixedCheck && usage.modifyDamage === true;
        // 攻撃モードのラジオ値(排他の表現。両フラグ立ちは isAttack 優先で正規化表示)
        context.attackMode         = context.isAttack ? "attack" : (context.isModifyDamage ? "modifyDamage" : "none");
        // 判定モードのラジオ値(2026-07-11/12): 通常/再判定を付与/判定を修正/スートを変更
        // (判定用途に「なし」は無い)
        context.checkMode          = usage.grantRecheck === true ? "grant"
            : (usage.modifyCheck === true ? "modify"
                : (usage.grantSuitChange === true ? "suitChange" : "normal"));
        // 宣言(declaration)の判定/ダメージ修正(2026-07-12 ユーザー確定): バフ宣言の表現。
        // 判定用途とレイアウトを揃えた〈判定〉〈ダメージ〉fieldset・チェックボックス2つは独立
        // (排他 UI にしない。両方 ON の運用は想定せず、使用時は「判定を修正」が先に振られる)
        context.isDeclarationType  = usage.type === "declaration";
        if (context.isDeclarationType) {
            context.checkBonusSelf  = usage.checkBonusSelf ?? "";
            context.damageBonusSelf = usage.damageBonusSelf ?? "";
        }

        // 回復(2026-07-13 ユーザー確定): BS/戦闘不能/負傷を除去する回復・治療系の設定。
        // check/declaration の両方で設定可能。範囲=大分類(グループ)→小分類(タグ)の行(OR)・
        // 除外=タグ(タグ自身+そのタグを与える負傷を除く=「指定タグを含むもの以外すべて」)
        context.isRecoveryCapable = (context.isCheckType && !context.isFixedCheck) || context.isDeclarationType;
        if (context.isRecoveryCapable) {
            context.isRecovery      = usage.recovery === true;
            context.recoveryAll     = usage.recoveryAll === true;
            context.recoveryCountValue   = Math.max(1, usage.recoveryCount ?? 1);
            const kindOptionsFor = (group) => Object.entries(CONDITION_KINDS)
                .filter(([, def]) => def.group === group)
                .map(([value, def]) => ({ value, label: def.label }));
            context.recoveryRows = (usage.recoveryTargets ?? []).map((r, idx) => ({
                idx,
                groupOptions: Object.entries(RECOVERY_GROUP_LABELS)
                    .map(([value, label]) => ({ value, label, selected: value === r.group })),
                kindOptions: [
                    { value: "", label: "（グループ全体）", selected: !r.kind },
                    ...kindOptionsFor(r.group).map(o => ({ ...o, selected: o.value === r.kind })),
                ],
            }));
            // 除外タグ: 負傷以外(BS/戦闘不能)のタグから選ぶ(負傷は「そのタグを与える」経由で除外される)
            const excludeSet = new Set(usage.recoveryExcludes ?? []);
            context.recoveryExcludeRows = [...excludeSet]
                .map(k => ({ key: k, label: CONDITION_KINDS[k]?.label ?? k }));
            context.recoveryExcludeChoices = Object.entries(CONDITION_KINDS)
                .filter(([k, def]) => def.type !== "wound" && !excludeSet.has(k))
                .map(([value, def]) => ({ value, label: def.label }));
        }

        // NPC取得(11-6・Troops.md/2026-07-13 タイプ→フラグへ移管): check/declaration のどちらにも
        // 設定できる。設定 UI は効果タブ・設定できるのはトループ取得技能とアウトフィット
        // (旧タイプの作成ゲートを移管)。モードは明示選択・実行はモード駆動で従来どおり
        // (エキストラ=判定なし・トループ/エニグマ/分身=判定。目標値はモードで決まるため入力欄を出さない)
        context.canNpcAcquire = (this._item.type === "styleSkill" && this._item.system.unique === "troopAcquire")
            || OUTFIT_ITEM_TYPES.has(this._item.type);
        context.isNpcAcquireType = usage.npcAcquire === true;
        context.isAcquireExtraMode = false;
        if (context.isNpcAcquireType) {
            const mode = usage.acquireMode || "extra";
            context.isAcquireExtraMode = mode === "extra";
            context.acquireModeOptions = Object.entries(ACQUIRE_MODES)
                .map(([value, label]) => ({ value, label, selected: value === mode }));
            // 取得アイテム参照(エキストラモード)は fromUuid でライブ解決(削除済みは name フォールバック)
            context.acquireItemRows = await Promise.all((usage.acquireItemRefs ?? []).map(async (r, idx) => {
                const doc = r.uuid ? await fromUuid(r.uuid).catch(() => null) : null;
                return { idx, uuid: r.uuid, name: doc?.name ?? (r.name ? `${r.name}（削除済み）` : "(不明)"), missing: !doc };
            }));
            // 取得アクター参照(トループ/エニグマのみ・2026-07-07 裁定=対象は用途側で設定)。ライブ解決。
            // 分身は対象を設定せずそのまま召喚(2026-07-08 裁定)＝参照欄の代わりに召喚数を設定する
            context.isAcquireBunshinMode = mode === "bunshin";
            context.isAcquireRefMode = mode === "troop" || mode === "enigma";
            const aRef = usage.acquireActorRef ?? {};
            const aDoc = aRef.uuid ? await fromUuid(aRef.uuid).catch(() => null) : null;
            context.hasAcquireActor = !!aRef.uuid;
            context.acquireActorName = aDoc?.name ?? (aRef.name ? `${aRef.name}（削除済み）` : "");
            context.acquireModeLabel = ACQUIRE_MODES[mode] ?? "";
            context.acquireCount = Math.max(1, usage.acquireCount ?? 1);
        }
        context.isAcquireCheckMode = context.isNpcAcquireType && !context.isAcquireExtraMode;

        // 技能ベースの用途（コンボ・対決表示・自動入力の対象）。攻撃は check なのでここに含まれる
        context.showSkillParams    = context.isCheckType || context.isAcquireCheckMode;

        // ベース技能・組み合わせ技能候補（check / attack）
        if (context.showSkillParams) {
            const SKILL_TYPES = ["generalSkill", "styleSkill"];
            const actor = this._item.actor;
            const parentIsAction = this._item.system.isAction === true;

            // 技能チェーン解決: アクション技能がチェーンにあると、ベースは「指定技能＋その代用」に限定する
            // (他の無関係な技能はベースになれない)。候補が1つなら固定表示、代用が増えれば選択可能(ハードロックにしない)。
            const parentItemId = this._item.id;
            const chainRes = this._resolveComboChain();
            const lockedByChain = !!chainRes && !chainRes.defect && chainRes.baseLocked;
            // baseCandidates: null=全技能から選択(非ロック)、配列=その候補に限定(本体優先で先頭)
            let baseCandidates = null;
            if (parentIsAction) baseCandidates = [parentItemId];
            else if (lockedByChain) baseCandidates = (chainRes.baseCandidateItemIds ?? []).slice();

            const defaultBaseId = parentIsAction ? parentItemId : (chainRes && !chainRes.defect ? chainRes.baseItemId : null);
            let baseId = parentIsAction ? parentItemId : (usage.baseSkillRef?.itemId ?? "");
            // ロック時、現ベースが候補外(未設定含む)なら既定(指定技能・本体優先)へ寄せる
            if (baseCandidates && !baseCandidates.includes(baseId)) baseId = defaultBaseId ?? baseCandidates[0] ?? "";

            const baseItem = actor?.items.get(baseId) ?? (baseId === parentItemId ? this._item : null);
            context.baseSkillName  = baseItem?.name ?? (baseId ? `(削除済み: ${baseId})` : "");
            context.baseSkillId    = baseId;
            // 候補が1つだけ(代用なし)なら固定表示、複数(代用あり)なら選択可能
            context.baseSkillFixed = !!baseCandidates && baseCandidates.length <= 1;

            context.availableBaseSkills = baseCandidates
                ? baseCandidates.map(id => ({ id, name: actor?.items.get(id)?.name ?? (id === parentItemId ? this._item.name : `(削除済み: ${id})`) }))
                : (actor?.items ?? [])
                    .filter(i => SKILL_TYPES.includes(i.type) && i.id !== parentItemId)
                    .map(i => ({ id: i.id, name: i.name }))
                    .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            const parentIsComboMember = !!baseId && parentItemId !== baseId;

            const usedIds = new Set([baseId, parentItemId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));

            // 現在の参加技能(ベース＋親がコンボ＋既存コンボ)のスート積。組み合わせは共通スートで成立するため、
            // 追加すると共通スートが空になる技能は候補から除外する。
            const currentSystems = [
                baseItem?.system,
                ...(parentIsComboMember ? [this._item.system] : []),
                ...usage.skillRefs.map(r => actor?.items.get(r.itemId)?.system),
            ].filter(Boolean);
            const currentSuits = getComboSuits(currentSystems);

            // 組み合わせ候補: アクション技能(必ずベース)・組み合わせ不可技能(単独判定のみ)・
            // 現在の構成と共通スートを持たない技能 は除外する。
            context.availableSkills = (actor?.items ?? [])
                .filter(i => SKILL_TYPES.includes(i.type) && !usedIds.has(i.id)
                    && i.system.isAction !== true && i.system.noCombo !== true
                    && currentSuits.some(suit => readFlag(i.system, `suits.${suit}`)))
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            // 技能チェーン: 「、」候補制限(どれか1つ登録まで候補をその代替に絞る)・必須コンボの削除不可表示
            if (chainRes?.alternativeItemIds?.length
                && !usage.skillRefs.some(r => chainRes.alternativeItemIds.includes(r.itemId))) {
                const altSet = new Set(chainRes.alternativeItemIds);
                context.availableSkills = context.availableSkills.filter(s => altSet.has(s.id));
            }
            // 削除不可(ロック)判定: ベース連鎖、または他の組み合わせ技能が要求する技能のみロックする。
            // 単に組み合わせに居る(seed)だけでは外せる(自身が seed＝必須 で全ロックになるのを防ぐ)。
            const allComboIds = [...(parentIsComboMember ? [parentItemId] : []), ...usage.skillRefs.map(r => r.itemId)];
            let lockOf = () => false;
            const lockSkillItems = this._actorSkillItems();
            if (lockSkillItems) {
                const { rootMandatoryIds, comboChains } = comboLockAnalysis(this._normalizeSkillItem(this._item), lockSkillItems, allComboIds);
                lockOf = (id) => isComboRequired(id, allComboIds, rootMandatoryIds, comboChains);
            }

            context.skillRefItems = [
                ...(parentIsComboMember ? [{ idx: -1, itemId: parentItemId, name: this._item.name, isLocked: true }] : []),
                ...usage.skillRefs.map((r, idx) => {
                    const skillItem = actor?.items.get(r.itemId);
                    return { idx, itemId: r.itemId, name: skillItem?.name ?? `(削除済み: ${r.itemId})`, isLocked: lockOf(r.itemId) };
                }),
            ];

            // 対決（情報表示）: 参加技能の固有 confrontation を読み取り、対決可能な技能と対決不可状態を可視化。
            // confrontation の name は辞典の識別キーのため、辞典から技能名へ逆引きして表示する
            // (基底シートの comboSkill 逆引きと同じ経路。未収載キーはそのまま表示)
            const skillNames = await loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
            const nameOf = (key) => skillNames[key] || key;
            const skills = this._gatherParticipatingSkills(usage);
            const reactions = [];
            let inherentCannot = false;
            for (const s of skills) {
                for (const c of (s.system.confrontation ?? [])) {
                    if (c.value === "cannot") inherentCannot = true;
                    else if (c.value === "skillName" && c.name) reactions.push(nameOf(c.name));
                    else if (c.value === "skillNameAsterisk" && c.name) reactions.push(`${nameOf(c.name)}※`);
                }
            }
            context.confrontationReactions = [...new Set(reactions)];
            context.confrontationCannot    = inherentCannot;

            // 無視する指定技能(2026-07-10): この用途で設定した技能を指定「技能」とするスタイル技能は、
            // 指定技能を自動追加せず単体で組み合わせに参加できる(〈技能AⅡ〉系の効果)。
            // 保存は辞典の識別キー・表示は逆引きした技能名(未収載キーはそのまま)
            const ignoreKeys = this._ignoreComboKeys();
            context.ignoreComboRows = ignoreKeys.map(key => ({ key, name: nameOf(key) }));
            const usedIgnore = new Set(ignoreKeys);
            context.ignoreComboChoices = Object.entries(skillNames)
                .filter(([key]) => key && !usedIgnore.has(key))
                .map(([key, name]) => ({ key, name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
        }

        // 攻撃プロファイル(判定を攻撃に使う場合の武器・系統)。攻撃は check の一種なので、
        // 固定値でない check 用途にプロファイル欄を出す(トグルで有効化=isAttack)。物理のみ武器・種別
        if (context.isCheckType && !context.isFixedCheck) {
            const actorItems = this._item.actor?.items ?? [];
            const refs = usage.weaponRefs ?? [];
            const refIds = new Set(refs.map(r => r.itemId).filter(Boolean));
            // 一本目の武器=シートの「攻撃で使用」(戦闘タブ・空欄=生身。2026-07-13 ユーザー確定)。
            // 用途の weaponRefs は2本目以降の追加分。表示もこの実体に合わせる
            const sheetActor = this._item.actor;
            const sheetWeaponId = sheetActor?.system?.weaponRefs?.attackItemId || "";
            const sheetWeapon = sheetWeaponId ? sheetActor?.items.get(sheetWeaponId) : null;
            const atkLabel = (w) => {
                const atk = w?.system.attack ?? {};
                const val = Number(atk.total ?? atk.value) || 0;
                return `${atk.damageTypeTotal || atk.damageType || ""}${val >= 0 ? `+${val}` : val}`;
            };
            const base = sheetActor?.system?.baseAttack ?? {};
            context.sheetAttackWeapon = sheetWeapon
                ? { name: attackWeaponDisplayName(sheetWeapon), attackLabel: atkLabel(sheetWeapon) }
                : { name: "生身", attackLabel: `${base.damageTypeTotal || base.damageType || "I"}+${(base.value ?? 0) + (base.mod ?? 0)}` };
            // 選択済みの追加武器(表示行・攻撃力ラベル付き)。攻撃力はシート武器と合算される(2026-07-09)
            context.selectedWeapons = refs.map((r, idx) => {
                const w = sheetActor?.items.get(r.itemId);
                return {
                    idx, id: r.itemId,
                    name: w ? attackWeaponDisplayName(w) : "（不明な武器）",
                    attackLabel: w ? atkLabel(w) : "",
                };
            });
            // 追加候補: 武器＋ヴィークル(未選択・シート武器以外)。ヴィークルは attack を持つため武器扱い
            context.availableWeapons = actorItems
                .filter(i => (i.type === "weapon" || i.type === "vehicle")
                    && !refIds.has(i.id) && i.id !== sheetWeaponId)
                .map(i => ({ id: i.id, name: i.name }));
            const category = usage.damageCategory || "physical";
            context.isAttackPhysical = context.isAttack && category === "physical";
            context.attackCategoryOptions = [
                { value: "physical", label: "物理" },
                { value: "mental",   label: "精神" },
                { value: "social",   label: "社会" },
            ].map(o => ({ ...o, selected: o.value === category }));

            // 判定ボーナス/ダメージ修正の行(式＋供給元)。供給元はチャットの帰属表示専用(識別キーを保存し
            // 表示は逆引きした現在名)。式は @system.*・@item.<識別キー>.system.* を参照可(2026-07-10)。
            // 供給元候補(グループ化): 組み合わせスタイル技能(一般技能除外)＋使用武器。値=識別キー・
            // 表示=現在のアイテム名。識別キーを持つものだけ(帰属できる供給元)を出す
            const getItem = (id) => this._item.actor?.items.get(id);
            const skillItemIds = [...new Set([usage.baseSkillRef?.itemId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean))];
            const styleSourceOpts = skillItemIds
                .map(getItem)
                .filter(it => it && it.type === "styleSkill" && it.system.identificationKey)
                .map(it => ({ value: it.system.identificationKey, label: it.name }));
            const weaponSourceOpts = (usage.weaponRefs ?? [])
                .map(r => getItem(r.itemId))
                .filter(it => it && it.system.identificationKey)
                .map(it => ({ value: it.system.identificationKey, label: it.name }));
            const sourceGroups = [];
            if (styleSourceOpts.length)  sourceGroups.push({ label: "組み合わせ技能", options: styleSourceOpts });
            if (weaponSourceOpts.length) sourceGroups.push({ label: "使用武器", options: weaponSourceOpts });
            // 行ごとに selected 付きの供給元グループを作る(テンプレートの深いネスト回避)
            const rowGroups = (source) => sourceGroups.map(g => ({
                label: g.label,
                options: g.options.map(o => ({ value: o.value, label: o.label, selected: o.value === source })),
            }));
            context.checkBonusRows  = (usage.checkBonuses  ?? []).map((r, idx) => ({ idx, formula: r.formula, source: r.source, sourceGroups: rowGroups(r.source) }));
            context.damageBonusRows = (usage.damageBonuses ?? []).map((r, idx) => ({ idx, formula: r.formula, source: r.source, sourceGroups: rowGroups(r.source) }));
            // 用途自身の修正値(専用欄・供給元つきの追加行とは別枠。式で @item.self=親アイテムを参照可)
            context.checkBonusSelf  = usage.checkBonusSelf ?? "";
            context.damageBonusSelf = usage.damageBonusSelf ?? "";
        }

        // 消費先設定(11-6・全用途タイプ共通。固定値判定は消費 UI を出さない=エキストラは消費なし)。
        // 全ての使用回数消費はこの設定からのみ発生する(自動スキャン全廃・D&D Consumption 踏襲)
        if (!context.isFixedCheck) {
            const actor = this._item.actor;
            const CONSUME_TYPE_LABELS = {
                parent:      "親アイテムの使用回数",
                itemUses:    "アイテムの使用回数",
                miracleUses: "神業の使用回数",
                actionRank:  "AR（アクションランク）",
            };
            const usesOptions = (actor?.items ?? [])
                .filter(i => i.system?.uses?.isLimit === true && i.id !== this._item.id)
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
            const miracleOptions = (actor?.items ?? [])
                .filter(i => i.type === "miracle")
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
            context.consumeRows = (usage.consumeTargets ?? []).map((t, idx) => {
                const type = t.type || "parent";
                const options = type === "miracleUses" ? miracleOptions : usesOptions;
                const known = options.some(o => o.id === t.itemId);
                return {
                    idx,
                    type,
                    // 対象アイテム選択を持たない種別(親=自明・AR=アクター自身のリソース)
                    noTarget: type === "parent" || type === "actionRank",
                    amount: Math.max(1, t.amount ?? 1),
                    itemId: t.itemId ?? "",
                    typeOptions: Object.entries(CONSUME_TYPE_LABELS)
                        .map(([value, label]) => ({ value, label, selected: value === type })),
                    targetOptions: [
                        ...options.map(o => ({ ...o, selected: o.id === t.itemId })),
                        // 参照切れ(削除済み等)は選択状態を失わせず可視化する
                        ...(!known && t.itemId ? [{ id: t.itemId, name: `(解決不能: ${t.itemId})`, selected: true }] : []),
                    ],
                };
            });
            context.hasConsumeActor = !!actor;
        }

        // エフェクト: 用途使用時に適用する ActiveEffect の参照。供給元は親アイテム(空 itemId)＋参加技能
        // (ベース＋組み合わせ)＋使用武器(2026-07-10)。保存は {itemId, effectId}(親は itemId 空で互換)。
        const parentId = this._item.id;
        const effActor = this._item.actor;
        const getEffItem = (id) => (!id || id === parentId ? this._item : effActor?.items.get(id));
        const contribIds = [];
        for (const id of [parentId, usage.baseSkillRef?.itemId, ...(usage.skillRefs ?? []).map(r => r.itemId),
                          ...(usage.weaponRefs ?? []).map(r => r.itemId)].filter(Boolean)) {
            if (!contribIds.includes(id)) contribIds.push(id);
        }
        const contribItems = contribIds.map(id => (id === parentId ? this._item : effActor?.items.get(id))).filter(Boolean);
        const addedKey = (itemId, effectId) => `${itemId || parentId}:${effectId}`;
        const addedSet = new Set((usage.effects ?? []).map(e => addedKey(e.itemId, e.effectId)));
        // 追加済み: 保存値(itemId 空=親)をそのまま remove ハンドラへ渡す
        context.addedEffects = (usage.effects ?? []).map(e => {
            const host = getEffItem(e.itemId);
            const eff = host?.effects.get(e.effectId);
            const fromParent = !e.itemId || e.itemId === parentId;
            return {
                itemId: e.itemId ?? "", effectId: e.effectId,
                name: eff?.name ?? `(削除済み: ${e.effectId})`,
                sourceName: fromParent ? "" : (host?.name ?? ""),   // 親由来は帰属表示を省く
                // 付与先(AE 設定・2026-07-13 再設計)。既定の「対象」は表示せず「自分」だけタグを出す
                grantSelf: eff?.flags?.["tokyo-nova-axleration"]?.grantTarget === "self",
            };
        });
        // 未追加の効果を供給元アイテムごとにグループ化(選択値=`itemId|effectId`・親は itemId 空)
        context.availableEffectGroups = contribItems
            .map(it => ({
                label: it.name,
                options: [...it.effects]
                    .filter(e => !addedSet.has(addedKey(it.id, e.id)))
                    .map(e => ({ value: `${it.id === parentId ? "" : it.id}|${e.id}`, name: e.name })),
            }))
            .filter(g => g.options.length);
        context.hasAnyEffect = contribItems.some(it => it.effects.size > 0);

        return context;
    }

    /** @override */
    _onRender(context, _options) {
        // タブ初期化: DOM に active クラスを付与する
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* そのタブが存在しない場合は無視 */ }
            }
        }

        // 条件付きサブ入力（timing/target/range/targetValue）の表示同期
        this._syncConditionalSubFields();
        for (const name of ["timing.value", "target", "range", "targetValue"]) {
            this.element.querySelector(`select[name='${name}']`)
                ?.addEventListener("change", () => {
                    // 制御 select を変えたら、対応しないサブ入力欄の値をリセット（submitOnChange 前に DOM を掃除）
                    this._resetHiddenSubFields();
                    this._syncConditionalSubFields();
                });
        }

        if (context.editable) {
            // 組み合わせ技能: ドロップダウン選択で即時追加
            for (const select of this.element.querySelectorAll("select.skill-ref-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止(actions 全配列の後勝ち上書きを防ぐ)
                    const itemId = ev.target.value;
                    if (!itemId) return;
                    const usage = this.usage;
                    if (!usage || usage.skillRefs.some(r => r.itemId === itemId)) return;
                    // 追加可否: アクション技能の重複(組み合わせ不可)・個数上限を事前に判定してブロック。
                    // 「無視する指定技能」設定済みの技能は指定技能を引き込まないため、ここで弾かれない
                    const chk = this._addComboCheck(itemId);
                    if (!chk.allowed) {
                        ui.notifications.warn(chk.reason === "action"
                            ? "アクション技能同士は組み合わせできません（その技能の指定「技能」がアクション技能です。組み合わせを可能にする効果がある場合は、参加技能の「無視する指定技能」に指定技能を設定してください）。"
                            : `組み合わせ技能は最大 ${chk.limit} 個までです（ベース技能のレベル＋1個）。`);
                        ev.target.value = "";
                        return;
                    }
                    await this._patchUsage({ skillRefs: [...usage.skillRefs, { itemId }] });
                    this.render({ force: true });
                });
            }

            // 回復の除外タグ: ドロップダウン選択で即時追加(2026-07-13)
            for (const select of this.element.querySelectorAll("select.recovery-exclude-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // フォームの submitOnChange を発火させない(actions 全配列書き込みの競合防止)
                    const key = ev.target.value;
                    if (!key) return;
                    const usage = this.usage;
                    if (!usage || (usage.recoveryExcludes ?? []).includes(key)) { ev.target.value = ""; return; }
                    await this._patchUsage({ recoveryExcludes: [...(usage.recoveryExcludes ?? []), key] });
                    this.render({ force: true });
                });
            }

            // 無視する指定技能: ドロップダウン選択で即時追加(2026-07-10)
            for (const select of this.element.querySelectorAll("select.ignore-combo-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止
                    const key = ev.target.value;
                    if (!key) return;
                    const usage = this.usage;
                    if (!usage || (usage.ignoreComboSkills ?? []).includes(key)) { ev.target.value = ""; return; }
                    await this._patchUsage({ ignoreComboSkills: [...(usage.ignoreComboSkills ?? []), key] });
                    this.render({ force: true });
                });
            }

            // 使用武器(攻撃プロファイル): ドロップダウン選択で即時追加(複数選ぶと攻撃力を合算)
            for (const select of this.element.querySelectorAll("select.weapon-ref-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止
                    const itemId = ev.target.value;
                    if (!itemId) return;
                    const usage = this.usage;
                    const refs = usage?.weaponRefs ?? [];
                    if (!usage || refs.some(r => r.itemId === itemId)) { ev.target.value = ""; return; }
                    await this._patchUsage({ weaponRefs: [...refs, { itemId }] });
                    // 射程「武器」の用途は、武器の変更に射程を追従させる(2026-07-13)
                    const rangePatch = deriveWeaponRangeLive(this._item, this.usage);
                    if (rangePatch) await this._patchUsage(rangePatch);
                    this.render({ force: true });
                });
            }

            // エフェクト: ドロップダウン選択で即時追加。選択値=`itemId|effectId`(親は itemId 空)
            for (const select of this.element.querySelectorAll("select.effect-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止
                    const raw = ev.target.value;
                    if (!raw) return;
                    const sep = raw.indexOf("|");
                    const itemId = sep >= 0 ? raw.slice(0, sep) : "";
                    const effectId = sep >= 0 ? raw.slice(sep + 1) : raw;
                    if (!effectId) return;
                    const usage = this.usage;
                    if (!usage || usage.effects.some(e => (e.itemId || "") === itemId && e.effectId === effectId)) { ev.target.value = ""; return; }
                    await this._patchUsage({ effects: [...usage.effects, { itemId, effectId }] });
                    this.render({ force: true });
                });
            }
        }

        // NPC取得(エキストラモード): 取得アイテムのドロップ欄(フェーズ10 の取得アクター欄と同方式)。
        // 小分類「エキストラ」のアウトフィットのみ受け付ける(Troops.md「エキストラの二重表現」)
        if (context.editable) {
            const zone = this.element.querySelector(".usage-acquire-dropzone");
            if (zone) {
                zone.addEventListener("dragover", (ev) => ev.preventDefault());
                zone.addEventListener("drop", (ev) => this._onAcquireDrop(ev));
            }
            // NPC取得(判定系モード): 取得アクターのドロップ欄(2026-07-07 裁定=対象は用途側で設定)
            const actorZone = this.element.querySelector(".usage-acquire-actor-dropzone");
            if (actorZone) {
                actorZone.addEventListener("dragover", (ev) => ev.preventDefault());
                actorZone.addEventListener("drop", (ev) => this._onAcquireActorDrop(ev));
            }
        }

        // 技能チェーンの既定ベース設定・必須コンボの自動付与(冪等。変更があるときだけ update→再レンダリングで収束)
        if (context.editable) this._enforceComboRequirements();

        // 再描画後にスクロール位置を復元する(行の追加/削除等の操作でリセットされるのを防ぐ・2026-07-10)
        const scrollTop = this._usageScrollTop ?? 0;
        if (scrollTop) requestAnimationFrame(() => {
            const body = this.element?.querySelector(".usage-sheet-body");
            if (body) body.scrollTop = scrollTop;
        });
    }

    /** @override — 再描画前にスクロール位置を保存する(操作でスクロールが飛ぶのを防ぐ・2026-07-10) */
    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this._usageScrollTop = this.element?.querySelector(".usage-sheet-body")?.scrollTop ?? 0;
    }

    /** NPC取得(エキストラモード)の取得アイテムドロップ: 小分類「エキストラ」のアウトフィットのみ */
    async _onAcquireDrop(event) {
        event.preventDefault();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Item" || doc.system?.minorCategory !== "extra") {
            ui.notifications?.warn("ここには小分類「エキストラ」のアウトフィットをドロップしてください。");
            return;
        }
        const usage = this.usage;
        if (!usage) return;
        const refs = [...(usage.acquireItemRefs ?? [])];
        if (refs.some(r => r.uuid === doc.uuid)) return; // 重複追加しない
        refs.push({ uuid: doc.uuid, name: doc.name });
        await this._patchUsage({ acquireItemRefs: refs });
        this.render({ force: true });
    }

    /** 制御 select が指す状態に合わない条件付きサブ入力の DOM 値をリセットする */
    _resetHiddenSubFields() {
        const sel = (name) => this.element.querySelector(`select[name='${name}']`)?.value;
        const setVal = (name, v) => {
            const el = this.element.querySelector(`[name='${name}']`);
            if (el) el.value = v;
        };
        const t = sel("timing.value");
        if (t !== "action")  setVal("timing.actionName", "blank");
        if (t !== "process") setVal("timing.processName", "blank");
        if (t !== "other")   setVal("timing.timingOther", "");
        if (sel("target") !== "other") setVal("targetOther", "");
        if (sel("range")  !== "other") setVal("rangeOther", "");
        const tvv = sel("targetValue");
        if (tvv !== "number") setVal("targetValueNumber", "0");
        // 自由記入欄(式)は「その他」「解説参照」の両方で使う(2026-07-13)
        if (tvv !== "other" && tvv !== "explanation") setVal("targetValueOther", "");
    }

    /** timing / target / range / targetValue のサブ入力欄の表示を選択値に追従させる */
    _syncConditionalSubFields() {
        const val = (name) => this.element.querySelector(`select[name='${name}']`)?.value;
        const toggle = (sel, show) => this.element.querySelector(sel)?.classList.toggle("hidden", !show);

        const tv = val("timing.value");
        toggle(".timing-action-sub",  tv === "action");
        toggle(".timing-process-sub", tv === "process");
        toggle(".timing-other-sub",   tv === "other");

        toggle(".target-other-sub", val("target") === "other");
        toggle(".range-other-sub",  val("range")  === "other");

        const tvv = val("targetValue");
        toggle(".tv-number-sub", tvv === "number");
        // 「解説参照」「その他」は式を入力できる自由記入欄を出す(2026-07-13 ユーザー確定)
        toggle(".tv-other-sub",  tvv === "other" || tvv === "explanation");
    }

    // ─── フォーム送信（auto-submit on change） ─────────────────────────────────

    static async _onSubmit(event, form, formData) {
        const usage = this.usage;
        if (!usage) return;

        const raw = formData.object;
        const update = {
            name:        raw["name"]        ?? usage.name,
            description: raw["description"]  ?? usage.description,

            "timing.value":       raw["timing.value"]       ?? usage.timing.value,
            "timing.actionName":  raw["timing.actionName"]  ?? usage.timing.actionName,
            "timing.processName": raw["timing.processName"] ?? usage.timing.processName,
            "timing.timingOther": raw["timing.timingOther"] ?? usage.timing.timingOther,

            target:        raw["target"]        ?? usage.target,
            targetOther:   raw["targetOther"]   ?? usage.targetOther,
            isFixedTarget: raw["isFixedTarget"] ?? usage.isFixedTarget,

            range:        raw["range"]        ?? usage.range,
            rangeOther:   raw["rangeOther"]   ?? usage.rangeOther,
            isFixedRange: raw["isFixedRange"] ?? usage.isFixedRange,

            targetValue:       raw["targetValue"]       ?? usage.targetValue,
            targetValueNumber: raw["targetValueNumber"] ?? usage.targetValueNumber,
            targetValueOther:  raw["targetValueOther"]  ?? usage.targetValueOther,

            isUnopposable: raw["isUnopposable"] ?? usage.isUnopposable,
        };

        // 判定ボーナス/ダメージ修正の行(式＋供給元)を indexed 入力から再構成する(consumeTargets と同型)。
        // check 用途のみ行 UI を描画する。空式の行は捨てる。ダメージ修正は攻撃オン時のみ保持(2026-07-10)
        if (usage.type === "check" && !Number.isFinite(usage.fixedResult)) {
            update.checkBonuses = TnxUsageSheet._collectBonusRows(raw, "checkBonus");
            update.checkBonusSelf = raw["checkBonusSelf"] ?? usage.checkBonusSelf ?? "";
            // 判定モード(ラジオ・2026-07-11/12): normal/grant/modify/suitChange。排他はラジオが保証。
            // 再判定可能(allowRecheck)・スート変更可能(allowSuitChange)は「判定を行う用途」の性質の
            // ため通常モードでのみ保持
            const checkMode = raw["checkMode"]
                ?? (usage.grantRecheck === true ? "grant"
                    : (usage.modifyCheck === true ? "modify"
                        : (usage.grantSuitChange === true ? "suitChange" : "normal")));
            update.grantRecheck    = checkMode === "grant";
            update.modifyCheck     = checkMode === "modify";
            update.grantSuitChange = checkMode === "suitChange";
            update.allowRecheck = checkMode === "normal"
                ? (raw["allowRecheck"] ?? usage.allowRecheck ?? false) : false;
            update.allowSuitChange = checkMode === "normal"
                ? (raw["allowSuitChange"] ?? usage.allowSuitChange ?? false) : false;
            const mode = raw["attackMode"] ?? (usage.damageCategory ? "attack" : (usage.modifyDamage ? "modifyDamage" : "none"));
            const isAtk = mode === "attack";
            const isModD = mode === "modifyDamage";
            update.damageBonuses  = isAtk ? TnxUsageSheet._collectBonusRows(raw, "damageBonus") : [];
            // damageBonusSelf は攻撃の「ダメージ修正値」/ダメージを修正の「修正値」を兼ねる(2026-07-11)
            update.damageBonusSelf = (isAtk || isModD) ? (raw["damageBonusSelf"] ?? usage.damageBonusSelf ?? "") : "";
            // スタン可能は物理攻撃のみの能力ゲート(精神は説得が常時可・社会は無)
            const damageCategory = raw["damageCategory"] ?? usage.damageCategory ?? "";
            update.canStun = (isAtk && damageCategory === "physical")
                ? (raw["canStun"] ?? usage.canStun ?? false) : false;
        }

        // 宣言(declaration)の判定/ダメージ修正(2026-07-12): チェックボックスは独立(排他にしない)。
        // OFF にした側の式はクリアする(check 用途の非選択側クリアと同じ扱い)。
        // 表示切り替え(式欄の出し入れ)があるためフラグ変更時は再描画する
        let declModifyChanged = false;
        if (usage.type === "declaration") {
            const prevMC = usage.modifyCheck === true;
            const prevMD = usage.modifyDamage === true;
            update.modifyCheck  = raw["modifyCheck"]  ?? prevMC;
            update.modifyDamage = raw["modifyDamage"] ?? prevMD;
            update.checkBonusSelf  = update.modifyCheck  ? (raw["checkBonusSelf"]  ?? usage.checkBonusSelf  ?? "") : "";
            update.damageBonusSelf = update.modifyDamage ? (raw["damageBonusSelf"] ?? usage.damageBonusSelf ?? "") : "";
            // 再判定を付与(2026-07-13): 宣言は組み合わせなしの素の再判定権を事後付与する。
            // 式欄を持たないため再描画は不要
            update.grantRecheck = raw["grantRecheck"] ?? (usage.grantRecheck === true);
            // スートを変更(次の判定・2026-07-12): 式欄を持たないため再描画は不要
            update.grantSuitChange = raw["grantSuitChange"] ?? (usage.grantSuitChange === true);
            declModifyChanged = update.modifyCheck !== prevMC || update.modifyDamage !== prevMD;
        }

        // 回復(2026-07-13): check/declaration 共通。行(recoveryGroup-N/recoveryKind-N)は
        // indexed 入力から再構成(consumeTargets 同型)。トグル・該当すべて・グループ変更は
        // 表示項目が変わるため再描画する
        let recoveryUiChanged = false;
        if ((usage.type === "check" && !Number.isFinite(usage.fixedResult)) || usage.type === "declaration") {
            const prevRec = usage.recovery === true;
            const prevAll = usage.recoveryAll === true;
            update.recovery = raw["recovery"] ?? prevRec;
            if (update.recovery) {
                const recIdxs = Object.keys(raw)
                    .map(k => k.match(/^recoveryGroup-(\d+)$/)?.[1])
                    .filter(v => v !== undefined)
                    .map(Number)
                    .sort((a, b) => a - b);
                if (recIdxs.length || this.element?.querySelector(".usage-recovery-rows")) {
                    update.recoveryTargets = recIdxs.map(i => ({
                        group: raw[`recoveryGroup-${i}`] || "bs",
                        kind:  raw[`recoveryKind-${i}`] ?? "",
                    }));
                    const prevGroups = (usage.recoveryTargets ?? []).map(t => t.group);
                    recoveryUiChanged ||= update.recoveryTargets.length === prevGroups.length
                        && update.recoveryTargets.some((t, i) => t.group !== prevGroups[i]);
                }
                update.recoveryAll = raw["recoveryAll"] ?? prevAll;
                update.recoveryCount = Math.max(1, Number(raw["recoveryCount"]) || (usage.recoveryCount ?? 1));
                recoveryUiChanged ||= update.recoveryAll !== prevAll;
            } else {
                // OFF は設定をリセットする(再 ON でまっさらから始める=2026-07-13 ユーザー指示)
                update.recoveryTargets = [];
                update.recoveryExcludes = [];
                update.recoveryAll = false;
                update.recoveryCount = 1;
            }
            recoveryUiChanged ||= update.recovery !== prevRec;
        }

        // 固定達成値(フェーズ11-5・エキストラの技能判定)。固定値用途のマーカーを兼ねるため、
        // 入力が空にされても null に戻さず 0 に留める(通常判定 UI へ化けるのを防ぐ)。負値は 0 clamp
        if (Number.isFinite(usage.fixedResult)) {
            update.fixedResult = Number.isFinite(raw["fixedResult"]) ? Math.max(0, raw["fixedResult"]) : 0;
        }

        // 消費先設定(11-6): 行入力(consumeType-N / consumeItem-N / consumeAmount-N)から再構成する。
        // 消費 UI が描画されているときのみ(固定値判定ビュー等では既存値を保持)
        const consumeIdxs = Object.keys(raw)
            .map(k => k.match(/^consumeType-(\d+)$/)?.[1])
            .filter(v => v !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        let consumeTypeChanged = false;
        if (consumeIdxs.length || this.element?.querySelector(".usage-consume-section")) {
            update.consumeTargets = consumeIdxs.map(i => {
                const type = raw[`consumeType-${i}`] || "parent";
                return {
                    type,
                    // 親・AR は対象アイテムを持たない
                    itemId: (type === "parent" || type === "actionRank") ? "" : (raw[`consumeItem-${i}`] ?? ""),
                    amount: Math.max(1, Number(raw[`consumeAmount-${i}`]) || 1),
                };
            });
            // 種別の変更は対象アイテム選択の出し入れを伴うため再描画する(親/AR は選択欄なし)
            const prevTypes = (usage.consumeTargets ?? []).map(t => t.type || "parent");
            consumeTypeChanged = update.consumeTargets.length === prevTypes.length
                && update.consumeTargets.some((t, i) => t.type !== prevTypes[i]);
        }

        // 発動タブ: 制御 select が別の選択肢に変わったら、対応しないサブ値を残骸として残さずリセットする
        if (update.target !== "other")            update.targetOther = "";
        if (update.range !== "other")             update.rangeOther = "";
        if (update.targetValue !== "number")      update.targetValueNumber = 0;
        if (update.targetValue !== "other" && update.targetValue !== "explanation") update.targetValueOther = "";
        if (update["timing.value"] !== "action")  update["timing.actionName"]  = "blank";
        if (update["timing.value"] !== "process") update["timing.processName"] = "blank";
        if (update["timing.value"] !== "other")   update["timing.timingOther"] = "";

        // NPC取得(2026-07-13 フラグ化): check/declaration 共通。OFF はモード・参照・召喚数を
        // リセットする(再 ON でまっさらから=回復と同じ意味論)。モード変更は表示項目が変わるため再描画。
        // 召喚数は分身モードでのみ描画されるため、入力が無いときは既存値を保持する
        if ((usage.type === "check" && !Number.isFinite(usage.fixedResult)) || usage.type === "declaration") {
            const prevNA = usage.npcAcquire === true;
            update.npcAcquire = raw["npcAcquire"] ?? prevNA;
            if (update.npcAcquire) {
                const defMode = this._item.type === "styleSkill" ? "troop" : "extra";
                update.acquireMode = raw["acquireMode"] ?? (prevNA ? (usage.acquireMode || defMode) : defMode);
                update.acquireCount = raw["acquireCount"] !== undefined
                    ? Math.max(1, Number(raw["acquireCount"]) || 1)
                    : (usage.acquireCount ?? 1);
                recoveryUiChanged ||= update.acquireMode !== usage.acquireMode;
            } else if (prevNA) {
                update.acquireMode = "extra";
                update.acquireItemRefs = [];
                update.acquireActorRef = { uuid: "", name: "" };
                update.acquireCount = 1;
            }
            recoveryUiChanged ||= update.npcAcquire !== prevNA;
        }

        // check: ベース技能（アクション技能は常に自身に固定）
        if (usage.type === "check") {
            update["baseSkillRef.itemId"] = this._item.system.isAction === true
                ? this._item.id
                : (raw["baseSkillRef.itemId"] ?? usage.baseSkillRef?.itemId ?? "");
        }

        // 攻撃プロファイル(2026-07-09): 攻撃は check の一種。「攻撃に使う」トグル(isAttack)が
        // オンなら damageCategory=系統を設定(物理のみ武器・ダメージ種別)。オフなら damageCategory を空に。
        // 固定値判定は攻撃にしない
        const prevAttackCategory = usage.type === "check" && !Number.isFinite(usage.fixedResult)
            ? (usage.damageCategory || "") : null;
        if (usage.type === "check" && !Number.isFinite(usage.fixedResult)) {
            // 攻撃モード(ラジオ・2026-07-11): none=通常判定 / attack=攻撃 / modifyDamage=ダメージを修正。
            // 排他はラジオが保証する(チェックボックス2つの後勝ち判定は廃止)
            const mode = raw["attackMode"] ?? (usage.damageCategory ? "attack" : (usage.modifyDamage ? "modifyDamage" : "none"));
            const isAttack = mode === "attack";
            update.modifyDamage = mode === "modifyDamage";
            if (isAttack) {
                update.damageCategory = raw["damageCategory"] || usage.damageCategory || "physical";
                update.damageType     = raw["damageType"]     ?? usage.damageType;
                // weaponRefs は行の追加/削除アクション(_patchUsage)で管理し submit では触らない。
                // 非物理系統は武器・種別を持たないためクリアする
                if (update.damageCategory !== "physical") {
                    update.weaponRefs = [];
                    update.damageType = "";
                }
            } else {
                update.damageCategory = "";
                update.weaponRefs     = [];
                update.damageType     = "";
            }
        }

        // ベース変更の検知(取り消し用に変更前のベースを保持)
        const prevBaseRef = usage.baseSkillRef?.itemId ?? "";
        const baseChanged = usage.type === "check"
            && this._item.system.isAction !== true
            && (update["baseSkillRef.itemId"] ?? prevBaseRef) !== prevBaseRef;

        await this._patchUsage(update);
        // ベース変更等を即反映: 必須コンボの移動・ベースのコンボ除去を enforcement で行い再レンダリング(冪等)
        await this._enforceComboRequirements();
        // ベースを別技能に変えて個数上限を超えたら、トリムダイアログで調整(取り消しで元のベースへ戻す)
        if (baseChanged) await this._promptTrimCombos(prevBaseRef);

        // 攻撃プロファイルの有無/系統変更は表示項目が変わる(武器・ダメージ種別は物理のみ)ため即再描画する。
        // submitOnChange は再描画しないため、旧系統の入力欄が残る問題を防ぐ(2026-07-09)
        if (prevAttackCategory !== null && (update.damageCategory ?? prevAttackCategory) !== prevAttackCategory) {
            this.render({ force: true });
        }
        // 宣言の修正フラグ変更・消費種別の変更・回復設定の変更も入力欄の出し入れがあるため即再描画する
        if (declModifyChanged || consumeTypeChanged || recoveryUiChanged) this.render({ force: true });
    }

    // ─── 自動入力（参加技能の固有値を優先度で合成） ─────────────────────────────

    static async _onAutoFill(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        const patch = deriveUsageAutoFill(this._item, usage);
        await this._patchUsage(patch);
        this.render({ force: true });
        ui.notifications.info("発動パラメータと使用回数の消費を自動入力しました。手編集で上書きできます。");
    }

    // ─── 目標値スピナー ────────────────────────────────────────────────────────

    static async _onTvIncrement(_event, _target) { await this._stepTargetValue(1); }
    static async _onTvDecrement(_event, _target) { await this._stepTargetValue(-1); }

    async _stepTargetValue(delta) {
        const usage = this.usage;
        if (!usage) return;
        const next = Math.max(0, (usage.targetValueNumber ?? 0) + delta);
        await this._patchUsage({ targetValueNumber: next });
        this.render({ force: true });
    }

    // ─── 固定達成値スピナー(フェーズ11-5・固定値判定) ─────────────────────────

    static async _onFixedIncrement(_event, _target) { await this._stepFixedResult(1); }
    static async _onFixedDecrement(_event, _target) { await this._stepFixedResult(-1); }

    async _stepFixedResult(delta) {
        const usage = this.usage;
        if (!usage) return;
        const next = Math.max(0, (usage.fixedResult ?? 0) + delta);
        await this._patchUsage({ fixedResult: next });
        this.render({ force: true });
    }

    // ─── 消費先設定(11-6) ──────────────────────────────────────────────────────

    static async _onConsumeRowAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ consumeTargets: [...(usage.consumeTargets ?? []), { type: "parent", itemId: "", amount: 1 }] });
        this.render({ force: true });
    }

    static async _onConsumeRowDelete(_event, target) {
        const idx = Number(target.dataset.rowIndex);
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ consumeTargets: (usage.consumeTargets ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    static async _onConsumeAmountInc(_event, target) { await this._stepConsumeAmount(Number(target.dataset.rowIndex), 1); }
    static async _onConsumeAmountDec(_event, target) { await this._stepConsumeAmount(Number(target.dataset.rowIndex), -1); }

    async _stepConsumeAmount(idx, delta) {
        const usage = this.usage;
        if (!usage || !(usage.consumeTargets ?? [])[idx]) return;
        const rows = foundry.utils.deepClone(usage.consumeTargets);
        rows[idx].amount = Math.max(1, (rows[idx].amount ?? 1) + delta);
        await this._patchUsage({ consumeTargets: rows });
        this.render({ force: true });
    }

    // ─── 判定ボーナス/ダメージ修正の行(式＋供給元・2026-07-10) ─────────────────────

    /** indexed 入力(<prefix>Formula-N / <prefix>Source-N)から行配列を再構成(空式は捨てる)。 */
    static _collectBonusRows(raw, prefix) {
        const re = new RegExp(`^${prefix}Formula-(\\d+)$`);
        const idxs = Object.keys(raw)
            .map(k => k.match(re)?.[1])
            .filter(v => v !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        return idxs
            .map(i => ({ formula: (raw[`${prefix}Formula-${i}`] ?? "").trim(), source: raw[`${prefix}Source-${i}`] ?? "" }))
            .filter(r => r.formula);
    }

    static async _onCheckBonusAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ checkBonuses: [...(usage.checkBonuses ?? []), { formula: "", source: "" }] });
        this.render({ force: true });
    }
    static async _onCheckBonusDelete(_event, target) {
        const usage = this.usage;
        if (!usage) return;
        const idx = Number(target.dataset.idx);
        await this._patchUsage({ checkBonuses: (usage.checkBonuses ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }
    static async _onDamageBonusAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ damageBonuses: [...(usage.damageBonuses ?? []), { formula: "", source: "" }] });
        this.render({ force: true });
    }
    static async _onDamageBonusDelete(_event, target) {
        const usage = this.usage;
        if (!usage) return;
        const idx = Number(target.dataset.idx);
        await this._patchUsage({ damageBonuses: (usage.damageBonuses ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    // ─── NPC取得: 取得アイテム参照(11-6) ───────────────────────────────────────

    static async _onAcquireRefDelete(_event, target) {
        const idx = Number(target.dataset.index);
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ acquireItemRefs: (usage.acquireItemRefs ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    // ─── NPC取得: 取得アクター参照(判定系モード・2026-07-07 裁定) ─────────────────

    /** 取得アクターのドロップ: 取得類型と一致するトループ級アクターのみ受け付ける */
    async _onAcquireActorDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const usage = this.usage;
        if (!usage) return;
        const mode = usage.acquireMode || "extra";
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Actor" || doc.type !== "troop" || doc.system.troopMode !== mode) {
            ui.notifications.warn(`ここには${ACQUIRE_MODES[mode] ?? ""}のアクター（種別が一致するトループ級）をドロップしてください。`);
            return;
        }
        await this._patchUsage({ acquireActorRef: { uuid: doc.uuid, name: doc.name } });
        this.render({ force: true });
    }

    static async _onAcquireActorClear(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ acquireActorRef: { uuid: "", name: "" } });
        this.render({ force: true });
    }

    static async _onAcquireCountInc(_event, _target) { await this._stepAcquireCount(1); }
    static async _onAcquireCountDec(_event, _target) { await this._stepAcquireCount(-1); }

    async _stepAcquireCount(delta) {
        const usage = this.usage;
        if (!usage) return;
        const next = Math.max(1, (usage.acquireCount ?? 1) + delta);
        await this._patchUsage({ acquireCount: next });
        this.render({ force: true });
    }

    // ─── skillRefs 管理 ────────────────────────────────────────────────────────

    static async _onSkillRefDelete(_event, target) {
        const idx = Number(target.dataset.idx);
        const usage = this.usage;
        if (!usage) return;

        const skillRefs = usage.skillRefs.filter((_, i) => i !== idx);
        await this._patchUsage({ skillRefs });
        this.render({ force: true });
    }

    // ─── 回復設定(2026-07-13) ───────────────────────────────────────────────

    static async _onRecoveryRowAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ recoveryTargets: [...(usage.recoveryTargets ?? []), { group: "bs", kind: "" }] });
        this.render({ force: true });
    }

    static async _onRecoveryRowDelete(_event, target) {
        const idx = Number(target.dataset.rowIndex);
        const usage = this.usage;
        if (!usage) return;
        const rows = [...(usage.recoveryTargets ?? [])];
        if (idx < 0 || idx >= rows.length) return;
        rows.splice(idx, 1);
        await this._patchUsage({ recoveryTargets: rows });
        this.render({ force: true });
    }

    static async _onRecoveryExcludeDelete(_event, target) {
        const key = target.dataset.key;
        const usage = this.usage;
        if (!usage || !key) return;
        await this._patchUsage({ recoveryExcludes: (usage.recoveryExcludes ?? []).filter(k => k !== key) });
        this.render({ force: true });
    }

    static async _onRecoveryCountInc(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ recoveryCount: Math.max(1, (usage.recoveryCount ?? 1) + 1) });
        this.render({ force: true });
    }

    static async _onRecoveryCountDec(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ recoveryCount: Math.max(1, (usage.recoveryCount ?? 1) - 1) });
        this.render({ force: true });
    }

    /** 「無視する指定技能」の行を削除する(2026-07-10)。解除で指定技能(アクション)が引き込まれて
     * アクション重複になる場合は解除できない(先に該当の参加技能を外す)。 */
    static async _onIgnoreComboDelete(_event, target) {
        const key = target.dataset.key;
        const usage = this.usage;
        if (!usage || !key) return;
        const next = (usage.ignoreComboSkills ?? []).filter(k => k !== key);
        if (this._comboActionConflict(next)) {
            ui.notifications.warn("この設定を外すと指定「技能」(アクション技能)が引き込まれ、アクション技能同士になるため外せません。先に該当の組み合わせ技能を外してください。");
            return;
        }
        await this._patchUsage({ ignoreComboSkills: next });
        this.render({ force: true });
    }

    /** 指定の「無視する指定技能」構成でアクション技能が2つ以上参加になるか(現ベース込み)。 */
    _comboActionConflict(ignoreKeys) {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return false;
        const seedIds = this.usage.skillRefs.map(r => r.itemId).filter(Boolean);
        const res = resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seedIds, ignoreKeys.filter(Boolean));
        const actionIds = new Set(res.mandatoryItemIds.filter(id => this._isActionSkillId(id)));
        const curBase = this._effectiveBaseId();
        if (this._isActionSkillId(curBase)) actionIds.add(curBase);
        return actionIds.size > 1;
    }

    // ─── weaponRefs 管理(攻撃プロファイル・複数武器の合算) ────────────────────────

    static async _onWeaponRefDelete(_event, target) {
        const idx = Number(target.dataset.idx);
        const usage = this.usage;
        if (!usage) return;
        const weaponRefs = (usage.weaponRefs ?? []).filter((_, i) => i !== idx);
        await this._patchUsage({ weaponRefs });
        // 射程「武器」の用途は、武器の変更に射程を追従させる(2026-07-13)
        const rangePatch = deriveWeaponRangeLive(this._item, this.usage);
        if (rangePatch) await this._patchUsage(rangePatch);
        this.render({ force: true });
    }

    // ─── effects 管理 ──────────────────────────────────────────────────────────

    static async _onEffectRemove(_event, target) {
        const effectId = target.dataset.effectId;
        const itemId = target.dataset.itemId ?? "";
        const usage = this.usage;
        if (!usage || !effectId) return;

        // itemId＋effectId で1件だけ外す(供給元アイテムが異なる同名/同IDの取り違えを避ける)
        const effects = usage.effects.filter(e => !((e.itemId || "") === itemId && e.effectId === effectId));
        await this._patchUsage({ effects });
        this.render({ force: true });
    }

    // ─── 内部ユーティリティ ────────────────────────────────────────────────────

    /**
     * usage エントリの一部フィールドをパッチ更新する。
     * @param {object} patch  ドット記法キーを含むパッチオブジェクト
     */
    async _patchUsage(patch) {
        const actions = foundry.utils.deepClone(this._item.system.actions ?? []);
        const idx = actions.findIndex(a => a._id === this._usageId);
        if (idx === -1) return;
        for (const [key, value] of Object.entries(patch)) {
            foundry.utils.setProperty(actions[idx], key, value);
        }
        await this._item.update({ "system.actions": actions });
    }

    // ─── 技能チェーン解決・必須コンボの enforcement ──────────────────────────────

    /** actor 技能アイテムを解決用に正規化する(モジュール共通関数へ委譲)。 */
    _normalizeSkillItem(it) {
        return normalizeSkillItemDoc(it);
    }

    /** actor 上の技能アイテム(check=攻撃含む・連鎖対象)を正規化して返す。対象外は null。 */
    _actorSkillItems() {
        const usage = this.usage;
        const actor = this._item.actor;
        if (!usage || usage.type !== "check") return null;
        if (!actor || !CHAIN_SKILL_TYPES.includes(this._item.type)) return null;
        return actor.items.filter(i => CHAIN_SKILL_TYPES.includes(i.type)).map(i => this._normalizeSkillItem(i));
    }

    /** 用途の「技能」欄チェーンを actor アイテムに解決する(現コンボを seed に含めて推移的に)。 */
    _resolveComboChain() {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return null;
        const seedComboIds = this.usage.skillRefs.map(r => r.itemId).filter(Boolean);
        return resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seedComboIds,
            this._ignoreComboKeys());
    }

    /** 用途の「無視する指定技能」(識別キー配列・空要素除去)。 */
    _ignoreComboKeys() {
        return (this.usage?.ignoreComboSkills ?? []).filter(Boolean);
    }

    /** 現在の実効ベース技能 id(アクション親は自身・非アクションは baseSkillRef かフォールバックで親)。 */
    _effectiveBaseId() {
        if (this._item.system.isAction === true) return this._item.id;
        return this.usage?.baseSkillRef?.itemId || this._item.id;
    }

    /** ベース技能のレベル(＝組み合わせ技能の上限個数。ベース込みで level+1)。 */
    _baseSkillLevel(baseId) {
        const it = this._item.actor?.items.get(baseId) ?? (baseId === this._item.id ? this._item : null);
        return Number(it?.system?.level ?? 0);
    }

    /** アイテム id がアクション技能か(アクション技能はベース専用で組み合わせ技能の欄には絶対に入らない)。 */
    _isActionSkillId(id) {
        const it = this._item.actor?.items.get(id) ?? (id === this._item.id ? this._item : null);
        return it?.system?.isAction === true;
    }

    /** ベース・必須クロージャから、あるべき skillRefs を組み立てる(ベース自身＆アクション技能を除外し、必須を補完)。 */
    _targetSkillRefs(baseId, currentRefIds, res) {
        const parentItemId = this._item.id;
        // アクション技能はベース専用＝コンボに絶対入れない。ベース自身も除外する。
        const target = currentRefIds.filter(id => id !== baseId && !this._isActionSkillId(id));
        const have = new Set(target);
        for (const id of res.mandatoryItemIds) {
            if (id !== baseId && id !== parentItemId && !have.has(id) && !this._isActionSkillId(id)) { target.push(id); have.add(id); }
        }
        return target;
    }

    /** 用途シート上の組み合わせ技能数(暗黙の親＋skillRefs)と上限・ベース。 */
    _comboCountInfo() {
        const baseId = this._effectiveBaseId();
        const parentIsComboMember = baseId !== this._item.id;
        return {
            baseId,
            limit: this._baseSkillLevel(baseId),
            count: this.usage.skillRefs.length + (parentIsComboMember ? 1 : 0),
            parentIsComboMember,
        };
    }

    /** res(追加後の解決結果)を踏まえた実効ベース id。アクション連れ込みでのベース入れ替わりを反映する。 */
    _resolvedBaseId(res) {
        const parentItemId = this._item.id;
        if (this._item.system.isAction === true) return parentItemId;
        if (res?.baseLocked) return res.baseItemId;                                       // アクション連れ込み→入れ替わり
        const current = this.usage.baseSkillRef?.itemId ?? "";
        if (current) return current;
        if (res?.baseItemId && res.baseItemId !== parentItemId) return res.baseItemId;    // 既定ベース
        return parentItemId;
    }

    /**
     * 技能 itemId を組み合わせに追加できるか判定する。
     * - アクション技能の重複(参加にアクションが2つ以上＝組み合わせ不可) → reason "action"
     * - 個数上限超過(追加後のベース入れ替わりを反映) → reason "limit"
     * @returns {{allowed:boolean, reason?:string, limit?:number}}
     */
    _addComboCheck(itemId) {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return { allowed: true }; // 解決不能なら制限しない
        const parentItemId = this._item.id;
        const currentRefIds = this.usage.skillRefs.map(r => r.itemId);
        // 用途の「無視する指定技能」を反映して判定する(該当技能は指定技能を引き込まず単体参加
        // ＝指定技能がアクションでもここで弾かれない)
        const res = resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, [...currentRefIds, itemId], this._ignoreComboKeys());

        // アクション技能の重複: 参加技能(クロージャ＋現ベース)にアクションが2つ以上 → 組み合わせ不可
        const actionIds = new Set(res.mandatoryItemIds.filter(id => this._isActionSkillId(id)));
        const curBase = this._effectiveBaseId();
        if (this._isActionSkillId(curBase)) actionIds.add(curBase);
        if (actionIds.size > 1) return { allowed: false, reason: "action" };

        // 個数上限(追加後のベース入れ替わりを反映)
        const newBaseId = this._resolvedBaseId(res);
        const limit = this._baseSkillLevel(newBaseId);
        const projected = this._targetSkillRefs(newBaseId, [...currentRefIds, itemId], res).length
            + (newBaseId !== parentItemId ? 1 : 0);
        if (projected > limit) return { allowed: false, reason: "limit", limit };
        return { allowed: true };
    }

    /**
     * 個数上限を超えているとき、外す技能をユーザーに選ばせて調整する(ベース変更で上限が下がった等)。
     * チェック状態に応じてロックを再計算し、削除予定の技能が連れ込んでいた必須技能は外せるようになる。
     * 取り消し時は prevBaseRef にベースを戻す。必須だけで超過する場合は救えないので警告して戻す。
     */
    async _promptTrimCombos(prevBaseRef) {
        const info = this._comboCountInfo();
        if (info.count <= info.limit) return;
        const needToRemove = info.count - info.limit;
        const skillItems = this._actorSkillItems();
        if (!skillItems) return;

        const actor = this._item.actor;
        const entries = [];
        if (info.parentIsComboMember) entries.push({ id: this._item.id, name: this._item.name });
        for (const r of this.usage.skillRefs) entries.push({ id: r.itemId, name: actor?.items.get(r.itemId)?.name ?? `(削除済み: ${r.itemId})` });
        const comboIds = entries.map(e => e.id);
        const { rootMandatoryIds, comboChains } = comboLockAnalysis(this._normalizeSkillItem(this._item), skillItems, comboIds);

        // 救えない: 外せる(必須でない)技能が不足
        if (comboIds.filter(id => !rootMandatoryIds.includes(id)).length < needToRemove) {
            ui.notifications.warn(`組み合わせが上限(${info.limit}個)を超えますが、必須技能だけで超過しているため調整できません。ベース技能を元に戻します。`);
            await this._patchUsage({ "baseSkillRef.itemId": prevBaseRef });
            await this._enforceComboRequirements();
            return;
        }

        const locked0 = (id) => isComboRequired(id, comboIds, rootMandatoryIds, comboChains);
        const rows = entries.map(e =>
            `<button type="button" class="tnx-trim-item" data-action="trimToggle" data-id="${e.id}" aria-pressed="false"${locked0(e.id) ? " disabled" : ""} style="text-align:left;">${e.name}${locked0(e.id) ? "（必須）" : ""}</button>`
        ).join("");
        const content = `<p>組み合わせ技能が上限(${info.limit}個)を <b>${needToRemove}</b> 個超えています。外す技能を選んで「確定」してください（必須技能は外せません）。</p>
            <div class="tnx-trim-list" style="display:flex;flex-direction:column;gap:4px;">${rows}</div>`;

        const result = await foundry.applications.api.DialogV2.wait({
            window:   { title: "組み合わせの個数調整" },
            classes:  ["tokyo-nova"],
            position: { width: 400 },
            content,
            actions: {
                trimToggle: (_event, target) => {
                    const pressed = target.getAttribute("aria-pressed") === "true";
                    target.setAttribute("aria-pressed", String(!pressed));
                    target.style.textDecoration = !pressed ? "line-through" : "";
                    target.style.opacity = !pressed ? "0.6" : "";
                    const items = [...target.closest(".tnx-trim-list").querySelectorAll(".tnx-trim-item")];
                    const toRemove = items.filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.id);
                    const kept = comboIds.filter(id => !toRemove.includes(id));
                    for (const b of items) {
                        const locked = isComboRequired(b.dataset.id, kept, rootMandatoryIds, comboChains);
                        if (locked && b.getAttribute("aria-pressed") === "true") {
                            b.setAttribute("aria-pressed", "false");
                            b.style.textDecoration = ""; b.style.opacity = "";
                        }
                        b.disabled = locked;
                    }
                },
            },
            buttons: [
                { action: "ok", icon: "fas fa-check", label: "確定", default: true,
                  callback: (_e, _b, dialog) => [...dialog.element.querySelectorAll('.tnx-trim-item[aria-pressed="true"]')].map(b => b.dataset.id) },
                { action: "cancel", icon: "fas fa-times", label: "取り消し", callback: () => "cancel" },
            ],
            rejectClose: false,
        });

        if (!Array.isArray(result)) {
            // 取り消し/閉じる: ベース変更を元に戻す
            await this._patchUsage({ "baseSkillRef.itemId": prevBaseRef });
            await this._enforceComboRequirements();
            return;
        }
        // 選択した技能を skillRefs から外す(暗黙の親は skillRefs に無いので影響なし)
        const toRemove = new Set(result);
        await this._patchUsage({ skillRefs: this.usage.skillRefs.filter(r => !toRemove.has(r.itemId)) });
        await this._enforceComboRequirements();
        // まだ超過していれば再調整(外せる技能は足りる前提なのでいずれ収束)
        const after = this._comboCountInfo();
        if (after.count > after.limit) await this._promptTrimCombos(prevBaseRef);
    }

    /**
     * 技能チェーンに基づき、用途のベース既定値と必須コンボを保つ(冪等)。
     * - ベース未設定かつ非manual → 既定ベースを設定。
     * - ベースが決まっているとき、mandatory のうちベース・親(暗黙コンボ)以外を全て skillRefs に自動追加
     *   (指定技能がベースでなくなった/別アクションがベースになった場合のはじき出し対応)。
     * 変更があったときだけ update し、true を返す。
     */
    async _enforceComboRequirements() {
        const usage = this.usage;
        if (!usage) return false;
        const res = this._resolveComboChain();
        if (!res || res.defect) return false; // 解決不能/不備のときは自動設定しない

        const parentIsAction = this._item.system.isAction === true;
        const parentItemId = this._item.id;
        // アクション技能がチェーンにあると、ベースは「指定技能＋その代用」に限定する(他はベースになれない)
        const baseCandidates = parentIsAction ? [parentItemId]
            : (res.baseLocked ? (res.baseCandidateItemIds ?? []) : null);
        const defaultBaseId = parentIsAction ? parentItemId : res.baseItemId;
        let baseId = parentIsAction ? parentItemId : (usage.baseSkillRef?.itemId ?? "");

        const patch = {};
        if (baseCandidates) {
            // ロック: 現ベースが候補外(未設定含む)なら既定(指定技能・本体優先)へ寄せる。候補内ならユーザー選択を尊重
            if (!baseCandidates.includes(baseId)) {
                baseId = defaultBaseId ?? baseCandidates[0] ?? "";
                if (!parentIsAction && baseId) patch["baseSkillRef.itemId"] = baseId;
            }
        } else if (!baseId && !res.manual && res.baseItemId && res.baseItemId !== parentItemId) {
            // 非ロック: ベース未設定なら既定ベースを設定(自身をベースにする no-chain は既存フォールバックに委ねる)
            baseId = res.baseItemId;
            patch["baseSkillRef.itemId"] = baseId;
        }

        // ベースが決まっているときのみ: ベース自身はコンボから外し、必須コンボ(クロージャ)を補完する
        if (baseId) {
            const current = usage.skillRefs.map(r => r.itemId);
            const target = this._targetSkillRefs(baseId, current, res); // ベース除外＋必須補完
            if (target.length !== current.length || target.some((id, i) => id !== current[i])) {
                patch.skillRefs = target.map(id => ({ itemId: id }));
            }
        }

        if (!Object.keys(patch).length) return false; // 変更なし(冪等で収束)
        await this._patchUsage(patch);
        this.render({ force: true }); // 反映のため即時再レンダリング(シートの開き直し不要)
        return true;
    }
}
