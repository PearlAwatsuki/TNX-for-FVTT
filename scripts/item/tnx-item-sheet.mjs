import { EffectsSheetMixin } from "../ui/effects-sheet-mixin.mjs";
import { TnxUsageSheet, USAGE_TYPES, deriveUsageAutoFill, updateUsageActions } from "../app/tnx-usage-sheet.mjs";
import { usageTypeLabelsFor, defaultUsageTypeFor } from "../rules/usage-types.mjs";
import { defaultConfrontationForType, executionFormOf, usageDisplayName, usesVehicle } from "../rules/usage-types.mjs";
import { resolveBunshinOwner } from "../flow/usage-consumption.mjs";
import { attachEditorSectionToggles } from "../ui/editor-sections.mjs";
import { activateItemCheck } from "../flow/item-activation.mjs";

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
            // 用途一覧(usage-list.hbs)はコア標準の data-action ディスパッチで配線する(2026-07-17 是正)。
            // コアはフレームを作るたびにディスパッチャを配線するため、開き直し・再レンダーで死なない
            // (自前リスナーの寿命管理=毎レンダー個別バインド/委譲一回バインドはどちらも死に方があり全廃)
            usageCreate: TokyoNovaItemSheet._onActionCreate,
            usageUse:    TokyoNovaItemSheet._onUsageUse,
            usageEdit:   TokyoNovaItemSheet._onUsageEdit,
            usageDelete: TokyoNovaItemSheet._onActionDelete,
        },
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = foundry.utils.deepClone(this.item.system);

        context.item = this.item;
        context.system = system;
        // 名前入力欄は素値(_source.name)を編集する(フェーズ12): 名前装飾 AE は item.name を
        // in-memory で書き換えるため、表示に item.name を使うと装飾後の名前を素値として保存してしまう。
        // 一覧・チャット等の表示は装飾後(item.name)を使い、編集欄だけ素値を読む。
        context.sourceName = this.item._source.name;
        context.owner = this.document.isOwner;
        // cssClass: edit/view-mode は root 要素で管理するため section には渡さない
        context.cssClass = "";
        context.options = {
            usageTypeLabels: USAGE_TYPES,
        };
        // 用途一覧の表示行: 表示名は usageDisplayName の一箇所で決める(placeholder・タイトル・
        // 戦闘タブ・カードと同一形式)。テンプレート側での表示名の再実装は表示ずれの温床のため禁止
        context.usageList = (this.item.system.actions ?? []).map((a) => ({
            id: a._id,
            // 用途名の技能名部分は〈〉で囲わない(2026-07-18 ユーザー確定): 親アイテム名は素の名前
            displayName: usageDisplayName(a, this.item.name),
        }));
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

        // 技能の役割(skillRoles)は廃止(2026-07-17 再編): 資格・候補の判定は用途タイプの所持のみ
        // (ドッジ=ドッジ用途を持つ技能 等)。役割チェック UI は撤去した
        if (this.item.type === "generalSkill" || this.item.type === "styleSkill") {
            // 特性(2026-07-09): 散在していた真偽フラグを1セクションに集約。フラグがオンのとき
            // 各詳細セクションが表示される(wide=ラベルが長く1行占有)。detail は元の位置に残しゲート
            const flags = [
                { name: "system.isAction",   label: "アクション技能",   checked: !!system.isAction },
                { name: "system.usesBounty", label: "報酬点を使用可能", checked: !!system.usesBounty },
            ];
            if (this.item.type === "generalSkill") {
                // アクト限定(14-7): アクトコネクション等の印。アクト終了時に自動削除される
                flags.push({ name: "system.isActLimited", label: "アクト限定", checked: !!system.isActLimited });
            }
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

        // @UUID コンテンツリンクのカード・ツールチップ(16-x): 解説内の辞典リンクに適用
        import("../chat/item-card-tooltips.mjs").then(m => m.applyContentLinkCardTooltips(el));

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

        // エディタ差し替えは失敗しても他のリスナー・表示処理を巻き添えにしない(2026-07-17 隔離)
        try {
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
                }
                // トグルボタンのヘッダー移設(共有配線・editor-sections.mjs)
                attachEditorSectionToggles(el);
            }
        } catch (err) {
            console.error("TNX | 説明エディタの差し替えに失敗しました", err);
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
        if (!this.document.isOwner) return;
        // 「判定（固定値）」を作成できるのは**エキストラ直下の一般技能のみ**(2026-07-04 確定)。
        // エキストラの技能は固定値判定しか行えないため選択ダイアログを出さず直接作成する。
        // それ以外のアイテムでは固定値プリセットは提供しない(通常の用途タイプ選択)
        const isFixedCheck = this.item.type === "generalSkill" && this.item.parent?.type === "extra";
        // 独自効果型の神業書き換え技能の用途は、技能自身の使い方ではなく**書き換えた神業の効果**に
        // なるため、神業と同じ器(神業専用の5種)で作る
        const miracleOwnEffect = this.item.type === "styleSkill" && this.item.system?.miracleRewrite?.effect === "own";
        let type = defaultUsageTypeFor(this.item.type, { miracleOwnEffect });
        if (!isFixedCheck) {
            // 選択肢は親の型で決まる(17-2): 神業なら神業専用の5種(宣言/即死/防御/社会戦/破壊)だけ、
            // それ以外は神業専用を除いた行動種別タイプ。NPC取得は用途の設定(効果タブ)へ移管済み
            const choice = await TokyoNovaItemSheet._promptUsageType(usageTypeLabelsFor(this.item.type, { miracleOwnEffect }));
            if (!choice) return;
            type = choice;
        }

        const newId = foundry.utils.randomID();
        const entry = {
            _id:         newId,
            type,
            // 用途名の既定は空(2026-07-17 ユーザー確定): 空のときの実効名=「タイプ名（親アイテム名）」
            name:        "",
            description: "",
            timing:      { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
            target:      "blank",
            effects:     [],
            skillRefs:   [],
            weaponRefs:  [],
            damageType:  "",
            checkBonuses: [],
            damageBonuses: [],
            // 対決欄の系統既定(2026-07-17): 攻撃=物理はドッジ+パリー等・移動/離脱は各妨害リアクション行
            confrontation: defaultConfrontationForType(type),
            // ヴィークル準備時(2026-07-18 一般化): 移動/リアクション（移動妨害）は既定オン
            requiresVehicle: usesVehicle(type),
            // 消費先設定: 既定は空(2026-07-17 ユーザー指示=無条件の「親×1」既定行は全廃。
            // 使用回数制限つきの参加技能の行は自動入力 deriveConsumeTargets が敷く)
            consumeTargets: [],
            ...(isFixedCheck ? { fixedResult: 10 } : {}),
        };

        // 自動入力の作成時一回適用(11-6 追補・2026-07-06 承認): 判定系用途は親技能の固有値から
        // 発動パラメータと消費行を導出して初期値にする(以降の再導出はシートのボタンで明示的に。
        // ライブ追従はしない)。固定値判定は発動項目を持たないため対象外
        if (!isFixedCheck && executionFormOf(entry) === "check") {
            const patch = await deriveUsageAutoFill(this.item, entry);
            foundry.utils.mergeObject(entry, foundry.utils.expandObject(patch));
        }

        // 直列キュー経由(2026-07-17): 開いている用途シートの submit/enforcement と競合しても
        // 最新の actions に対して追記する(stale 全配列上書きの最後勝ちで消えない)
        try {
            await updateUsageActions(this.item, (actions) => {
                actions.push(entry);
                return actions;
            });
        } catch (err) {
            console.error("TNX | 用途の追加に失敗しました", err);
            ui.notifications.error("用途の追加に失敗しました。コンソールを確認してください。");
            return;
        }

        // 作成直後に編集シートを開く
        const sheet = new TnxUsageSheet(this.item, newId);
        sheet.render({ force: true });
    }

    /** 用途編集: TnxUsageSheet を開く */
    static async _onUsageEdit(_event, target) {
        if (!this.document.isOwner) return;
        const usageId = target.dataset.usageId;
        if (!usageId) return;

        // 既に同じ用途のシートが開いていれば前面に出す(instances は Map・Object.values では列挙されない)
        const existing = [...foundry.applications.instances.values()]
            .find(a => a instanceof TnxUsageSheet && a._usageId === usageId);
        if (existing) {
            existing.bringToTop();
            return;
        }

        const sheet = new TnxUsageSheet(this.item, usageId);
        sheet.render({ force: true });
    }

    /**
     * 用途使用（起動）: 唯一の起動関数 `activateItemCheck` へ用途 ID を直接指定して委譲する
     * (2026-07-16 統合。従来ここに在ったNPC取得/クリック待ち/回復/攻撃/宣言使用の分岐は、
     * アクターシートの技能クリックと同じディスパッチャの複製であり、後から足した分岐=カバー・
     * 固定値がこちらに反映されないドリフトが起きていた)。入口は薄く=actor/item を解決して呼ぶだけ。
     */
    static async _onUsageUse(_event, target) {
        if (!this.document.isOwner) return;
        const usageId = target.dataset.usageId;
        if (!usageId) return;
        const usage = (this.item.system.actions ?? []).find(a => a._id === usageId);
        if (!usage) return;
        const actor = this.item.actor;
        if (!actor) {
            // スタンドアロン(未所持)アイテム: 判定・消費・付与はアクター前提のため実行できない
            ui.notifications.warn("アクターが所持しているアイテムから使用してください。");
            return;
        }
        await activateItemCheck(actor, this.item, { usageId });
    }

    static async _onActionDelete(_event, target) {
        if (!this.document.isOwner) return;
        const usageId = target.dataset.usageId;
        if (!usageId) return;

        // 開いている用途シートは先に閉じる(2026-07-17): 消えた用途を指したままのシートが
        // 以後の更新のたびに空描画で残らないように(テンプレート側の usage ガードと二重の防御)。
        // instances は Map のため values() で列挙する(Object.values は常に空)
        for (const app of foundry.applications.instances.values()) {
            if (app instanceof TnxUsageSheet && app._usageId === usageId) app.close();
        }

        // 直列キュー経由(2026-07-17): 用途シートの submit/enforcement の in-flight 書き込みと
        // 競合しても、削除は必ず最新の actions へ適用される(復活レースの根絶)
        try {
            await updateUsageActions(this.item, (actions) => {
                const idx = actions.findIndex(a => a._id === usageId);
                if (idx === -1) return null;
                actions.splice(idx, 1);
                return actions;
            });
        } catch (err) {
            console.error("TNX | 用途の削除に失敗しました", err);
            ui.notifications.error("用途の削除に失敗しました。コンソールを確認してください。");
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
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
            ],
            close: () => null,
        });
    }
}
