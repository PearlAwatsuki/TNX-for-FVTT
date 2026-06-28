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
import { getComboSuits } from "./tnx-judgment-engine.mjs";
import { resolveUsageSkills, comboLockAnalysis, isComboRequired } from "./skill-chain-resolution.mjs";

const CHAIN_SKILL_TYPES = ["generalSkill", "styleSkill"];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const USAGE_TYPES = Object.freeze({
    check:        "判定",
    attack:       "攻撃",
    declaration:  "宣言",
    damageBoost:  "ダメージ増加",
    damageReduce: "ダメージ軽減",
    modification: "改造",
});

// ─── 発動パラメータ優先度（自動入力で使用） ───────────────────────────────────
// ルール正本: llm-wiki/01_Wiki/Game_Rules/Judgment_Rules.md（対象優先度・射程優先度）

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

/** 参加技能群の目標値を解決。数値があれば最大、なければ最初の非blank型を採用 */
function resolveTargetValue(entries) {
    const numerics = entries.filter(e => e.targetValue === "number");
    if (numerics.length) {
        return { targetValue: "number", targetValueNumber: Math.max(...numerics.map(e => e.number ?? 0)) };
    }
    const typed = entries.find(e => e.targetValue && e.targetValue !== "blank" && e.targetValue !== "none");
    return typed ? { targetValue: typed.targetValue } : null;
}

export class TnxUsageSheet extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(item, usageId, options = {}) {
        super(options);
        this._item = item;
        this._usageId = usageId;
    }

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "tnx-usage-sheet"],
        position: { width: 500, height: 520 },
        window: { resizable: true },
        tag: "form",
        form: {
            handler: TnxUsageSheet._onSubmit,
            submitOnChange: true,
            closeOnSubmit: false,
        },
        actions: {
            skillRefDelete:        TnxUsageSheet._onSkillRefDelete,
            effectRemove:          TnxUsageSheet._onEffectRemove,
            paramAdd:              TnxUsageSheet._onParamAdd,
            paramDelete:           TnxUsageSheet._onParamDelete,
            autoFill:              TnxUsageSheet._onAutoFill,
            incrementTargetValue:  TnxUsageSheet._onTvIncrement,
            decrementTargetValue:  TnxUsageSheet._onTvDecrement,
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
        context.isAttackType       = usage.type === "attack";
        context.isDamageType       = usage.type === "damageBoost" || usage.type === "damageReduce";
        context.isModificationType = usage.type === "modification";
        // 技能ベースの用途（コンボ・対決表示・自動入力の対象）
        context.showSkillParams    = context.isCheckType || context.isAttackType;

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
                    && currentSuits.some(suit => i.system.suits?.[suit] === true))
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

            // 対決（情報表示）: 参加技能の固有 confrontation を読み取り、対決可能な技能と対決不可状態を可視化
            const skills = this._gatherParticipatingSkills(usage);
            const reactions = [];
            let inherentCannot = false;
            for (const s of skills) {
                for (const c of (s.system.confrontation ?? [])) {
                    if (c.value === "cannot") inherentCannot = true;
                    else if (c.value === "skillName" && c.name) reactions.push(c.name);
                    else if (c.value === "skillNameAsterisk" && c.name) reactions.push(`${c.name}※`);
                }
            }
            context.confrontationReactions = [...new Set(reactions)];
            context.confrontationCannot    = inherentCannot;
        }

        // 武器候補（attack）
        if (context.isAttackType) {
            context.availableWeapons = (this._item.actor?.items ?? [])
                .filter(i => i.type === "weapon")
                .map(i => ({ id: i.id, name: i.name }));
            context.selectedWeaponName = this._item.actor?.items.get(usage.weaponRef?.itemId)?.name ?? "";
        }

        // エフェクト: 用途使用時に適用する ActiveEffect の参照
        const addedIds = usage.effects.map(e => e.effectId).filter(Boolean);
        const addedSet = new Set(addedIds);
        context.addedEffects = addedIds.map(id => {
            const eff = this._item.effects.get(id);
            return { id, name: eff?.name ?? `(削除済み: ${id})` };
        });
        context.availableEffects = this._item.effects
            .filter(e => !addedSet.has(e.id))
            .map(e => ({ id: e.id, name: e.name }));
        context.hasAnyEffect = this._item.effects.size > 0;

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
                    const itemId = ev.target.value;
                    if (!itemId) return;
                    const usage = this.usage;
                    if (!usage || usage.skillRefs.some(r => r.itemId === itemId)) return;
                    // 追加可否: アクション技能の重複(組み合わせ不可)・個数上限を事前に判定してブロック
                    const chk = this._addComboCheck(itemId);
                    if (!chk.allowed) {
                        ui.notifications.warn(chk.reason === "action"
                            ? "アクション技能同士は組み合わせできません（その技能の指定「技能」がアクション技能です）。"
                            : `組み合わせ技能は最大 ${chk.limit} 個までです（ベース技能のレベル＋1個）。`);
                        ev.target.value = "";
                        return;
                    }
                    await this._patchUsage({ skillRefs: [...usage.skillRefs, { itemId }] });
                    this.render({ force: true });
                });
            }

            // エフェクト: ドロップダウン選択で即時追加
            for (const select of this.element.querySelectorAll("select.effect-select")) {
                select.addEventListener("change", async (ev) => {
                    const effectId = ev.target.value;
                    if (!effectId) return;
                    const usage = this.usage;
                    if (!usage || usage.effects.some(e => e.effectId === effectId)) return;
                    await this._patchUsage({ effects: [...usage.effects, { effectId }] });
                    this.render({ force: true });
                });
            }
        }

        // 技能チェーンの既定ベース設定・必須コンボの自動付与(冪等。変更があるときだけ update→再レンダリングで収束)
        if (context.editable) this._enforceComboRequirements();
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
        if (tvv !== "other")  setVal("targetValueOther", "");
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
        toggle(".tv-other-sub",  tvv === "other");
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

        // 発動タブ: 制御 select が別の選択肢に変わったら、対応しないサブ値を残骸として残さずリセットする
        if (update.target !== "other")            update.targetOther = "";
        if (update.range !== "other")             update.rangeOther = "";
        if (update.targetValue !== "number")      update.targetValueNumber = 0;
        if (update.targetValue !== "other")       update.targetValueOther = "";
        if (update["timing.value"] !== "action")  update["timing.actionName"]  = "blank";
        if (update["timing.value"] !== "process") update["timing.processName"] = "blank";
        if (update["timing.value"] !== "other")   update["timing.timingOther"] = "";

        // check・attack: ベース技能（アクション技能は常に自身に固定）
        if (usage.type === "check" || usage.type === "attack") {
            update["baseSkillRef.itemId"] = this._item.system.isAction === true
                ? this._item.id
                : (raw["baseSkillRef.itemId"] ?? usage.baseSkillRef?.itemId ?? "");
        }

        // attack 固有
        if (usage.type === "attack") {
            update["weaponRef.itemId"] = raw["weaponRef.itemId"] ?? usage.weaponRef.itemId;
            update.damageType          = raw["damageType"]       ?? usage.damageType;
        }

        // damageBoost / damageReduce 固有
        if (usage.type === "damageBoost" || usage.type === "damageReduce") {
            update.formula        = raw["formula"]        ?? usage.formula;
            update.damageCategory = raw["damageCategory"] ?? usage.damageCategory;
        }

        // ベース変更の検知(取り消し用に変更前のベースを保持)
        const prevBaseRef = usage.baseSkillRef?.itemId ?? "";
        const baseChanged = (usage.type === "check" || usage.type === "attack")
            && this._item.system.isAction !== true
            && (update["baseSkillRef.itemId"] ?? prevBaseRef) !== prevBaseRef;

        await this._patchUsage(update);
        // ベース変更等を即反映: 必須コンボの移動・ベースのコンボ除去を enforcement で行い再レンダリング(冪等)
        await this._enforceComboRequirements();
        // ベースを別技能に変えて個数上限を超えたら、トリムダイアログで調整(取り消しで元のベースへ戻す)
        if (baseChanged) await this._promptTrimCombos(prevBaseRef);
    }

    // ─── 自動入力（参加技能の固有値を優先度で合成） ─────────────────────────────

    static async _onAutoFill(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        const skills = this._gatherParticipatingSkills(usage);

        const patch = {};
        const t = resolveTarget(skills.map(s => ({ target: s.system.target, isFixed: !!s.system.isFixedTarget })));
        if (t) { patch.target = t.target; patch.isFixedTarget = t.isFixed; }

        const r = resolveRange(skills.map(s => ({ range: s.system.range, isFixed: !!s.system.isFixedRange })));
        if (r) { patch.range = r.range; patch.isFixedRange = r.isFixed; }

        const tv = resolveTargetValue(skills.map(s => ({ targetValue: s.system.targetValue, number: s.system.targetValueNumber })));
        if (tv) {
            patch.targetValue = tv.targetValue;
            if (tv.targetValueNumber !== undefined) patch.targetValueNumber = tv.targetValueNumber;
        }

        // タイミング: ベース技能の最初の非 blank timing を採用（best-effort）
        const baseId = this._item.system.isAction === true
            ? this._item.id
            : (usage.baseSkillRef?.itemId || this._item.id);
        const baseSkill = skills.find(s => s.id === baseId) ?? this._item;
        const bt = (baseSkill.system.timing ?? []).find(x => x?.value && x.value !== "blank");
        if (bt) {
            patch["timing.value"]       = bt.value;
            patch["timing.actionName"]  = bt.actionName ?? "blank";
            patch["timing.processName"] = bt.processName ?? "blank";
            patch["timing.timingOther"] = bt.timingOther ?? "";
        }

        // 対決不可: 参加技能が固有に「対決不可」なら true（外す方向には自動更新しない）
        if (skills.some(s => (s.system.confrontation ?? []).some(c => c.value === "cannot"))) {
            patch.isUnopposable = true;
        }

        await this._patchUsage(patch);
        this.render({ force: true });
        ui.notifications.info("発動パラメータを自動入力しました。手編集で上書きできます。");
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

    // ─── skillRefs 管理 ────────────────────────────────────────────────────────

    static async _onSkillRefDelete(_event, target) {
        const idx = Number(target.dataset.idx);
        const usage = this.usage;
        if (!usage) return;

        const skillRefs = usage.skillRefs.filter((_, i) => i !== idx);
        await this._patchUsage({ skillRefs });
        this.render({ force: true });
    }

    // ─── effects 管理 ──────────────────────────────────────────────────────────

    static async _onEffectRemove(_event, target) {
        const effectId = target.dataset.effectId;
        const usage = this.usage;
        if (!usage || !effectId) return;

        const effects = usage.effects.filter(e => e.effectId !== effectId);
        await this._patchUsage({ effects });
        this.render({ force: true });
    }

    // ─── modifiableParams 管理 ─────────────────────────────────────────────────

    static async _onParamAdd(_event, _target) {
        const input = this.element.querySelector("input.param-input");
        const val = input?.value?.trim();
        if (!val) return;

        const usage = this.usage;
        if (!usage) return;

        const modifiableParams = [...(usage.modifiableParams ?? []), val];
        await this._patchUsage({ modifiableParams });
        if (input) input.value = "";
        this.render({ force: true });
    }

    static async _onParamDelete(_event, target) {
        const idx = Number(target.dataset.idx);
        const usage = this.usage;
        if (!usage) return;

        const modifiableParams = (usage.modifiableParams ?? []).filter((_, i) => i !== idx);
        await this._patchUsage({ modifiableParams });
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

    /** actor 技能アイテムを解決用に正規化する。 */
    _normalizeSkillItem(it) {
        return {
            id: it.id,
            identificationKey: it.system?.identificationKey ?? "",
            isAction: it.system?.isAction === true,
            isSubstitute: it.system?.isSubstitute === true,
            substituteTarget: Array.isArray(it.system?.substituteTarget) ? it.system.substituteTarget : [],
            comboSkill: it.system?.comboSkill ?? [],
        };
    }

    /** actor 上の技能アイテム(check/attack 用の連鎖対象)を正規化して返す。対象外は null。 */
    _actorSkillItems() {
        const usage = this.usage;
        const actor = this._item.actor;
        if (!usage || (usage.type !== "check" && usage.type !== "attack")) return null;
        if (!actor || !CHAIN_SKILL_TYPES.includes(this._item.type)) return null;
        return actor.items.filter(i => CHAIN_SKILL_TYPES.includes(i.type)).map(i => this._normalizeSkillItem(i));
    }

    /** 用途の「技能」欄チェーンを actor アイテムに解決する(現コンボを seed に含めて推移的に)。 */
    _resolveComboChain() {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return null;
        const seedComboIds = this.usage.skillRefs.map(r => r.itemId).filter(Boolean);
        return resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seedComboIds);
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
        const res = resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, [...currentRefIds, itemId]);

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
