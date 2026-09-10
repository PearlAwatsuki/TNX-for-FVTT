/**
 * @fileoverview TnxCharacterSheetBase - アクターシート共通基底(フェーズ11-2 共通部品化)
 *
 * 旧 TokyoNovaCastSheet の共通機能(コンテキスト準備・技能/アウトフィット/戦闘/部位・判定起動・
 * ドラッグ&ドロップ・コンテキストメニュー・編集モード・スピナー・CS/AR・神業表示)を基底化したもの。
 * cast 固有(EXP 系・セッション履歴)は tnx-cast-sheet.mjs に残る。
 * PARTS は各シート(派生クラス)が定義する。テンプレートの差異は SHEET_FEATURES → features で
 * ゲートする(templates/actor/parts/ の partial 群を共有)。
 */

import { editTokenImage } from "./sheet-images.mjs";
import { SYSTEM_ID } from "../constants.mjs";
import { TnxSkillUtils } from '../core/tnx-skill-utils.mjs';
import { EffectsSheetMixin } from "../ui/effects-sheet-mixin.mjs";
import { OUTFIT_CATEGORIES, getMinorCategoryLabel } from '../data/item/outfit-categories.mjs';
import { getPartSlotPreset, PartSlotPresetApp } from '../app/part-slot-preset-app.mjs';
import { findDepartmentSkillName } from '../data/helpers.mjs';
import { applyOutfitFlagToggle } from '../core/outfit-flags.mjs';
import { TnxCheckFlow } from '../flow/tnx-check-flow.mjs';
import { ALL_SUITS } from '../rules/tnx-check-engine.mjs';
import { loadSkillChoices, SKILL_PACKS } from '../dictionary/skill-dictionary.mjs';
import { groupStyleSkillsByStyle } from '../core/style-skill-acquisition.mjs';
import { CONDITION_KINDS, readConditions, getConditionKinds, getEffectiveConditions, getCheckBlock, gatherSkillUseWarnings, woundChartValue } from '../rules/conditions.mjs';
import { planActionRecoveryRows, PAYMENT_LABELS, MAJOR_PAYMENTS } from '../rules/time-boundary.mjs';
import { applyTriggerDisable } from '../ui/ui-trigger-disable.mjs';
import { applyItemCardTooltips, applyContentLinkCardTooltips } from '../chat/item-card-tooltips.mjs';
import { calcSkillInsertSort } from '../core/identification.mjs';
import { resolveHousingAreaMods } from '../core/residence-area.mjs';
import { asOtherCopyUpdate } from "../flow/miracle-flow.mjs";
import { TargetSelectionDialog } from "../ui/tnx-dialog.mjs";
import { buildCombatSpeedInit } from "../rules/session.mjs";
// 用途の起動は唯一の起動関数(flow/item-activation.mjs)。シートは入口を提供するだけ
import { activateItemCheck } from "../flow/item-activation.mjs";
import { prepareOutfitGroups, preparePartOccupancy } from "./outfit-tab.mjs";
import { onDropItem, onSortItem, DROP_FALLBACK } from "./sheet-drop.mjs";
import { activateContextMenus } from "./sheet-context-menus.mjs";
import { prepareCombatData, prepareMiraclesForDisplay } from "./combat-tab.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class TnxCharacterSheetBase extends HandlebarsApplicationMixin(ActorSheetV2) {

    _isEditMode = false;
    _showTokenImage = false;
    tabGroups = { primary: "abilities" };
    _scrollPositions = {};
    /** 部位占有パネルの展開状態(既定は縮小)。再描画をまたいで保持する。 */
    _partOccExpanded = false;

    /** ラベル縮小(squeeze-text)の再計測用 ResizeObserver。_onRender で observe・close で解除。 */
    _squeezeResizeObserver = null;

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor"],
        position: { width: 920, height: 1000 },
        window: {
            resizable: true,
            controls: [
                {
                    action: "copyUuid",
                    icon: "fas fa-passport",
                    label: "UUIDをコピー",
                    ownership: "OBSERVER",
                }
            ]
        },
        form: { submitOnChange: true },
        actions: {
            clearHostRef: TnxCharacterSheetBase._onClearHostRef,
            ...EffectsSheetMixin.ACTIONS,
            copyUuid:             TnxCharacterSheetBase._onCopyUuid,
            toggleEditMode:       TnxCharacterSheetBase._onToggleEditMode,
            editTokenImage,
            toggleActorImage:     TnxCharacterSheetBase._onToggleActorImage,
            toggleStyleRole:      TnxCharacterSheetBase._onToggleStyleRole,
            rollStyleDescription: TnxCharacterSheetBase._onRollStyleDescription,
            openItemSheet:        TnxCharacterSheetBase._onOpenItemSheet,
            openLifepathItem:     TnxCharacterSheetBase._onOpenLifepathItem,
            removeLifepath:       TnxCharacterSheetBase._onRemoveLifepath,
            itemCreate:           TnxCharacterSheetBase._onItemCreate,
            itemDelete:           TnxCharacterSheetBase._onItemDelete,
            removeBadStatus:      TnxCharacterSheetBase._onRemoveBadStatus,
            toggleAbilityDetails: TnxCharacterSheetBase._onToggleAbilityDetails,
            toggleSkillDesc:      TnxCharacterSheetBase._onToggleSkillDesc,
            openOutfitSheet:      TnxCharacterSheetBase._onOpenOutfitSheet,
            addOutfit:            TnxCharacterSheetBase._onAddOutfit,
            loadPartPreset:       TnxCharacterSheetBase._onLoadPartPreset,
            togglePartOccupancy:  TnxCharacterSheetBase._onTogglePartOccupancy,
            editPartSlots:        TnxCharacterSheetBase._onEditPartSlots,
            toggleOutfitFlag:     TnxCharacterSheetBase._onToggleOutfitFlag,
            toggleOutfitDesc:     TnxCharacterSheetBase._onToggleOutfitDesc,
            recalculateBounty:    TnxCharacterSheetBase._onRecalculateBounty,
            startSkillCheck:      TnxCharacterSheetBase._onStartSkillCheck,
            startAbilityCheck:    TnxCharacterSheetBase._onStartAbilityCheck,
            startControlCheck:    TnxCharacterSheetBase._onStartControlCheck,
            startUsageUse:        TnxCharacterSheetBase._onStartUsageUse,
            incrementField:       TnxCharacterSheetBase._onIncrementField,
            decrementField:       TnxCharacterSheetBase._onDecrementField,
            initCombatSpeed:      TnxCharacterSheetBase._onInitCombatSpeed,
            recoverByAction:      TnxCharacterSheetBase._onRecoverByAction,
        },
        dragDrop: [{ dragSelector: ".item-list .item, .style-skills-list .item, .skills-list-view .item, .outfit-groups-container .outfit-row:not(.outfit-row--option):not(.outfit-row--header)", dropSelector: null }],
    };

    /**
     * シートごとの機能差(テンプレート partial の features ゲート)。派生クラスが上書きする。
     * exp/history=セッション履歴系(cast のみ)、lifePath=ライフパス(cast のみ)、
     * parts=部位管理、miracles=神業(トループ級は使用不可＝Troops.md)、
     * bounty=報酬点、heads=人数/エニグマポイント(troop のみ)、
     * growth=能力値の成長欄(トループは成長しない)、personalData=パーソナルデータ、
     * citizenRank=市民ランク、handle=ハンドル(いずれも個人識別キャラでないトループは持たない)、
     * troopLevel=トループレベル(troop のみ・能力値の決定項)、
     * abilities=能力値(attributes 非保持の extra は false・通常判定も不可)、combat=戦闘タブ。
     */
    static SHEET_FEATURES = {
        exp: false, history: false, lifePath: false,
        parts: true, miracles: true, bounty: true, heads: false,
        growth: true, personalData: true, citizenRank: true, handle: true,
        troopLevel: false, abilities: true, combat: true,
    };

    /** 基底の既定とマージした実効 features(派生クラスの宣言漏れで既定が欠けるのを防ぐ)。 */
    get sheetFeatures() {
        return { ...TnxCharacterSheetBase.SHEET_FEATURES, ...this.constructor.SHEET_FEATURES };
    }

    // ─── コンテキスト準備 ──────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actor = this.actor;
        context.system = this.actor.system;
        context.owner = this.actor.isOwner;
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;
        // 立ち絵は actor.img、コマ画像はコアの Token 画像フィールドを使い、別々に管理する。
        const imageToken = this.actor.isToken ? this.actor.token : this.actor.prototypeToken;
        context.tokenImage = imageToken?.randomImg ? CONST.DEFAULT_TOKEN
            : (imageToken?.texture?.src || CONST.DEFAULT_TOKEN);
        context.showTokenImage = this._showTokenImage;
        context.cssClass = "";
        context.features = this.sheetFeatures;
        // 名前固定(トループ/分身=導出名・編集不可。troop シートが上書きする)
        context.nameLocked = false;
        // 所属(ワークス)ブロックの表示。トループは「ワークスを設定」ON のときだけ(troop シートが上書き)
        context.showAffiliation = true;
        // スタイルの役割(ペルソナ/キー/シャドウ)表示。トループ/エニグマは持たない(troop シートが上書き)
        context.showStyleRoles = true;
        // 宿主(17-6): カゲムシャのスタイル(識別キー kagemusha)を持つキャラクターにだけ出す。RL がアクトごとに
        // 設定(ドロップ)。名前はライブ解決(削除済みは name フォールバック=ライブ解決原則)
        context.showHost = this.actor.items.some(i => i.type === "style" && i.system?.identificationKey === "kagemusha");
        context.canEditHost = game.user.isGM;
        const hostRef = this.actor.system.host ?? {};
        let hostName = "";
        if (hostRef.uuid) {
            let hostDoc = null;
            try { hostDoc = fromUuidSync(hostRef.uuid); } catch { hostDoc = null; }
            hostName = (hostDoc?.actor ?? hostDoc)?.name ?? (hostRef.name ? `${hostRef.name}（削除済み）` : "");
        }
        context.hostActorName = hostName;
        // 閲覧モードのスタイル概要行。トループ種別では名前にスタイルが含まれるため出さない(troop シートが上書き)
        context.showStyleSummary = true;

        context.enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            this.actor.system.description, {
                relativeTo: this.actor,
                editable: context.editable,
            }
        );

        // ライフパスは cast 固有(features.lifePath。guest は持たない＝2026-07-03 再訂正)
        if (this.sheetFeatures.lifePath) {
            const lifepathDefs = [
                { key: "origin",     label: "出自" },
                { key: "experience", label: "経験" },
                { key: "encounter",  label: "邂逅" },
            ];
            const lifepathSlots = [];
            for (const { key, label } of lifepathDefs) {
                const data = this.actor.system.lifePath[key];
                let enrichedSummary = "";
                let displayName = data.name;
                if (data.itemUuid) {
                    try {
                        const liveItem = await fromUuid(data.itemUuid);
                        if (liveItem) {
                            displayName = liveItem.name;
                            if (liveItem.system?.description) {
                                enrichedSummary = await foundry.applications.ux.TextEditor.enrichHTML(
                                    liveItem.system.description,
                                    { relativeTo: liveItem, editable: false }
                                );
                            }
                        }
                    } catch { /* アイテムが削除されている場合はフォールバック名を使用 */ }
                }
                lifepathSlots.push({
                    key,
                    label,
                    hasItem:       !!data.itemUuid,
                    name:          displayName,
                    enrichedSummary,
                });
            }
            context.lifepathSlots = lifepathSlots;
        }

        // スートの表示名。テンプレートは title="{{suitData.label}}" にそのまま出すので、
        // ここは**表示文字列**を置く(2026-09-07 是正)。従来は "TNX.Suits.spade" という
        // 翻訳キーが入っており、localize を通していないテンプレートでは生キーが出ていた
        context.TNX = {
            SUITS: {
                spade:   { label: "スペード", icon: "fa-solid fa-spade" },
                club:    { label: "クラブ",   icon: "fa-solid fa-club" },
                heart:   { label: "ハート",   icon: "fa-solid fa-heart" },
                diamond: { label: "ダイヤ",   icon: "fa-solid fa-diamond" }
            }
        };

        const allStyles   = this.actor.items.filter(i => i.type === 'style');
        const allMiracles = this.actor.items.filter(i => i.type === 'miracle');
        context.equippedAffiliations = this.actor.items.filter(i => i.type === 'organization');
        // 部署技能(ワークス技能の部署フラグ)を取得している場合、所属名はその技能名で上書き(2026-07-03 確定)
        context.affiliationDisplay   = findDepartmentSkillName(this.actor.items)
            ?? (context.equippedAffiliations[0]?.name || "フリーランス");

        context.styleSlots = this._prepareStyleSlots(allStyles);

        // 神業の枠(2026-09-05 是正): 従来はどちらも先頭3件で切り詰めていたため、**使用回数2以上の神業が
        // あると2つ目以降の神業がシートから消えていた**(使用回数ぶんの枠が3つを占める)。
        // ・割り当て(編集モード)＝**神業ごとに1枠**(3スタイル=3枠。足りない分は空枠)
        // ・使用(閲覧モード)＝**使用回数ぶんの枠を全部**(消費済みは無効化。3未満はプレースホルダで埋める)
        const miracleSlotsData = prepareMiraclesForDisplay(allMiracles);
        context.miracleSlots = miracleSlotsData.filter((s, i, arr) => arr.findIndex(x => x._id === s._id) === i);
        while (context.miracleSlots.length < 3) context.miracleSlots.push({ isEmpty: true });

        context.miracleSlotsForView = [...miracleSlotsData];
        while (context.miracleSlotsForView.length < 3) {
            context.miracleSlotsForView.push({
                name: `神業${context.miracleSlotsForView.length + 1}`,
                isPlaceholder: true,
                _id: `placeholder-${context.miracleSlotsForView.length}`
            });
        }

        context.processedStylesForView = this._prepareStylesForView(allStyles);


        // 無視ゲート(ignore.*): 実効コンディションの effectIgnored/ignoredBy を identity で引ける表に。
        // バッヂ自体は残す(存在は消えない)=無視中の行だけ取り消し線＋供給元 tooltip を添える。
        const ignoreByIdentity = new Map(
            getEffectiveConditions(this.actor).map(c => [c.identity, { ignored: c.effectIgnored, by: c.ignoredBy, manual: c.manuallyIgnored }]));
        const bsList = [];
        this.actor.effects.forEach(e => {
            if (e.disabled) return;
            const conds = readConditions(e);
            const bsFlags = e.flags?.[SYSTEM_ID];
            let hasStatusCondition = false;
            if (e.statuses && e.statuses.size > 0) {
                e.statuses.forEach(statusId => {
                    const statusConfig = CONFIG.statusEffects.find(s => s.id === statusId);
                    if (statusConfig) {
                        const ig = ignoreByIdentity.get(`${e.id}:${statusId}`);
                        bsList.push({
                            id:      e.id,
                            statusId,
                            name:    statusConfig.name,
                            valueText:  TnxCharacterSheetBase._bsValueText(this.actor, conds.find(c => c.kind === statusId), e),
                            // ダメージ(負傷)は「nチャート名」・BS は「効果名n」の順(2026-07-18 ユーザー確定)
                            valueFirst: CONDITION_KINDS[statusId]?.type === "wound",
                            img:     statusConfig.img,
                            details: ig?.ignored ? (ig.manual ? "手動で無視中" : (ig.by ? `「${ig.by}」により無視` : "効果を無視中")) : (bsFlags?.details || ""),
                            ignored: ig?.ignored === true,
                        });
                        hasStatusCondition = true;
                    }
                });
            }
            if (!hasStatusCondition && bsFlags?.isBadStatus) {
                const ig = ignoreByIdentity.get(conds[0]?.identity);
                bsList.push({
                    id:      e.id,
                    statusId: null,
                    name:    e.name,
                    valueText:  TnxCharacterSheetBase._bsValueText(this.actor, conds[0], e),
                    valueFirst: conds[0]?.def?.type === "wound",
                    img:     e.img,
                    details: ig?.ignored ? (ig.manual ? "手動で無視中" : (ig.by ? `「${ig.by}」により無視` : "効果を無視中")) : (bsFlags?.details || ""),
                    ignored: ig?.ignored === true,
                });
            }
        });
        context.badStatuses = bsList;

        // 行動を支払って回復する BS(15-4)。1 BS 種別につき1行で、押すと支払いと回復が同時に済む。
        // 押せるのはカット進行中だけ——カット進行外は AR という原資自体が存在しない(付与型)。
        context.actionRecoveries = planActionRecoveryRows(this.actor.effects.contents)
            .map(row => ({ ...row, paymentLabel: PAYMENT_LABELS[row.payment] ?? "", countText: row.count > 1 ? ` ×${row.count}` : "" }));
        context.inCutProgression = this.actor.system?.actionRank?.inCombat === true;

        this._getCitizenRankData(context);
        if (this.sheetFeatures.abilities) {
            this._getAbilitiesData(context, allStyles);
        } else {
            // 能力値を持たないシート(extra=attributes 非保持)。派生コンテキストは既定値で埋める
            context.system.abilities = {};
            context.mundaneTotalValue = 0;
            context.effectiveBounty = 0;
            context.bountyAtMin = true;
        }
        await this._prepareSkillsData(context);
        EffectsSheetMixin.prepareEffectsContext(this.actor, context);
        context.allEffects = [
            ...context.effects.temporary,
            ...context.effects.passive,
            ...context.effects.inactive
        ];

        context.outfitGroups = await prepareOutfitGroups(this.actor);
        if (this.sheetFeatures.combat) prepareCombatData(this.actor, context);
        context.partOccupancy = this.sheetFeatures.parts
            ? preparePartOccupancy(this.actor)
            : { slots: [], unlisted: [], hasSlots: false, hasUnlisted: false, hostChips: [], hasHostChips: false };
        context.partOccExpanded = this._partOccExpanded;

        return context;
    }

    /**
     * ゲーム設定の部位プリセットを読み込み、このキャストの部位スロットを作成する(フェーズ10)。
     * 既存の部位スロットがある場合は確認のうえ置換する。新規キャストへの流し込み(preCreateActor)を
     * 既存キャストにも手動で適用できるようにするもの。
     */
    static async _onLoadPartPreset(event, _target) {
        event.preventDefault();
        const preset = getPartSlotPreset();
        if (!preset.length) {
            ui.notifications.warn("部位スロットプリセットが空です。ゲーム設定の「部位スロットプリセット」で定義してください。");
            return;
        }
        const existing = this.actor.system.partSlots ?? [];
        if (existing.length) {
            const ok = await foundry.applications.api.DialogV2.confirm({
                window: { title: "部位プリセットを読み込む" },
                content: "<p>このキャストの部位スロットをプリセットで<strong>置き換え</strong>ます。よろしいですか？</p>",
                classes: ["tokyo-nova", "tnx-dialog"],
            });
            if (!ok) return;
        }
        await this.actor.update({ "system.partSlots": foundry.utils.deepClone(preset) });
        ui.notifications.info("部位プリセットを読み込みました。");
    }

    /** 部位占有パネルの展開/縮小を切り替える(状態はインスタンスに保持し再描画をまたぐ)。 */
    static _onTogglePartOccupancy(event, _target) {
        event.preventDefault();
        this._partOccExpanded = !this._partOccExpanded;
        this.element.querySelector(".tnx-part-occupancy")?.classList.toggle("collapsed", !this._partOccExpanded);
    }

    /** このキャストの部位スロットを編集する(プリセット編集アプリをアクター対象で開く)。 */
    static async _onEditPartSlots(event, _target) {
        event.preventDefault();
        new PartSlotPresetApp({ actor: this.actor }).render(true);
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    async _preRender(_context, _options) {
        if (!this.element) return;
        this.element.classList.add("tnx-no-transitions");
        this._scrollPositions = {};
        for (const sel of [
            ".profile-sidebar", ".sheet-body",
            ".tab[data-tab='abilities']", ".tab[data-tab='combat']",
            ".tab[data-tab='outfits']",  ".tab[data-tab='status']",
            ".tab[data-tab='history']",  ".tab[data-tab='profile']",
        ]) {
            const el = this.element.querySelector(sel);
            if (el) this._scrollPositions[sel] = el.scrollTop;
        }
    }

    /** 宿主のドロップ(RL のみ・17-6): キャスト/ゲストのアクター。自分自身は不可 */
    async _onHostDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        if (!game.user.isGM) return;
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const raw = await fromUuid(data.uuid).catch(() => null);
        const doc = raw?.actor ?? raw;
        if (!doc || doc.documentName !== "Actor" || !["cast", "guest"].includes(doc.type)) {
            ui.notifications.warn("宿主にはキャストまたはゲストのアクターをドロップしてください。");
            return;
        }
        if (doc.id === this.actor.id) { ui.notifications.warn("自分自身を宿主にはできません。"); return; }
        await this.actor.update({ "system.host": { uuid: doc.uuid, name: doc.name } });
    }

    static async _onClearHostRef(_event, _target) {
        if (!game.user.isGM) return;
        await this.actor.update({ "system.host": { uuid: "", name: "" } });
    }

    _onRender(context, _options) {
        super._onRender(context, _options);
        // 宿主のドロップ受け(RL のみ・トループの所有者欄と同方式・17-6)
        const hostZone = this.element.querySelector(".cast-host-dropzone");
        if (hostZone && game.user.isGM) {
            hostZone.addEventListener("dragover", (ev) => ev.preventDefault());
            hostZone.addEventListener("drop", (ev) => this._onHostDrop(ev));
        }
        const el = this.element;

        el.classList.toggle("edit-mode",  !!context.isEditMode);
        el.classList.toggle("view-mode", !context.isEditMode);

        // アイテム行のカード・ツールチップ(16-2): レンダー後に非同期で属性を流し込む
        // (ホバー時には出来上がっている・HUD シーンカードのツールチップと同方式)
        applyItemCardTooltips(el, this.actor);
        // @UUID コンテンツリンクのカード・ツールチップ(16-x): 解説展開パネル等のリンクに適用
        applyContentLinkCardTooltips(el);

        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* PARTS にそのタブがない場合は無視 */ }
            }
        }

        // 編集モードトグルボタン(ウィンドウヘッダー左端)
        const header = el.querySelector(".window-header");
        if (header && this.isEditable && !header.querySelector(".edit-mode-toggle")) {
            const toggleBtn = document.createElement("a");
            toggleBtn.className = "edit-mode-toggle";
            toggleBtn.title = "編集モード切替";
            toggleBtn.innerHTML = '<i class="fa-solid fa-eye tnx-view-icon"></i><i class="fa-solid fa-pen tnx-edit-icon"></i>';
            toggleBtn.addEventListener("click", ev => {
                ev.preventDefault();
                TnxCharacterSheetBase._onToggleEditMode.call(this, ev, toggleBtn);
            });
            header.prepend(toggleBtn);
        }

        // 使用不可の判定トリガーをグレーアウト＋クリック不能に(再利用: applyTriggerDisable)。
        // ・技能: 負傷の使用不可(skillBlock)に該当する技能(造反/人脈消失/口座凍結 等)。
        // ・能力値判定: 重圧の対象能力値(制御判定トリガーは対象外=重圧でも制御は可)。
        const blockConds = TnxCheckFlow._gatherConditions(this.actor);
        applyTriggerDisable(el, '[data-action="startSkillCheck"][data-item-id]', (t) => {
            const key = this.actor.items.get(t.dataset.itemId)?.system?.identificationKey;
            if (!key) return null;
            const names = gatherSkillUseWarnings(blockConds, [key]);
            return names.length ? { reason: `「${names.join("」「")}」により使用不可` } : null;
        });
        applyTriggerDisable(el, '[data-action="startAbilityCheck"][data-ability-key]', (t) => {
            const b = getCheckBlock(blockConds, { upward: true, ability: t.dataset.abilityKey });
            return b.blocked ? { reason: `「${b.by}」により、この能力値を使う判定はできません` } : null;
        });
        // 行動での回復(15-4): カット進行外は AR という原資が存在しない(付与型)ので支払えない。
        // 行動回数の制限ではなく原資の有無による区別。
        applyTriggerDisable(el, '[data-action="recoverByAction"]', () => (
            this.actor.system?.actionRank?.inCombat === true
                ? null : { reason: "カット進行中のみ" }
        ));

        // スキルプロパティ変更(EXP 連動あり、data-action 外で処理)
        for (const input of el.querySelectorAll(".skill-property-change")) {
            input.addEventListener("change", ev => this._onSkillPropertyChange(ev));
        }

        // クラスベースのアイテム操作
        for (const btn of el.querySelectorAll(".item-edit")) {
            btn.addEventListener("click", ev => {
                ev.preventDefault();
                const itemId = ev.currentTarget.dataset.itemId;
                this.actor.items.get(itemId)?.sheet.render({ force: true });
            });
        }
        for (const btn of el.querySelectorAll(".item-delete")) {
            btn.addEventListener("click", ev => TnxCharacterSheetBase._onItemDelete.call(this, ev, ev.currentTarget));
        }
        for (const btn of el.querySelectorAll(".item-create")) {
            btn.addEventListener("click", ev => TnxCharacterSheetBase._onItemCreate.call(this, ev, ev.currentTarget));
        }

        // 報酬点 ±1 ボタン(閲覧モード・ホバー表示)。人数/エニグマポイントの±ボタンは意匠クラス
        // (.bounty-adjust-btn)を共有するが data-action で別処理のため、報酬点の実処理は
        // data-delta を持つボタンにのみ束縛する(無条件束縛だと NaN が bounty に飛ぶ)
        for (const btn of el.querySelectorAll(".bounty-adjust-btn[data-delta]")) {
            btn.addEventListener("click", ev => {
                ev.preventDefault();
                const delta = parseInt(ev.currentTarget.dataset.delta, 10);
                if (!Number.isFinite(delta)) return;
                const currentEffective = parseInt(
                    ev.currentTarget.closest(".bounty-view-panel")?.querySelector(".bounty-total")?.textContent ?? "0",
                    10
                );
                if (currentEffective + delta < 0) return;
                const currentBounty = this.actor.system.bounty ?? 0;
                this.actor.update({ "system.bounty": currentBounty + delta });
            });
        }

        // 技能・アイテム行のドラッグ(並び替え・ワールド/辞典への持ち出し)。
        // V2 は DEFAULT_OPTIONS.dragDrop を自動処理しないため明示的にバインドする。
        // ドロップ側は ActorSheetV2 既存の処理に委ねる(drop: false で二重発火を防止)。
        // 閲覧モードでも有効(2026-08-31 ユーザー指示。従来の編集モード限定ゲートは
        // アウトフィットタブが「ドラッグできない」ように見える原因だった)
        new foundry.applications.ux.DragDrop.implementation({
            dragSelector: ".item-list .item, .style-skills-list .item, .skills-list-view .item, .outfit-groups-container .outfit-row:not(.outfit-row--option):not(.outfit-row--header)",
            dropSelector: null,
            permissions: {
                dragstart: () => this.isEditable,
                drop:      () => false,
            },
            callbacks: {
                dragstart: this._onDragStart.bind(this),
            },
        }).bind(el);

        // 技能行のコンテキストメニュートリガー(縦三点リーダー)
        for (const trigger of el.querySelectorAll(".item-menu-trigger")) {
            trigger.addEventListener("click", ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const row = ev.currentTarget.closest("[data-item-id]");
                if (row) {
                    row.dispatchEvent(new MouseEvent("contextmenu", {
                        bubbles: true, cancelable: true, view: window,
                        clientX: ev.clientX, clientY: ev.clientY, buttons: 2
                    }));
                }
            });
        }

        // ProseMirror エディタのセットアップ — 編集モード時のみ表示、トグルなし
        const ProseMirrorEl = customElements.get("prose-mirror");
        if (ProseMirrorEl) {
            for (const contentDiv of el.querySelectorAll(".editor-content[data-edit]")) {
                const editorDiv = contentDiv.closest("div.editor");
                if (!editorDiv) continue;
                const fieldName = contentDiv.dataset.edit;
                const pm = ProseMirrorEl.create({
                    name: fieldName,
                    value: foundry.utils.getProperty(this.actor, fieldName) ?? "",
                    enriched: contentDiv.innerHTML,
                    toggled: false,
                });
                pm.dataset.documentUuid = this.actor.uuid;
                editorDiv.replaceWith(pm);
            }
        }

        activateContextMenus(this, el);
        this._applyTextSqueezing();
        // 初回描画の計測はウィンドウ幅(position)の適用前に走り得て、shrink-to-fit の仮幅
        // (実測で本来の約2倍)を親幅に「収まっている」と誤判定する(縮小不発・幅確定後に見切れる)。
        // 幅確定・手動リサイズを含む「フレームのサイズが変わったら測り直す」に一元化する
        // (transform は box を変えないため観測が再帰発火することはない)
        this._squeezeResizeObserver ??= new ResizeObserver(() => this._applyTextSqueezing());
        this._squeezeResizeObserver.disconnect();
        this._squeezeResizeObserver.observe(el);

        // 再描画後にスクロール位置を復元する
        const saved = this._scrollPositions;
        this._scrollPositions = {};
        requestAnimationFrame(() => {
            for (const [sel, top] of Object.entries(saved)) {
                if (!top) continue;
                const target = this.element?.querySelector(sel);
                if (target) target.scrollTop = top;
            }
            this.element?.classList.remove("tnx-no-transitions");
        });
    }

    /** @override タブ切替後、表示されたタブの .squeeze-text を縮小し直す(非表示時は clientWidth=0 で効かないため)。 */
    changeTab(tab, group, options) {
        super.changeTab(tab, group, options);
        this._applyTextSqueezing();
    }

    /** @override シートを閉じたらラベル縮小の ResizeObserver を解除する(フレームは破棄される)。 */
    _onClose(options) {
        super._onClose(options);
        this._squeezeResizeObserver?.disconnect();
    }

    // ─── データ準備ヘルパー ────────────────────────────────────────────────────

    _prepareStyleSlots(styles) {
        const slots = [];
        styles.forEach(item => {
            const itemData = item.toObject(false);
            itemData.isEmpty = false;
            itemData.isPersona = item.system.level === 3 ? true : item.system.isPersona;
            itemData.isKey     = item.system.level === 3 ? true : item.system.isKey;
            itemData.roleIndicatorDisplay = this._getRoleIndicatorSymbol(itemData.isPersona, itemData.isKey);
            itemData.roleIndicatorClass   = this._getRoleIndicatorClass(itemData.isPersona, itemData.isKey);
            for (let i = 0; i < item.system.level; i++) {
                if (slots.length < 3) slots.push(itemData);
            }
        });
        while (slots.length < 3) slots.push({ isEmpty: true });
        return slots;
    }

    _prepareStylesForView(styles) {
        return styles.map(item => {
            const itemData = item.toObject(false);
            const level    = item.system.level || 1;
            const isPersona = level === 3 ? true : item.system.isPersona;
            const isKey     = level === 3 ? true : item.system.isKey;
            const displayName               = item.system.nameEn || item.name;
            itemData.repeatedName          = Array(level).fill(displayName).join(' = ');
            itemData.roleIndicatorDisplay  = this._getRoleIndicatorSymbol(isPersona, isKey);
            return itemData;
        });
    }

    _prepareGenericSlots(items, maxSlots) {
        const slots = [];
        for (let i = 0; i < maxSlots; i++) {
            const item = items[i];
            slots.push(item ? { ...item.toObject(false), isEmpty: false } : { isEmpty: true });
        }
        return slots;
    }

    async _prepareSkillsData(context) {
        const generalSkills = this.actor.items
            .filter(i => i.type === 'generalSkill')
            .sort((a, b) => a.sort - b.sort);
        context.generalSkills = generalSkills;
        const halfIndex = Math.ceil(generalSkills.length / 2);
        context.generalSkillColumns = [generalSkills.slice(0, halfIndex), generalSkills.slice(halfIndex)];

        context.styleSkills = this.actor.items
            .filter(i => i.type === 'styleSkill')
            .sort((a, b) => a.sort - b.sort);

        const skillOptions = TnxSkillUtils.getSkillOptions();
        // 「技能」(comboSkill)の識別キー→技能名の逆引き用に全技能辞典を読み込み、view へ渡す
        const comboSkillNames = await loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
        context.styleSkills.forEach(item => {
            if (item.type === 'styleSkill') {
                item.view = TnxSkillUtils.prepareStyleSkillView(item.system, skillOptions, comboSkillNames);
            }
        });

        // スタイル技能をスタイル単位でグループ化し、各群に秘技/奥義の取得数＋上限を付す
        // (秘技=スタイルレベル×2／奥義=スタイルレベル・表示のみ非強制)。除外・レベル自動参照は数えない。
        // スタイル未一致(ワークス技能等)は末尾「その他」群へ。グループ見出しに数を出すことで
        // 取得数を該当技能の直上・スタイル単位で示す(全体合算でなく、見出し1か所に集約もしない)。
        const styleDescriptors = this.actor.items
            .filter(i => i.type === 'style')
            .map(s => ({ key: s.system.identificationKey, name: s.name, level: s.system.level }));
        const groups = groupStyleSkillsByStyle(
            context.styleSkills.map(i => ({
                id:               i.id,
                style:            i.system.style,
                category:         i.system.styleSkillCategory,
                excludeFromCount: i.system.excludeFromCount,
                levelRefEnabled:  i.system.levelRef?.enabled,
            })),
            styleDescriptors,
        );
        const byId = new Map(context.styleSkills.map(i => [i.id, i]));
        context.styleSkillGroups = groups.map(g => ({
            ...g,
            skills: g.skillIds.map(id => byId.get(id)).filter(Boolean),
        }));

        // 技能解説の展開パネル用エンリッチ(16-x): @UUID コンテンツリンク等を解決した HTML を
        // id 逆引きで渡す(テンプレは lookup で参照。素の system.description 直渡しを置換)
        const enrichText = (t) => foundry.applications.ux.TextEditor.enrichHTML(t ?? "", { async: true });
        context.enrichedSkillDescriptions = Object.fromEntries(await Promise.all(
            [...generalSkills, ...context.styleSkills]
                .map(async (i) => [i.id, await enrichText(i.system.description)]),
        ));
    }

    // ─── ドラッグ&ドロップ ────────────────────────────────────────────────────

    _onDragStart(event) {
        const row  = event.currentTarget.closest("[data-item-id]");
        const item = this.actor.items.get(row?.dataset.itemId);
        if (!item) return;
        event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
    }

    // ─── コンテキストメニュー ──────────────────────────────────────────────────

    // ─── テキスト圧縮 ─────────────────────────────────────────────────────────

    _applyTextSqueezing() {
        if (!this.element) return;
        for (const el of this.element.querySelectorAll('.squeeze-text')) {
            const parent      = el.parentElement;
            const parentStyle = getComputedStyle(parent);
            const availableWidth = parent.clientWidth
                - parseFloat(parentStyle.paddingLeft)
                - parseFloat(parentStyle.paddingRight)
                - 2;
            const contentWidth = el.scrollWidth;
            const isSkewedLabel = el.classList.contains('skill-label-content');
            const transformBase = isSkewedLabel ? 'skewX(25deg)' : '';
            // 非表示タブ等で親幅が取れない(clientWidth=0)ときは縮小しない(scaleX(NaN/∞)回避)。
            // タブ表示後に changeTab から再実行されるので、そこで正しく縮小される。
            if (availableWidth <= 0 || contentWidth === 0) {
                el.style.transform = transformBase;
                continue;
            }
            if (contentWidth > availableWidth) {
                el.style.transform = `${transformBase} scaleX(${(availableWidth / contentWidth) * 0.95})`;
            } else {
                el.style.transform = transformBase;
            }
        }
    }

    // ─── アウトフィットタブ ──────────────────────────────────────────────────

    /**
     * 住宅施設に紐づく住宅エリアの修正値を解決する。
     * 実体は `residence-area.mjs`(14-8 でシーンの舞台選択と共用するため切り出し)。
     */
    static async _resolveHousingAreaMods(sys) {
        return resolveHousingAreaMods(sys);
    }

    // ─── 市民ランク・能力値データ ─────────────────────────────────────────────

    _getCitizenRankData(context) {
        const currentRank = context.system.citizenRank;
        const rankMap = { "A": "A", "B+": "B+", "B": "B", "B-": "B-", "C+": "C+", "C": "C", "C-": "C-", "X": "X" };
        context.citizenRankOptionsForSelect = Object.entries(rankMap).map(([value]) => ({
            value,
            label:    value,
            selected: value === currentRank
        }));
    }

    _getAbilitiesData(context, equippedStyles) {
        context.system.abilities = {};
        const abilityKeys   = ["reason", "passion", "life", "mundane"];
        const abilityLabels = {
            reason:  "♠理性",
            passion: "♣感情",
            life:    "♥生命",
            mundane: "♦外界"
        };

        const outfitMod = context.system.outfitMod ?? {};
        for (const key of abilityKeys) {
            const ability = context.system[key];
            const styleContributions = equippedStyles.map(style => {
                const level = style.system.level || 1;
                return {
                    name:    style.name,
                    value:   style.system[key].value   * level,
                    control: style.system[key].control * level,
                    level,
                };
            });
            const abilityOutfitMod  = outfitMod[key]    ?? 0;
            const controlOutfitMod  = outfitMod.control ?? 0;
            context.system.abilities[key] = {
                label:            abilityLabels[key],
                growth:           ability.growth,
                controlGrowth:    ability.controlGrowth,
                mod:              ability.mod,
                controlMod:       ability.controlMod,
                outfitMod:        abilityOutfitMod,
                outfitControlMod: controlOutfitMod,
                styleContributions,
                // 実効値は DataModel.prepareDerivedData が算出した単一の真実を読む(0clamp 込み)。
                // styleTotalValue 等はスタイル内訳表示(styleContributions)専用。
                totalValue:   this.actor.system[key].total,
                totalControl: this.actor.system[key].totalControl,
            };
        }
        context.mundaneTotalValue = context.system.abilities.mundane.totalValue;
        context.effectiveBounty = (context.system.bountyBase ?? 0) + (context.system.bounty ?? 0);
        context.bountyAtMin = context.effectiveBounty <= 0;
    }

    // ─── スキルプロパティ変更(EXP 連動) ──────────────────────────────────────

    async _onSkillPropertyChange(event) {
        event.preventDefault();
        const input  = event.currentTarget;
        const itemId = input.closest('.item')?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const target = input.dataset.target;

        // レベル自動参照中のスタイル技能はレベルが派生上書きされる(実体は同一技能の別ブロック)。
        // スートは手動だがレベル・経験点には触れない(レベルは参照先で確定・二重計上しない)。
        if (item.type === 'styleSkill' && item.system.levelRef?.enabled) {
            if (target === "suit") {
                await item.update({ [`system.suits.${input.dataset.suit}`]: input.checked });
            }
            return; // level 入力は無効化済み
        }

        let newLevel  = item.system.level;
        const updateData = {};

        if (target === "level") {
            newLevel = parseInt(input.value, 10);
            updateData["system.level"] = newLevel;
        } else if (target === "suit") {
            const suitKey = input.dataset.suit;
            updateData[`system.suits.${suitKey}`] = input.checked;
            const currentSuits = item.system.suits;
            newLevel = 0;
            for (const key of ["spade", "club", "heart", "diamond"]) {
                if ((key === suitKey ? input.checked : currentSuits[key])) newLevel++;
            }
            updateData["system.level"] = newLevel;
        }

        // 経験点はレベルを書いた結果を消費集計(updateCastExp)が全量再計算するため、ここは
        // レベルを書き込むだけでよい。**残量による中止はしない**——所持量を超える消費を
        // システムが止める筋合いはない(前借り・後払いは卓が決めること。KI-040)。
        await item.update(updateData);
    }

    _getRoleIndicatorSymbol(isPersona, isKey) {
        if (isPersona && isKey) return "◎⬤";
        if (isPersona)          return "◎";
        if (isKey)              return "⬤";
        return "";
    }

    _getRoleIndicatorClass(isPersona, isKey) {
        if (isPersona && isKey) return "role-pk";
        if (isPersona)          return "role-p";
        if (isKey)              return "role-k";
        return "role-shadow";
    }

    // ─── 静的アクションハンドラ ────────────────────────────────────────────────

    static _onCopyUuid(event, _target) {
        event.preventDefault();
        game.clipboard.copyPlainText(this.document.uuid);
        ui.notifications.info(game.i18n.format("DOCUMENT.IdCopiedClipboard", {
            label: this.document.documentName, type: "UUID", id: this.document.uuid
        }));
    }

    static _onToggleActorImage(event, target) {
        event.preventDefault();
        if (!this._isEditMode || !this.isEditable) return;
        this._showTokenImage = !this._showTokenImage;
        // フォームの未保存入力を失わないよう、画像領域だけ切り替える。
        const section = target.closest(".portrait-section");
        section.querySelector('[data-image-kind="portrait"]').hidden = this._showTokenImage;
        section.querySelector('[data-image-kind="token"]').hidden = !this._showTokenImage;
        target.setAttribute("aria-checked", String(this._showTokenImage));
        target.querySelector(".image-switch-label").textContent = this._showTokenImage ? "コマ" : "立ち絵";
    }

    static async _onToggleEditMode(event, _target) {
        if (event) event.preventDefault();
        // 編集→閲覧切替時: ProseMirror の内容をアクターに保存してから再描画する
        if (this._isEditMode && this.element) {
            const updates = {};
            for (const pm of this.element.querySelectorAll("prose-mirror")) {
                const fieldName = pm.getAttribute("name");
                if (!fieldName) continue;
                foundry.utils.setProperty(updates, fieldName, pm.value ?? "");
            }
            if (!foundry.utils.isEmpty(updates)) {
                this._isEditMode = false;
                await this.actor.update(updates);
                this.render();
                return;
            }
        }
        this._isEditMode = !this._isEditMode;
        this.render();
    }

    static _onOpenItemSheet(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        this.actor.items.get(itemId)?.sheet.render({ force: true });
    }

    static async _onOpenLifepathItem(event, target) {
        event.preventDefault();
        const key = target.dataset.lifepathKey;
        if (!key) return;
        const uuid = this.actor.system.lifePath[key]?.itemUuid;
        if (!uuid) return;
        const item = await fromUuid(uuid);
        item?.sheet?.render({ force: true });
    }

    static async _onRemoveLifepath(event, target) {
        event.preventDefault();
        const key = target.dataset.lifepathKey;
        if (!key) return;
        await this.actor.update({
            [`system.lifePath.${key}.itemUuid`]: "",
            [`system.lifePath.${key}.name`]:     "",
        });
    }

    static async _onOpenOutfitSheet(event, target) {
        event.preventDefault();
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;
        item.sheet._isEditMode = false;
        item.sheet.render({ force: true });
    }

    static async _onAddOutfit(event) {
        event.preventDefault();
        const optgroups = Object.entries(OUTFIT_CATEGORIES).map(([majorKey, major]) => {
            const opts = Object.entries(major.minors).map(([minorKey, def]) =>
                `<option value="${majorKey}|${minorKey}|${def.types[0]}">${def.label}</option>`
            ).join("");
            return `<optgroup label="${major.label}">${opts}</optgroup>`;
        }).join("");

        const result = await foundry.applications.api.DialogV2.prompt({
            window:  { title: "アウトフィットを追加" },
            content: `<div class="form-group"><label>種別</label><select name="sel">${optgroups}</select></div>`,
            ok: { label: "追加", callback: (_e, _btn, dialog) =>
                dialog.element.querySelector("[name=sel]").value
            },
        });
        if (!result) return;
        const [majorCategory, minorCategory, type] = result.split("|");
        await Item.create({
            name:   `新規${getMinorCategoryLabel(minorCategory)}`,
            type,
            system: { majorCategory, minorCategory },
        }, { parent: this.actor });
    }

    static async _onToggleOutfitFlag(event, target) {
        event.preventDefault();
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;
        // 不変条件(住宅の携帯固定・携帯が準備の前提・装備先の連動)は planOutfitFlagToggle が
        // 正本。アイテムシートのヘッダからも同じ規則で切り替わる(2026-09-07 一本化)
        await applyOutfitFlagToggle(item, target.dataset.flag, this.actor);
    }

    static _onToggleOutfitDesc(event, target) {
        event.preventDefault();
        target.blur();
        const row   = target.closest(".outfit-row");
        const panel = row?.querySelector(".outfit-desc-panel");
        if (!panel) return;
        const visible = panel.style.display !== "none";
        panel.style.display = visible ? "none" : "";
        const icon = target.querySelector("i");
        if (icon) {
            icon.classList.toggle("fa-expand",   visible);
            icon.classList.toggle("fa-compress", !visible);
        }
    }

    static async _onItemCreate(event, target) {
        event.preventDefault();
        const type = target.dataset.type;
        if (!type) return;
        if (type === 'generalSkill') {
            const onomasticTypes = [
                { value: "craft",   label: "製作" },
                { value: "art",     label: "芸術" },
                { value: "operate", label: "操縦" },
                { value: "society", label: "社会" },
                { value: "contact", label: "コネ" },
                { value: "other",   label: "その他" },
            ];
            const optionsHtml = onomasticTypes.map(o =>
                `<option value="${o.value}">${o.label}</option>`
            ).join("");
            const selected = await foundry.applications.api.DialogV2.prompt({
                window:  { title: "一般技能を追加" },
                content: `<div class="form-group"><label>種別</label><select name="sel">${optionsHtml}</select></div>`,
                ok: { label: "追加", callback: (_e, _btn, dialog) =>
                    dialog.element.querySelector("[name=sel]").value
                },
            });
            if (!selected) return;

            const nameMap = {
                craft: "製作：", art: "芸術：", operate: "操縦：",
                society: "社会：", contact: "コネ：", other: "新規一般技能",
            };
            const identificationKey = selected === "other" ? "" : `${selected}_`;
            const isOnomasticType   = selected !== "other";
            const existingSkills = this.actor.items.filter(i => i.type === 'generalSkill');
            // 識別キー空("other")は getSkillSortPosition が Infinity を返し末尾挿入になる
            const sortValue = calcSkillInsertSort(existingSkills, identificationKey);

            return Item.create({
                name:   nameMap[selected] ?? "新規一般技能",
                type:   "generalSkill",
                sort:   sortValue,
                system: {
                    level: 0,
                    generalSkillCategory: "onomasticSkill",
                    identificationKey,
                    isAction:   isOnomasticType,
                    usesBounty: isOnomasticType,
                },
            }, { parent: this.actor });
        }
        if (type === 'styleSkill') {
            return Item.create({ name: "新規スタイル技能", type: "styleSkill",
                system: { level: 0 }
            }, { parent: this.actor });
        }
        return Item.create({ name: `新規${type}`, type }, { parent: this.actor });
    }

    static async _onItemDelete(event, target) {
        event.preventDefault();
        const li     = target.closest(".item");
        const itemId = li?.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window:  { title: "削除" },
            content: `<p>「${item.name}」を削除しますか？</p>`
        });
        if (confirmed) {
            await item.delete();
            this.render();
        }
    }

    /**
     * 効果の参照を持つ神業の効果を、**スタイルを設定した時点で**固定する。
     * 対応表(区分の技能→参照する神業)から区分を1つ選ばせ、選んだ行の神業を効果として保存する。
     * 対応表が無い/1件しかない神業は何も聞かない(1件ならそれで固定)。
     * @param {?Item} miracle アクターに追加された神業
     */
    static async _chooseMiracleFormEffect(miracle) {
        const cfg = miracle?.system?.asOther;
        if (!miracle || cfg?.mode !== "choice") return;
        const rows = (cfg.choices ?? []).filter(c => c.uuid);
        if (!rows.length) return;
        const labels = await Promise.all(rows.map(async (c) => {
            const skill   = c.skillUuid ? await fromUuid(c.skillUuid).catch(() => null) : null;
            const miracleDoc = await fromUuid(c.uuid).catch(() => null);
            return { value: c.uuid, label: `${skill?.name ?? "（区分未設定）"}：${miracleDoc?.name ?? "?"}` };
        }));
        // 選択と写し(用途・経験点条件)は**1回の update にまとめる**(作成フックの中で分けると落ちる)
        const fix = async (uuid) => {
            const patch = await asOtherCopyUpdate(miracle, uuid);
            await miracle.update({ "system.asOther.selected": uuid, ...(patch ?? {}) });
        };
        if (labels.length === 1) {
            await fix(labels[0].value);
            return;
        }
        const picked = await TargetSelectionDialog.prompt({
            title: `${miracle.name}: 効果を決める`, label: "区分（フォルム・属性）",
            options: labels, selectLabel: "決定",
        });
        if (!picked) return;
        await fix(picked);
    }

    static async _onRollStyleDescription(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const item   = this.actor.items.get(itemId);
        if (!item) return;

        const enrichedDescription = await foundry.applications.ux.TextEditor.enrichHTML(
            item.system.description, { async: true }
        );
        // チャットカードの統一規格(item-card.hbs)で組む(2026-09-05)
        const content = await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/item-card.hbs",
            { typeLabel: "スタイル", name: item.name, description: enrichedDescription });
        ChatMessage.create({
            user:    game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content,
            flags: { "core.canPopout": true }
        });
    }

    static async _onToggleStyleRole(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const itemId      = target.closest('[data-item-id]')?.dataset.itemId;
        const clickedItem = this.actor.items.get(itemId);
        if (!this.isEditable || !clickedItem) return;

        if (clickedItem.system.level === 3) {
            return ui.notifications.warn("スタイルレベルが3のため、役割は「ペルソナ」と「キー」で固定されています。");
        }

        const { isPersona, isKey } = clickedItem.system;
        let nextIsPersona, nextIsKey;
        if (!isPersona && !isKey)     { nextIsPersona = true;  nextIsKey = false; }
        else if (isPersona && !isKey) { nextIsPersona = false; nextIsKey = true;  }
        else if (!isPersona && isKey) { nextIsPersona = true;  nextIsKey = true;  }
        else                          { nextIsPersona = false; nextIsKey = false; }

        const updates    = [];
        const allStyles  = this.actor.items.filter(i => i.type === 'style');
        for (const style of allStyles) {
            if (style.system.level === 3) continue;
            const updateData = { _id: style.id };
            let needsUpdate  = false;
            if (style.id === clickedItem.id) {
                updateData['system.isPersona'] = nextIsPersona;
                updateData['system.isKey']     = nextIsKey;
                needsUpdate = true;
            } else {
                if (nextIsPersona && style.system.isPersona) { updateData['system.isPersona'] = false; needsUpdate = true; }
                if (nextIsKey     && style.system.isKey)     { updateData['system.isKey']     = false; needsUpdate = true; }
            }
            if (needsUpdate) updates.push(updateData);
        }
        if (updates.length > 0) await this.actor.updateEmbeddedDocuments("Item", updates);
    }

    static _onToggleAbilityDetails(event, target) {
        event.preventDefault();
        const panel = target.closest('.ability-block')?.querySelector('.ability-details-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
        const icon = target.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-chevron-down');
            icon.classList.toggle('fa-chevron-up');
        }
    }

    static _onToggleSkillDesc(event, target) {
        event.preventDefault();
        target.blur();
        const row = target.closest('.style-skill-row');
        const panel = row?.querySelector('.style-skill-desc-panel');
        if (!panel) return;
        const isVisible = panel.style.display !== 'none';
        panel.style.display = isVisible ? 'none' : '';
        const icon = target.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-expand', isVisible);
            icon.classList.toggle('fa-compress', !isVisible);
        }
    }

    static async _onRemoveBadStatus(event, target) {
        event.preventDefault();
        const effectId = target.dataset.effectId;
        const statusId = target.dataset.statusId || null;
        const effect   = this.actor.effects.get(effectId);
        if (!effect) return;

        if (statusId) {
            const newStatuses = Array.from(effect.statuses).filter(id => id !== statusId);
            await effect.update({ statuses: newStatuses });
            if (newStatuses.length === 0 && effect.changes.length === 0
                    && !effect.flags?.[SYSTEM_ID]?.isBadStatus) {
                await effect.delete();
            }
        } else {
            await effect.delete();
        }
    }

    static async _onRecalculateBounty(event, _target) {
        event.preventDefault();
        await this.actor.update({ "system.bountyBase": TnxCharacterSheetBase._computeMundaneTotalValue(this.actor) });
    }

    /**
     * BS/負傷バッジに付す効果値/対象の表記を返す(2026-07-15・正本 Bad_Status.md の表記に従う)。
     * 値/対象が「効果や名前で決まるもの」(酩酊(大/小)・恐慌 等)は空文字＝表示しない。
     * カードで決まるもの(重圧の指定なし・衰弱のスート引き)も、引いた後は保存された値/対象を表示する。
     * 表示順はテンプレート側(valueFirst): BS=名前の後「効果名n」・負傷=名前の前「nチャート名」
     * (2026-07-18 ユーザー確定)。
     * @param {Actor} actor バッジの持ち主(対象武器=このアクターの武器・生身の解決に使う)
     * @param {object|null} cond readConditions の 1 要素
     * @param {ActiveEffect|null} effect バッジの元 AE(負傷のチャート値の読み取りに使う)
     * @returns {string} 効果値/対象の表記(例 「2」「（生命）」「（-3）」「（対象名）」)
     */
    static _bsValueText(actor, cond, effect = null) {
        const def = cond?.def;
        if (!def || def.fixedMagnitude !== undefined) return ""; // 固定値/名前で明示=表示なし
        // 負傷: チャート値を数字直付けで表示(邪毒と同型・2026-07-18 ユーザー指摘で表示化。
        // 保存された woundValue 優先・手動付与は kind から導出=woundChartValue)
        if (def.type === "wound") {
            const v = woundChartValue(effect);
            return v ? String(v) : "";
        }
        // 対象能力値はスート記号で表す(♠理性/♣感情/♥生命/♦外界・2026-07-19 ユーザー確定:
        // 能力値名だと能力値の値と紛らわしく、「生命の制御値」等はバッジ幅に収まらないため)
        const ABIL_SUIT = { reason: "♠", passion: "♣", life: "♥", mundane: "♦" };
        // 変動する強度(邪毒・電子妨害): 名前に数字を直付け(括弧なし)。Bad_Status `[BS：邪毒n]`/`[BS：電子妨害n]`
        if (def.magnitudeField && (def.type === "continuous" || def.type === "computed")) {
            return cond.magnitude ? String(cond.magnitude) : "";
        }
        // 衰弱: 全制御値版=-n / スート引き版=♥-n(括弧なし=2026-07-19 ユーザー確定)。
        // ルール表記は Bad_Status `[BS：衰弱(-数字)]`
        if (def.magnitudeField && def.apply === "control") {
            if (cond.targetAbility) return `${ABIL_SUIT[cond.targetAbility] ?? "?"}-${cond.magnitude}`;
            return cond.magnitude ? `-${cond.magnitude}` : "";
        }
        // 重圧: 対象能力値のスート(括弧なし)。ルール表記は Bad_Status `[BS：重圧(生命)]`
        // (指定なし=カード決定後に埋まる)
        if (def.abilityField) {
            return cond.targetAbility ? (ABIL_SUIT[cond.targetAbility] ?? "?") : "";
        }
        // 萎縮/憎悪: 対象アクター名(逆引きした現在名)
        if (def.targetField && cond.targetUuid) {
            const a = fromUuidSync(cond.targetUuid);
            return a?.name ? `（${a.name}）` : "";
        }
        // 捕縛: 対象武器名(このアクターの武器・空=生身)
        if (def.weaponField) {
            const id = cond.targetWeapon;
            const name = id ? (actor?.items?.get(id)?.name ?? "?") : "生身";
            return `（${name}）`;
        }
        return "";
    }

    // ─── 判定起動 ────────────────────────────────────────────────────────────

    // 参加技能の解決(旧 _resolveSkillSet)と用途不備検知(旧 _detectUsageDefect)は、判定起動の
    // 共通前段(usage-check-context.mjs の resolveUsageSkillSet / detectUsageDefect)へ移設した
    // (2026-07-16 一本化。攻撃/NPC取得/回復の専用フローと共用するため)。

    static async _onStartSkillCheck(event, target) {
        event.preventDefault();
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        if (!itemId) return;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        await activateItemCheck(this.actor, item);
    }

    /**
     * 戦闘タブのタイミング節から用途を直接起動する(2026-07-17 用途駆動化)。
     * 旧・合成アクション(操縦移動/リロード)は移動タイプ用途・リロード用途に一本化されオミット。
     */
    static async _onStartUsageUse(event, target) {
        event.preventDefault();
        const itemId = target.dataset.itemId;
        const usageId = target.dataset.usageId;
        const item = itemId ? this.actor.items.get(itemId) : null;
        if (!item || !usageId) return;
        try {
            await activateItemCheck(this.actor, item, { usageId });
        } catch (err) {
            console.error("TNX | 用途の実行に失敗しました", err);
            ui.notifications.error(`用途の実行に失敗しました: ${err.message}`);
        }
    }

    static async _onStartAbilityCheck(event, target) {
        event.preventDefault();
        const abilityKey = target.closest("[data-ability-key]")?.dataset.abilityKey;
        if (!abilityKey) return;
        const ABILITY_TO_SUIT = { reason: "spade", passion: "club", life: "heart", mundane: "diamond" };
        const ABILITY_LABELS  = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
        const suit = ABILITY_TO_SUIT[abilityKey];
        const actor = this.actor;
        await TnxCheckFlow.open({
            type:            "abilityCheck",
            actorId:         actor.id,
            skillIds:        [],
            skillLabel:      ABILITY_LABELS[abilityKey] ?? abilityKey,
            validSuits:      suit ? [suit] : [...ALL_SUITS],
            targetValue:     null,
            bountyAvailable: 0, // 能力値判定では報酬点を消費できない(2026-07-10 ユーザー確定)
            requestMessageId: null,
        });
    }

    static async _onStartControlCheck(event, target) {
        event.preventDefault();
        const abilityKey = target.closest("[data-ability-key]")?.dataset.abilityKey;
        const ABILITY_TO_SUIT = { reason: "spade", passion: "club", life: "heart", mundane: "diamond" };
        const ABILITY_LABELS  = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
        const suit  = ABILITY_TO_SUIT[abilityKey];
        const actor = this.actor;
        await TnxCheckFlow.open({
            type:            "controlCheck",
            actorId:         actor.id,
            skillIds:        [],
            skillLabel:      abilityKey ? `${ABILITY_LABELS[abilityKey] ?? abilityKey}の制御` : "制御判定",
            validSuits:      suit ? [suit] : [...ALL_SUITS],
            targetValue:     null,
            bountyAvailable: 0,
            requestMessageId: null,
        });
    }

    static _computeMundaneTotalValue(actor) {
        // 外界(mundane)の最終実効値。prepareDerivedData が算出した単一の真実を読む。
        return actor.system.mundane.total;
    }

    // ─── コンバットスピード(フェーズ10-5) ───────────────────────────────────

    /** number-input-spinner の＋。data-field のパスを 1 増やす(アイテムシートと同方式)。 */
    static async _onIncrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.actor, field) ?? 0;
        await this.actor.update({ [field]: current + 1 });
    }

    /** number-input-spinner の－。data-min があればそこで止める。 */
    static async _onDecrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.actor, field) ?? 0;
        let next = current - 1;
        if (target.dataset.min !== undefined) next = Math.max(next, Number(target.dataset.min));
        await this.actor.update({ [field]: next });
    }

    /**
     * プレアクト初期化(フェーズ10-5・正本 Combat_Flow.md): CSベースの能力値項
     * floor((理性+感情+生命)÷2) を**その時点の実効値**から焼き込み(以後追従しない)、
     * CS を CSベース実効値で初期化する。修正項(freeMod・タップ修正・AE)はライブのため、
     * 現在の実効ベースからオーバーレイ分を保って value に写す。
     */
    static async _onInitCombatSpeed(_event, _target) {
        const patch = buildCombatSpeedInit(this.actor.system);
        await this.actor.update(patch);
        ui.notifications?.info(`CS を決定しました（CS ${patch["system.combatSpeed.value"]}）。`);
    }

    /**
     * 行動を支払って BS を回復する(15-4・正本 Bad_Status「行動を支払って回復する BS」)。
     *
     * 押した時点で支払いと回復の両方が済む(別の回復ボタンは出さない)。回復は**その種別を全て**
     * ——重圧・捕縛は「全回復」であり、捕縛を武器ごとに複数受けていても 1 回のメジャー放棄で戻る。
     * メジャーの放棄は**行動の放棄というアクションを行ったもの**とみなすため、通常のメジャー行使と
     * 同じ記帳に積む(プロセス終了時に AR−1＋CS カレント 0 が一般則で適用される)。
     */
    static async _onRecoverByAction(_event, target) {
        const kind = target.closest("[data-condition-kind]")?.dataset.conditionKind;
        if (!kind) return;
        const payment = CONDITION_KINDS[kind]?.payment;
        const ids = this.actor.effects.contents
            .filter(e => getConditionKinds(e).includes(kind))
            .map(e => e.id);
        if (!ids.length) return;
        if (MAJOR_PAYMENTS.has(payment)) {
            const { TnxCombat } = await import("../combat/tnx-combat.mjs");
            await TnxCombat.markMajorAction(this.actor);
        }
        await this.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }

    // 武器の参照宣言(weaponRefs)は編集モードのドロップダウン(name バインド・submitOnChange)で
    // 直接保存されるため、専用アクションは持たない(フェーズ10-6・2026-07-02)。

    /** @override 実体は sheet-drop.mjs(既定処理へ委ねる判断だけ super を呼べるここで受ける)。 */
    async _onDropItem(event, data) {
        const res = await onDropItem(this, event, data);
        return res === DROP_FALLBACK ? super._onDropItem(event, data) : res;
    }

    /** @override 実体は sheet-drop.mjs。 */
    _onSortItem(event, itemData) {
        return onSortItem(this, event, itemData);
    }

}
