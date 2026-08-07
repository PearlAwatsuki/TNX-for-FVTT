/**
 * @fileoverview セッション進行の純ロジック(フェーズ14-2・正本 Phase_14_Tasks_Detail.md)。
 *
 * アクト＝プレアクト→OP/リサーチ/クライマックス/ED→ポストアクト、シーン＝台本(アクトシート
 * flags.scenes)の行、の進行に関わる Foundry 非依存の計算をここに集める。実行状態の正本は
 * ワールド設定 `sessionState`(session-state.mjs)。**アクト中に「シーン外」状態は存在しない**
 * (2026-08-08 ユーザー確定)——シーンの切替は「現行終了→次開始」を一括で行い、sessionState の
 * sceneId は常に台本のどれかの行を指す。13 案1(カット進行終了の「シーンも終了」)は終了境界の
 * 発火だけを先行させるため、`sceneEnded` フラグで切替時の二重発火を防ぐ。
 */

import { TNX_HOOKS } from "./combat-events.mjs";

/** メインアクトのフェイズ順(台本の走査順・シーン開始時の phase stamp に使う)。 */
export const PHASE_ORDER = Object.freeze(["opening", "research", "climax", "ending"]);

/**
 * 舞台エリア(セキュリティランク)の選択肢。台本のシーン行 `area` の値域。
 * TN への写像・危険値ペナルティの適用は登場判定(14-5)が担う。
 */
export const SCENE_AREA_OPTIONS = Object.freeze([
    { value: "",          label: "未設定" },
    { value: "red",       label: "レッド" },
    { value: "yellow",    label: "イエロー" },
    { value: "green",     label: "グリーン" },
    { value: "white",     label: "ホワイト" },
    { value: "sanctuary", label: "サンクチュアリ" },
]);

/**
 * シーン行を正規化する(旧形式の行に 14-2 追加フィールドの既定値を補う)。
 * 一括マイグレーションは行わず、読み出し時に吸収する(保存は編集時のみ)。
 * `player`(旧・キャスト名の自由文字列)は playerUserId 未設定時の表示フォールバックとして残す。
 * `stage` は複合値文字列 `"" | "scene:<SceneId>" | "subScene:<サブシーンid>"`(parseStageRef)。
 * @param {object|null} row
 * @returns {{id:string, number:(string|number), name:string, player:string, isMasterScene:boolean,
 *            switchMessage:string, area:string, stage:string, playerUserId:string}}
 */
export function normalizeSceneRow(row) {
    const r = row ?? {};
    return {
        id:            r.id            ?? "",
        number:        r.number        ?? "",
        name:          r.name          ?? "",
        player:        r.player        ?? "",
        isMasterScene: r.isMasterScene ?? false,
        switchMessage: r.switchMessage ?? "",
        area:          r.area          ?? "",
        stage:         r.stage         ?? "",
        playerUserId:  r.playerUserId  ?? "",
    };
}

/**
 * ハンドアウト行を正規化する(`actorId`＝キャスト参照の既定値を補う)。
 * アクト開始の自動設定(報酬点・CS)の対象は actorId が設定されたキャストのみ(2026-08-08 裁定)。
 * @param {object|null} row
 */
export function normalizeHandoutRow(row) {
    const r = row ?? {};
    return { ...r, actorId: r.actorId ?? "" };
}

/**
 * 舞台参照の複合値を解く。
 * @param {string|null} ref `"scene:<id>"` | `"subScene:<id>"` | それ以外
 * @returns {?{type:("scene"|"subScene"), id:string}}
 */
export function parseStageRef(ref) {
    if (typeof ref !== "string") return null;
    const m = ref.match(/^(scene|subScene):(.+)$/);
    return m ? { type: m[1], id: m[2] } : null;
}

/**
 * 台本からシーン行を検索する。
 * @param {object|null} scenes flags.scenes({opening:[],research:[],climax:[],ending:[]})
 * @param {string} sceneId
 * @returns {?{phase:string, row:object}}
 */
export function findSceneRow(scenes, sceneId) {
    if (!scenes || !sceneId) return null;
    for (const phase of PHASE_ORDER) {
        const row = (Array.isArray(scenes[phase]) ? scenes[phase] : []).find(s => s?.id === sceneId);
        if (row) return { phase, row };
    }
    return null;
}

/**
 * アクト開始時に入る先頭シーン(フェイズ順で最初の行)を返す。
 * @param {object|null} scenes
 * @returns {?{phase:string, row:object}}
 */
export function firstSceneRow(scenes) {
    if (!scenes) return null;
    for (const phase of PHASE_ORDER) {
        const rows = Array.isArray(scenes[phase]) ? scenes[phase] : [];
        if (rows.length > 0) return { phase, row: rows[0] };
    }
    return null;
}

/**
 * アクト開始の自動設定(2026-08-07 裁定・対象はハンドアウトの actorId キャスト)の update patch。
 * - 報酬点: `bountyBase` ← 外界点実効値・`bounty` ← 0(ポストアクトの清算を兼ねる)
 * - CS: シートの「プレアクト初期化」ボタンと同一計算(CSベース=floor((理性+感情+生命)÷2) を
 *   実効値から焼き込み・CS=新ベース＋現在のオーバーレイ)= tnx-character-sheet-base と共用
 * @param {object} system キャストの actor.system(派生値算出済み)
 * @returns {object} Actor.update 用 patch
 */
export function buildPreActInit(system) {
    const s = system ?? {};
    return {
        ...buildCombatSpeedInit(s),
        "system.bountyBase": s.mundane?.total ?? 0,
        "system.bounty":     0,
    };
}

/**
 * CS 決定(プレアクト初期化)の update patch。シートの「プレアクト初期化」ボタンと
 * アクト開始トリガー(buildPreActInit)が共用する(計算の一本化・10-5 と同式)。
 * @param {object} system
 */
export function buildCombatSpeedInit(system) {
    const s = system ?? {};
    const newBase = Math.floor(
        ((s.reason?.total ?? 0) + (s.passion?.total ?? 0) + (s.life?.total ?? 0)) / 2);
    const overlays = (s.combatSpeed?.baseTotal ?? 0) - (s.combatSpeed?.base ?? 0);
    return {
        "system.combatSpeed.base":  newBase,
        "system.combatSpeed.value": newBase + overlays,
    };
}

/**
 * シーン切替(現行終了→次開始)で発火する境界イベント列(発火のみ・適用は15)。
 * `sceneEnded`=13 案1等で現行シーンの終了境界を発火済みなら終了イベントを重複発火しない。
 * @param {{fromSceneId:string, sceneEnded:boolean, toSceneId:string, toPhase:string}} args
 * @returns {Array<{hook:string, data:object}>}
 */
export function planSceneSwitchEvents({ fromSceneId, sceneEnded, toSceneId, toPhase }) {
    const events = [];
    if (fromSceneId && !sceneEnded) {
        events.push({ hook: TNX_HOOKS.sceneEnd, data: { sceneId: fromSceneId } });
    }
    events.push({ hook: TNX_HOOKS.sceneStart, data: { sceneId: toSceneId, phase: toPhase } });
    return events;
}

/**
 * アクト終了で発火する境界イベント列(現行シーンの終了→アクト終了)。
 * @param {{sceneId:string, sceneEnded:boolean, actId:string}} args
 * @returns {Array<{hook:string, data:object}>}
 */
export function planActEndEvents({ sceneId, sceneEnded, actId }) {
    const events = [];
    if (sceneId && !sceneEnded) {
        events.push({ hook: TNX_HOOKS.sceneEnd, data: { sceneId } });
    }
    events.push({ hook: TNX_HOOKS.actEnd, data: { actId } });
    return events;
}

// ─── チーム(sessionState.teams・非破壊操作) ─────────────────────────────────
// チームを組む宣言はいつでも可(非登場者同士も可)。免除ロジック(同時登場/退場)は 14-5。

/** チームを追加した配列を返す。 */
export function teamCreate(teams, { id, name = "" } = {}) {
    return [...(teams ?? []), { id, name, memberActorIds: [] }];
}

/** アクターを対象チームへ移す(他チームからは抜ける=1アクター1チーム・既所属なら並びを保つ)。 */
export function teamJoin(teams, teamId, actorId) {
    return (teams ?? []).map(t => {
        if (t.id === teamId) {
            const members = t.memberActorIds ?? [];
            return members.includes(actorId) ? { ...t, memberActorIds: [...members] }
                : { ...t, memberActorIds: [...members, actorId] };
        }
        return { ...t, memberActorIds: (t.memberActorIds ?? []).filter(a => a !== actorId) };
    });
}

/** アクターを全チームから抜く。 */
export function teamLeave(teams, actorId) {
    return (teams ?? []).map(t => ({
        ...t, memberActorIds: (t.memberActorIds ?? []).filter(a => a !== actorId),
    }));
}

/** チームを削除した配列を返す。 */
export function teamDelete(teams, teamId) {
    return (teams ?? []).filter(t => t.id !== teamId);
}

/** アクターの所属チームを返す(未所属は null)。 */
export function teamOf(teams, actorId) {
    return (teams ?? []).find(t => (t.memberActorIds ?? []).includes(actorId)) ?? null;
}
