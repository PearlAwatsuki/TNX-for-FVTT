/**
 * @fileoverview セッション進行の実行状態の正本(フェーズ14-2・正本 Phase_14_Tasks_Detail.md)。
 *
 * 「今がどのシーンか」はアクターでなく**ワールドが持つ**(2026-08-07 ユーザー裁定)。
 * 正本はワールド設定 `sessionState` 一箇所(FS判定の `activeFocusSystems` と同じ方式)。
 * アクトシートは台本(編集専用)であり実行状態を持たない。設定の読み込みは必ずアクトシートから
 * 行い、手動設定は行わない(シーン進行パネル=14-3 の原則)。
 *
 * **アクト中に「シーン外」状態は存在しない**(2026-08-08 確定)——切替は「現行終了→次開始」を
 * 一括で行い、sceneId は常に台本のどれかの行を指す。13 案1(「シーンも終了」)は終了境界の発火を
 * 先行させるだけなので、`sceneEnded` で切替時の二重発火を防ぐ。
 *
 * 書き込みは RL(GM)のみ(ワールド設定の更新権限に一致)。切り札→シーンカード化だけは
 * プレイヤークライアントで起きるため、ソケット(sessionSceneCard)で GM に委譲する。
 */

import { TNX_HOOKS } from "./combat-events.mjs";
import {
    normalizeSceneRow, normalizeHandoutRow, findSceneRow, firstSceneRow,
    buildPreActInit, planSceneSwitchEvents, planActEndEvents,
    teamCreate, teamJoin, teamLeave, teamDelete, teamOf, teamHasAppearing,
    hasBackstage, backstageQueue, nextBackstageSpot, isBackstageFinished,
    findDuplicateKeys, matchTrumpCard,
} from "./session-logic.mjs";
import { setAppearing, clearAllAppearing, listAppearingActors, isAppearing } from "./appearance-state.mjs";
import { getUserFlagData, saveIsScenePlayer } from "./user-flag-schema.mjs";
import { SKILL_PACKS } from "./skill-dictionary.mjs";

const SCOPE = "tokyo-nova-axleration";
const SETTING = "sessionState";

const DEFAULTS = Object.freeze({
    actId:       "",    // 読み込まれたアクト(JournalEntry id)。"" = 未読込
    actStarted:  false, // アクト開始済みか(読み込み=参照セットのみ・開始=自動設定+シーン進行。2026-08-08 裁定で分離)
    phase:       "",    // 現在フェイズ(opening/research/climax/ending)。シーン開始時に台本から stamp
    sceneId:     "",    // 現在の TNX シーン(台本行 id)
    sceneEnded:  false, // 現行シーンの終了境界(tnxSceneEnd)を発火済みか(13 案1)
    sceneCardId: "",    // 現在のシーンカード(シーンカード置き場内の Card id)
    teams:       [],    // [{id, name, memberActorIds: []}]。アクト終了でクリア
    // 舞台裏(14-6・シーンの終了処理の一部・リサーチシーンのみ)。「シーンを閉じる」で open、
    // 回しきる(started かつスポット解除)まで「次のシーンへ」を出さない。シーン単位でリセット
    backstage:   { open: false, started: false, spotActorId: "", extraActorIds: [] },
});

/** 舞台裏の初期状態(シーン単位・入場時にリセットする)。 */
const BACKSTAGE_INITIAL = Object.freeze({ open: false, started: false, spotActorId: "", extraActorIds: [] });

/** ワールド設定の登録(init で呼ぶ)。 */
export function registerSessionStateSetting() {
    game.settings.register(SCOPE, SETTING, {
        scope:   "world",
        config:  false,
        type:    Object,
        default: { ...DEFAULTS },
        // 状態が変わったら開いているシナリオコントロールパネル(14-3)と HUD(14-7 ステータス
        // 表示=舞台裏)を全クライアントで再描画する
        onChange: () => {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
            foundry.applications.instances.get("tnx-hud")?.render(false);
        },
    });
}

/** 実行状態を返す(全員が読める・既定値フォールバック付き)。 */
export function getSessionState() {
    return { ...DEFAULTS, ...(game.settings.get(SCOPE, SETTING) ?? {}) };
}

/** アクティブなアクト(台本 JournalEntry)。アクト外は null。 */
export function getActiveActJournal() {
    const { actId } = getSessionState();
    return actId ? (game.journal.get(actId) ?? null) : null;
}

/** ワールドのアクトシート(TnxScenarioSheet が割り当てられた JournalEntry)を列挙する。 */
export function listActJournals() {
    return game.journal.filter(j =>
        (j.flags?.core?.sheetClass ?? "") === "tokyo-nova.TnxScenarioSheet");
}

/** アクティブなアクトの台本(flags.scenes)。 */
export function getActiveScenes() {
    return getActiveActJournal()?.getFlag(SCOPE, "scenes") ?? null;
}

/** 現在のシーン行(正規化済み)とフェイズ。シーンが無ければ null。 */
export function getCurrentSceneRow() {
    const hit = findSceneRow(getActiveScenes(), getSessionState().sceneId);
    return hit ? { phase: hit.phase, row: normalizeSceneRow(hit.row) } : null;
}

/** 現在のシーンカード(Card ドキュメント)。未提示・解決不能は null。 */
export async function getCurrentSceneCard() {
    const { sceneCardId } = getSessionState();
    if (!sceneCardId) return null;
    const pileUuid = game.settings.get(SCOPE, "scenePileId");
    const pile = pileUuid ? await fromUuid(pileUuid) : null;
    return pile?.cards.get(sceneCardId) ?? null;
}

function assertGM() {
    if (!game.user.isGM) {
        ui.notifications.warn("セッション進行を操作できるのは RL のみです。");
        return false;
    }
    return true;
}

async function setState(patch) {
    await game.settings.set(SCOPE, SETTING, { ...getSessionState(), ...patch });
}

// ─── アクトのライフサイクル ─────────────────────────────────────────────────

/**
 * アクトを読み込む(参照のセットのみ・2026-08-08 裁定=読み込みと開始の分離)。
 * 自動設定・イベント発火・シーン開始は行わない。プレアクト(トレーラー読み上げ・
 * ハンドアウト配布等)はこの状態でパネルから行える。読み直しは参照の差し替え。
 * @param {JournalEntry} journal 台本(アクトシート)
 */
export async function loadAct(journal) {
    if (!assertGM() || !journal) return;
    await game.settings.set(SCOPE, SETTING, { ...DEFAULTS, actId: journal.id });
}

/**
 * 読み込み済みのアクトを開始する(2026-08-07 裁定: 開始を踏んだ瞬間に報酬点・CS を自動設定)。
 * 対象は**ハンドアウトの actorId に設定されたキャストのみ**(2026-08-08 裁定)。
 * アクト中に「シーン外」は無いため、続けて先頭シーン(または指定シーン)へ入る。
 * @param {{sceneId?: ?string}} [opts] 開始シーンの指定(既定=台本の先頭行)
 * @returns {Promise<boolean>} シーン開始まで到達したか
 */
export async function startAct({ sceneId = null } = {}) {
    if (!assertGM()) return false;
    const st = getSessionState();
    const journal = getActiveActJournal();
    if (!journal) { ui.notifications.warn("アクトが読み込まれていません。"); return false; }
    if (st.actStarted) { ui.notifications.warn("アクトは既に開始されています。"); return false; }

    // 参加=ハンドアウトの対象ユーザー(2026-08-09 裁定=ハンドアウトはユーザーに付与)。
    // キャストはユーザーの割当キャラクター(user.character)から解決する。
    // 旧 actorId(キャスト直接参照)は読み替えで吸収(書き換えない)
    const handouts = (journal.getFlag(SCOPE, "handouts") ?? []).map(normalizeHandoutRow);
    const assignments = _resolveHandoutAssignments(handouts);
    const casts = [...new Map(assignments.filter(a => a.cast).map(a => [a.cast.id, a.cast])).values()];

    // キー被りチェック(14-7・2026-08-08 裁定): キーはプレアクトに相談してずらすもの→
    // 重複が残っていたらアクト開始をブロックする
    const keyEntries = casts.map(cast => ({
        name: cast.name,
        keys: cast.items
            .filter(i => i.type === "style" && i.system.isKey === true)
            .map(i => i.system.identificationKey ?? ""),
    }));
    const duplicates = findDuplicateKeys(keyEntries);
    if (duplicates.length > 0) {
        for (const d of duplicates) {
            const styleName = casts.flatMap(c => c.items.contents ?? c.items)
                .find(i => i.type === "style" && i.system.identificationKey === d.key)?.name ?? d.key;
            ui.notifications.error(`キースタイル「${styleName}」が ${d.names.join("・")} で重複しています。キーをずらしてからアクトを開始してください。`);
        }
        return false;
    }

    // 自動設定: bountyBase←外界点実効値・bounty←0(清算を兼ねる)・CS=プレアクト初期化と同計算
    const updates = casts.map(actor => ({ _id: actor.id, ...buildPreActInit(actor.system) }));
    if (updates.length) await Actor.updateDocuments(updates);
    const unassigned = assignments.filter(a => !a.user && !a.cast).length;
    if (unassigned > 0) {
        ui.notifications.info(`対象ユーザー未設定のハンドアウトが ${unassigned} 件あります(報酬点・CS の自動設定をスキップ)。`);
    }
    for (const a of assignments) {
        if (a.user && !a.cast) {
            ui.notifications.warn(`${a.user.name} にキャストが割り当てられていないため、自動設定をスキップしました。`);
        }
    }

    // 切り札の自動配布(14-7・2026-08-08 裁定): キースタイルの識別キー⇔カード画像ファイル名で
    // 対応するニューロカードを特定し、担当ユーザーの切り札置き場へ。手動配布経路は別途残る
    await _dealTrumpsForCasts(casts);

    // コネ(アクトコネクション)の配布(14-7): 対象ユーザーのキャストへコピー付与
    // (コピーに isActLimited を立てる=アクト終了時に自動削除される)
    await _grantActConnections(assignments);

    await setState({ actStarted: true, sceneEnded: false });
    Hooks.callAll(TNX_HOOKS.actStart, { actId: journal.id });

    const scenes = journal.getFlag(SCOPE, "scenes") ?? null;
    const hit = sceneId ? findSceneRow(scenes, sceneId) : firstSceneRow(scenes);
    if (!hit) {
        ui.notifications.warn("台本にシーンがありません。シーンは開始されませんでした。");
        return false;
    }
    await _applySceneEntry(hit);
    Hooks.callAll(TNX_HOOKS.sceneStart, { sceneId: hit.row.id, phase: hit.phase });
    return true;
}

/** アクトを終了する(現行シーンの終了境界→チーム解散→アクト終了)。読み込み状態には戻る。 */
export async function endAct() {
    if (!assertGM()) return;
    const st = getSessionState();
    if (!st.actId || !st.actStarted) return;
    const events = planActEndEvents({ sceneId: st.sceneId, sceneEnded: st.sceneEnded, actId: st.actId });
    if (st.sceneId) await _applySceneExit();
    await game.settings.set(SCOPE, SETTING, { ...DEFAULTS, actId: st.actId });
    await _deleteActLimitedSkills();
    for (const ev of events) Hooks.callAll(ev.hook, ev.data);
}

/**
 * アクト限定(isActLimited)の一般技能を全キャストから自動削除する(14-7・2026-08-08 裁定)。
 * アクトコネクション等、そのアクト限りの技能の後始末。
 */
async function _deleteActLimitedSkills() {
    let count = 0;
    for (const actor of game.actors.filter(a => a.type === "cast")) {
        const ids = actor.items
            .filter(i => i.type === "generalSkill" && i.system.isActLimited === true)
            .map(i => i.id);
        if (!ids.length) continue;
        await actor.deleteEmbeddedDocuments("Item", ids);
        count += ids.length;
    }
    if (count > 0) ui.notifications.info(`アクト限定の技能 ${count} 件を削除しました。`);
}

/**
 * ハンドアウト行ごとの対象ユーザー・キャストを解決する(2026-08-09 裁定=参照は userId)。
 * キャスト=ユーザーの割当キャラクター(user.character・cast 型のみ)。
 * 旧 actorId はキャスト直接参照として読み替え、担当ユーザーは割当から逆引きする。
 * @param {Array<object>} handouts 正規化済みハンドアウト行
 * @returns {Array<{handout: object, user: ?User, cast: ?Actor}>}
 */
function _resolveHandoutAssignments(handouts) {
    return handouts.map(handout => {
        let user = handout.userId ? (game.users.get(handout.userId) ?? null) : null;
        let cast = user?.character?.type === "cast" ? user.character : null;
        if (!user && handout.actorId) {
            const legacy = game.actors.get(handout.actorId);
            cast = legacy?.type === "cast" ? legacy : null;
            user = cast ? (game.users.find(u => u.character?.id === cast.id) ?? null) : null;
        }
        return { handout, user, cast };
    });
}

/**
 * 参加キャストへ切り札を自動配布する(14-7)。キースタイルの識別キーと**カード画像ファイル名
 * (拡張子除く)の完全一致**で対応カードを特定する(2026-08-08 ユーザー確定=両者は同一。
 * 画像パスはローカライズ不変・カード名のパースは使わない)。キースタイル未設定/複数・担当
 * ユーザー不在・カード不在・置き場に既にカードあり、は警告してスキップ(手動配布で対応)。
 */
async function _dealTrumpsForCasts(casts) {
    if (!casts.length) return;
    const deckUuid = game.settings.get(SCOPE, "neuroDeckId");
    const neuroDeck = deckUuid ? await fromUuid(deckUuid) : null;
    if (!neuroDeck) return void ui.notifications.warn("ニューロデッキが設定されていないため、切り札の自動配布をスキップしました。");
    const deckCards = neuroDeck.cards.contents.map(c => ({
        id: c.id, img: c.currentFace?.img ?? c.faces?.[0]?.img ?? c.img,
    }));

    for (const cast of casts) {
        const keyStyles = cast.items.filter(i => i.type === "style" && i.system.isKey === true);
        if (keyStyles.length !== 1) {
            ui.notifications.warn(`${cast.name} のキースタイルが${keyStyles.length === 0 ? "未設定" : "複数"}のため、切り札を自動配布できません。`);
            continue;
        }
        const cardId = matchTrumpCard(deckCards, keyStyles[0].system.identificationKey ?? "");
        if (!cardId) {
            ui.notifications.warn(`${cast.name} のキースタイル「${keyStyles[0].name}」に対応する切り札がニューロデッキにありません。`);
            continue;
        }
        const owner = game.users.find(u => u.character?.id === cast.id);
        if (!owner) {
            ui.notifications.warn(`${cast.name} の担当ユーザーが見つからないため、切り札を自動配布できません。`);
            continue;
        }
        const trumpPileId = getUserFlagData(owner).trumpCardPileId;
        const trumpPile = trumpPileId ? await fromUuid(trumpPileId) : null;
        if (!trumpPile) {
            ui.notifications.warn(`${owner.name} に切り札置き場が設定されていません。`);
            continue;
        }
        if (trumpPile.cards.size > 0) {
            ui.notifications.warn(`${owner.name} の切り札置き場には既にカードがあります(自動配布をスキップ)。`);
            continue;
        }
        await neuroDeck.pass(trumpPile, [cardId], { chatNotification: false, updateData: { face: 0 } });
        ui.notifications.info(`${owner.name} に切り札を配布しました。`);
    }
}

/**
 * コネ(ハンドアウトのアクトコネクション=辞典コネ技能の識別キー・**必ず一つ**)を対象ユーザーの
 * キャストへコピー付与する(14-7・2026-08-09 裁定で単一化＋ユーザー参照化)。指定するコネ技能は
 * 一般技能辞典への格納が前提(2026-08-08 裁定)。コピーには isActLimited を立てる=アクト終了時に
 * 自動削除される。同じ識別キーの技能を既に持つ場合はスキップ(重複付与を避ける)。
 * @param {Array<{handout: object, user: ?User, cast: ?Actor}>} assignments
 */
async function _grantActConnections(assignments) {
    let granted = 0;
    const pack = game.packs?.get(SKILL_PACKS.general);
    // 単品は getDocument(キャッシュ優先・KI-026 の孤児化を起こさない)。キー→_id はインデックスで引く
    const index = pack ? await pack.getIndex({ fields: ["system.identificationKey"] }) : [];
    const idByKey = new Map([...index]
        .filter(e => e.system?.identificationKey)
        .map(e => [e.system.identificationKey, e._id]));
    for (const { handout, cast } of assignments) {
        const key = handout.actConnection;
        if (!cast || !key) continue;
        const id = idByKey.get(key);
        const doc = id ? await pack.getDocument(id).catch(() => null) : null;
        if (doc?.type !== "generalSkill") {
            ui.notifications.warn(`コネ技能が辞典に見つかりません(${cast.name})。`);
            continue;
        }
        const exists = cast.items.some(i => i.type === "generalSkill"
            && i.system.identificationKey === key);
        if (exists) continue;
        const data = doc.toObject();
        delete data._id;
        foundry.utils.setProperty(data, "system.isActLimited", true);
        await cast.createEmbeddedDocuments("Item", [data]);
        granted += 1;
    }
    if (granted > 0) ui.notifications.info(`コネを ${granted} 件配布しました(アクト終了時に自動削除)。`);
}

// ─── シーンのライフサイクル ─────────────────────────────────────────────────

/**
 * シーンを切り替える(現行終了→次開始の一括・アクト中に「シーン外」は無い)。
 * 切替メッセージの送信・シーンカードのドローはパネル(14-3)がこの前後で行う。
 * @param {string} sceneId 台本の行 id
 */
export async function switchScene(sceneId) {
    if (!assertGM()) return;
    const st = getSessionState();
    if (!st.actId || !st.actStarted) return void ui.notifications.warn("アクトが開始されていません。");
    if (sceneId === st.sceneId) return;
    const hit = findSceneRow(getActiveScenes(), sceneId);
    if (!hit) return void ui.notifications.warn("台本に該当するシーンがありません。");

    const events = planSceneSwitchEvents({
        fromSceneId: st.sceneId, sceneEnded: st.sceneEnded,
        toSceneId: sceneId, toPhase: hit.phase,
    });
    if (st.sceneId) await _applySceneExit();
    for (const ev of events) {
        if (ev.hook === TNX_HOOKS.sceneEnd) Hooks.callAll(ev.hook, ev.data);
    }
    await _applySceneEntry(hit);
    for (const ev of events) {
        if (ev.hook === TNX_HOOKS.sceneStart) Hooks.callAll(ev.hook, ev.data);
    }
}

/**
 * 13 案1「シーンも終了」からの終了境界の発火(tnx-combat から呼ぶ)。
 * シーンは現行のまま・`sceneEnded` を立てて次の切替での二重発火を防ぐ。
 * @returns {Promise<boolean>} セッション側で処理したか(false=アクト外=呼び元がフォールバック)
 */
export async function endSceneFromCombat() {
    if (!game.user.isGM) return false;
    const st = getSessionState();
    if (!st.actId || !st.sceneId || st.sceneEnded) return false;
    await _applySceneExit();
    await setState({ sceneEnded: true });
    Hooks.callAll(TNX_HOOKS.sceneEnd, { sceneId: st.sceneId });
    return true;
}

/** シーンに入る(状態更新・シーンプレイヤー指定・自動登場)。イベント発火は呼び元。 */
async function _applySceneEntry({ phase, row }) {
    const scene = normalizeSceneRow(row);
    // 舞台裏はシーン単位(前シーンの状態を持ち越さない)
    await setState({ phase, sceneId: scene.id, sceneEnded: false, backstage: { ...BACKSTAGE_INITIAL } });
    // ルーラーシーン(GM ユーザー選択 or 旧 isMasterScene)＝**シーンプレイヤーはいない**
    // (ルーラーはプレイヤーではない・2026-08-08 裁定)→ isScenePlayer は誰にも立てない
    const playerUser = scene.playerUserId ? game.users.get(scene.playerUserId) : null;
    const rulerScene = scene.isMasterScene || playerUser?.isGM === true;
    const playerUserId = (rulerScene || !playerUser) ? "" : scene.playerUserId;
    await _setScenePlayerFlags(playerUserId);
    // シーンプレイヤーのキャラクターは判定なしで登場する(仕様確認ポイント2・承認済み)
    if (playerUserId) {
        const cast = game.users.get(playerUserId)?.character;
        if (cast) await setAppearing(cast, true);
    }
}

/** シーンの終了処理(全員退場・シーンプレイヤー解除)。イベント発火は呼び元。 */
async function _applySceneExit() {
    await clearAllAppearing();
    await _setScenePlayerFlags("");
}

/** isScenePlayer User flag を付け替える(指定ユーザーのみ true・他は false)。 */
async function _setScenePlayerFlags(userId) {
    for (const user of game.users) {
        const current = getUserFlagData(user).isScenePlayer;
        const next = user.id === userId;
        if (current !== next) await saveIsScenePlayer(user, next);
    }
}

// ─── 舞台裏(14-6・シーンの終了処理の一部) ───────────────────────────────────

/** 舞台裏の状態。 */
export function getBackstage() {
    return { ...BACKSTAGE_INITIAL, ...(getSessionState().backstage ?? {}) };
}

async function setBackstage(patch) {
    await setState({ backstage: { ...getBackstage(), ...patch } });
}

/** 舞台裏で回す相手の列(非登場キャスト＋RL の手動追加)。表示・巡回で共用する。 */
export function buildBackstageQueue() {
    const extra = getBackstage().extraActorIds ?? [];
    const candidates = game.actors
        .filter(a => a.type === "cast" || extra.includes(a.id))
        .map(a => ({ id: a.id, name: a.name, appearing: isAppearing(a) }));
    return backstageQueue(candidates, extra);
}

/** 現在のシーンで舞台裏を行うか(リサーチのみ)。 */
export function currentSceneHasBackstage() {
    const st = getSessionState();
    return st.actStarted && hasBackstage(st.phase);
}

/**
 * 舞台裏を回しきったか＝「次のシーンへ」を出してよいか。
 * 舞台裏を持たないシーン(リサーチ以外)は制約なし＝常に true。
 */
export function canAdvanceScene() {
    if (!currentSceneHasBackstage()) return true;
    return isBackstageFinished(getBackstage(), buildBackstageQueue());
}

/** 「シーンを閉じる」＝シーンの終了処理に入り、舞台裏を開く(リサーチのみ)。 */
export async function closeSceneToBackstage() {
    if (!assertGM()) return;
    const st = getSessionState();
    if (!st.actStarted || !st.sceneId) return;
    if (!hasBackstage(st.phase)) return void ui.notifications.warn("舞台裏があるのはリサーチのシーンだけです。");
    await setBackstage({ open: true, started: false, spotActorId: "" });
}

/** 舞台裏を回す＝次のスポットへ。末尾まで送ると回しきり(スポット解除)。 */
export async function advanceBackstageSpot() {
    if (!assertGM()) return;
    const bs = getBackstage();
    if (!bs.open) return;
    const next = nextBackstageSpot(buildBackstageQueue(), bs.spotActorId);
    await setBackstage({ started: true, spotActorId: next ?? "" });
}

/** RL が任意のキャラクターを舞台裏の列へ加える(登場中でも入る)。 */
export async function addBackstageActor(actorId) {
    if (!assertGM() || !actorId) return;
    const extra = getBackstage().extraActorIds ?? [];
    if (extra.includes(actorId)) return;
    await setBackstage({ extraActorIds: [...extra, actorId] });
}

/** 手動追加を取り消す(非登場者=自動列挙分は列から外せない)。 */
export async function removeBackstageActor(actorId) {
    if (!assertGM()) return;
    const bs = getBackstage();
    await setBackstage({
        extraActorIds: (bs.extraActorIds ?? []).filter(id => id !== actorId),
        spotActorId: bs.spotActorId === actorId ? "" : bs.spotActorId,
    });
}

// ─── 現在のシーンカード ─────────────────────────────────────────────────────

/** 現在のシーンカードを記録する(GM)。シーン開始のドロー(14-3)と切り札のシーン消費化から。 */
export async function setCurrentSceneCard(cardId) {
    if (!game.user.isGM) return;
    await setState({ sceneCardId: cardId ?? "" });
}

/**
 * シーンカード置き場に新しいシーンカードが提示されたことを記録する。経路は2つ:
 * ①ニューロデッキのドロー(シーン切替時の提示・`drawNeuroCard`)
 * ②切り札の消費(ルール: 消費した切り札はそのシーンのシーンカードになる)
 * プレイヤークライアントからはソケット(sessionSceneCard)で GM に委譲する。
 * @param {string} cardId シーンカード置き場内の Card id
 */
export function recordCurrentSceneCard(cardId) {
    if (game.user.isGM) return void setCurrentSceneCard(cardId);
    game.socket.emit("system.tokyo-nova-axleration", { type: "sessionSceneCard", cardId });
}

// ─── チーム(宣言はいつでも可・免除ロジックは14-5) ───────────────────────────

export function getTeams() {
    return getSessionState().teams;
}

export function teamOfActor(actorId) {
    return teamOf(getTeams(), actorId);
}

export async function createTeam(name = "") {
    if (!assertGM()) return;
    await setState({ teams: teamCreate(getTeams(), { id: foundry.utils.randomID(), name }) });
}

export async function joinTeam(teamId, actorId) {
    if (!assertGM()) return;
    const teams = teamJoin(getTeams(), teamId, actorId);
    await setState({ teams });
    // チーム免除(14-5・2026-08-08 ユーザー指示): 登場中のメンバーがいるチームへ後から加入した
    // キャラクターには自動で登場状態を付与する(シーン進行中のみ)
    const st = getSessionState();
    if (!st.actStarted || !st.sceneId) return;
    const appearingIds = new Set(listAppearingActors().map(a => a.id));
    const actor = game.actors.get(actorId);
    if (actor && !appearingIds.has(actorId) && teamHasAppearing(teams, teamId, appearingIds)) {
        await setAppearing(actor, true);
        ui.notifications.info(`${actor.name} はチームに合流し、シーンに登場した。`);
    }
}

/**
 * チームで同時登場する(チーム免除=登場中のメンバーがいれば残りは判定なしで登場)。
 * @param {string} teamId
 */
export async function appearTeam(teamId) {
    if (!assertGM()) return;
    const st = getSessionState();
    if (!st.actStarted) return void ui.notifications.warn("アクトが開始されていません。");
    const teams = getTeams();
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const appearingIds = new Set(listAppearingActors().map(a => a.id));
    if (!teamHasAppearing(teams, teamId, appearingIds)) {
        return void ui.notifications.warn("登場中のメンバーがいないため、チームでの同時登場はできません。");
    }
    for (const id of team.memberActorIds ?? []) {
        if (appearingIds.has(id)) continue;
        const actor = game.actors.get(id);
        if (actor) await setAppearing(actor, true);
    }
}

/** チームで同時に退場する(「退場も同時になる」の一括操作)。 */
export async function exitTeam(teamId) {
    if (!assertGM()) return;
    const team = getTeams().find(t => t.id === teamId);
    if (!team) return;
    for (const id of team.memberActorIds ?? []) {
        const actor = game.actors.get(id);
        if (actor) await setAppearing(actor, false);
    }
}

/** チーム名を変更する(RL の編成操作)。 */
export async function renameTeam(teamId, name) {
    if (!assertGM()) return;
    await setState({
        teams: getTeams().map(t => (t.id === teamId ? { ...t, name: String(name ?? "") } : t)),
    });
}

export async function leaveTeam(actorId) {
    if (!assertGM()) return;
    await setState({ teams: teamLeave(getTeams(), actorId) });
}

export async function deleteTeam(teamId) {
    if (!assertGM()) return;
    await setState({ teams: teamDelete(getTeams(), teamId) });
}
