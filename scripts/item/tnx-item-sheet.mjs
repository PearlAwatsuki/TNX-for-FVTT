import { EffectsSheetMixin } from "../module/effects-sheet-mixin.mjs";
import { TnxUsageSheet, USAGE_TYPES, deriveUsageAutoFill } from "../module/tnx-usage-sheet.mjs";
import { resolveConsumeRowsForActor, promptConsumption, applyConsumptionPlan, resolveBunshinOwner } from "../module/usage-consumption.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { useNpcAcquire } from "../module/npc-acquisition.mjs";
import { useAttack } from "../module/attack-flow.mjs";
import { isAttackUsage } from "../data/item/common/usage.mjs";
import { SKILL_ROLES, getSkillRoles } from "../module/skill-roles.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Tokyo NOVA アイテムシートの基底クラス。
 * 用途(Actions)タブの処理や共通のエフェクト処理を提供する。
 * PARTS は各サブクラスで定義する。
 */
export class TokyoNovaItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

    /** view/edit モード状態。isOwner でない場合は常に false。 */
    _isEditMode = false;

    /** アクティブタブの状態。 */
    tabGroups = { primary: "description" };

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item"],
        position: { width: 600, height: 650 },
        form: { submitOnChange: true },
        actions: {
            ...EffectsSheetMixin.ACTIONS,
            toggleEditMode: TokyoNovaItemSheet._onToggleEditMode,
            incrementField: TokyoNovaItemSheet._onIncrementField,
            decrementField: TokyoNovaItemSheet._onDecrementField,
            toggleSkillRole: TokyoNovaItemSheet._onToggleSkillRole,
        },
    };

    /**
     * 技能の役割(skillRoles)をトグルする(2026-07-09 新設計)。役割チェックの ON/OFF。
     * 表示は実効役割(getSkillRoles=フィールド or 正準名の既定)。初回編集で既定が明示化される。
     */
    static async _onToggleSkillRole(_event, target) {
        const role = target.dataset.role;
        if (!role || !SKILL_ROLES[role]) return;
        const current = getSkillRoles(this.item);
        const next = current.includes(role) ? current.filter(r => r !== role) : [...current, role];
        await this.item.update({ "system.skillRoles": next });
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = foundry.utils.deepClone(this.item.system);

        context.item = this.item;
        context.system = system;
        context.owner = this.document.isOwner;
        // cssClass: edit/view-mode は root 要素で管理するため section には渡さない
        context.cssClass = "";
        context.options = {
            usageTypeLabels: USAGE_TYPES,
        };
        context.isEditMode = this._isEditMode && context.editable;

        context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(system.description, {
            relativeTo: this.item,
            editable: context.editable,
        });

        // 分身の使用回数共有(11-6・Troops.md): 分身直下のアイテムはローカルの使用回数を使わず
        // 本体側カウンターを共有するため、使用回数ブロックを共有表示(入力無効化)にする
        const bunshinOwner = resolveBunshinOwner(this.item.actor);
        context.usesSharedWithOwner = !!bunshinOwner;
        context.usesOwnerName = bunshinOwner?.name ?? "";

        EffectsSheetMixin.prepareEffectsContext(this.item, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive,
        ];

        // 技能の役割(2026-07-09 新設計): 治療/ドッジ/パリー/各リアクション/各攻撃の既定技能を
        // 名前でなく役割で持つ。技能アイテムのみ役割チェックを出す(実効役割=フィールド or 正準名の既定)
        if (this.item.type === "generalSkill" || this.item.type === "styleSkill") {
            const active = getSkillRoles(this.item);
            context.skillRoleOptions = Object.entries(SKILL_ROLES).map(([key, def]) => ({
                key, label: def.label, checked: active.includes(key),
            }));
            // 特性(2026-07-09): 散在していた真偽フラグを1セクションに集約。フラグがオンのとき
            // 各詳細セクションが表示される(wide=ラベルが長く1行占有)。detail は元の位置に残しゲート
            const flags = [
                { name: "system.isAction",   label: "アクション技能",   checked: !!system.isAction },
                { name: "system.usesBounty", label: "報酬点を使用可能", checked: !!system.usesBounty },
            ];
            if (this.item.type === "styleSkill") {
                flags.push({ name: "system.noCombo", label: "組み合わせ不可", checked: !!system.noCombo });
                flags.push({ name: "system.uses.isLimit", label: "使用回数に制限あり", checked: !!system.uses?.isLimit, disabled: !!context.usesSharedWithOwner });
                if (system.styleSkillCategory === "special")
                    flags.push({ name: "system.special.works.value", label: "ワークス技能", checked: !!system.special?.works?.value });
                flags.push({ name: "system.isSubstitute", label: "代用可能", checked: !!system.isSubstitute });
                flags.push({ name: "system.acquiresOutfit", label: "取得と同時にアウトフィットを取得する", checked: !!system.acquiresOutfit, wide: true });
                flags.push({ name: "system.expFree", label: "経験点消費なしで取得可", checked: !!system.expFree, wide: true });
                if (system.styleSkillCategory === "secret" || system.styleSkillCategory === "mystery")
                    flags.push({ name: "system.excludeFromCount", label: `${system.styleSkillCategory === "secret" ? "秘技" : "奥義"}の取得数に含まない`, checked: !!system.excludeFromCount, wide: true });
                flags.push({ name: "system.levelRef.enabled", label: "他スタイル技能のレベルを参照", checked: !!system.levelRef?.enabled, wide: true });
            }
            context.traitFlags = flags;
        }

        return context;
    }

    /** @override */
    _onRender(context, _options) {
        const el = this.element;

        // edit/view モード CSS クラスを同期
        el.classList.toggle("edit-mode", !!context.isEditMode);
        el.classList.toggle("view-mode", !context.isEditMode);

        // V2 はレンダー時に active クラスを DOM に付与しないため、changeTab で補完する。
        // テンプレートは context.tabs を使っていないため毎レンダー後に呼ぶ必要がある。
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* PARTS にそのタブがない場合は無視 */ }
            }
        }

        if (!context.editable) return;

        // 編集モード切替ボタン。window-header は PART 外で永続するが
        // _onRender は毎レンダー呼ばれるので remove → append でリフレッシュする。
        const header = el.querySelector(".window-header");
        if (header) {
            header.querySelector(".edit-mode-toggle")?.remove();
            const btn = document.createElement("a");
            btn.className = "edit-mode-toggle";
            btn.title = "編集モード切替";
            btn.dataset.action = "toggleEditMode";
            btn.innerHTML = '<i class="fa-solid fa-eye tnx-view-icon"></i><i class="fa-solid fa-pen tnx-edit-icon"></i>';
            header.prepend(btn);
        }

        const ProseMirrorEl = customElements.get("prose-mirror");
        if (ProseMirrorEl) {
            for (const contentDiv of el.querySelectorAll(".editor-content[data-edit]")) {
                const editorDiv = contentDiv.closest("div.editor");
                if (!editorDiv) continue;
                const fieldName = contentDiv.dataset.edit;
                const pm = ProseMirrorEl.create({
                    name: fieldName,
                    value: foundry.utils.getProperty(this.document, fieldName) ?? "",
                    enriched: contentDiv.innerHTML,
                    toggled: true,
                });
                pm.dataset.documentUuid = this.document.uuid;
                editorDiv.replaceWith(pm);
                // トグルボタンをヘッダーへ移動する（Foundry デフォルトはhover時のみ表示・エリア右上絶対配置）
                const section = pm.closest(".tnx-editor-section");
                const sectionHeader = section?.querySelector(".tnx-editor-section__header");
                if (sectionHeader) {
                    const moveBtn = () => {
                        const btn = pm.querySelector("button.toggle");
                        if (btn) sectionHeader.appendChild(btn);
                    };
                    requestAnimationFrame(moveBtn);
                    pm.addEventListener("close", () => requestAnimationFrame(moveBtn));
                }
            }
        }

        // usage-list.hbs は data-action ではなく直接リスナーで対応する
        el.querySelector(".action-create")?.addEventListener("click", (ev) => {
            ev.preventDefault();
            TokyoNovaItemSheet._onActionCreate.call(this, ev, ev.currentTarget);
        });
        for (const btn of el.querySelectorAll(".action-use[data-usage-id]")) {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                TokyoNovaItemSheet._onUsageUse.call(this, ev, ev.currentTarget);
            });
        }
        for (const btn of el.querySelectorAll(".action-edit[data-usage-id]")) {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                TokyoNovaItemSheet._onUsageEdit.call(this, ev, ev.currentTarget);
            });
        }
        for (const btn of el.querySelectorAll(".action-delete[data-usage-id]")) {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                TokyoNovaItemSheet._onActionDelete.call(this, ev, ev.currentTarget);
            });
        }
    }

    // ─── アクションハンドラ ────────────────────────────────────────────────────

    static async _onToggleEditMode(_event, _target) {
        this._isEditMode = !this._isEditMode;
        this.render();
    }

    /**
     * number-input-spinner の +ボタン。data-field のパスを 1 増やす。
     */
    static async _onIncrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.item, field) ?? 0;
        await this.item.update({ [field]: current + 1 });
    }

    /**
     * number-input-spinner の -ボタン。data-field のパスを 1 減らす。
     */
    static async _onDecrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.item, field) ?? 0;
        let next = current - 1;
        if (target.dataset.min !== undefined) next = Math.max(next, Number(target.dataset.min));
        await this.item.update({ [field]: next });
    }

    /** 用途追加: 種別選択ダイアログ → エントリ作成 → TnxUsageSheet を開く */
    static async _onActionCreate(_event, _target) {
        // 「判定（固定値）」を作成できるのは**エキストラ直下の一般技能のみ**(2026-07-04 確定)。
        // エキストラの技能は固定値判定しか行えないため選択ダイアログを出さず直接作成する。
        // それ以外のアイテムでは固定値プリセットは提供しない(通常の用途タイプ選択)
        const isFixedCheck = this.item.type === "generalSkill" && this.item.parent?.type === "extra";
        let type = "check";
        if (!isFixedCheck) {
            // 「NPC取得」を作成できるのはトループ取得技能(unique="troopAcquire")と
            // アウトフィット系のみ(11-6・Troops.md「NPC取得」。式神符のような起動取得型を含む)
            const allowNpcAcquire = (this.item.type === "styleSkill" && this.item.system.unique === "troopAcquire")
                || OUTFIT_ITEM_TYPES.has(this.item.type);
            const choices = { ...USAGE_TYPES };
            if (!allowNpcAcquire) delete choices.npcAcquire;
            const choice = await TokyoNovaItemSheet._promptUsageType(choices);
            if (!choice) return;
            type = choice;
        }

        const newId = foundry.utils.randomID();
        const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
        const entry = {
            _id:         newId,
            type,
            name:        isFixedCheck ? "判定（固定値）" : (USAGE_TYPES[type] ?? "新規用途"),
            description: "",
            timing:      { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
            target:      "blank",
            effects:     [],
            skillRefs:   [],
            weaponRef:   { itemId: "" },
            damageType:  "",
            formula:     "",
            damageCategory: "",
            modifiableParams: [],
            // 消費先設定(11-6): check / npcAcquire 用途は「親アイテムの使用回数×1」を既定にする
            // (migrateData の互換既定と同一。親に isLimit が無ければ no-op)。他タイプは空から設定する
            consumeTargets: (type === "check" || type === "npcAcquire")
                ? [{ type: "parent", itemId: "", amount: 1 }] : [],
            // NPC取得の既定モード: トループ取得技能=トループ / アウトフィット(式神符等)=エキストラ
            ...(type === "npcAcquire"
                ? { acquireMode: this.item.type === "styleSkill" ? "troop" : "extra" } : {}),
            ...(isFixedCheck ? { fixedResult: 10 } : {}),
        };

        // 自動入力の作成時一回適用(11-6 追補・2026-07-06 承認): 判定系用途は親技能の固有値から
        // 発動パラメータと消費行を導出して初期値にする(以降の再導出はシートのボタンで明示的に。
        // ライブ追従はしない)。固定値判定は発動項目を持たないため対象外
        if (!isFixedCheck && (type === "check" || type === "npcAcquire")) {
            const patch = deriveUsageAutoFill(this.item, entry);
            foundry.utils.mergeObject(entry, foundry.utils.expandObject(patch));
        }

        actions.push(entry);
        await this.item.update({ "system.actions": actions });

        // 作成直後に編集シートを開く
        const sheet = new TnxUsageSheet(this.item, newId);
        sheet.render({ force: true });
    }

    /** 用途編集: TnxUsageSheet を開く */
    static async _onUsageEdit(_event, target) {
        const usageId = target.dataset.usageId;
        if (!usageId) return;

        // 既に同じ用途のシートが開いていれば前面に出す
        const existing = Object.values(foundry.applications.instances)
            .find(a => a instanceof TnxUsageSheet && a._usageId === usageId);
        if (existing) {
            existing.bringToTop();
            return;
        }

        const sheet = new TnxUsageSheet(this.item, usageId);
        sheet.render({ force: true });
    }

    /**
     * 用途使用（起動）: 用途が参照するアイテム上の ActiveEffect を有効化する（フェーズ9-3）。
     * 効果は削除でなく disabled=false に切り替える（転送効果と違い常駐し、終了は時間管理フェーズ）。
     * 使用回数の消費(11-6): check 以外の用途タイプは「使用」時に消費先設定を適用する
     * (check 用途は判定実行時に消費するためここでは消費しない)。キャンセルで使用ごと中止。
     */
    static async _onUsageUse(_event, target) {
        const usageId = target.dataset.usageId;
        if (!usageId) return;
        const usage = (this.item.system.actions ?? []).find(a => a._id === usageId);
        if (!usage) return;

        // NPC取得(11-6): 専用フローに委譲(消費・対象解決・判定・転記・配置を一貫して扱う。
        // 効果有効化は行わない=取得に特化)。失敗を握りつぶさず通知する(不具合調査のため)
        if (usage.type === "npcAcquire") {
            try {
                await useNpcAcquire(this.item, usage);
            } catch (err) {
                console.error("TNX | NPC取得の実行に失敗しました", err);
                ui.notifications.error(`NPC取得の実行に失敗しました: ${err.message}`);
            }
            return;
        }

        // 攻撃(12-2): 攻撃は判定の一種(damageCategory 付きの check)。専用フローに委譲
        // (武器解決・対象決定・成否保留の攻撃カード・リアクション対決)
        if (isAttackUsage(usage)) {
            try {
                await useAttack(this.item, usage);
            } catch (err) {
                console.error("TNX | 攻撃の実行に失敗しました", err);
                ui.notifications.error(`攻撃の実行に失敗しました: ${err.message}`);
            }
            return;
        }

        const actor = this.item.actor;
        if (usage.type !== "check" && actor) {
            // 分身は本体側カウンターへ差し替えて共有(Troops.md)
            const rows = resolveConsumeRowsForActor(actor, this.item, usage.consumeTargets);
            const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${usage.name || this.item.name}` });
            if (plan === null) return;
            await applyConsumptionPlan(plan);
        }

        const ids = (usage.effects ?? []).map(e => e.effectId).filter(Boolean);
        const updates = [];
        for (const id of ids) {
            if (this.item.effects.has(id)) updates.push({ _id: id, disabled: false });
        }
        if (updates.length) await this.item.updateEmbeddedDocuments("ActiveEffect", updates);
        ui.notifications?.info(`「${usage.name || "用途"}」を使用：${updates.length}件の効果を有効化しました。`);
    }

    static async _onActionDelete(_event, target) {
        const usageId = target.dataset.usageId;
        if (!usageId) return;

        const actions = foundry.utils.deepClone(this.item.system.actions ?? []);
        const idx = actions.findIndex(a => a._id === usageId);
        if (idx >= 0) {
            actions.splice(idx, 1);
            await this.item.update({ "system.actions": actions });
        }
    }

    // ─── 種別選択ダイアログ ────────────────────────────────────────────────────

    /** 用途タイプを選択させる DialogV2。選択されたキーを返す。 */
    static async _promptUsageType(choices = USAGE_TYPES) {
        const options = Object.entries(choices)
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join("");

        const content = `
            <div class="usage-type-select-dialog">
                <div class="form-group">
                    <label>用途の種別</label>
                    <select name="usageType">${options}</select>
                </div>
            </div>`;

        return foundry.applications.api.DialogV2.wait({
            window:   { title: "用途の種別を選択" },
            classes:  ["tokyo-nova", "tnx-dialog"],
            position: { width: 340 },
            content,
            buttons: [
                {
                    action: "ok", icon: "fas fa-check", label: "作成", default: true,
                    callback: (_event, _button, dialog) =>
                        dialog.element.querySelector("select[name='usageType']")?.value ?? null,
                },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });
    }
}
