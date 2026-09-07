/**
 * @fileoverview シナリオコントロールパネル(フェーズ14-3・正本 Phase_14_Tasks_Detail.md)。
 *
 * シーンコントロールバーから開く「上演の操作盤」。アクトシートは台本の編集専用で、
 * 実行系(アクトの読み込み/開始/終了・シーン切替・トレーラー/ハンドアウト/テキスト送信・
 * 情報公開)はすべて本パネルに集約する(2026-08-07〜08 ユーザー裁定)。
 *
 * - **設定の読み込みは必ずアクトシートから・手動設定なし**(FS判定パネルとの違い)。
 * - **読み込みと開始は別**(2026-08-08 裁定): 読み込み=参照セットのみ。プレアクトの配布は
 *   読み込み状態で行い、開始で自動設定(報酬点/CS)→先頭シーンへ入る。
 * - 全員に表示(現在シーン・フェイズ・シーンカードの参照)・操作は RL のみ。
 * - 実行状態の正本はワールド設定 sessionState(session-state.mjs)。このパネルはその読み書き UI。
 * - **レイアウトは固定ヘッダ+使用頻度別タブ**(2026-08-15 ユーザー承認): 現在シーンの表示は
 *   常に見える固定ヘッダ、開始後の RL 操作は 進行(毎シーン)/キャスト(シーン切替時)/
 *   アクト(セッション1回) の3タブ。タブと折りたたみの状態はクライアント設定に永続化する。
 */

import {
    getSessionState, getActiveActJournal, getCurrentSceneRow, getCurrentSceneCard, isRulerScene,
    listActJournals, loadAct, startAct, switchScene, endAct,
    createTeam, joinTeam, leaveTeam, deleteTeam, renameTeam,
    getBackstage, buildBackstageQueue, currentSceneHasBackstage, canAdvanceScene,
    closeSceneToBackstage, advanceBackstageSpot, addBackstageActor, removeBackstageActor,
    appearActor, setActorNameHidden, setActorGhost,
    getCurrentSceneAppearance, getRotationStatus, markEventSceneDone, promptActLimitedCleanup,
} from "../module/session-state.mjs";
import {
    isAppearing, isNameHidden, displayActorName, listAppearingActors,
    manualExitTargets, confirmTeamExitDialog, applyManualExit,
} from "../module/appearance-state.mjs";
import { SYSTEM_ID } from "../constants.mjs";
import { TnxSocketHandler } from "../module/tnx-socket-handler.mjs";
import { enrichText, enrichInfoCardData } from "../module/reference-links.mjs";
import {
    SCENE_AREA_OPTIONS, PHASE_ORDER, normalizeSceneRow, normalizeHandoutRow,
    nextSceneTarget, canShowNextScene, eventSceneCandidates, areEventScenesDone,
    sceneSequenceNumbers,
    buildSceneSwitchCardData, buildTrailerCardData, buildScenarioTextCardData,
    buildHandoutCardData, buildInfoCardData,
    withResolvedInfoSkillNames, handoutDisplayTitle, handoutNumberOf, handoutStyleDisplay,
    infoSkillGroups, infoValueLabel, toggleInfoDisclosure,
} from "../rules/session.mjs";
import {
    loadGeneralSkillNameByKey, loadSkillChoices, formatGroupedSkillNames, STYLE_PACK,
} from "../module/skill-dictionary.mjs";
import {
    appearanceCheckParams, formatAppearanceSummary, groupCharacterChoices,
} from "../rules/appearance.mjs";
import { presetLabel } from "../module/request-presets.mjs";

import { TnxActionHandler } from "../module/tnx-action-handler.mjs";
import { applyStageRef } from "../module/subscenes.mjs";
import { resolveHandoutContact } from "../module/handout-contact.mjs";
import { collectLostCharacters } from "../rules/time-boundary.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;


/**
 * 送信カードの描画(2026-08-15)。パネルから送るチャットは4種とも判定要求カードの骨格を
 * 踏襲した専用テンプレートで、組み立ては session-logic の純関数が返す描画コンテキストに載る。
 * @param {string} name templates/chat/ のファイル名(拡張子なし)
 * @param {object} data 描画コンテキスト
 * @returns {Promise<string>} HTML
 */
async function renderChatCard(name, data) {
    // リッチテキスト欄のエンリッチ(16-x): @UUID コンテンツリンク等をカード種別ごとの
    // 本文フィールドで解決する(ラベル等の非リッチ欄は触らない)
    const d = { ...data };
    if (name === "text-card") d.content = await enrichText(d.content);
    if (name === "handout-card") {
        d.content = await enrichText(d.content);
        if (d.ps) d.ps = await enrichText(d.ps);
    }
    if (name === "scene-switch-card" && d.message) d.message = await enrichText(d.message);
    if (name === "info-card") return foundry.applications.handlebars.renderTemplate(
        `systems/tokyo-nova-axleration/templates/chat/${name}.hbs`, await enrichInfoCardData(d));
    return foundry.applications.handlebars.renderTemplate(
        `systems/tokyo-nova-axleration/templates/chat/${name}.hbs`, d);
}

/**
 * シーン行の「シーンプレイヤー」の表示解決(パネルの現在シーン表示と切替チャットで共用)。
 * ルーラーシーン(判定は session-state の共通述語)はプレイヤー不在＝ラベルなし。
 * 表示名は**キャスト名**(2026-08-09 ユーザー指示)＝そのユーザーの担当キャラクター。担当が
 * 未設定ならユーザー名、旧自由文字列 `player` を最後のフォールバックにする。
 * @param {object} row 正規化済みシーン行
 * @returns {{rulerScene: boolean, playerLabel: string}}
 */
function resolveScenePlayer(row) {
    // シーンプレイヤーの選択は実行状態が持つ(14-8)。台本に書いてある行はその値が写されており、
    // 巡回シーンは入場ダイアログで決まった値が入る＝行からは導けない
    const userId = getSessionState().scenePlayerUserId;
    if (isRulerScene(row, userId)) return { rulerScene: true, playerLabel: "" };
    const playerUser = userId ? game.users.get(userId) : null;
    return {
        rulerScene: false,
        playerLabel: playerUser?.character?.name ?? playerUser?.name ?? row?.player ?? "",
    };
}

export class TnxScenarioPanel extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-scenario-panel",
        classes: ["tokyo-nova", "tnx-scenario-panel-app"],
        window: { title: "シナリオコントロール", resizable: true },
        position: { width: 420, height: "auto" },
        actions: {
            loadAct:             TnxScenarioPanel._onLoadAct,
            startAct:            TnxScenarioPanel._onStartAct,
            endAct:              TnxScenarioPanel._onEndAct,
            switchScene:         TnxScenarioPanel._onSwitchScene,
            nextScene:           TnxScenarioPanel._onNextScene,
            launchEvent:         TnxScenarioPanel._onLaunchEvent,
            goClimax:            TnxScenarioPanel._onGoClimax,
            closeScene:          TnxScenarioPanel._onCloseScene,
            backstageNext:       TnxScenarioPanel._onBackstageNext,
            backstageAdd:        TnxScenarioPanel._onBackstageAdd,
            backstageRemove:     TnxScenarioPanel._onBackstageRemove,
            sendTrailer:         TnxScenarioPanel._onSendTrailer,
            sendHandout:         TnxScenarioPanel._onSendHandout,
            sendText:            TnxScenarioPanel._onSendText,
            sendInfo:            TnxScenarioPanel._onSendInfo,
            toggleInfoPublic:    TnxScenarioPanel._onToggleInfoPublic,
            toggleInfoDisclosed: TnxScenarioPanel._onToggleInfoDisclosed,
            appearanceCheck:     TnxScenarioPanel._onAppearanceCheck,
            appearActor:         TnxScenarioPanel._onAppearActor,
            exitActor:           TnxScenarioPanel._onExitActor,
            toggleAppearHidden:  TnxScenarioPanel._onToggleAppearHidden,
            toggleAppearGhost:   TnxScenarioPanel._onToggleAppearGhost,
            toggleNewHideName:   TnxScenarioPanel._onToggleNewHideName,
            toggleNewGhost:      TnxScenarioPanel._onToggleNewGhost,
            teamCreate:          TnxScenarioPanel._onTeamCreate,
            teamJoin:            TnxScenarioPanel._onTeamJoin,
            teamLeave:           TnxScenarioPanel._onTeamLeave,
            teamDelete:          TnxScenarioPanel._onTeamDelete,
            teamAddMember:       TnxScenarioPanel._onTeamAddMember,
            teamRemoveMember:    TnxScenarioPanel._onTeamRemoveMember,
            toggleSceneList:     TnxScenarioPanel._onToggleSceneList,
            toggleRotation:      TnxScenarioPanel._onToggleRotation,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/scenario-panel.hbs" },
    };

    /** 本文(.scp-body)のスクロール位置(再描画をまたいで保持)。 */
    _scrollPositions = {};

    /**
     * 再描画前にスクロール位置を控える。PARTS の scrollable 宣言はレイアウト確定前に復元が
     * 走って 0 に丸まる(隔離実機で実測)ため、シート基底と同じ rAF 復元の手動機構を使う。
     */
    async _preRender(context, options) {
        await super._preRender(context, options);
        if (!this.element) return;
        this._scrollPositions = {};
        const body = this.element.querySelector(".scp-body");
        if (body) this._scrollPositions[".scp-body"] = body.scrollTop;
    }

    /** タブ状態(既定=進行)。最後に開いたタブはクライアント設定で次回起動に引き継ぐ。 */
    tabGroups = { primary: game.settings.get(SYSTEM_ID, "scenarioPanelTab") || "flow" };

    /**
     * タブ切替。コア V13 の changeTab は nav に `.tabs` クラスを要求しコア CSS と競合するため、
     * アクト(シナリオ)シートと同じく独自実装で置き換える。切り替えたタブは設定に保存する。
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
        if (game.settings.get(SYSTEM_ID, "scenarioPanelTab") !== tab) {
            game.settings.set(SYSTEM_ID, "scenarioPanelTab", tab);
        }
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const st = getSessionState();
        const journal = getActiveActJournal();

        context.isGM = game.user.isGM;
        context.loaded = !!journal;
        context.actStarted = st.actStarted;
        context.actName = journal?.name ?? "";
        context.actOptions = listActJournals().map(j => ({
            id: j.id, name: j.name, selected: j.id === st.actId,
        }));

        // 現在シーン(全員向け表示)。上演中に卓が見る値=シーンプレイヤー・登場判定の目標値・
        // 指定技能(2026-08-09 ユーザー指示)。技能名の逆引きは辞典キャッシュ経由で全員分行う
        const skillNameByKey = await loadGeneralSkillNameByKey();
        context.scene = null;
        context.phaseLabel = CONFIG.TNX.phaseLabels[st.phase] ?? "";
        const current = getCurrentSceneRow();
        if (st.actStarted && current) {
            const row = current.row;
            // ルーラーシーン=シーンプレイヤー不在(2026-08-08 裁定)。「ルーラーシーン」とだけ表示する
            const { rulerScene, playerLabel } = resolveScenePlayer(row);
            // 登場設定は行＋実行時の上書きの合成(14-8)を通す＝巡回シーン・「未設定」の行では
            // シーン開始ダイアログで決めた値がここに乗る。目標値は登場判定と同じ算出
            // (appearanceCheckParams)を使う=表示と判定の二重定義を作らない。アクター依存の
            // 引数(危険値)は渡さない＝シーン設定だけで決まる部分を出す
            const sceneAppearance = getCurrentSceneAppearance();
            const appearance = appearanceCheckParams({
                area: sceneAppearance.area, mode: sceneAppearance.mode,
                fixedValue: sceneAppearance.fixedValue,
            });
            context.scene = {
                // 上演中のシーン番号＝実行時のカウンタ(巡回シーンで同じ行に何度も入るため)
                number: st.sceneNumber || "??",
                name: row.name || "無題のシーン",
                areaLabel: SCENE_AREA_OPTIONS
                    .find(o => o.value === sceneAppearance.area && o.value !== "")?.label ?? "",
                rulerScene,
                playerLabel,
                appearanceLabel: formatAppearanceSummary({
                    mode: sceneAppearance.mode,
                    targetValue: appearance.targetValue,
                    skillNames: formatGroupedSkillNames(sceneAppearance.skills, skillNameByKey),
                }),
            };
        }

        // 現在のシーンカード(全員向け表示)。キーワード(faces[0].text)・暗示(description)は
        // ワールドデータ由来のリッチテキストなので、チャットカードと同じく enrichHTML して
        // **HTML として描画**する(テンプレートは {{{ }}}・2026-08-08 ユーザー指摘で是正)
        const card = await getCurrentSceneCard();
        context.sceneCard = card ? {
            // ニューロカード名は逆位置の英語名を反転させる span 等の装飾を含む(tnx-neuro-cards の
            // カード定義)。チャットカードと同じく**HTML として描画**する(テンプレートは {{{ }}})
            name: card.name,
            nameText: String(card.name ?? "").replace(/<[^>]*>/g, ""),   // img alt 用の素テキスト
            img: card.currentFace?.img ?? card.faces?.[0]?.img ?? card.img,
            keyword: await foundry.applications.ux.TextEditor.enrichHTML(card.faces?.[0]?.text ?? ""),
            implication: await foundry.applications.ux.TextEditor.enrichHTML(card.description ?? ""),
        } : null;

        // 登場中の一覧(全員向け・14-5)と登場判定ボタン(PL・非登場の担当キャラクターがいるとき)。
        // 名前を伏せて登場しているキャラクターは卓に「？？？」と見せる(14-8)。RL には実名と
        // 伏せている印を出し、退場・名前の付け替えもここから行う
        const appearing = st.actStarted ? listAppearingActors() : [];
        context.appearing = appearing.map(a => ({
            id: a.id, name: displayActorName(a), hidden: isNameHidden(a),
            // ゴーストトグル(2026-08-22 ユーザー指示・名前非公開と同じ操作系)。
            // isGhost フィールドを持たない種別(トループ等)にはトグルを出さない
            ghost: a.system?.isGhost === true,
            canGhost: a.system?.isGhost !== undefined,
        }));
        const appearingIds = new Set(appearing.map(a => a.id));
        // RL の手動登場(14-8): 候補=まだ登場していないキャラクター4種(キャストも含む)。
        // RL は登場判定を経ずに誰でも登場させられる(2026-08-09 ユーザー裁定)
        context.appearCandidateGroups = (game.user.isGM && st.actStarted)
            ? groupCharacterChoices(
                game.actors.map(a => ({
                    id: a.id, name: a.name, type: a.type, appearing: appearingIds.has(a.id),
                })),
                { labelOf: type => game.i18n.localize(`TYPES.Actor.${type}`), excludeAppearing: true })
            : [];
        const myCharacter = game.user.character ?? null;
        context.canAppearanceCheck = !game.user.isGM && st.actStarted
            && !!myCharacter && !isAppearing(myCharacter);

        // チーム(全員向け・宣言はいつでも可=読み込みがあれば表示)。PL=自分のキャラクターの
        // 参加/離脱・RL=編成(メンバー追加/除去・改名・解散)。チーム経由の登場/退場は
        // 2026-08-22 裁定でオミット=登場の適用は RL の操作に一本化。
        // 編成候補=キャスト+ゲスト(チームにはゲストも入れられる・2026-08-08 ユーザー裁定)
        const teamCandidates = game.actors.filter(a => a.type === "cast" || a.type === "guest");
        context.teams = (journal ? st.teams : []).map(team => {
            const memberIds = team.memberActorIds ?? [];
            // メンバー名も登場中一覧と同じ解決を通す(隣で実名が出ていたら伏せる意味がない)
            const members = memberIds
                .map(id => game.actors.get(id))
                .filter(a => a)
                .map(a => ({ id: a.id, name: displayActorName(a), appearing: appearingIds.has(a.id) }));
            const isMember = !!myCharacter && memberIds.includes(myCharacter.id);
            // 「チームで登場/退場」は 2026-08-22 のユーザー裁定でオミット——チーム経由の自動登場は
            // 行わず、登場の適用は RL の操作(手動登場・登場判定の成功)に一本化する
            return {
                id: team.id,
                name: team.name || "チーム",
                members,
                addCandidates: game.user.isGM
                    ? teamCandidates.filter(a => !memberIds.includes(a.id)).map(a => ({ id: a.id, name: a.name }))
                    : [],
                canJoin:   !!myCharacter && !isMember,
                canLeave:  isMember,
            };
        });

        if (!journal || !game.user.isGM) return context;

        // シーン一覧(フェイズ別・現在行ハイライト)と「次のシーンへ」(基本操作・台本順で送る)
        const scenes = journal.getFlag(SYSTEM_ID, "scenes") ?? {};
        // 舞台裏(14-6): リサーチシーンでは「シーンを閉じる」→ 舞台裏を回しきるまで
        // 「次のシーンへ」を出さない(2026-08-08 ユーザー指示)
        const bs = getBackstage();
        const bsQueue = buildBackstageQueue();
        context.canCloseScene = currentSceneHasBackstage() && !bs.open;
        context.backstage = (st.actStarted && bs.open) ? {
            queue: bsQueue.map(a => ({
                ...a,
                isSpot: a.id === bs.spotActorId,
                isExtra: (bs.extraActorIds ?? []).includes(a.id),
            })),
            spotName: bsQueue.find(a => a.id === bs.spotActorId)?.name ?? "",
            finished: canAdvanceScene(),
            addCandidates: game.actors
                .filter(a => (a.type === "cast" || a.type === "guest")
                    && !bsQueue.some(q => q.id === a.id))
                .map(a => ({ id: a.id, name: a.name })),
        } : null;

        // 「次のシーンへ」(14-8): 巡回シーンにいる間は同じ行へ再入場＝シーンプレイヤーが次の人へ。
        // イベントシーンの次がイベントシーンのときは出さない(起動条件を踏んでいないイベントへ
        // 順送りで入ってしまうため)。舞台裏の順序制約は従来どおり先に効く
        const next = st.actStarted ? nextSceneTarget(scenes, st.sceneId, st.doneEventSceneIds) : null;
        const rotating = current?.row.kind === "rotation";
        context.nextScene = (next && canAdvanceScene()
            && canShowNextScene(scenes, st.sceneId, st.doneEventSceneIds))
            ? {
                name: normalizeSceneRow(next.row).name || "無題のシーン",
                rotating,
            }
            : null;

        // 「イベントシーンを起動する」(14-8): 巡回/イベントシーンにいる間、次の巡回シーン
        // (またはフェイズの切れ目)までの未実行イベントがあれば出す
        const eventCandidates = st.actStarted
            ? eventSceneCandidates(scenes, st.sceneId, st.doneEventSceneIds) : [];
        context.canLaunchEvent = canAdvanceScene() && eventCandidates.length > 0;

        // 「クライマックスへ」(14-8): リサーチのイベントが全て実行済みになったら出す。
        // 踏まれなかったイベントは選択ダイアログの「起動せず実行済みにする」で消化できる
        context.canGoClimax = st.actStarted && st.phase === "research" && canAdvanceScene()
            && areEventScenesDone(scenes, st.doneEventSceneIds)
            && (Array.isArray(scenes.climax) ? scenes.climax.length > 0 : false);

        // 巡回の消化状況(ハンドアウト順・務めた人と次の既定)＝「なるべく務めていない人に回す」判断の材料
        context.rotation = rotating ? getRotationStatus() : null;
        // 折りたたみ状態(2026-08-15 タブ再構成): 巡回・シーン一覧は毎シーンの操作ではないので
        // 既定で畳み、開閉はクライアント設定に永続化する
        context.rotationOpen  = game.settings.get(SYSTEM_ID, "scenarioPanelRotationOpen");
        context.sceneListOpen = game.settings.get(SYSTEM_ID, "scenarioPanelSceneListOpen");
        // 一覧の番号は台本順の自動採番(14-8・手入力を廃止)
        const seq = sceneSequenceNumbers(scenes);
        context.sceneGroups = PHASE_ORDER.map(phase => ({
            phaseLabel: CONFIG.TNX.phaseLabels[phase],
            rows: (Array.isArray(scenes[phase]) ? scenes[phase] : []).map(normalizeSceneRow).map(row => ({
                id: row.id,
                number: seq[row.id] ?? "-",
                name: row.name || "無題のシーン",
                isCurrent: row.id === st.sceneId,
            })),
        }));

        // 送信系(読み込みがあれば開始前でも使用可=プレアクトの配布)。
        // 表示名は「①<スタイル名>用ハンドアウト」形式の自動生成・ラベルは対象ユーザー(2026-08-09 裁定)
        const styleChoices = await loadSkillChoices([STYLE_PACK]);
        const handoutRows = (journal.getFlag(SYSTEM_ID, "handouts") ?? []).map(normalizeHandoutRow);
        context.handouts = handoutRows.map(h => ({
            id: h.id,
            title: handoutDisplayTitle(h, {
                number: handoutNumberOf(handoutRows, h.id),
                styleName: handoutStyleDisplay(h.recommendedStyle, styleChoices),
            }),
            castLabel: (h.userId ? game.users.get(h.userId)?.name : null)
                ?? (h.actorId ? game.actors.get(h.actorId)?.name : null) ?? "",
        }));
        // 名前が未入力のテキストはアクトシートと同じ「テキストn」で並べる(全部「テキスト」に
        // なると送信先を選べないため)
        context.texts = (journal.getFlag(SYSTEM_ID, "scenarioTexts") ?? []).map((t, i) => ({
            id: t.id, title: presetLabel(t, i, "テキスト"),
        }));
        // 技能行の識別キーは辞典逆引きの現在名で表示する(14-7・生キー/空欄を出さない)。
        // 並びは **指定技能が見出し・その下に目標値が同列**(2026-08-15 ユーザー指示):
        // 目標値どうしに上下関係は無いので、入口と段を区別せず 1 つの並びとして出す
        context.infoItems = (journal.getFlag(SYSTEM_ID, "infoItems") ?? [])
            .map(item => withResolvedInfoSkillNames(item, skillNameByKey))
            .map(item => ({
                id: item.id,
                title: item.title || "情報",
                isPublic: item.isPublic === true,
                groups: (item.contents ?? []).flatMap(c => infoSkillGroups(c).map(group => ({
                    contentId: c.id,
                    skillLabel: group.skillLabel,
                    values: group.values.map(v => ({
                        tierId: v.tierId ?? "",
                        isDisclosed: v.isDisclosed,
                        label: infoValueLabel(v.tn),
                    })),
                }))),
            }));

        return context;
    }

    // ─── シーン開始の演出(切替チャット+シーンカードのドロー) ────────────────

    /**
     * シーン開始処理の後段: 舞台リンクを適用(サブシーン=背景差し替え/通常 Scene=アクティブ化・
     * 14-4)→ 見出しチャット(切替メッセージ含む)を投稿 → ニューロデッキのドローを起動する
     * (シーンカードの提示=2026-08-07 裁定「シーンカードは自動でニューロデッキのドローを起動
     * するだけ」。「現在のシーンカード」の記録はドロー側で行われる)。
     */
    static async _performSceneEntryEffects() {
        const current = getCurrentSceneRow();
        if (!current) return;
        const row = current.row;
        await applyStageRef(row.stage);
        const { rulerScene, playerLabel } = resolveScenePlayer(row);
        await ChatMessage.create({ content: await renderChatCard("scene-switch-card",
            buildSceneSwitchCardData(row, {
                playerLabel, rulerScene, number: getSessionState().sceneNumber,
            })) });
        await TnxActionHandler.drawNeuroCard();
    }

    // ─── アクトのライフサイクル ─────────────────────────────────────────────

    static async _onLoadAct(_event, _target) {
        const select = this.element.querySelector('select[name="actJournalId"]');
        const journal = select?.value ? game.journal.get(select.value) : null;
        if (!journal) return void ui.notifications.warn("アクトシートを選択してください。");
        const st = getSessionState();
        if (st.actId === journal.id) return;
        if (st.actStarted) {
            const confirmed = await DialogV2.confirm({
                window: { title: "アクトの読み込み" },
                content: "<p>進行中のアクトがあります。読み込み直すと現在の進行状態(シーン・チーム)は破棄されます。よろしいですか？</p>",
            });
            if (!confirmed) return;
        }
        await loadAct(journal);
    }

    static async _onStartAct(_event, _target) {
        const confirmed = await DialogV2.confirm({
            window: { title: "アクトの開始" },
            content: "<p>アクトを開始しますか？</p><p>ハンドアウトに設定されたキャストへ報酬点と CS が自動設定され、最初のシーンが始まります。</p>",
        });
        if (!confirmed) return;
        const entered = await startAct();
        if (entered) await TnxScenarioPanel._performSceneEntryEffects();
    }

    static async _onEndAct(_event, _target) {
        const confirmed = await DialogV2.confirm({
            window: { title: "アクトの終了" },
            content: "<p>アクトを終了しますか？(現在のシーンの終了とチームの解散が行われます)</p>",
        });
        if (!confirmed) return;
        const actName = getActiveActJournal()?.name ?? "";
        // 「全て自動で入力する」の元データは endAct() より前に採取する——アクト終了境界で
        // 神業の uses.spent が 0 に戻り、登場シーン数(sessionState)も既定へリセットされるため
        const { TnxExpAwardApp, collectExpAutoFill } = await import("./tnx-exp-award-app.mjs");
        const autoFill = collectExpAutoFill();
        await endAct();
        // ポストアクト: ロスト確認(15-5・Scenario_Progress の「致死ダメージが残るキャストの
        // ロスト確認」)。残存ダメージ消去は tnxActEnd で済んでおり、終端状態だけが残っている
        await TnxScenarioPanel._promptLostCharacters();
        // ポストアクト: 経験点の半自動配布(14-7)。確定で各ユーザーの履歴へ自動記帳。
        // **アクト限定技能の後始末はその後**(2026-08-13 ユーザー指示)——維持するコネは
        // そのアクトの経験点で買う扱いになるので、配布前に聞くと払う原資が無い
        new TnxExpAwardApp({ actName, autoFill, onFinish: promptActLimitedCleanup }).render(true);
    }

    /**
     * ポストアクトのロスト確認(15-5)。終端状態(完全死亡・精神崩壊・抹殺)を持つキャラクターを
     * RL に提示する。**提示だけで、システムは何も適用しない**——抹殺の「アクト終了時の適用」も
     * ここに載せることが実体(2026-08-29 ユーザー裁定)。対象が居なければ何も出さない。
     */
    static async _promptLostCharacters() {
        const lost = collectLostCharacters(
            game.actors.map(a => ({ name: a.name, effects: a.effects.contents })));
        if (!lost.length) return;
        const rows = lost
            .map(l => `<li>${foundry.utils.escapeHTML(l.name)}（${l.labels.join("・")}）</li>`)
            .join("");
        await DialogV2.prompt({
            window: { title: "ロスト確認" },
            content: `<ul class="tnx-lost-list">${rows}</ul>`,
            ok: { label: "確認しました" },
        });
    }

    static async _onSwitchScene(_event, target) {
        const sceneId = target.dataset.sceneId;
        if (!sceneId) return;
        const confirmed = await DialogV2.confirm({
            window: { title: "シーンの切替" },
            content: "<p>このシーンへ切り替えますか？(現在のシーンは終了します)</p>",
        });
        if (!confirmed) return;
        if (await switchScene(sceneId)) await TnxScenarioPanel._performSceneEntryEffects();
    }

    /**
     * 「次のシーンへ」＝台本順の次の行へ送る(基本操作。一覧の各行ボタンは直接ジャンプ用)。
     * 巡回シーンにいる間は同じ行へ再入場し、シーンプレイヤーが未消化の次の人へ進む(14-8)。
     */
    static async _onNextScene(_event, _target) {
        const journal = getActiveActJournal();
        const st = getSessionState();
        const next = nextSceneTarget(
            journal?.getFlag(SYSTEM_ID, "scenes") ?? null, st.sceneId, st.doneEventSceneIds);
        if (!next) return void ui.notifications.warn("台本に次のシーンがありません。");
        // 巡回の継続はシーン開始ダイアログが確認を兼ねる(確認ダイアログを二重に出さない)
        if (next.row.id !== st.sceneId) {
            const name = normalizeSceneRow(next.row).name || "無題のシーン";
            const confirmed = await DialogV2.confirm({
                window: { title: "次のシーンへ" },
                content: `<p>「${foundry.utils.escapeHTML(name)}」へ進みますか？(現在のシーンは終了します)</p>`,
            });
            if (!confirmed) return;
        }
        if (await switchScene(next.row.id)) await TnxScenarioPanel._performSceneEntryEffects();
    }

    /**
     * 「イベントシーンを起動する」(14-8)＝巡回をやめてイベントへつなぐ。次の巡回シーン
     * (またはフェイズの切れ目)までの未実行イベントを起動条件つきで並べ、1つ選ばせる。
     * 想定と違う順で巡ったために踏まれなかったイベントは「起動せず実行済みにする」で消化できる。
     */
    static async _onLaunchEvent(_event, _target) {
        const st = getSessionState();
        const scenes = getActiveActJournal()?.getFlag(SYSTEM_ID, "scenes") ?? null;
        const candidates = eventSceneCandidates(scenes, st.sceneId, st.doneEventSceneIds);
        if (!candidates.length) return void ui.notifications.warn("起動できるイベントシーンがありません。");

        const esc = foundry.utils.escapeHTML;
        // 初期選択は候補の先頭＝台本で最も上にある未実行のイベント(2026-08-09 ユーザー指示)
        const rows = candidates.map(({ row }, i) => `
            <label class="tnx-event-choice">
                <input type="radio" name="eventSceneId" value="${esc(row.id)}"${i === 0 ? " checked" : ""} />
                <span class="tnx-event-choice__name">${esc(row.name || "無題のシーン")}</span>
                ${row.eventCondition ? `<span class="tnx-event-choice__cond">${esc(row.eventCondition)}</span>` : ""}
            </label>`).join("");
        const pick = await DialogV2.wait({
            window: { title: "イベントシーンの起動" },
            classes: ["tokyo-nova", "tnx-dialog", "tnx-event-dialog"],
            position: { width: 420 },
            content: `<div class="tnx-event-choices">${rows}</div>`,
            buttons: [
                {
                    action: "launch", icon: "fas fa-bolt", label: "起動する", default: true,
                    callback: (_e, _b, dialog) => ({
                        mode: "launch",
                        sceneId: dialog.element.querySelector('[name="eventSceneId"]:checked')?.value ?? "",
                    }),
                },
                {
                    action: "done", icon: "fas fa-check", label: "起動せず実行済みにする",
                    callback: (_e, _b, dialog) => ({
                        mode: "done",
                        sceneId: dialog.element.querySelector('[name="eventSceneId"]:checked')?.value ?? "",
                    }),
                },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
            ],
            close: () => null,
        });
        if (!pick?.sceneId) return;
        if (pick.mode === "done") return void await markEventSceneDone(pick.sceneId);
        if (await switchScene(pick.sceneId)) await TnxScenarioPanel._performSceneEntryEffects();
    }

    /** 「クライマックスへ」(14-8)＝リサーチのイベントを消化しきったらクライマックスの先頭行へ。 */
    static async _onGoClimax(_event, _target) {
        const scenes = getActiveActJournal()?.getFlag(SYSTEM_ID, "scenes") ?? null;
        const first = Array.isArray(scenes?.climax) ? scenes.climax[0] : null;
        if (!first) return void ui.notifications.warn("台本にクライマックスのシーンがありません。");
        const name = normalizeSceneRow(first).name || "無題のシーン";
        const confirmed = await DialogV2.confirm({
            window: { title: "クライマックスへ" },
            content: `<p>リサーチを終えて「${foundry.utils.escapeHTML(name)}」へ進みますか？(現在のシーンは終了します)</p>`,
        });
        if (!confirmed) return;
        if (await switchScene(first.id)) await TnxScenarioPanel._performSceneEntryEffects();
    }

    // ─── 舞台裏(14-6・シーンの終了処理の一部) ───────────────────────────────

    /** 「シーンを閉じる」＝シーンの終了処理に入り舞台裏を開く(リサーチのみ)。 */
    static async _onCloseScene(_event, _target) {
        await closeSceneToBackstage();
    }

    /** 舞台裏を回す(次の人へ。末尾まで送ると回しきり＝「次のシーンへ」が出る)。 */
    static async _onBackstageNext(_event, _target) {
        await advanceBackstageSpot();
    }

    static async _onBackstageAdd(_event, target) {
        const select = target.closest(".scp-backstage")?.querySelector('select[name="backstageActorId"]');
        if (select?.value) await addBackstageActor(select.value);
    }

    static async _onBackstageRemove(_event, target) {
        await removeBackstageActor(target.dataset.actorId);
    }

    // ─── 配布・送信(読み込み状態=プレアクトから使用可) ──────────────────────

    static async _onSendTrailer(_event, _target) {
        const journal = getActiveActJournal();
        // 見出しはアクト名(トレーラーが名乗るのはそのアクトの題名)
        const data = buildTrailerCardData(journal?.getFlag(SYSTEM_ID, "trailer"), { actName: journal?.name });
        if (!data) return void ui.notifications.warn("トレーラーが入力されていません。");
        await ChatMessage.create({ content: await renderChatCard("text-card", data) });
    }

    static async _onSendHandout(_event, target) {
        const journal = getActiveActJournal();
        const handouts = (journal?.getFlag(SYSTEM_ID, "handouts") ?? []).map(normalizeHandoutRow);
        const handout = handouts.find(h => h.id === target.dataset.id);
        if (!handout) return;
        // スタイル(スタイル辞典キー)は逆引きの現在名で表示する(生キーを出さない)。
        // コネは相手の名前の自由入力なのでそのまま出す(2026-08-12)
        const styleChoices = await loadSkillChoices([STYLE_PACK]);
        const styleName = handoutStyleDisplay(handout.recommendedStyle, styleChoices);
        const title = handoutDisplayTitle(handout, {
            number: handoutNumberOf(handouts, handout.id), styleName,
        });
        const playerName = handout.userId
            ? (game.users.get(handout.userId)?.character?.name ?? game.users.get(handout.userId)?.name ?? "")
            : "";
        // 指定方法(PC/NPC/自由記述)ごとの解決は resolveHandoutContact が担う
        const contact = resolveHandoutContact(handout, handouts);
        const content = await renderChatCard("handout-card",
            buildHandoutCardData(handout, { title, styleName, playerName, contactName: contact.contactName }));
        // コネの受け取りに要る値はカードへ写す(台本を後で編集してもカードは送った時点の記録)
        await ChatMessage.create({
            content,
            flags: { [SYSTEM_ID]: { handoutContact: {
                type:        contact.type,
                contactName: contact.contactName,
                itemUuid:    contact.itemUuid,
                userId:      handout.userId ?? "",
                styleKey:    handout.recommendedStyle ?? "",
                granted:     false,
                actorId:     null,
                actorName:   "",
            } } },
        });
    }

    static async _onSendText(_event, target) {
        const journal = getActiveActJournal();
        const text = (journal?.getFlag(SYSTEM_ID, "scenarioTexts") ?? []).find(t => t.id === target.dataset.id);
        const data = buildScenarioTextCardData(text);
        if (!data) return void ui.notifications.warn("送信するテキストがありません。");
        await ChatMessage.create({ content: await renderChatCard("text-card", data) });
    }

    static async _onSendInfo(_event, target) {
        const journal = getActiveActJournal();
        const item = (journal?.getFlag(SYSTEM_ID, "infoItems") ?? []).find(i => i.id === target.dataset.id);
        if (!item) return;
        // 非公開の情報はチャットに送れない(2026-08-18 ユーザー指示)。ボタンは公開時のみ
        // 描画されるが、再描画前の押下に備えて実行側でも塞ぐ
        if (item.isPublic !== true) {
            return void ui.notifications.warn("非公開の情報は送信できません。公開してから送信してください。");
        }
        const data = buildInfoCardData(
            withResolvedInfoSkillNames(item, await loadGeneralSkillNameByKey()));
        if (!data.mode) return void ui.notifications.warn("送信できる技能・目標値がありません。");
        await ChatMessage.create({ content: await renderChatCard("info-card", data) });
        ui.notifications.info(data.mode === "disclosed"
            ? `情報「${item.title}」の公開済み内容を送信しました。`
            : `情報「${item.title}」の目標値情報を送信しました。`);
    }

    // ─── 情報公開トグル(正本=アクトシートの infoItems フラグ) ────────────────

    static async _onToggleInfoPublic(_event, target) {
        const journal = getActiveActJournal();
        if (!journal) return;
        const items = foundry.utils.deepClone(journal.getFlag(SYSTEM_ID, "infoItems") ?? []);
        const item = items.find(i => i.id === target.dataset.id);
        if (!item) return;
        item.isPublic = item.isPublic !== true;
        // 再描画は updateJournalEntry フック(tnx.mjs)が行う。ここで重ねて render すると
        // 二重描画になり、スクロール位置の控えが 0 の状態を拾って復元が壊れる(2026-08-16)
        await journal.setFlag(SYSTEM_ID, "infoItems", items);
    }

    /**
     * 情報の内容(入口本文または段)の開示を切り替える。
     * 段は入口本文の上に積まれるため、開示の累積は `toggleInfoDisclosure` が保つ
     * (段を開けば下位段と入口も開き、閉じれば上位段も閉じる)。
     */
    static async _onToggleInfoDisclosed(_event, target) {
        const journal = getActiveActJournal();
        if (!journal) return;
        const items = foundry.utils.deepClone(journal.getFlag(SYSTEM_ID, "infoItems") ?? []);
        const contents = items.find(i => i.id === target.dataset.id)?.contents;
        const index = contents?.findIndex(c => c.id === target.dataset.contentId) ?? -1;
        if (index < 0) return;
        contents[index] = toggleInfoDisclosure(contents[index], target.dataset.tierId || null);
        // 再描画は updateJournalEntry フックが行う(_onToggleInfoPublic と同じ理由で重ねない)
        await journal.setFlag(SYSTEM_ID, "infoItems", items);
    }

    // ─── 折りたたみ(巡回・シーン一覧)＝クライアント設定に永続化 ─────────────

    static async _onToggleSceneList(_event, _target) {
        await game.settings.set(SYSTEM_ID, "scenarioPanelSceneListOpen",
            !game.settings.get(SYSTEM_ID, "scenarioPanelSceneListOpen"));
        this.render(false);
    }

    static async _onToggleRotation(_event, _target) {
        await game.settings.set(SYSTEM_ID, "scenarioPanelRotationOpen",
            !game.settings.get(SYSTEM_ID, "scenarioPanelRotationOpen"));
        this.render(false);
    }

    // ─── 登場判定(14-5) ─────────────────────────────────────────────────────

    static async _onAppearanceCheck(_event, _target) {
        const { startAppearanceCheck } = await import("../module/appearance-check.mjs");
        await startAppearanceCheck();
    }

    // ─── RL による登場・退場(14-8・登場判定なし) ─────────────────────────────

    /** 追加行のプルダウンで選んだキャラクターを登場させる(名前非公開・ゴーストは同じ行のトグル)。 */
    static async _onAppearActor(_event, target) {
        const row = target.closest(".scp-appear-add");
        const actorId = row?.querySelector('select[name="appearActorId"]')?.value;
        if (!actorId) return;
        const hideName = row.querySelector('[data-action="toggleNewHideName"]')
            ?.classList.contains("is-on") === true;
        const ghost = row.querySelector('[data-action="toggleNewGhost"]')
            ?.classList.contains("is-on") === true;
        await appearActor(actorId, { hideName, ghost });
    }

    /**
     * 登場中のキャラクターを退場させる(退場=盤面のトークン削除・2026-08-23)。
     * チームの退場連動が他メンバーに及ぶときだけ確認ダイアログを挟む(2026-08-23 ユーザー
     * 裁定=確認はチーム退場時のみ)。単独の退場は即適用する。
     */
    static async _onExitActor(_event, target) {
        const actor = game.actors.get(target.dataset.actorId);
        if (!actor) return;
        const targets = manualExitTargets(actor.id);
        if (targets.others.length && !await confirmTeamExitDialog(actor, targets)) return;
        await applyManualExit(actor.id);
    }

    /** 登場中のキャラクターの名前を伏せる/戻す(登場後の付け替え)。 */
    static async _onToggleAppearHidden(_event, target) {
        await setActorNameHidden(target.dataset.actorId, target.dataset.hidden !== "true");
    }

    /** 登場中のキャラクターのゴースト状態を付け替える(2026-08-22・名前非公開と同じ操作系)。 */
    static async _onToggleAppearGhost(_event, target) {
        await setActorGhost(target.dataset.actorId, target.dataset.ghost !== "true");
    }

    /**
     * これから登場させるキャラクターの名前を伏せるかのトグル(追加行内で完結する選択)。
     * 保存先を持たない一時的な選択なので、再描画を挟まず DOM の状態だけを反転させる。
     */
    static _onToggleNewHideName(_event, target) {
        const on = target.classList.toggle("is-on");
        const icon = target.querySelector("i");
        icon?.classList.toggle("fa-eye", !on);
        icon?.classList.toggle("fa-eye-slash", on);
        target.setAttribute("title", on ? "名前を伏せて登場" : "名前を出して登場");
    }

    /** これから登場させるキャラクターをゴーストにするかのトグル(追加行内で完結する選択)。 */
    static _onToggleNewGhost(_event, target) {
        const on = target.classList.toggle("is-on");
        target.setAttribute("title", on ? "ゴーストとして登場" : "通常登場");
    }

    // ─── チーム(14-5・宣言はいつでも可) ─────────────────────────────────────
    // GM は直接、PL は sessionTeam ソケットで activeGM に委譲する(実行状態は GM しか書けない)

    static async _teamOp(op, data = {}) {
        if (game.user.isGM) {
            switch (op) {
                case "create":     return createTeam(data.name ?? "");
                case "join":       return joinTeam(data.teamId, data.actorId);
                case "leave":      return leaveTeam(data.actorId);
                case "delete":     return deleteTeam(data.teamId);
            }
            return;
        }
        TnxSocketHandler.emitSessionTeam({ op, ...data });
    }

    static async _onTeamCreate(_event, _target) {
        const input = this.element.querySelector('input[name="newTeamName"]');
        await TnxScenarioPanel._teamOp("create", { name: input?.value ?? "" });
        if (input) input.value = "";
    }

    static async _onTeamJoin(_event, target) {
        const actorId = game.user.character?.id;
        if (!actorId) return void ui.notifications.warn("担当キャラクターが設定されていません。");
        await TnxScenarioPanel._teamOp("join", { teamId: target.dataset.id, actorId });
    }

    static async _onTeamLeave(_event, _target) {
        const actorId = game.user.character?.id;
        if (!actorId) return;
        await TnxScenarioPanel._teamOp("leave", { actorId });
    }

    static async _onTeamDelete(_event, target) {
        await TnxScenarioPanel._teamOp("delete", { teamId: target.dataset.id });
    }

    // RL の編成操作(メンバー追加/除去・GM 直接)
    static async _onTeamAddMember(_event, target) {
        const teamId = target.dataset.id;
        const select = target.closest(".scp-team")?.querySelector('select[name="addMemberId"]');
        const actorId = select?.value;
        if (!teamId || !actorId) return;
        await joinTeam(teamId, actorId);
    }

    static async _onTeamRemoveMember(_event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        await leaveTeam(actorId);
    }

    /** タブの復元(V2 はレンダー時に active を付与しない)とチーム名インライン編集の配線。 */
    _onRender(_context, _options) {
        // タブは RL の開始後だけ描画される(開始前・PL は nav なし=復元不要)
        if (this.element.querySelector(".scp-tabs")) {
            for (const [group, tab] of Object.entries(this.tabGroups)) {
                if (tab) this.changeTab(tab, group, { force: true });
            }
        }
        for (const input of this.element.querySelectorAll('.scp-team input[name="teamName"]')) {
            input.addEventListener("change", (event) => {
                const teamId = event.currentTarget.closest(".scp-team")?.dataset.teamId;
                if (teamId) renameTeam(teamId, event.currentTarget.value);
            });
        }
        // 再描画後にスクロール位置を復元する(レイアウト確定後=rAF・シート基底と同じ機構)
        const saved = this._scrollPositions;
        this._scrollPositions = {};
        requestAnimationFrame(() => {
            for (const [sel, top] of Object.entries(saved)) {
                if (!top) continue;
                const target = this.element?.querySelector(sel);
                if (target) target.scrollTop = top;
            }
        });
    }
}

/** パネルを開く(開いていれば前面へ)。シーンコントロールバーのボタンから呼ぶ。 */
export function openScenarioPanel() {
    const existing = foundry.applications.instances.get("tnx-scenario-panel");
    if (existing) return existing.render({ force: true });
    return new TnxScenarioPanel().render(true);
}
