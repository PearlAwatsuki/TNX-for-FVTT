import { loadGroupedGeneralSkillChoices, loadGeneralSkillNameByKey, loadSkillChoices, idKeyPrefix, SKILL_PACKS, STYLE_PACK } from '../module/skill-dictionary.mjs';
import { formatSkillName } from '../module/identification.mjs';
import {
    presetLabel, presetSkillKeys, newCheckRequestPreset, newBountyPreset,
    newDamageGrantPreset, newEffectGrantPreset, newScenarioTextPreset,
} from '../module/request-presets.mjs';
import { RL_DAMAGE_TYPES, RL_DAMAGE_CATEGORIES, RL_DAMAGE_MODES } from '../module/rl-grant-logic.mjs';
import { promptEffectData } from '../module/effect-authoring.mjs';
import { describeEffectData } from '../module/effect-source-logic.mjs';
import { captureScrollTop, restoreScrollTop } from '../module/scroll-preserve.mjs';
import { conditionStatusLabels } from '../module/conditions.mjs';
import { checkTypeOptions } from '../module/tnx-rl-request-app.mjs';
import {
    SCENE_AREA_OPTIONS, SCENE_KIND_OPTIONS, SCENE_PLAYER_RULER, HANDOUT_SUIT_OPTIONS,
    HANDOUT_STYLE_COMMON, HANDOUT_STYLE_FREE,
    normalizeSceneRow, normalizeHandoutRow, handoutTitleSuffix, circledNumber, infoSkillKeys,
    sceneSequenceNumbers, handoutPlayerLabel, handoutNumberOf, handoutStyleDisplay, infoTiers,
    CONTACT_TYPES,
} from '../module/session-logic.mjs';
import { normalizeAppearanceActors, groupCharacterChoices } from '../module/appearance-logic.mjs';
import { listSubScenes } from '../module/subscenes.mjs';
import { attachEditorSectionToggles } from '../module/editor-sections.mjs';

const { HandlebarsApplicationMixin, DocumentSheetV2, DialogV2 } = foundry.applications.api;

export class TnxScenarioSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "journal", "scenario", "two-column-layout"],
        // 既定 800 ではシーン表見出し「シーンプレイヤー」が数 px 足りず省略されるため 830。
        // 14-8 で種別列(88px＋gap 6px)を足した分だけ広げ、既存列の幅を元のまま保つ
        position: { width: 924, height: 700 },
        window: { resizable: true },
        actions: {
            addScene:          TnxScenarioSheet._onAddScene,
            deleteScene:       TnxScenarioSheet._onDeleteScene,
            addInfoItem:       TnxScenarioSheet._onAddInfoItem,
            deleteInfoItem:    TnxScenarioSheet._onDeleteInfoItem,
            addInfoContent:    TnxScenarioSheet._onAddInfoContent,
            deleteInfoContent: TnxScenarioSheet._onDeleteInfoContent,
            addInfoTier:       TnxScenarioSheet._onAddInfoTier,
            deleteInfoTier:    TnxScenarioSheet._onDeleteInfoTier,
            addSkillCheck:     TnxScenarioSheet._onAddSkillCheck,
            deleteSkillCheck:  TnxScenarioSheet._onDeleteSkillCheck,
            removeInfoSkill:   TnxScenarioSheet._onRemoveInfoSkill,
            removePresetSkill: TnxScenarioSheet._onRemovePresetSkill,
            clearHandoutContact: TnxScenarioSheet._onClearHandoutContact,
            addHandout:        TnxScenarioSheet._onAddHandout,
            deleteHandout:     TnxScenarioSheet._onDeleteHandout,
            removeAppearanceSkill:      TnxScenarioSheet._onRemoveAppearanceSkill,
            removeAppearanceActor:      TnxScenarioSheet._onRemoveAppearanceActor,
            toggleAppearanceActorHidden: TnxScenarioSheet._onToggleAppearanceActorHidden,
            addTextPreset:         TnxScenarioSheet._onAddTextPreset,
            deleteTextPreset:      TnxScenarioSheet._onDeleteTextPreset,
            addCheckRequestPreset: TnxScenarioSheet._onAddCheckRequestPreset,
            addBountyPreset:       TnxScenarioSheet._onAddBountyPreset,
            addDamageGrantPreset:  TnxScenarioSheet._onAddDamageGrantPreset,
            addEffectGrantPreset:  TnxScenarioSheet._onAddEffectGrantPreset,
            editEffectPreset:      TnxScenarioSheet._onEditEffectPreset,
            deletePreset:          TnxScenarioSheet._onDeletePreset,
            presetUp:              TnxScenarioSheet._onPresetUp,
            presetDown:            TnxScenarioSheet._onPresetDown,
            spinUp:                TnxScenarioSheet._onSpin,
            spinDown:              TnxScenarioSheet._onSpin,
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

        context.phaseLabels = CONFIG.TNX.phaseLabels;
        context.documentName = this.document.name;

        // シーン行は読み出し時に正規化する(14-2 追加フィールドの既定値を補う。一括書き換えはしない)
        const scenesData = flagData.scenes || {};
        const normalizePhase = rows => (Array.isArray(rows) ? rows : []).map(normalizeSceneRow);
        context.scenes = {
            opening:  normalizePhase(scenesData.opening),
            research: normalizePhase(scenesData.research),
            climax:   normalizePhase(scenesData.climax),
            ending:   normalizePhase(scenesData.ending),
        };
        // No. は台本順の自動採番(14-8・手入力を廃止)。上演中の「SCENE n」は実行時のカウンタ
        const seq = sceneSequenceNumbers(context.scenes);
        for (const rows of Object.values(context.scenes)) {
            for (const row of rows) row.seqNumber = seq[row.id] ?? "-";
        }
        // 旧データ(ユーザー参照・自由文字列)のシーンプレイヤー指定は、空選択肢のラベルで示す
        // ——値は保ったまま「何が指定されていたか」を見せ、選び直せば新形式へ移る
        for (const rows of Object.values(context.scenes)) {
            for (const row of rows) {
                if (row.playerHandoutId) continue;
                const legacyUser = row.playerUserId && row.playerUserId !== SCENE_PLAYER_RULER
                    ? game.users.get(row.playerUserId) : null;
                row.legacyPlayerLabel = legacyUser
                    ? (legacyUser.character?.name ?? legacyUser.name)
                    : (row.playerUserId === SCENE_PLAYER_RULER || row.isMasterScene
                        ? "ルーラーシーン" : (row.player ?? ""));
            }
        }
        // シーン行のセレクト選択肢(14-2/14-4): エリア・舞台(サブシーン+通常 Scene)・
        // シーンプレイヤー(User。シーンプレイヤーはプレイヤー側の指定=2026-08-07 裁定)
        context.sceneAreaOptions = SCENE_AREA_OPTIONS;
        // 種別(14-8): 通常/巡回/イベント。巡回はエリア・登場判定・シーンプレイヤーを台本で持たない
        context.sceneKindOptions = SCENE_KIND_OPTIONS;
        context.stageSubSceneOptions = listSubScenes().map(s => ({ value: `subScene:${s.id}`, label: s.name }));
        context.stageSceneOptions = game.scenes.map(s => ({ value: `scene:${s.id}`, label: s.name }));
        // シーンプレイヤー候補＝**ハンドアウト**(2026-08-10 ユーザー指摘)。シナリオの台本は
        // 「SCENE 2：シーンプレイヤー＝HO①」の形で書かれ、担当はプレアクトで決まるため、
        // ユーザーではなくハンドアウトを指す。ラベルは「①スタイル名（キャスト名）」・
        // キャスト未設定なら「①スタイル名」。**共通ハンドアウトは出さない**(全員向けなので
        // シーンプレイヤーになり得ない)。ルーラーシーンは独立した選択肢
        context.scenePlayerRuler = SCENE_PLAYER_RULER;
        context.scenePlayerHandouts = await this._buildScenePlayerHandouts(flagData.handouts);

        // 判定要求・報酬点のプリセット(フェーズ12-5)。名前は未入力なら「判定要求n」を出す
        const skillGroups = await loadGroupedGeneralSkillChoices();
        // 一般技能の辞典グループ(素)＝シーンの指定技能・情報項目の指定技能のプルダウン共用(14-7)。
        // キー→名前の逆引きでチップを表示する(生キーは表示しない)
        context.skillGroupsPlain = skillGroups ?? [];
        const skillNameByKey = await loadGeneralSkillNameByKey();
        const toSkillChips = keys => (keys ?? []).map(key => {
            const dictName = skillNameByKey.get(key);
            return { key, name: dictName ? formatSkillName(dictName) : "（参照切れ）" };
        });
        // 登場キャラクターの事前設定(14-8): 参照は id・表示は現在のアクター名をライブ解決する
        // (名前はキャッシュしない)。目のトグル＝名前を伏せて登場(卓には「？？？」)
        const toActorChips = list => normalizeAppearanceActors(list).map(entry => ({
            actorId:  entry.actorId,
            name:     game.actors.get(entry.actorId)?.name ?? "（参照切れ）",
            hideName: entry.hideName,
        }));
        for (const rows of Object.values(context.scenes)) {
            for (const row of rows) {
                row.appearanceSkillChips = toSkillChips(row.appearanceSkills);
                row.appearanceActorChips = toActorChips(row.appearanceActors);
            }
        }
        // 追加プルダウンの候補=キャラクター4種(type ごとの optgroup・パネルの登場候補と共用の純関数)
        context.appearanceActorGroups = groupCharacterChoices(
            game.actors.map(a => ({ id: a.id, name: a.name, type: a.type })),
            { labelOf: type => game.i18n.localize(`TYPES.Actor.${type}`) });
        // 判定要求プリセットの指定技能は**全技能**(一般＋スタイル＋ワークス)を指せる(2026-08-12)。
        // 逆引きは3辞典まとめて引く(一般技能だけの skillNameByKey では足りない)
        const allSkillNames = await loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
        const toAnySkillChips = keys => (keys ?? []).map(key => ({
            key, name: allSkillNames[key] ? formatSkillName(allSkillNames[key]) : "（参照切れ）",
        }));
        // シナリオテキストも RL プリセットの一員(2026-08-09 にテキストタブから合流)。
        // 名前欄のキーは既存データのまま title
        context.scenarioTexts = (flagData.scenarioTexts || []).map((p, i) => ({
            ...p,
            placeholder: presetLabel({}, i, "テキスト"),
        }));
        context.checkRequestPresets = (flagData.checkRequests || []).map((p, i) => ({
            ...p,
            placeholder: presetLabel({}, i, "判定要求"),
            checkTypes:  checkTypeOptions(p.checkType ?? "skillCheck"),
            skillChips:  toAnySkillChips(presetSkillKeys(p)),
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

        // 情報項目の使用技能(2026-08-09 裁定): **1行＝技能の集合＋共通の目標値**のタグ入力。
        // 選ぶと行の中に積み上がり、目標値の異なる技能は行そのものを足す。自由記述は廃止
        // (コネも辞典格納の運用になったため)。旧い自由記述は「旧: …」のタグで残す
        // (データは書き換えない。外すと消える)
        context.infoItems = (flagData.infoItems || []).map(item => ({
            ...item,
            contents: (item.contents ?? []).map(content => ({
                ...content,
                // 段(追加で判明する内容)は目標値の昇順で表示する(保存順は書き換えない)
                tiers: infoTiers(content),
                skills: (content.skills ?? []).map(skill => {
                    const tags = toSkillChips(infoSkillKeys(skill));
                    return {
                        ...skill,
                        skillTags: tags,
                        legacyName: (!tags.length && skill.name) ? skill.name : "",
                    };
                }),
            })),
        }));
        context.trailer       = flagData.trailer       || "";
        context.handouts      = (flagData.handouts || []).map(normalizeHandoutRow);

        // 閲覧ビューのエンリッチ(16-x): prose-mirror(toggled)の表示側には @UUID コンテンツ
        // リンク等を解決した HTML を流し込む(value=素データは不変・編集は従来どおり)
        const enrichText = (t) => foundry.applications.ux.TextEditor.enrichHTML(t ?? "", { async: true });
        context.enrichedTrailer = await enrichText(context.trailer);
        context.handouts = await Promise.all(context.handouts.map(async (h) => ({
            ...h, enrichedContent: await enrichText(h.content),
        })));
        context.scenarioTexts = await Promise.all(context.scenarioTexts.map(async (p) => ({
            ...p, enrichedContent: await enrichText(p.content),
        })));
        for (const rows of Object.values(context.scenes)) {
            for (const row of rows) row.enrichedSwitchMessage = await enrichText(row.switchMessage);
        }
        context.infoItems = await Promise.all(context.infoItems.map(async (item) => ({
            ...item,
            contents: await Promise.all((item.contents ?? []).map(async (c) => ({
                ...c,
                enrichedText: await enrichText(c.text),
                tiers: await Promise.all((c.tiers ?? []).map(async (t) => ({
                    ...t, enrichedText: await enrichText(t.text),
                }))),
            }))),
        })));
        // コネ(アクトコネクション)は指定方法を選んでから相手を指す(2026-08-13)。受け取りは
        // HO 送信カードのボタンで、そこで技能アイテムを生成/複製する
        // スタイル(指定スタイル)＝スタイル辞典のプルダウン(識別キー保存)。1行目でハンドアウト名の
        // 構成要素を兼ねる(「<スタイル名>用ハンドアウト①」形式・2026-08-09 裁定)
        const styleChoices = await loadSkillChoices([STYLE_PACK]);
        const styleEntries = Object.entries(styleChoices).filter(([key]) => key);
        // PC モードの候補＝他のハンドアウト(シーンプレイヤー欄と同じラベル・共通は除外済み)
        const contactHandouts = await this._buildScenePlayerHandouts(flagData.handouts);
        let handoutNumber = 0;   // スタイル指定行(共通・自由記述以外)の通し番号
        for (const handout of context.handouts) {
            // コネの指定方法とモード別の入力
            handout.connTypes = CONTACT_TYPES.map(o => ({ ...o, selected: o.value === handout.actConnectionType }));
            handout.connIsFree = handout.actConnectionType === "free";
            handout.connIsPc   = handout.actConnectionType === "pc";
            handout.connIsNpc  = handout.actConnectionType === "npc";
            // 自分自身へのコネは意味がないので候補から外す
            handout.connHandouts = contactHandouts
                .filter(o => o.id !== handout.id)
                .map(o => ({ ...o, selected: o.id === handout.actConnectionHandoutId }));
            // NPC: 落とした辞典アイテムの**現在名**をライブ解決する(名前はキャッシュしない)
            handout.connItemName = handout.actConnectionUuid
                ? (fromUuidSync(handout.actConnectionUuid)?.name ?? "（参照切れ）")
                : "";
            // 推奨スート: キー保存のセレクト。キー以外の旧自由テキストは空選択肢のラベルで示す
            handout.suits = HANDOUT_SUIT_OPTIONS.map(o => ({ ...o, selected: o.value === handout.recommendedSuit }));
            handout.legacySuit = (handout.recommendedSuit
                && !HANDOUT_SUIT_OPTIONS.some(o => o.value === handout.recommendedSuit))
                ? handout.recommendedSuit : "";
            // スタイル: キー保存＋特殊値(共通/自由記述)。@ 以外の旧自由テキストは空選択肢のラベルで示す
            handout.isCommon    = handout.recommendedStyle === HANDOUT_STYLE_COMMON;
            handout.isFreeTitle = handout.recommendedStyle === HANDOUT_STYLE_FREE;
            handout.styleOptions = styleEntries.map(([key, name]) => ({
                value: key, label: name, selected: key === handout.recommendedStyle,
            }));
            handout.legacyStyle = (handout.recommendedStyle
                && !handout.recommendedStyle.startsWith("@")
                && !(handout.recommendedStyle in styleChoices))
                ? handout.recommendedStyle : "";
            // ハンドアウト名の自動表示: 番号は前置「①<スタイル名>用ハンドアウト」(2026-08-09 裁定)。
            // 共通・自由記述は番号なし
            if (!handout.isCommon && !handout.isFreeTitle) {
                handoutNumber += 1;
                handout.numberLabel = circledNumber(handoutNumber);
            } else {
                handout.numberLabel = "";
            }
            handout.titleSuffix = handoutTitleSuffix(handout);
            // 対象ユーザー(2026-08-09 裁定=ハンドアウトはユーザーに付与)。旧 actorId は表示フォールバック
            handout.userOptions = game.users.map(u => ({
                id: u.id, name: u.name, selected: u.id === handout.userId,
            }));
            handout.legacyCastName = (!handout.userId && handout.actorId)
                ? (game.actors.get(handout.actorId)?.name ?? "（参照切れ）") : "";
        }

        return context;
    }

    // ─── レンダリング ─────────────────────────────────────────────────────────

    /** @override — 再描画前にスクロール位置と詳細設定の開閉状態を保存する(全再描画方式のため DOM 状態が飛ぶ)。 */
    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this._scrollTop = captureScrollTop(this.element, ".sheet-body");
        this._openSceneDetails = [...(this.element?.querySelectorAll(".scene-item details[open]") ?? [])]
            .map(d => d.closest(".scene-item")?.dataset.sceneId)
            .filter(Boolean);
    }

    _onRender(_context, _options) {
        this._setupChangeListeners();
        // @UUID コンテンツリンクのカード・ツールチップ(16-x): 閲覧ビュー内のリンクに適用
        import("../module/item-card-tooltips.mjs").then(m => m.applyContentLinkCardTooltips(this.element));
        // 長文エリアの編集トグルボタンをセクションヘッダーへ移設(常時視認・共有配線)
        attachEditorSectionToggles(this.element);
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) this.changeTab(tab, group, { force: true });
        }
        // 詳細設定の開閉を復元してからスクロールを戻す(開閉で内容高さが変わるため順序が要る)
        for (const sceneId of this._openSceneDetails ?? []) {
            this.element.querySelector(`.scene-item[data-scene-id="${sceneId}"] details`)
                ?.setAttribute("open", "");
        }
        // 再描画でスクロールが飛ぶのを防ぐ(RL プリセットの入力操作等)
        restoreScrollTop(this.element, ".sheet-body", this._scrollTop);
    }

    // ─── 変更リスナー ─────────────────────────────────────────────────────────

    _setupChangeListeners() {
        const el = this.element;

        // prose-mirror はフォーム要素(name/value)。保存確定は save イベントでも通知されるため
        // change と save の両方を購読する(二重発火しても保存は同値=冪等)
        const bind = (elements, handler) => {
            for (const input of elements) {
                input.addEventListener('change', handler);
                if (input.tagName === 'PROSE-MIRROR') input.addEventListener('save', handler);
            }
        };

        // RL プリセット(シナリオテキスト・判定要求・報酬点・ダメージ・効果)
        bind(el.querySelectorAll('.preset-item [data-preset-kind]'),
            this._onPresetFieldChange.bind(this));

        // 判定要求プリセットの指定技能(タグ入力・複数可): 一般技能はプルダウン、
        // スタイル技能・ワークス専用技能はドロップ(判定要求ダイアログと同じ組み合わせ)
        for (const select of el.querySelectorAll('.preset-skill-add')) {
            select.addEventListener('change', this._onPresetSkillAdd.bind(this));
        }
        for (const zone of el.querySelectorAll('.preset-skill-drop')) {
            zone.addEventListener('dragover', (event) => event.preventDefault());
            zone.addEventListener('drop', this._onPresetSkillDrop.bind(this));
        }

        // コネ(NPC モード)のインポートボックス
        for (const zone of el.querySelectorAll('.handout-conn-drop')) {
            zone.addEventListener('dragover', (event) => event.preventDefault());
            zone.addEventListener('drop', this._onHandoutContactDrop.bind(this));
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

        bind(el.querySelectorAll(
            '.scene-item input:not([data-no-save]), .scene-item select:not([data-no-save]), .scene-item prose-mirror'),
        this._onSceneItemChange.bind(this));

        // 指定技能の追加プルダウン(タグ入力=選ぶこと自体が追加操作。値の保存ではないので
        // data-no-save で上の一括保存から外し、専用ハンドラで処理する)
        for (const select of el.querySelectorAll('.scene-item .appearance-skill-select')) {
            select.addEventListener('change', this._onAppearanceSkillAdd.bind(this));
        }

        // 登場キャラクターの追加プルダウン(14-8・指定技能と同型のタグ入力)
        for (const select of el.querySelectorAll('.scene-item .appearance-actor-select')) {
            select.addEventListener('change', this._onAppearanceActorAdd.bind(this));
        }

        bind(el.querySelectorAll(
            '.info-item input:not([data-no-save]), .info-item select:not([data-no-save]), .info-item prose-mirror'),
        this._onInfoItemChange.bind(this));

        // 使用技能の追加プルダウン(シーンの指定技能と同じタグ入力=選ぶこと自体が追加操作)
        for (const select of el.querySelectorAll('.info-item .info-skill-add')) {
            select.addEventListener('change', this._onInfoSkillAdd.bind(this));
        }
        bind(el.querySelectorAll(
            '.scenario-info-container > .act-name-section input, .scenario-info-container prose-mirror, '
            + '.handout-item input:not([data-no-save]), .handout-item select:not([data-no-save])'),
        this._onScenarioInfoChange.bind(this));
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
        } else if (name === "documentName") {
            // アクトシート名の編集(14-7)。空にはしない
            if (value.trim()) await this.document.update({ name: value.trim() });
        }
    }

    /**
     * 指定技能を追加する(タグ入力の追加プルダウン・FS 判定エディタと同型)。
     * 選択値は読み取り直後に空へ戻す(再描画までの間に同じ値で二重発火しても足さない)。
     */
    async _onAppearanceSkillAdd(event) {
        const select = event.currentTarget;
        const key = select.value;
        select.value = "";
        if (!key) return;
        const sceneItem = select.closest(".scene-item");
        const { sceneId, phase } = sceneItem?.dataset ?? {};
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes?.[phase]?.find(s => s.id === sceneId);
        if (!scene) return;
        const keys = Array.isArray(scene.appearanceSkills) ? scene.appearanceSkills : [];
        if (keys.includes(key)) return;
        scene.appearanceSkills = [...keys, key];
        await this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    /**
     * シーンプレイヤー欄の候補（ハンドアウト）を組む。
     * ラベルは「①スタイル名（キャスト名）」・キャスト未設定なら「①スタイル名」（2026-08-10 指定）。
     * 共通ハンドアウトは全員向けなのでシーンプレイヤーになり得ず、候補から外す。
     * @param {Array<object>} rawHandouts flags.handouts
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async _buildScenePlayerHandouts(rawHandouts) {
        const handouts = (rawHandouts ?? []).map(normalizeHandoutRow);
        const styleChoices = await loadSkillChoices([STYLE_PACK]);
        return handouts
            .filter(h => h.recommendedStyle !== HANDOUT_STYLE_COMMON)
            .map(h => {
                const user = h.userId ? game.users.get(h.userId) : null;
                return {
                    id: h.id,
                    label: handoutPlayerLabel(h, {
                        number:    handoutNumberOf(handouts, h.id),
                        styleName: handoutStyleDisplay(h.recommendedStyle, styleChoices),
                        castName:  user?.character?.name ?? "",
                    }),
                };
            });
    }

    async _onSceneItemChange(event) {
        const input = event.currentTarget;
        const sceneItem = input.closest('.scene-item');
        const sceneId = sceneItem.dataset.sceneId;
        const phase = sceneItem.dataset.phase;

        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes[phase]?.find(s => s.id === sceneId);
        if (!scene) return;

        scene[input.name] = input.type === 'checkbox' ? input.checked
            : input.type === 'number' ? (Number.isFinite(parseInt(input.value)) ? parseInt(input.value) : null)
            : input.value;
        await this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    async _onInfoItemChange(event) {
        const input = event.currentTarget;
        const { infoId, contentId, skillId, tierId } = input.dataset;
        const value = input.type === "checkbox" ? input.checked
            : input.type === "number" ? parseInt(input.value)
            : input.value;

        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const item = items.find(i => i.id === infoId);
        if (!item) return;

        if (contentId && tierId) {
            // 段の目標値・本文(技能行と同じ name を使うため、段の判定を先に置く)
            const tier = item.contents.find(c => c.id === contentId)?.tiers?.find(t => t.id === tierId);
            if (tier) tier[input.name] = value;
        } else if (contentId && skillId) {
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

    // ─── シーンの登場設定・アクトコネクション(14-7) ───────────────────────────

    /** number-input-spinner の ±(シート内共通。変更は各 change リスナーが保存する)。 */
    static _onSpin(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector("input[type=number]");
        if (!input) return;
        if (target.dataset.action === "spinUp") input.stepUp();
        else input.stepDown();
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /**
     * シーン行の登場キャラクター指定を書き換える(追加・除去・名前非公開の切替で共用・14-8)。
     * @param {HTMLElement} target 行内の要素(シーン行の特定に使う)
     * @param {(list: Array<{actorId: string, hideName: boolean}>) => ?Array<object>} mutate
     *        変更後の配列。null を返すと書き込まない(変化なしの空振りを避ける)
     */
    async _updateAppearanceActors(target, mutate) {
        const sceneItem = target.closest(".scene-item");
        const { sceneId, phase } = sceneItem?.dataset ?? {};
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes?.[phase]?.find(s => s.id === sceneId);
        if (!scene) return;
        const next = mutate(normalizeAppearanceActors(scene.appearanceActors));
        if (!next) return;
        scene.appearanceActors = next;
        await this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    /** 登場キャラクターを追加する(指定技能と同じタグ入力=選ぶこと自体が追加操作)。 */
    async _onAppearanceActorAdd(event) {
        const select = event.currentTarget;
        const actorId = select.value;
        select.value = "";
        if (!actorId) return;
        await this._updateAppearanceActors(select, list => (list.some(e => e.actorId === actorId)
            ? null
            : [...list, { actorId, hideName: false }]));
    }

    /** 登場キャラクターの指定を外す。 */
    static async _onRemoveAppearanceActor(_event, target) {
        const actorId = target.dataset.actorId;
        await this._updateAppearanceActors(target,
            list => list.filter(e => e.actorId !== actorId));
    }

    /** そのキャラクターを名前を伏せて登場させるかを切り替える。 */
    static async _onToggleAppearanceActorHidden(_event, target) {
        const actorId = target.dataset.actorId;
        await this._updateAppearanceActors(target,
            list => list.map(e => (e.actorId === actorId ? { ...e, hideName: !e.hideName } : e)));
    }

    /** 指定技能を外す。 */
    static async _onRemoveAppearanceSkill(_event, target) {
        const sceneItem = target.closest(".scene-item");
        const { sceneId, phase } = sceneItem?.dataset ?? {};
        const key = target.dataset.key;
        const scenes = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "scenes"));
        const scene = scenes?.[phase]?.find(s => s.id === sceneId);
        if (!scene) return;
        scene.appearanceSkills = (scene.appearanceSkills ?? []).filter(k => k !== key);
        await this.document.setFlag("tokyo-nova-axleration", "scenes", scenes);
    }

    // コネ(アクトコネクション)は必ず一つ(2026-08-09 裁定)＝name="actConnection" の単一セレクト。
    // 保存は他のハンドアウト欄と同じ汎用ハンドラ(_onScenarioInfoChange)が担う

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
                skills: [{ id: foundry.utils.randomID(), identificationKeys: [], tn: null }],
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
            skills: [{ id: foundry.utils.randomID(), identificationKeys: [], tn: null }],
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

    /**
     * 段(追加で判明する内容)を足す(2026-08-12 裁定)。
     * 同じ入口(＝この内容の使用技能)のまま目標値が上がると増える情報を表す。
     * 要求技能が違う場合はここではなく「情報の内容を追加」で枝そのものを分ける。
     */
    static async _onAddInfoTier(_event, target) {
        const { infoId, contentId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents?.find(c => c.id === contentId);
        if (!content) return;
        if (!Array.isArray(content.tiers)) content.tiers = [];
        content.tiers.push({ id: foundry.utils.randomID(), tn: null, text: "", isDisclosed: false });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    /** 段を削除する(内容ブロック・技能行の削除と同じく確認なし。確認は情報項目全体のみ)。 */
    static async _onDeleteInfoTier(_event, target) {
        const { infoId, contentId, tierId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents?.find(c => c.id === contentId);
        if (!content) return;
        content.tiers = (content.tiers ?? []).filter(t => t.id !== tierId);
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    /** 情報項目の技能行(infoId/contentId/skillId)を取り出す。 */
    _infoSkillRow(items, { infoId, contentId, skillId }) {
        return items.find(i => i.id === infoId)?.contents?.find(c => c.id === contentId)
            ?.skills?.find(s => s.id === skillId) ?? null;
    }

    /**
     * 情報項目の使用技能を行に足す(タグ入力の追加プルダウン・シーンの指定技能と同型)。
     * 1行＝技能の集合＋共通の目標値。目標値の異なる技能は行そのものを足す。
     */
    async _onInfoSkillAdd(event) {
        const select = event.currentTarget;
        const key = select.value;
        select.value = "";
        if (!key) return;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const row = this._infoSkillRow(items, select.dataset);
        if (!row) return;
        const keys = infoSkillKeys(row);
        if (keys.includes(key)) return;
        row.identificationKeys = [...keys, key];
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    /**
     * コネ(NPC モード)に辞典のコネ技能をドロップして設定する(2026-08-13)。
     * 参照(uuid)で保存し、表示名は都度ライブ解決する。コネ技能以外は理由を出して弾く。
     */
    async _onHandoutContactDrop(event) {
        event.preventDefault();
        // currentTarget は await をまたぐと null になるので先に読む
        const handoutId = event.currentTarget?.dataset.id;
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid || !handoutId) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (doc?.type !== "generalSkill") {
            ui.notifications.warn("コネ技能をドロップしてください。");
            return;
        }
        if (idKeyPrefix(doc.system?.identificationKey) !== "contact") {
            ui.notifications.warn(`${doc.name} はコネ技能ではありません（識別キーが contact_ で始まる技能を落としてください）。`);
            return;
        }
        await this._updateHandoutRow(handoutId, { actConnectionUuid: doc.uuid });
    }

    /** コネ(NPC モード)の指定を外す。 */
    static async _onClearHandoutContact(_event, target) {
        await this._updateHandoutRow(target.dataset.id, { actConnectionUuid: "" });
    }

    /** ハンドアウト行の一部を書き換える(コネのモード別入力など、フォーム送信を経ない更新)。 */
    async _updateHandoutRow(handoutId, patch) {
        const handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
        const row = handouts.find(h => h.id === handoutId);
        if (!row) return;
        Object.assign(row, patch);
        await this.document.setFlag("tokyo-nova-axleration", "handouts", handouts);
    }

    /** 判定要求プリセットの行を取り出す。 */
    _checkRequestPreset(presets, presetId) {
        return presets.find(p => p.id === presetId) ?? null;
    }

    /**
     * 判定要求プリセットの指定技能を足す(2026-08-12・複数可)。
     * 旧形式(単数 identificationKey)の行は、足した時点で配列へ移る(一括書き換えはしない)。
     */
    async _setPresetSkillKeys(presetId, update) {
        const presets = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "checkRequests") || []);
        const preset = this._checkRequestPreset(presets, presetId);
        if (!preset) return;
        const next = update(presetSkillKeys(preset));
        if (!next) return;
        preset.identificationKeys = next;
        delete preset.identificationKey;   // 配列へ移った行に旧単数を残さない
        await this.document.setFlag("tokyo-nova-axleration", "checkRequests", presets);
    }

    /** 判定要求プリセットの指定技能をプルダウンから足す(一般技能)。 */
    async _onPresetSkillAdd(event) {
        const select = event.currentTarget;
        const key = select.value;
        select.value = "";
        if (!key) return;
        await this._setPresetSkillKeys(select.dataset.presetId,
            keys => (keys.includes(key) ? null : [...keys, key]));
    }

    /** 判定要求プリセットの指定技能をドロップから足す(スタイル技能・ワークス専用技能も)。 */
    async _onPresetSkillDrop(event) {
        event.preventDefault();
        // currentTarget は await をまたぐと null になる(ディスパッチ終了で外れる)。先に読む
        const presetId = event.currentTarget?.dataset.presetId;
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid || !presetId) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || (doc.type !== "generalSkill" && doc.type !== "styleSkill")) {
            ui.notifications.warn("技能をドロップしてください。");
            return;
        }
        const key = doc.system?.identificationKey;
        if (!key) {
            ui.notifications.warn(`${doc.name} に識別キーが設定されていないため指定できません。`);
            return;
        }
        await this._setPresetSkillKeys(presetId, keys => (keys.includes(key) ? null : [...keys, key]));
    }

    /** 判定要求プリセットの指定技能を外す。 */
    static async _onRemovePresetSkill(_event, target) {
        const { presetId, key } = target.dataset;
        await this._setPresetSkillKeys(presetId, keys => keys.filter(k => k !== key));
    }

    /** 情報項目の使用技能を行から外す(キー無し＝旧い自由記述のタグを消す)。 */
    static async _onRemoveInfoSkill(_event, target) {
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const row = this._infoSkillRow(items, target.dataset);
        if (!row) return;
        const key = target.dataset.key;
        if (key) row.identificationKeys = infoSkillKeys(row).filter(k => k !== key);
        else row.name = "";
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onAddSkillCheck(_event, target) {
        const { infoId, contentId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents.find(c => c.id === contentId);
        if (!content) return;
        content.skills.push({ id: foundry.utils.randomID(), identificationKeys: [], tn: null });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onDeleteSkillCheck(_event, target) {
        const { infoId, contentId, skillId } = target.dataset;
        const items = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "infoItems") || []);
        const content = items.find(i => i.id === infoId)?.contents.find(c => c.id === contentId);
        if (!content) return;
        content.skills = content.skills.filter(s => s.id !== skillId);
        if (content.skills.length === 0) content.skills.push({ id: foundry.utils.randomID(), identificationKeys: [], tn: null });
        await this.document.setFlag("tokyo-nova-axleration", "infoItems", items);
    }

    static async _onAddHandout(_event, _target) {
        const handouts = foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", "handouts") || []);
        // 名前は「<スタイル名>用ハンドアウト①」形式の自動表示(2026-08-09 裁定)。title は自由記述用
        handouts.push({
            id: foundry.utils.randomID(),
            title: "",
            recommendedSuit: "",
            recommendedStyle: "",
            content: "",
            ps: "",
            userId: "",
            actConnection: "",
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

    // ─── RL プリセット(フェーズ12-5。14-8 でシナリオテキストも合流) ─────────────

    /** プリセット配列を取り出す(kind = 保存先のフラグキー。scenarioTexts / checkRequests など)。 */
    _presets(kind) {
        return foundry.utils.deepClone(this.document.getFlag("tokyo-nova-axleration", kind) || []);
    }

    static async _onAddTextPreset(_event, _target) {
        const rows = this._presets("scenarioTexts");
        rows.push(newScenarioTextPreset());
        await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", rows);
    }

    /**
     * シナリオテキストの削除だけは確認を挟む(他のプリセットは設定値だが、
     * ここで消えるのは書き溜めた本文そのもののため)。
     */
    static async _onDeleteTextPreset(_event, target) {
        const confirmed = await DialogV2.confirm({
            window: { title: "テキストの削除" },
            content: "<p>このテキスト項目を削除しますか？</p>",
        });
        if (!confirmed) return;
        const rows = this._presets("scenarioTexts").filter(p => p.id !== target.dataset.presetId);
        await this.document.setFlag("tokyo-nova-axleration", "scenarioTexts", rows);
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
