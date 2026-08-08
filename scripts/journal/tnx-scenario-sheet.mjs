import { loadGroupedGeneralSkillChoices } from '../module/skill-dictionary.mjs';
import {
    presetLabel, newCheckRequestPreset, newBountyPreset,
    newDamageGrantPreset, newEffectGrantPreset,
} from '../module/request-presets.mjs';
import { RL_DAMAGE_TYPES, RL_DAMAGE_CATEGORIES, RL_DAMAGE_MODES } from '../module/rl-grant-logic.mjs';
import { promptEffectData } from '../module/effect-authoring.mjs';
import { describeEffectData } from '../module/effect-source-logic.mjs';
import { captureScrollTop, restoreScrollTop } from '../module/scroll-preserve.mjs';
import { conditionStatusLabels } from '../module/conditions.mjs';
import { checkTypeOptions } from '../module/tnx-rl-request-app.mjs';
import { SCENE_AREA_OPTIONS, normalizeSceneRow, normalizeHandoutRow } from '../module/session-logic.mjs';
import { listSubScenes } from '../module/subscenes.mjs';

const { HandlebarsApplicationMixin, DocumentSheetV2, DialogV2 } = foundry.applications.api;

export class TnxScenarioSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "journal", "scenario", "two-column-layout"],
        position: { width: 800, height: 700 },
        actions: {
            addScene:          TnxScenarioSheet._onAddScene,
            deleteScene:       TnxScenarioSheet._onDeleteScene,
            addTextItem:       TnxScenarioSheet._onAddTextItem,
            deleteTextItem:    TnxScenarioSheet._onDeleteTextItem,
            addInfoItem:       TnxScenarioSheet._onAddInfoItem,
            deleteInfoItem:    TnxScenarioSheet._onDeleteInfoItem,
            addInfoContent:    TnxScenarioSheet._onAddInfoContent,
            deleteInfoContent: TnxScenarioSheet._onDeleteInfoContent,
            addSkillCheck:     TnxScenarioSheet._onAddSkillCheck,
            deleteSkillCheck:  TnxScenarioSheet._onDeleteSkillCheck,
            addHandout:        TnxScenarioSheet._onAddHandout,
            deleteHandout:     TnxScenarioSheet._onDeleteHandout,
            addCheckRequestPreset: TnxScenarioSheet._onAddCheckRequestPreset,
            addBountyPreset:       TnxScenarioSheet._onAddBountyPreset,
            addDamageGrantPreset:  TnxScenarioSheet._onAddDamageGrantPreset,
            addEffectGrantPreset:  TnxScenarioSheet._onAddEffectGrantPreset,
            editEffectPreset:      TnxScenarioSheet._onEditEffectPreset,
            deletePreset:          TnxScenarioSheet._onDeletePreset,
            presetUp:              TnxScenarioSheet._onPresetUp,
            presetDown:            TnxScenarioSheet._onPresetDown,
            presetSpinUp:          TnxScenarioSheet._onPresetSpin,
            presetSpinDown:        TnxScenarioSheet._onPresetSpin,
        },
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",
        },
    };

    tabGroups = { primary: "scenario-info" };

    /**
     * Foundry V13 の changeTab は `.tabs` クラスを nav に要求するが、
     * 縦型タブレイアウトでは Foundry コア CSS と競合するため、独自実装で置き換える。
     */
    changeTab(tab, group, options = {}) {
        if (!tab || !group) return;
        if ((this.tabGroups[group] === tab) && !options.force) return;

        for (const item of this.element.querySelectorAll(`[data-group="${group}"][data-tab]`)) {
            item.classList.toggle("active", item.dataset.tab === tab);
        }
        for (const section of this.element.querySelectorAll(`.tab[data-group="${group}"]`)) {
            section.classList.toggle("active", section.dataset.tab === tab);
        }
        this.tabGroups[group] = tab;
    }

    // ─── コンテキスト準備 ─────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const flagData = this.document.flags["tokyo-nova-axleration"] || {};

        context.castActors = game.actors.filter(a => a.type === 'cast');
        context.phaseLabels = CONFIG.TNX.phaseLabels;

        // シーン行は読み出し時に正規化する(14-2 追加フィールドの既定値を補う。一括書き換えはしない)
        const scenesData = flagData.scenes || {};
        const normalizePhase = rows => (Array.isArray(rows) ? rows : []).map(normalizeSceneRow);
        context.scenes = {
            opening:  normalizePhase(scenesData.opening),
            research: normalizePhase(scenesData.research),
            climax:   normalizePhase(scenesData.climax),
            ending:   normalizePhase(scenesData.ending),
        };
        // シーン行のセレクト選択肢(14-2/14-4): エリア・舞台(サブシーン+通常 Scene)・
        // シーンプレイヤー(User。シーンプレイヤーはプレイヤー側の指定=2026-08-07 裁定)
        context.sceneAreaOptions = SCENE_AREA_OPTIONS;
        context.stageSubSceneOptions = listSubScenes().map(s => ({ value: `subScene:${s.id}`, label: s.name }));
        context.stageSceneOptions = game.scenes.map(s => ({ value: `scene:${s.id}`, label: s.name }));
        context.scenePlayerUsers = game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: u.name }));

        // 判定要求・報酬点のプリセット(フェーズ12-5)。名前は未入力なら「判定要求n」を出す
        const skillGroups = await loadGroupedGeneralSkillChoices();
        const withSkills = (key) => (skillGroups ?? []).map(g => ({
            ...g,
            skills: (g.skills ?? []).map(o => ({ ...o, selected: o.identificationKey === key })),
        }));
        context.checkRequestPresets = (flagData.checkRequests || []).map((p, i) => ({
            ...p,
            placeholder: presetLabel({}, i, "判定要求"),
            checkTypes:  checkTypeOptions(p.checkType ?? "skillCheck"),
            skillGroups: withSkills(p.identificationKey),
        }));
        context.bountyPresets = (flagData.bountyGrants || []).map((p, i) => ({
            ...p,
            placeholder: presetLabel({}, i, "報酬点"),
        }));
        const selected = (options, value) => options.map(o => ({ ...o, selected: o.value === value }));
        context.damageGrantPresets = (flagData.damageGrants || []).map((p, i) => ({
            ...p,
            placeholder:  presetLabel({}, i, "ダメージ"),
            categories:   selected(RL_DAMAGE_CATEGORIES, p.category ?? "physical"),
            damageTypes:  selected(RL_DAMAGE_TYPES, p.damageType ?? "I"),
            // 決め方(固定/カード算出・2026-07-24)。値ラベルはモードに追随(欄の切替は _setupChangeListeners)
            modes:        selected(RL_DAMAGE_MODES, p.mode ?? "fixed"),
            valueLabel:   (p.mode ?? "fixed") === "card" ? "基準値" : "ダメージ",
        }));
        const statusLabels = conditionStatusLabels();
        context.effectGrantPresets = (flagData.effectGrants || []).map((p, i) => ({
            ...p,
            placeholder: presetLabel({}, i, "効果"),
            effect: {
                set:     !!p.effect?.name,
                name:    p.effect?.name || "未作成",
                img:     p.effect?.img  || "icons/svg/aura.svg",
                summary: describeEffectData(p.effect, statusLabels),
            },
        }));

        context.scenarioTexts = flagData.scenarioTexts || [];
        context.infoItems     = flagData.infoItems     || [];
        context.trailer       = flagData.trailer       || "";
        context.handouts      = (flagData.handouts || []).map(normalizeHandoutRow);

        return context;
    }

    // ─── レンダリング ─────────────────────────────────────────────────────────

    /** @override — 再描画前にスクロール位置を保存する(プリセット操作でスクロールが飛ぶのを防ぐ)。 */
    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this._scrollTop = captureScrollTop(this.element, ".sheet-body");
    }

    _onRender(_context, _options) {
        this._setupChangeListeners();
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) this.changeTab(tab, group, { force: true });
        }
        // 再描画でスクロールが飛ぶのを防ぐ(RL プリセットの入力操作等)
        restoreScrollTop(this.element, ".sheet-body", this._scrollTop);
    }

    // ─── 変更リスナー ─────────────────────────────────────────────────────────

    _setupChangeListeners() {
        const el = this.element;

        // RL プリセット(判定要求・報酬点・ダメージ・効果)
        for (const input of el.querySelectorAll('.preset-item [data-preset-kind]')) {
            input.addEventListener('change', this._onPresetFieldChange.bind(this));
        }

        // ダメージ付与プリセットの欄同期(付与ダイアログと同じ規則・2026-07-24):
        // 種別は物理のみ／値ラベルは 固定＝「ダメージ」・カード＝「基準値（攻撃力相当）」／
        // カード×精神・社会は攻撃力の概念が無い＝ダメージ欄ごと隠す(カードのみ算出)
        for (const item of el.querySelectorAll('.preset-item')) {
            const categorySelect = item.querySelector('[name="category"]');
            const modeSelect = item.querySelector('[name="mode"]');
            if (!categorySelect || !modeSelect) continue;   // ダメージ付与プリセットのみ対象
            const sync = () => {
                const isPhysical = categorySelect.value === 'physical';
                const isCard = modeSelect.value === 'card';
                item.querySelector('.damage-type-field')?.toggleAttribute('hidden', !isPhysical);
                const label = item.querySelector('.damage-value-label');
                if (label) label.textContent = isCard ? '基準値' : 'ダメージ';
                item.querySelector('.damage-fields-group')?.toggleAttribute('hidden', isCard && !isPhysical);
            };
            categorySelect.addEventListener('change', sync);
            modeSelect.addEventListener('change', sync);
            sync();
        }

        for (const input of el.querySelectorAll('.scene-item input[type="text"], .scene-item input[type="checkbox"], .scene-item textarea, .scene-item select')) {
            input.addEventListener('change', this._onSceneItemChange.bind(this));
        }
        for (const checkbox of el.querySelectorAll('.scene-item input[name="isMasterScene"]')) {
            checkbox.addEventListener('change', this._onToggleMasterScene.bind(this));
        }
        for (const sceneItem of el.querySelectorAll('.scene-item')) {
            this._updateScenePlayerState(sceneItem);
        }

        for (const input of el.querySelectorAll('.text-item input[type="text"], .text-item textarea')) {
            input.addEventListener('change', this._onTextItemChange.bind(this));
        }
        for (const input of el.querySelectorAll('.info-item input, .info-item textarea')) {
            input.addEventListener('change', this._onInfoItemChange.bind(this));
        }
        for (const input of el.querySelectorAll('.scenario-info-container textarea, .handout-item input, .handout-item textarea, .handout-item select')) {
            input.addEventListener('change', this._onScenarioInfoChange.bind(this));
        }
    }

    // ─── インスタンス変更ハンドラ ─────────────────────────────────────────────

    async _onScenarioInfoChange(event) {
        const input = event.currentTarget;
        const name = input.name;
        const value = input.value;
        const handoutItem = input.closest('.handout-item');

        if (handoutItem) {
            const handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
            const handout = handouts.find(h => h.id === handoutItem.dataset.id);
            if (handout) {
                handout[name] = value;
                await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
            }
        } else if (name === "trailer") {
            await this.document.setFlag("tokyo-nova-axleration", "trailer", value);
        }
    }

    async _onSceneItemChange(event) {
        const input = event.currentTarget;
        const sceneItem = input.closest('.scene-item');
        const sceneId = sceneItem.dataset.sceneId;
        const phase = sceneItem.dataset.phase;

        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes[phase]?.find(s => s.id === sceneId);
        if (!scene) return;

        scene[input.name] = input.type === 'checkbox' ? input.checked : input.value;
        await this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    _onToggleMasterScene(event) {
        this._updateScenePlayerState(event.currentTarget.closest('.scene-item'));
    }

    _updateScenePlayerState(sceneItem) {
        const checkbox = sceneItem.querySelector('input[name="isMasterScene"]');
        const playerInput = sceneItem.querySelector('select[name="playerUserId"]');
        if (checkbox && playerInput) {
            playerInput.disabled = checkbox.checked;
            if (checkbox.checked) playerInput.value = '';
        }
    }

    async _onTextItemChange(event) {
        const input = event.currentTarget;
        const id = input.closest('.text-item').dataset.id;
        const texts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        const textItem = texts.find(t => t.id === id);
        if (textItem) {
            textItem[input.name] = input.value;
            await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
        }
    }

    async _onInfoItemChange(event) {
        const input = event.currentTarget;
        const { infoId, contentId, skillId } = input.dataset;
        const value = input.type === "checkbox" ? input.checked
            : input.type === "number" ? parseInt(input.value)
            : input.value;

        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;

        if (contentId && skillId) {
            const skill = item.contents.find(c => c.id === contentId)?.skills.find(s => s.id === skillId);
            if (skill) skill[input.name] = value;
        } else if (contentId) {
            const content = item.contents.find(c => c.id === contentId);
            if (content) content[input.name] = value;
        } else {
            item[input.name] = value;
        }

        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    // ─── 静的アクションハンドラ ───────────────────────────────────────────────

    static async _onAddScene(_event, target) {
        const phase = target.dataset.phase;
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes") || { opening: [], research: [], climax: [], ending: [] });
        if (!Array.isArray(scenes[phase])) scenes[phase] = [];
        scenes[phase].push(normalizeSceneRow({ id: foundry.utils.randomID(), name: "新規シーン" }));
        this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    static async _onDeleteScene(_event, target) {
        const sceneItem = target.closest('.scene-item');
        const { sceneId, phase } = sceneItem.dataset;
        const confirmed = await DialogV2.confirm({
            window: { title: "シーンの削除" },
            content: "<p>このシーンを削除しますか？</p>",
        });
        if (!confirmed) return;
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        if (scenes[phase]) scenes[phase] = scenes[phase].filter(s => s.id !== sceneId);
        this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    // シーン切替はシナリオコントロールパネル(14-3)へ完全移行した。旧「切替」ボタンは
    // journal の currentState フラグを更新する旧経路で、sessionState と状態が二重化するため
    // 14-3 で即オミット(2026-08-08 承認)。

    static async _onAddTextItem(_event, _target) {
        const texts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        texts.push({ id: foundry.utils.randomID(), title: "新規テキスト", content: "" });
        await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
    }

    static async _onDeleteTextItem(_event, target) {
        const textItemId = target.closest('.text-item').dataset.id;
        const confirmed = await DialogV2.confirm({
            window: { title: "テキストの削除" },
            content: "<p>このテキスト項目を削除しますか？</p>",
        });
        if (!confirmed) return;
        let texts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenarioTexts") || []);
        texts = texts.filter(t => t.id !== textItemId);
        await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", texts);
    }

    static async _onAddInfoItem(_event, _target) {
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        items.push({
            id: foundry.utils.randomID(),
            title: "新規情報",
            isPublic: false,
            contents: [{
                id: foundry.utils.randomID(),
                text: "",
                isDisclosed: false,
                skills: [{ id: foundry.utils.randomID(), name: "", tn: null }],
            }],
        });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteInfoItem(_event, target) {
        const infoItemId = target.dataset.infoId;
        const confirmed = await DialogV2.confirm({
            window: { title: "情報の削除" },
            content: "<p>この情報項目全体を削除しますか？</p>",
        });
        if (!confirmed) return;
        let items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        items = items.filter(i => i.id !== infoItemId);
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onAddInfoContent(_event, target) {
        const infoId = target.dataset.infoId;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;
        if (!Array.isArray(item.contents)) item.contents = [];
        item.contents.push({
            id: foundry.utils.randomID(),
            text: "",
            isDisclosed: false,
            skills: [{ id: foundry.utils.randomID(), name: "", tn: null }],
        });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteInfoContent(_event, target) {
        const { infoId, contentId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;
        item.contents = item.contents.filter(c => c.id !== contentId);
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onAddSkillCheck(_event, target) {
        const { infoId, contentId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents.find(c => c.id === contentId);
        if (!content) return;
        content.skills.push({ id: foundry.utils.randomID(), name: "", tn: null });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteSkillCheck(_event, target) {
        const { infoId, contentId, skillId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents.find(c => c.id === contentId);
        if (!content) return;
        content.skills = content.skills.filter(s => s.id !== skillId);
        if (content.skills.length === 0) content.skills.push({ id: foundry.utils.randomID(), name: "", tn: null });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onAddHandout(_event, _target) {
        const handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
        handouts.push({
            id: foundry.utils.randomID(),
            pcName: `PC${handouts.length + 1}`,
            title: `ハンドアウト ${handouts.length + 1}`,
            connections: "",
            recommendedSuit: "",
            recommendedStyle: "",
            content: "",
            ps: "",
        });
        await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
    }

    static async _onDeleteHandout(_event, target) {
        const id = target.closest('.handout-item').dataset.id;
        const confirmed = await DialogV2.confirm({
            window: { title: "ハンドアウトの削除" },
            content: "<p>このハンドアウトを削除しますか？</p>",
        });
        if (!confirmed) return;
        let handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
        handouts = handouts.filter(h => h.id !== id);
        await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
    }

    // ─── 判定要求・報酬点のプリセット(フェーズ12-5) ────────────────────────────

    /** プリセット配列を取り出す(kind = checkRequests / bountyGrants)。 */
    _presets(kind) {
        return foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", kind) || []);
    }

    static async _onAddCheckRequestPreset(_event, _target) {
        const rows = this._presets("checkRequests");
        rows.push(newCheckRequestPreset());
        await this.document.setFlag("tokyo-nova-axleration", "checkRequests", rows);
    }

    static async _onAddBountyPreset(_event, _target) {
        const rows = this._presets("bountyGrants");
        rows.push(newBountyPreset());
        await this.document.setFlag("tokyo-nova-axleration", "bountyGrants", rows);
    }

    static async _onAddDamageGrantPreset(_event, _target) {
        const rows = this._presets("damageGrants");
        rows.push(newDamageGrantPreset());
        await this.document.setFlag("tokyo-nova-axleration", "damageGrants", rows);
    }

    static async _onAddEffectGrantPreset(_event, _target) {
        const rows = this._presets("effectGrants");
        rows.push(newEffectGrantPreset());
        await this.document.setFlag("tokyo-nova-axleration", "effectGrants", rows);
    }

    /**
     * 効果プリセットの中身を標準の効果シートで組む(2026-07-21)。
     * アクト中に組むには重い作業のため、事前に用意しておけるようにする。
     */
    static async _onEditEffectPreset(_event, target) {
        const rows = this._presets("effectGrants");
        const row  = rows.find(p => p.id === target.dataset.presetId);
        if (!row) return;
        const effect = await promptEffectData(row.effect);
        if (!effect) return;   // 送信せずに閉じた＝取り消し
        row.effect = effect;
        await this.document.setFlag("tokyo-nova-axleration", "effectGrants", rows);
    }

    static async _onDeletePreset(_event, target) {
        const { presetKind, presetId } = target.dataset;
        const rows = this._presets(presetKind).filter(p => p.id !== presetId);
        await this.document.setFlag("tokyo-nova-axleration", presetKind, rows);
    }

    static async _onPresetUp(_event, target)   { await TnxScenarioSheet._movePreset.call(this, target, -1); }
    static async _onPresetDown(_event, target) { await TnxScenarioSheet._movePreset.call(this, target, 1); }

    /** プリセットを手動で並び替える(表・リスト系 UI は既定で並び替え可能=TNX 標準)。 */
    static async _movePreset(target, delta) {
        const { presetKind, presetId } = target.dataset;
        const rows = this._presets(presetKind);
        const i = rows.findIndex(p => p.id === presetId);
        const j = i + delta;
        if (i < 0 || !rows[j]) return;
        [rows[i], rows[j]] = [rows[j], rows[i]];
        await this.document.setFlag("tokyo-nova-axleration", presetKind, rows);
    }

    /** number-input-spinner の ± (変更は change リスナーが保存する)。 */
    static _onPresetSpin(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector("input[type=number]");
        if (!input) return;
        if (target.dataset.action === "presetSpinUp") input.stepUp();
        else input.stepDown();
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /** プリセットの入力欄の変更を保存する。 */
    async _onPresetFieldChange(event) {
        const el = event.currentTarget;
        const { presetKind, presetId } = el.dataset;
        if (!presetKind || !presetId) return;
        const rows = this._presets(presetKind);
        const row = rows.find(p => p.id === presetId);
        if (!row) return;
        row[el.name] = el.type === "checkbox" ? el.checked
            : el.type === "number" ? (Number(el.value) || 0)
            : el.value;
        await this.document.setFlag("tokyo-nova-axleration", presetKind, rows);
    }
}
