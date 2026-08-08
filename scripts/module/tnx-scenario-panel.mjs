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
 */

import {
    getSessionState, getActiveActJournal, getCurrentSceneRow, getCurrentSceneCard,
    listActJournals, loadAct, startAct, switchScene, endAct,
    createTeam, joinTeam, leaveTeam, deleteTeam, appearTeam, exitTeam, renameTeam,
    getBackstage, buildBackstageQueue, currentSceneHasBackstage, canAdvanceScene,
    closeSceneToBackstage, advanceBackstageSpot, addBackstageActor, removeBackstageActor,
} from "./session-state.mjs";
import { isAppearing, listAppearingActors } from "./appearance-state.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import {
    SCENE_AREA_OPTIONS, PHASE_ORDER, normalizeSceneRow, normalizeHandoutRow, nextSceneRow,
    buildSceneSwitchMessage, buildTrailerMessage, buildHandoutMessage, buildInfoMessage,
    withResolvedInfoSkillNames,
} from "./session-logic.mjs";
import { loadGeneralSkillNameByKey } from "./skill-dictionary.mjs";
import { TnxActionHandler } from "./tnx-action-handler.mjs";
import { applyStageRef } from "./subscenes.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

const SCOPE = "tokyo-nova-axleration";

/** 情報の内容行の一覧表示ラベル(技能>目標値の並び・無ければ本文の頭・どちらも無ければ空欄表記)。 */
function infoContentLabel(content) {
    const skills = (content.skills ?? [])
        .filter(s => s.name && s.tn)
        .map(s => `${s.name} > ${s.tn}`);
    if (skills.length) return skills.join("・");
    const text = (content.text ?? "").replace(/<[^>]*>/g, "").trim();
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
    return "（内容未入力）";
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
            teamCreate:          TnxScenarioPanel._onTeamCreate,
            teamJoin:            TnxScenarioPanel._onTeamJoin,
            teamLeave:           TnxScenarioPanel._onTeamLeave,
            teamAppear:          TnxScenarioPanel._onTeamAppear,
            teamExit:            TnxScenarioPanel._onTeamExit,
            teamDelete:          TnxScenarioPanel._onTeamDelete,
            teamAddMember:       TnxScenarioPanel._onTeamAddMember,
            teamRemoveMember:    TnxScenarioPanel._onTeamRemoveMember,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/scenario-panel.hbs" },
    };

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

        // 現在シーン(全員向け表示)
        context.scene = null;
        context.phaseLabel = CONFIG.TNX.phaseLabels[st.phase] ?? "";
        const current = getCurrentSceneRow();
        if (st.actStarted && current) {
            const row = current.row;
            // ルーラーシーン=シーンプレイヤー不在(2026-08-08 裁定)。「ルーラーシーン」とだけ表示する
            const playerUser = row.playerUserId ? game.users.get(row.playerUserId) : null;
            const rulerScene = row.isMasterScene || playerUser?.isGM === true;
            context.scene = {
                number: row.number || "??",
                name: row.name || "無題のシーン",
                areaLabel: SCENE_AREA_OPTIONS.find(o => o.value === row.area && o.value !== "")?.label ?? "",
                rulerScene,
                playerLabel: rulerScene ? "" : (playerUser?.name ?? row.player),
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

        // 登場中の一覧(全員向け・14-5)と登場判定ボタン(PL・非登場の担当キャラクターがいるとき)
        const appearing = st.actStarted ? listAppearingActors() : [];
        context.appearingNames = appearing.map(a => a.name);
        const myCharacter = game.user.character ?? null;
        context.canAppearanceCheck = !game.user.isGM && st.actStarted
            && !!myCharacter && !isAppearing(myCharacter);

        // チーム(全員向け・宣言はいつでも可=読み込みがあれば表示)。PL=自分のキャラクターの
        // 参加/離脱・RL=編成(メンバー追加/除去・改名・解散)。どちらも一括登場/退場を押せる
        const appearingIds = new Set(appearing.map(a => a.id));
        // 編成候補=キャスト+ゲスト(チームにはゲストも入れられる・2026-08-08 ユーザー裁定)
        const teamCandidates = game.actors.filter(a => a.type === "cast" || a.type === "guest");
        context.teams = (journal ? st.teams : []).map(team => {
            const memberIds = team.memberActorIds ?? [];
            const members = memberIds
                .map(id => game.actors.get(id))
                .filter(a => a)
                .map(a => ({ id: a.id, name: a.name, appearing: appearingIds.has(a.id) }));
            const hasAppearing = memberIds.some(id => appearingIds.has(id));
            const isMember = !!myCharacter && memberIds.includes(myCharacter.id);
            return {
                id: team.id,
                name: team.name || "チーム",
                members,
                addCandidates: game.user.isGM
                    ? teamCandidates.filter(a => !memberIds.includes(a.id)).map(a => ({ id: a.id, name: a.name }))
                    : [],
                canJoin:   !!myCharacter && !isMember,
                canLeave:  isMember,
                canAppear: st.actStarted && hasAppearing && memberIds.some(id => !appearingIds.has(id)),
                canExit:   st.actStarted && hasAppearing,
            };
        });

        if (!journal || !game.user.isGM) return context;

        // シーン一覧(フェイズ別・現在行ハイライト)と「次のシーンへ」(基本操作・台本順で送る)
        const scenes = journal.getFlag(SCOPE, "scenes") ?? {};
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

        const next = st.actStarted ? nextSceneRow(scenes, st.sceneId) : null;
        context.nextScene = (next && canAdvanceScene())
            ? { name: normalizeSceneRow(next.row).name || "無題のシーン" }
            : null;
        context.sceneGroups = PHASE_ORDER.map(phase => ({
            phaseLabel: CONFIG.TNX.phaseLabels[phase],
            rows: (Array.isArray(scenes[phase]) ? scenes[phase] : []).map(normalizeSceneRow).map(row => ({
                id: row.id,
                number: row.number || "-",
                name: row.name || "無題のシーン",
                isCurrent: row.id === st.sceneId,
            })),
        }));

        // 送信系(読み込みがあれば開始前でも使用可=プレアクトの配布)
        context.handouts = (journal.getFlag(SCOPE, "handouts") ?? []).map(normalizeHandoutRow).map(h => ({
            id: h.id,
            title: h.title || "ハンドアウト",
            castLabel: (h.actorId ? game.actors.get(h.actorId)?.name : null) ?? h.pcName,
        }));
        context.texts = (journal.getFlag(SCOPE, "scenarioTexts") ?? []).map(t => ({
            id: t.id, title: t.title || "テキスト",
        }));
        // 技能行の識別キーは辞典逆引きの現在名で表示する(14-7・生キー/空欄を出さない)
        const skillNameByKey = await loadGeneralSkillNameByKey();
        context.infoItems = (journal.getFlag(SCOPE, "infoItems") ?? [])
            .map(item => withResolvedInfoSkillNames(item, skillNameByKey))
            .map(item => ({
                id: item.id,
                title: item.title || "情報",
                isPublic: item.isPublic === true,
                contents: (item.contents ?? []).map(c => ({
                    id: c.id,
                    isDisclosed: c.isDisclosed === true,
                    label: infoContentLabel(c),
                })),
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
        const playerUser = row.playerUserId ? game.users.get(row.playerUserId) : null;
        const rulerScene = row.isMasterScene || playerUser?.isGM === true;
        const playerLabel = rulerScene ? "" : (playerUser?.name ?? row.player);
        await ChatMessage.create({ content: buildSceneSwitchMessage(row, { playerLabel, rulerScene }) });
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
        await endAct();
        // ポストアクト: 経験点の半自動配布(14-7)。確定で各ユーザーの履歴へ自動記帳
        const { TnxExpAwardApp } = await import("./tnx-exp-award-app.mjs");
        new TnxExpAwardApp({ actName }).render(true);
    }

    static async _onSwitchScene(_event, target) {
        const sceneId = target.dataset.sceneId;
        if (!sceneId) return;
        const confirmed = await DialogV2.confirm({
            window: { title: "シーンの切替" },
            content: "<p>このシーンへ切り替えますか？(現在のシーンは終了します)</p>",
        });
        if (!confirmed) return;
        await switchScene(sceneId);
        await TnxScenarioPanel._performSceneEntryEffects();
    }

    /** 「次のシーンへ」＝台本順の次の行へ送る(基本操作。一覧の各行ボタンは直接ジャンプ用)。 */
    static async _onNextScene(_event, _target) {
        const journal = getActiveActJournal();
        const next = nextSceneRow(journal?.getFlag(SCOPE, "scenes") ?? null, getSessionState().sceneId);
        if (!next) return void ui.notifications.warn("台本に次のシーンがありません。");
        const name = normalizeSceneRow(next.row).name || "無題のシーン";
        const confirmed = await DialogV2.confirm({
            window: { title: "次のシーンへ" },
            content: `<p>「${foundry.utils.escapeHTML(name)}」へ進みますか？(現在のシーンは終了します)</p>`,
        });
        if (!confirmed) return;
        await switchScene(next.row.id);
        await TnxScenarioPanel._performSceneEntryEffects();
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
        const html = buildTrailerMessage(journal?.getFlag(SCOPE, "trailer"));
        if (!html) return void ui.notifications.warn("トレーラーが入力されていません。");
        await ChatMessage.create({ content: html });
    }

    static async _onSendHandout(_event, target) {
        const journal = getActiveActJournal();
        const handout = (journal?.getFlag(SCOPE, "handouts") ?? []).find(h => h.id === target.dataset.id);
        if (!handout) return;
        await ChatMessage.create({ content: buildHandoutMessage(handout) });
    }

    static async _onSendText(_event, target) {
        const journal = getActiveActJournal();
        const text = (journal?.getFlag(SCOPE, "scenarioTexts") ?? []).find(t => t.id === target.dataset.id);
        if (!text?.content) return void ui.notifications.warn("送信するテキストがありません。");
        await ChatMessage.create({ content: text.content });
    }

    static async _onSendInfo(_event, target) {
        const journal = getActiveActJournal();
        const item = (journal?.getFlag(SCOPE, "infoItems") ?? []).find(i => i.id === target.dataset.id);
        if (!item) return;
        const { html, mode } = buildInfoMessage(
            withResolvedInfoSkillNames(item, await loadGeneralSkillNameByKey()));
        if (!mode) return void ui.notifications.warn("送信できる技能・目標値がありません。");
        await ChatMessage.create({ content: html });
        ui.notifications.info(mode === "disclosed"
            ? `情報「${item.title}」の公開済み内容を送信しました。`
            : `情報「${item.title}」の目標値情報を送信しました。`);
    }

    // ─── 情報公開トグル(正本=アクトシートの infoItems フラグ) ────────────────

    static async _onToggleInfoPublic(_event, target) {
        const journal = getActiveActJournal();
        if (!journal) return;
        const items = foundry.utils.deepClone(journal.getFlag(SCOPE, "infoItems") ?? []);
        const item = items.find(i => i.id === target.dataset.id);
        if (!item) return;
        item.isPublic = item.isPublic !== true;
        await journal.setFlag(SCOPE, "infoItems", items);
        this.render(false);
    }

    static async _onToggleInfoDisclosed(_event, target) {
        const journal = getActiveActJournal();
        if (!journal) return;
        const items = foundry.utils.deepClone(journal.getFlag(SCOPE, "infoItems") ?? []);
        const content = items.find(i => i.id === target.dataset.id)
            ?.contents?.find(c => c.id === target.dataset.contentId);
        if (!content) return;
        content.isDisclosed = content.isDisclosed !== true;
        await journal.setFlag(SCOPE, "infoItems", items);
        this.render(false);
    }

    // ─── 登場判定(14-5) ─────────────────────────────────────────────────────

    static async _onAppearanceCheck(_event, _target) {
        const { startAppearanceCheck } = await import("./appearance-check.mjs");
        await startAppearanceCheck();
    }

    // ─── チーム(14-5・宣言はいつでも可) ─────────────────────────────────────
    // GM は直接、PL は sessionTeam ソケットで activeGM に委譲する(実行状態は GM しか書けない)

    static async _teamOp(op, data = {}) {
        if (game.user.isGM) {
            switch (op) {
                case "create":     return createTeam(data.name ?? "");
                case "join":       return joinTeam(data.teamId, data.actorId);
                case "leave":      return leaveTeam(data.actorId);
                case "appearTeam": return appearTeam(data.teamId);
                case "exitTeam":   return exitTeam(data.teamId);
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

    static async _onTeamAppear(_event, target) {
        await TnxScenarioPanel._teamOp("appearTeam", { teamId: target.dataset.id });
    }

    static async _onTeamExit(_event, target) {
        await TnxScenarioPanel._teamOp("exitTeam", { teamId: target.dataset.id });
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

    /** RL のチーム名インライン編集(GM のみ描画される入力)。 */
    _onRender(_context, _options) {
        for (const input of this.element.querySelectorAll('.scp-team input[name="teamName"]')) {
            input.addEventListener("change", (event) => {
                const teamId = event.currentTarget.closest(".scp-team")?.dataset.teamId;
                if (teamId) renameTeam(teamId, event.currentTarget.value);
            });
        }
    }
}

/** パネルを開く(開いていれば前面へ)。シーンコントロールバーのボタンから呼ぶ。 */
export function openScenarioPanel() {
    const existing = foundry.applications.instances.get("tnx-scenario-panel");
    if (existing) return existing.render({ force: true });
    return new TnxScenarioPanel().render(true);
}
