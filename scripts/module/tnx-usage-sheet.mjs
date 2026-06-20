/**
 * @fileoverview TnxUsageSheet - 用途エントリの編集シート
 *
 * 用途データはアイテムの system.actions[] に格納されている。
 * このシートは item と usageId を受け取り、対象エントリを
 * 読み書きする疑似ドキュメントシートとして機能する。
 *
 * D&D 5e の Activity Sheet を参考に設計:
 *   - タブ構成: 基本 / 起動 / [種別固有] / エフェクト
 *   - タイプは作成時に固定（UI 上で変更不可）
 *   - skillRefs/effects は専用ボタンで管理（submitOnChange 外）
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

/** タイプ固有タブのラベル（存在しないタイプは null） */
const TYPE_TAB_LABELS = Object.freeze({
    check:        "判定",
    attack:       "攻撃",
    damageBoost:  "ダメージ",
    damageReduce: "ダメージ",
    modification: "改造",
});

export class TnxUsageSheet extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(item, usageId, options = {}) {
        super(options);
        this._item = item;
        this._usageId = usageId;
    }

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "tnx-usage-sheet"],
        position: { width: 500, height: 480 },
        window: { resizable: true },
        tag: "form",
        form: {
            handler: TnxUsageSheet._onSubmit,
            submitOnChange: true,
            closeOnSubmit: false,
        },
        actions: {
            skillRefDelete: TnxUsageSheet._onSkillRefDelete,
            effectRemove:   TnxUsageSheet._onEffectRemove,
            paramAdd:       TnxUsageSheet._onParamAdd,
            paramDelete:    TnxUsageSheet._onParamDelete,
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

    // ─── コンテキスト準備 ───────────────────────────────────────────────────────

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const usage = this.usage;
        if (!usage) {
            this.close();
            return context;
        }

        const skillOptions = TnxSkillUtils.getSkillOptions();

        context.usage      = foundry.utils.deepClone(usage);
        context.item       = this._item;
        context.editable   = this._item.isOwner;
        context.skillOpts  = skillOptions;
        context.typeLabel  = USAGE_TYPES[usage.type] ?? usage.type;

        const typeTabLabel = TYPE_TAB_LABELS[usage.type] ?? null;
        context.hasTypeTab    = typeTabLabel !== null;
        context.typeTabLabel  = typeTabLabel;

        // タイプ判定フラグ
        context.isCheckType        = usage.type === "check";
        context.isAttackType       = usage.type === "attack";
        context.isDamageType       = usage.type === "damageBoost" || usage.type === "damageReduce";
        context.isModificationType = usage.type === "modification";

        // ベース技能・組み合わせ技能候補（check / attack）
        if (context.isCheckType || context.isAttackType) {
            const SKILL_TYPES = ["generalSkill", "styleSkill"];
            const actor = this._item.actor;
            const parentIsAction = this._item.system.isAction === true;

            // ベース技能: アクション技能は常に自身に固定、非アクション技能はセレクターで選択
            const parentItemId = this._item.id;
            const baseId = parentIsAction ? parentItemId : (usage.baseSkillRef?.itemId ?? "");
            // actor が null のとき（スタンドアロンアイテム）でも自身への参照は名前を表示
            const baseItem = actor?.items.get(baseId) ?? (baseId === parentItemId ? this._item : null);
            context.baseSkillName  = baseItem?.name ?? (baseId ? `(削除済み: ${baseId})` : "");
            context.baseSkillId    = baseId;
            context.baseSkillFixed = parentIsAction;

            // ベース技能の選択候補（非アクション技能の用途のみ。アクション技能は常に自身が固定なので除外）
            // アクション技能もそれ以外の技能もベースになりうる（アクション技能は必ずベースになる）
            context.availableBaseSkills = parentIsAction ? [] : (actor?.items ?? [])
                .filter(i => SKILL_TYPES.includes(i.type) && i.id !== parentItemId)
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            // 親アイテムがベース技能でない場合は自動的にコンボ参加（isLocked エントリ）
            const parentIsComboMember = !!baseId && parentItemId !== baseId;

            // コンボ技能候補（ベース技能・親アイテム・既選択・アクション技能を除外）
            // アクション技能同士の組み合わせ不可のため isAction === true は除外
            const usedIds = new Set([baseId, parentItemId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));
            context.availableSkills = (actor?.items ?? [])
                .filter(i => SKILL_TYPES.includes(i.type) && !usedIds.has(i.id) && i.system.isAction !== true)
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            // 組み合わせ技能リスト（親＋skillRefs）
            context.skillRefItems = [
                ...(parentIsComboMember ? [{ idx: -1, itemId: parentItemId, name: this._item.name, isLocked: true }] : []),
                ...usage.skillRefs.map((r, idx) => {
                    const skillItem = actor?.items.get(r.itemId);
                    return { idx, itemId: r.itemId, name: skillItem?.name ?? `(削除済み: ${r.itemId})`, isLocked: false };
                }),
            ];
        }

        // 武器候補（attack）
        if (context.isAttackType) {
            context.availableWeapons = (this._item.actor?.items ?? [])
                .filter(i => i.type === "weapon")
                .map(i => ({ id: i.id, name: i.name }));
            context.selectedWeaponName = this._item.actor?.items.get(usage.weaponRef?.itemId)?.name ?? "";
        }

        // エフェクト: 用途使用時に適用する ActiveEffect の参照
        // - addedEffects: 用途に追加済み（usage.effects 順を保持）
        // - availableEffects: アイテムが持つが未追加の ActiveEffect（セレクトの選択肢）
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
        // typeSpecific タブが存在しないタイプなのにアクティブになっている場合は identity に戻す
        if (this.tabGroups.primary === "typeSpecific" && !context.hasTypeTab) {
            this.tabGroups.primary = "identity";
        }

        // タブ初期化: DOM に active クラスを付与する
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* そのタブが存在しない場合は無視 */ }
            }
        }

        // timing.value 変更でサブ選択肢を動的表示
        const timingSelect = this.element.querySelector("select[name='timing.value']");
        if (timingSelect) {
            timingSelect.addEventListener("change", (ev) => this._onTimingValueChange(ev));
            this._syncTimingSubFields(timingSelect.value);
        }

        // 組み合わせ技能: ドロップダウン選択で即時追加（追加ボタン不要）
        if (context.editable) {
            for (const select of this.element.querySelectorAll("select.skill-ref-select")) {
                select.addEventListener("change", async (ev) => {
                    const itemId = ev.target.value;
                    if (!itemId) return;
                    const usage = this.usage;
                    if (!usage) return;
                    if (usage.skillRefs.some(r => r.itemId === itemId)) return;
                    const skillRefs = [...usage.skillRefs, { itemId }];
                    await this._patchUsage({ skillRefs });
                    this.render({ force: true });
                });
            }

            // エフェクト: ドロップダウン選択で即時追加（D&D の「適用される効果」方式）
            for (const select of this.element.querySelectorAll("select.effect-select")) {
                select.addEventListener("change", async (ev) => {
                    const effectId = ev.target.value;
                    if (!effectId) return;
                    const usage = this.usage;
                    if (!usage) return;
                    if (usage.effects.some(e => e.effectId === effectId)) return;
                    const effects = [...usage.effects, { effectId }];
                    await this._patchUsage({ effects });
                    this.render({ force: true });
                });
            }
        }
    }

    _onTimingValueChange(event) {
        this._syncTimingSubFields(event.target.value);
    }

    _syncTimingSubFields(value) {
        this.element.querySelector(".timing-action-sub")
            ?.classList.toggle("hidden", value !== "action");
        this.element.querySelector(".timing-process-sub")
            ?.classList.toggle("hidden", value !== "process");
        this.element.querySelector(".timing-other-sub")
            ?.classList.toggle("hidden", value !== "other");
    }

    // ─── フォーム送信（auto-submit on change） ─────────────────────────────────

    static async _onSubmit(event, form, formData) {
        const usage = this.usage;
        if (!usage) return;

        const raw = formData.object;
        const update = {
            name:        raw["name"]              ?? usage.name,
            description: raw["description"]       ?? usage.description,
            target:      raw["target"]             ?? usage.target,
            "timing.value":       raw["timing.value"]       ?? usage.timing.value,
            "timing.actionName":  raw["timing.actionName"]  ?? usage.timing.actionName,
            "timing.processName": raw["timing.processName"] ?? usage.timing.processName,
            "timing.timingOther": raw["timing.timingOther"] ?? usage.timing.timingOther,
        };

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
