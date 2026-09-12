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

import { resolveUsageSkills, comboLockAnalysis, isComboRequired } from "../rules/skill-chain-resolution.mjs";
import { ALL_CATEGORIES_KEY } from "../data/item/outfit-categories.mjs";
import { captureScrollTop, restoreScrollTop } from "../ui/scroll-preserve.mjs";
import { applyTriggerDisable } from "../ui/ui-trigger-disable.mjs";
import { USAGE_TYPE_LABELS, executionFormOf, usageDisplayName, effectiveBaseSkillId } from "../rules/usage-types.mjs";
import {
    CHAIN_SKILL_TYPES,
    updateUsageActions,
    normalizeSkillItemDoc,
    deriveUsageAutoFill,
    deriveWeaponRangeLive,
} from "../core/usage-derivation.mjs";

import { prepareUsageContext, ACQUIRE_MODES } from "./usage-sheet-context.mjs";

import { submitUsageForm } from "./usage-sheet-submit.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// 用途タイプ=行動種別(2026-07-17 ユーザー確定)。正本は usage-types.mjs の USAGE_TYPE_DEFS。
// 旧 check/declaration 一本化(2026-07-13)からの移行は usage.mjs の migrateData。
export const USAGE_TYPES = USAGE_TYPE_LABELS;

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
            confrontRowAdd:        TnxUsageSheet._onConfrontRowAdd,
            confrontRowDelete:     TnxUsageSheet._onConfrontRowDelete,
            recoveryRowAdd:        TnxUsageSheet._onRecoveryRowAdd,
            recoveryRowDelete:     TnxUsageSheet._onRecoveryRowDelete,
            recoveryExcludeDelete: TnxUsageSheet._onRecoveryExcludeDelete,
            repairCategoryDelete:  TnxUsageSheet._onRepairCategoryDelete,
            destroyCategoryDelete: TnxUsageSheet._onDestroyCategoryDelete,
            negateMiracleDelete: TnxUsageSheet._onNegateMiracleDelete,
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

    static async _onNegateMiracleDelete(_event, target) {
        if (!this.usage) return;
        await this._patchUsage({ negateMiracle: (this.usage.negateMiracle ?? []).filter(uuid => uuid !== target.dataset.uuid) });
        this.render({ force: true });
    }

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs" },
    };

    tabGroups = { primary: "identity" };

    // ─── ゲッター ──────────────────────────────────────────────────────────────

    get usage() {
        return this._item.system.actions?.find(a => a._id === this._usageId) ?? null;
    }

    get title() {
        // 名前が空のときの実効名=「タイプ名（親アイテム名）」(2026-07-17 ユーザー確定)。
        // 用途名の技能名部分は〈〉で囲わない(2026-07-18)=親アイテム名は素の名前
        const name = usageDisplayName(this.usage, this._item?.name);
        return name ? `用途: ${name}` : "用途";
    }

    /** 用途の参加技能（親＋ベース＋コンボ）を Item 配列で返す（check / attack 用） */
    _gatherParticipatingSkills(usage) {
        const actor = this._item.actor;
        const baseId = effectiveBaseSkillId(usage, this._item);
        const ids = new Set([this._item.id, baseId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));
        return [...ids]
            .map(id => (id === this._item.id ? this._item : actor?.items.get(id)))
            .filter(Boolean);
    }

    // ─── コンテキスト準備 ───────────────────────────────────────────────────────

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

        // 破壊できる分類は空欄を許容しない(2026-09-06): 残り1つになったら削除トリガーを無効化する
        if ((this.usage?.destroyableCategories ?? []).length <= 1) {
            applyTriggerDisable(this.element, '[data-action="destroyCategoryDelete"]',
                () => ({ reason: "1つ以上必要" }));
        }

        if (context.editable) {
            this.element.querySelector("select.negate-miracle-select")?.addEventListener("change", async (ev) => {
                ev.stopPropagation();
                const uuid = ev.target.value;
                if (!uuid || !this.usage) return;
                const current = this.usage.negateMiracle ?? [];
                await this._patchUsage({ negateMiracle: uuid === "all" ? [] : [...new Set([...current, uuid])] });
                this.render({ force: true });
            });

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

            // 修理できる分類(小分類キー): ドロップダウン選択で即時追加(2026-07-18)
            for (const select of this.element.querySelectorAll("select.repair-category-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation();
                    const key = ev.target.value;
                    if (!key) return;
                    const usage = this.usage;
                    if (!usage || (usage.repairableCategories ?? []).includes(key)) { ev.target.value = ""; return; }
                    await this._patchUsage({ repairableCategories: [...(usage.repairableCategories ?? []), key] });
                    this.render({ force: true });
                });
            }

            // 破壊できる分類(17-3・2026-09-06): ドロップダウン選択で即時追加
            for (const select of this.element.querySelectorAll("select.destroy-category-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation();
                    const key = ev.target.value;
                    if (!key) return;
                    const usage = this.usage;
                    const current = usage?.destroyableCategories ?? [];
                    if (!usage || current.includes(key)) { ev.target.value = ""; return; }
                    // 「全て」と個別の分類は排他: 「全て」を選べばそれだけになり、
                    // 「全て」の状態で分類を選べばその分類だけに絞られる
                    const next = key === ALL_CATEGORIES_KEY
                        ? [ALL_CATEGORIES_KEY]
                        : [...current.filter(k => k !== ALL_CATEGORIES_KEY), key];
                    await this._patchUsage({ destroyableCategories: next });
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

            // エフェクト: ドロップダウン選択で即時追加。選択値=`itemId|effectId`(親は itemId 空)。
            // 追加先リストは data-effect-list で決まる(既定=effects・攻撃のダメージ時=damageEffects)
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
                    const listKey = ev.target.dataset.effectList === "damageEffects" ? "damageEffects" : "effects";
                    const list = usage?.[listKey] ?? [];
                    if (!usage || list.some(e => (e.itemId || "") === itemId && e.effectId === effectId)) { ev.target.value = ""; return; }
                    await this._patchUsage({ [listKey]: [...list, { itemId, effectId }] });
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

        // 再描画後にスクロール位置を復元する(行の追加/削除等の操作でリセットされるのを防ぐ)
        restoreScrollTop(this.element, ".usage-sheet-body", this._usageScrollTop);
    }

    /** @override — 再描画前にスクロール位置を保存する(操作でスクロールが飛ぶのを防ぐ) */
    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this._usageScrollTop = captureScrollTop(this.element, ".usage-sheet-body");
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

    // ─── 自動入力（参加技能の固有値を優先度で合成） ─────────────────────────────

    static async _onAutoFill(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        const patch = await deriveUsageAutoFill(this._item, usage);
        await this._patchUsage(patch);
        this.render({ force: true });
        ui.notifications.info("発動パラメータ・対決・使用回数の消費を自動入力しました。手編集で上書きできます。");
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
        // 既定行=「このアイテム自身」の使用回数×1(2026-07-18 再編)
        await this._patchUsage({ consumeTargets: [...(usage.consumeTargets ?? []), { type: "item", itemId: "", resource: "uses", amount: 1 }] });
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
        // 消費数はロックしない(2026-07-18 ユーザー確定): 0/負値(=回復)も許容(クランプ・0スキップなし)
        rows[idx].amount = (Number(rows[idx].amount) || 0) + delta;
        await this._patchUsage({ consumeTargets: rows });
        this.render({ force: true });
    }

    // ─── 対決欄の行(2026-07-17) ─────────────────────────────────────────────────

    static async _onConfrontRowAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ confrontation: [
            ...(usage.confrontation ?? []),
            { value: "blank", name: "", skillDict: "", skillGroup: "", skillSub: "" },
        ] });
        this.render({ force: true });
    }

    static async _onConfrontRowDelete(_event, target) {
        const usage = this.usage;
        const idx = Number(target.dataset.rowIndex);
        if (!usage || !Number.isFinite(idx)) return;
        await this._patchUsage({ confrontation: (usage.confrontation ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    // ─── 判定ボーナス/ダメージ修正の行(式＋供給元・2026-07-10) ─────────────────────

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

    static async _onRepairCategoryDelete(_event, target) {
        const key = target.dataset.key;
        const usage = this.usage;
        if (!usage || !key) return;
        await this._patchUsage({ repairableCategories: (usage.repairableCategories ?? []).filter(k => k !== key) });
        this.render({ force: true });
    }

    /**
     * 破壊できる分類の削除(17-3・2026-09-06)。**最後の1つは削除しない**(空欄を許容しない)。
     * 行が1つのときは _onRender でトリガー自体を無効化しているが、DOM 経由の発火に備えて弾く。
     */
    static async _onDestroyCategoryDelete(_event, target) {
        const key = target.dataset.key;
        const usage = this.usage;
        if (!usage || !key) return;
        const rest = (usage.destroyableCategories ?? []).filter(k => k !== key);
        if (!rest.length) return;
        await this._patchUsage({ destroyableCategories: rest });
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
        const baseId = this.usage.baseSkillRef?.itemId;
        const seedIds = [
            ...(baseId && baseId !== this._item.id ? [baseId] : []),
            ...this.usage.skillRefs.map(r => r.itemId),
        ].filter(Boolean);
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

        // itemId＋effectId で1件だけ外す(供給元アイテムが異なる同名/同IDの取り違えを避ける)。
        // 対象リストは data-effect-list で決まる(既定=effects・攻撃のダメージ時=damageEffects)
        const listKey = target.dataset.effectList === "damageEffects" ? "damageEffects" : "effects";
        const list = (usage[listKey] ?? []).filter(e => !((e.itemId || "") === itemId && e.effectId === effectId));
        await this._patchUsage({ [listKey]: list });
        this.render({ force: true });
    }

    // ─── 内部ユーティリティ ────────────────────────────────────────────────────

    /**
     * usage エントリの一部フィールドをパッチ更新する。
     * @param {object} patch  ドット記法キーを含むパッチオブジェクト
     */
    async _patchUsage(patch) {
        // 直列キュー経由(2026-07-17): 常に最新の actions に対して自分の用途だけを書き換える
        // (削除済みなら何もしない=stale 上書きで消えた用途を復活させない)
        await updateUsageActions(this._item, (actions) => {
            const idx = actions.findIndex(a => a._id === this._usageId);
            if (idx === -1) return null;
            for (const [key, value] of Object.entries(patch)) {
                foundry.utils.setProperty(actions[idx], key, value);
            }
            return actions;
        });
    }

    // ─── 技能チェーン解決・必須コンボの enforcement ──────────────────────────────

    /** actor 技能アイテムを解決用に正規化する(モジュール共通関数へ委譲)。 */
    _normalizeSkillItem(it) {
        return normalizeSkillItemDoc(it);
    }

    /**
     * 同輩の技能アイテム(判定を行う用途=攻撃・リアクション等を含む・連鎖対象)を正規化して返す。対象外は null。
     * アクター所持はアクターの技能・辞典/ワールド直下は直近レンダーの同輩キャッシュ
     * (resolveUsageSiblingSkills・2026-07-18 是正=アクター外でもベース技能・連鎖を解決する)
     */
    _actorSkillItems() {
        const usage = this.usage;
        if (!usage || executionFormOf(usage) !== "check") return null;
        // 親が技能でなくても(アウトフィット等)、ベース技能が設定されていればその連鎖を解決する
        // (2026-07-18 ユーザー確定: 「ベース技能として設定された技能のベース技能」も自動解決)
        if (!CHAIN_SKILL_TYPES.includes(this._item.type) && !usage.baseSkillRef?.itemId) return null;
        const actor = this._item.actor;
        const skills = actor
            ? actor.items.filter(i => CHAIN_SKILL_TYPES.includes(i.type))
            : this._siblingSkills;
        if (!skills) return null;
        return skills.map(i => this._normalizeSkillItem(i));
    }

    /**
     * 用途の「技能」欄チェーンを actor アイテムに解決する(現コンボ＋ベース技能を seed に含めて推移的に)。
     * ベース技能を seed に含めるのは 2026-07-18 ユーザー確定: **ベース技能自身に「技能」連鎖がある場合、
     * その必須参加技能を組み合わせへ自動解決する**(ベース技能をそのシートで直接編集したときと同じ)。
     * seed の連鎖は resolveUsageSkills が推移的に必須クロージャへ畳み込む。
     */
    _resolveComboChain() {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return null;
        const baseId = this.usage.baseSkillRef?.itemId;
        const seedComboIds = [
            ...(baseId && baseId !== this._item.id ? [baseId] : []),
            ...this.usage.skillRefs.map(r => r.itemId),
        ].filter(Boolean);
        return resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seedComboIds,
            this._ignoreComboKeys());
    }

    /** 用途の「無視する指定技能」(識別キー配列・空要素除去)。 */
    _ignoreComboKeys() {
        return (this.usage?.ignoreComboSkills ?? []).filter(Boolean);
    }

    /** 現在の実効ベース技能 id(共通リゾルバ effectiveBaseSkillId に集約・2026-07-18)。 */
    _effectiveBaseId() {
        return effectiveBaseSkillId(this.usage, this._item);
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
        const baseId = this.usage.baseSkillRef?.itemId;
        // 用途の「無視する指定技能」を反映して判定する(該当技能は指定技能を引き込まず単体参加
        // ＝指定技能がアクションでもここで弾かれない)。ベース技能も seed=その連鎖の必須も見込む
        const seeds = [
            ...(baseId && baseId !== parentItemId ? [baseId] : []),
            ...currentRefIds, itemId,
        ].filter(Boolean);
        const res = resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seeds, this._ignoreComboKeys());

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
        const parentIsChainSkill = CHAIN_SKILL_TYPES.includes(this._item.type);
        // アクション技能がチェーンにあると、ベースは「指定技能＋その代用」に限定する(他はベースになれない)
        const baseCandidates = parentIsAction ? [parentItemId]
            : (res.baseLocked ? (res.baseCandidateItemIds ?? []) : null);
        const curBase = usage.baseSkillRef?.itemId ?? "";

        // 実効ベースを決めて**常に永続化**する(2026-07-18 統一・アクション/非アクション共通)。
        // 空フォールバック依存を廃し baseSkillRef を単一の真実にする。
        // - アクション → 親自身
        // - ロック(チェーンにアクション) → 現ベースが候補内ならユーザー選択尊重・候補外/未設定は既定へ
        // - & グループ(全員非アクション)=ベース曖昧(manual) → 自動設定しない(ユーザーが選ぶ)
        // - 非ロック → ユーザー設定尊重・未設定は連鎖の解決ベース(指定技能があれば末端・無ければ親自身)
        let baseId;
        if (parentIsAction) baseId = parentItemId;
        else if (baseCandidates) baseId = baseCandidates.includes(curBase) ? curBase : (res.baseItemId || baseCandidates[0] || "");
        else if (res.manual) baseId = curBase;
        else if (parentIsChainSkill) baseId = curBase || res.baseItemId || parentItemId;
        else baseId = curBase; // アウトフィット親等: ユーザーが設定したベースのみ

        const patch = {};
        if (baseId && baseId !== curBase) patch["baseSkillRef.itemId"] = baseId;

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
    /** @override 組み立ての実体は usage-sheet-context.mjs(super はここでしか呼べない)。 */
    async _prepareContext(options) {
        return prepareUsageContext(this, await super._prepareContext(options));
    }

    /** @override 実体は usage-sheet-submit.mjs。 */
    static async _onSubmit(event, form, formData) {
        return submitUsageForm(this, event, form, formData);
    }

}
