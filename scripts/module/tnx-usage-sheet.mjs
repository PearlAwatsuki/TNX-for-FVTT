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

            // ベース技能: アクション技能は常に自身に固定、非アクション技能はセレクターで選択
            const parentItemId = this._item.id;
            const baseId = parentIsAction ? parentItemId : (usage.baseSkillRef?.itemId ?? "");
            const baseItem = actor?.items.get(baseId) ?? (baseId === parentItemId ? this._item : null);
            context.baseSkillName  = baseItem?.name ?? (baseId ? `(削除済み: ${baseId})` : "");
            context.baseSkillId    = baseId;
            context.baseSkillFixed = parentIsAction;

            context.availableBaseSkills = parentIsAction ? [] : (actor?.items ?? [])
                .filter(i => SKILL_TYPES.includes(i.type) && i.id !== parentItemId)
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            const parentIsComboMember = !!baseId && parentItemId !== baseId;

            const usedIds = new Set([baseId, parentItemId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));
            context.availableSkills = (actor?.items ?? [])
                .filter(i => SKILL_TYPES.includes(i.type) && !usedIds.has(i.id) && i.system.isAction !== true)
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            context.skillRefItems = [
                ...(parentIsComboMember ? [{ idx: -1, itemId: parentItemId, name: this._item.name, isLocked: true }] : []),
                ...usage.skillRefs.map((r, idx) => {
                    const skillItem = actor?.items.get(r.itemId);
                    return { idx, itemId: r.itemId, name: skillItem?.name ?? `(削除済み: ${r.itemId})`, isLocked: false };
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

        await this._patchUsage(update);
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
}
