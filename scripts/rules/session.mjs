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
import { formatDesignatedSkills } from "../dictionary/skill-dictionary.mjs";
import { normalizeAppearanceActors, sceneAppearanceMode } from "./appearance.mjs";

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
 * シーン行の種別(2026-08-09 ユーザー確定・14-8 巡回シーン)。
 * - `normal`: 通常シーン。台本で全て決めておく従来のシーン
 * - `rotation`: 巡回シーン。**同じ行に何度でも入場**し、入場のたびにシーンプレイヤーが
 *   ハンドアウト順の未消化の先頭へ進む。エリア・登場判定は行に持たず、入場ダイアログで決める
 * - `event`: イベントシーン。起動条件を踏んだと RL が判断したときに割り込ませるシーン
 */
// ラベルは台本の「種別」列の中だけで使うため、列見出しが与える文脈に頼って短くする
// (列幅に「イベントシーン」を通すと、隣のシーン名・シーンプレイヤーが痩せる)
export const SCENE_KIND_OPTIONS = Object.freeze([
    { value: "normal",   label: "通常" },
    { value: "rotation", label: "巡回" },
    { value: "event",    label: "イベント" },
]);

/**
 * シーンプレイヤー欄の特殊値＝ルーラーシーン(2026-08-10 ユーザー裁定)。
 *
 * 14-7 は「GM ユーザーを選ぶ＝ルーラーシーン」としていたが、**1つの選択で「誰が
 * シーンプレイヤーか」と「ルーラーシーンか」の2つを表していた**ため、RL がキャストを
 * 持ちハンドアウトの割り当てもある場合に、その RL のキャストを主役にできなかった
 * (必ずルーラーシーン扱いになる)。ルーラーシーンを独立した選択肢に切り出して含意を消す。
 * ユーザー参照は据え置き——ハンドアウトも巡回順もユーザー参照なので、ここだけキャスト参照を
 * 混ぜない(表示はキャスト名を主にする)。
 */
export const SCENE_PLAYER_RULER = "@ruler";

/**
 * シーン行を正規化する(旧形式の行に 14-2 追加フィールドの既定値を補う)。
 * 一括マイグレーションは行わず、読み出し時に吸収する(保存は編集時のみ)。
 * `player`(旧・キャスト名の自由文字列)は playerUserId 未設定時の表示フォールバックとして残す。
 * `stage` は複合値文字列 `"" | "scene:<SceneId>" | "subScene:<サブシーンid>"`(parseStageRef)。
 * @param {object|null} row
 * @returns {{id:string, number:(string|number), name:string, player:string, isMasterScene:boolean,
 *            switchMessage:string, area:string, stage:string, playerUserId:string, kind:string,
 *            eventCondition:string}}
 */
export function normalizeSceneRow(row) {
    const r = row ?? {};
    const kind = SCENE_KIND_OPTIONS.some(o => o.value === r.kind) ? r.kind : "normal";
    const isRotation = kind === "rotation";
    return {
        id:            r.id            ?? "",
        number:        r.number        ?? "",
        name:          r.name          ?? "",
        player:        r.player        ?? "",
        isMasterScene: r.isMasterScene ?? false,
        switchMessage: r.switchMessage ?? "",
        // 巡回シーンはエリア・登場判定を**行に持たない**(2026-08-09 ユーザー確定)＝常に「未設定」
        // 扱いで入場ダイアログが決める。生データは書き換えず読み出しで伏せるだけなので、
        // 種別を戻せば元の指定がそのまま生きる(一括書き換えをしない原則)
        area:          isRotation ? "" : (r.area ?? ""),
        stage:         r.stage         ?? "",
        playerUserId:  r.playerUserId  ?? "",
        // シーンプレイヤーの指定＝**ハンドアウト参照**(2026-08-10 ユーザー指摘)。シナリオの台本は
        // 「SCENE 2：シーンプレイヤー＝HO①」の形で書かれ、誰が担当するかはプレアクトで決まる。
        // 値は "" | "@ruler"(ルーラーシーン) | ハンドアウト行の id。
        // 旧 playerUserId(ユーザー参照)・旧 isMasterScene は読み替えのフォールバックとして残す
        playerHandoutId: r.playerHandoutId ?? "",
        kind,
        // イベントシーンの起動条件(14-8・表示のみ。条件の自動判定はしない=RL が読んで判断する)
        eventCondition: r.eventCondition ?? "",
        // 登場設定: エリア指定があれば area（自動）。エリア未設定では fixed=数値指定/none=登場不可/
        // unset=未設定(シーン開始ダイアログで決める・14-8)。
        // appearanceSkills=シーン指定の使用技能(識別キー・複数可・候補の提示であって制限しない)
        appearanceMode:   sceneAppearanceMode(r),
        appearanceValue:  r.appearanceValue  ?? null,
        appearanceSkills: Array.isArray(r.appearanceSkills) ? r.appearanceSkills : [],
        // 登場キャラクターの事前設定(14-8): シーン入場時に判定なしで登場させる面々
        // ({actorId, hideName}・hideName=名前を伏せて登場=卓には「？？？」)
        appearanceActors: normalizeAppearanceActors(r.appearanceActors),
    };
}

/**
 * ハンドアウトの推奨スートの選択肢(キー保存・表示ラベル)。
 * キーは技能スート等と同じ系(spade/club/heart/diamond)。
 */
export const HANDOUT_SUIT_OPTIONS = Object.freeze([
    { value: "spade",   label: "スペード" },
    { value: "club",    label: "クラブ" },
    { value: "heart",   label: "ハート" },
    { value: "diamond", label: "ダイヤ" },
]);

/** 推奨スートのキー→表示ラベル(キー以外の旧自由テキストはそのまま返す)。 */
export function handoutSuitLabel(value) {
    return HANDOUT_SUIT_OPTIONS.find(o => o.value === value)?.label ?? (value ?? "");
}

/**
 * ハンドアウト行を正規化する(`actorId`＝キャスト参照の既定値を補う)。
 * アクト開始の自動設定(報酬点・CS)の対象は actorId が設定されたキャストのみ(2026-08-08 裁定)。
 * @param {object|null} row
 */
// ハンドアウトのスタイル欄の特殊値(2026-08-09 裁定)。スタイル辞典キーと衝突しない @ 前置。
// 共通=「共通ハンドアウト」・自由記述=タイトルを自由入力(自動表示なし)
export const HANDOUT_STYLE_COMMON = "@common";
export const HANDOUT_STYLE_FREE   = "@free";

/** 丸数字(①〜⑳・超過は「(n)」)。ハンドアウトの自動連番表示に使う。 */
export function circledNumber(n) {
    if (Number.isInteger(n) && n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    return `(${n})`;
}

/**
 * ハンドアウト名の自動表示部分(スタイルセレクトの右に出す接尾。番号は**前置**のため含まない)。
 * スタイル指定=「用ハンドアウト」・未選択=「ハンドアウト」・
 * 共通=「ハンドアウト」(合わせて「共通ハンドアウト」)・自由記述=""(記入欄を出す)。
 * @param {object} handout
 */
export function handoutTitleSuffix(handout) {
    const style = handout?.recommendedStyle ?? "";
    if (style === HANDOUT_STYLE_FREE) return "";
    if (style === HANDOUT_STYLE_COMMON) return "ハンドアウト";
    return `${style ? "用" : ""}ハンドアウト`;
}

/**
 * ハンドアウトの表示名(名前形式=「①<スタイル名>用ハンドアウト」・番号は前置=2026-08-09 裁定)。
 * 共通=「共通ハンドアウト」(番号なし)・自由記述=title(自由入力)。styleName は辞典解決済みの現在名。
 * @param {object} handout
 * @param {{number?: number, styleName?: string}} [options]
 */
export function handoutDisplayTitle(handout, { number = 1, styleName = "" } = {}) {
    const h = handout ?? {};
    if (h.recommendedStyle === HANDOUT_STYLE_FREE) return h.title || "ハンドアウト";
    if (h.recommendedStyle === HANDOUT_STYLE_COMMON) return "共通ハンドアウト";
    return `${circledNumber(number)}${styleName}${handoutTitleSuffix(h)}`;
}

/**
 * シーンプレイヤー欄に出すハンドアウトのラベル(2026-08-10 ユーザー指定)。
 * **「①スタイル名（キャスト名）」**・キャスト未設定なら「①スタイル名」。
 * ハンドアウト名そのもの(「①〈カブト〉用ハンドアウト」)は台本の欄には冗長なので使わない。
 * 自由記述ハンドアウトはスタイルを持たないので自由入力のタイトルを使う。
 * @param {object} handout
 * @param {{number?: number, styleName?: string, castName?: string}} [options]
 *        number=スタイル指定行の通し番号(0=番号なし)・styleName=辞典解決済みのスタイル名
 * @returns {string}
 */
export function handoutPlayerLabel(handout, { number = 0, styleName = "", castName = "" } = {}) {
    const h = handout ?? {};
    const head = h.recommendedStyle === HANDOUT_STYLE_FREE
        ? (h.title || "ハンドアウト")
        : `${number ? circledNumber(number) : ""}${styleName}`;
    const base = head || "ハンドアウト";
    return castName ? `${base}（${castName}）` : base;
}

/**
 * シーン行のシーンプレイヤー指定を解く(2026-08-10)。ハンドアウト参照を正とし、
 * 旧データ(ユーザー参照・`isMasterScene`)は読み替えで吸収する(一括書き換えはしない)。
 * @param {?object} row 正規化済みシーン行
 * @param {Array<object>} [handouts] 正規化済みハンドアウト行
 * @returns {{ruler:boolean, handoutId:string, userId:string}}
 *          handoutId=指定されたハンドアウト(旧データ由来なら "")・userId=解決した対象ユーザー
 */
export function resolveScenePlayerRef(row, handouts = []) {
    const r = row ?? {};
    const ruler = { ruler: true, handoutId: "", userId: "" };
    const ref = r.playerHandoutId ?? "";
    if (ref === SCENE_PLAYER_RULER) return ruler;
    if (ref) {
        const hit = (handouts ?? []).find(h => h?.id === ref) ?? null;
        return { ruler: false, handoutId: ref, userId: hit?.userId ?? "" };
    }
    // 旧データ: 2026-08-10 以前の「ルーラーシーン」はユーザー欄の特殊値、さらに前は専用フラグ
    if (r.playerUserId === SCENE_PLAYER_RULER || r.isMasterScene) return ruler;
    return { ruler: false, handoutId: "", userId: r.playerUserId ?? "" };
}

/**
 * ハンドアウトのスタイル欄の表示文字列を返す。特殊値(@common/@free)・未選択は ""、
 * 辞典キーは現在名、キー以外の旧自由テキストは生値をそのまま返す。
 * @param {string} style 保存値
 * @param {Record<string,string>} styleChoices loadSkillChoices([STYLE_PACK]) の結果
 */
export function handoutStyleDisplay(style, styleChoices = {}) {
    const s = String(style ?? "");
    if (!s || s.startsWith("@")) return "";
    return styleChoices[s] ?? s;
}

/**
 * スタイル指定行(共通・自由記述でない行)の通し番号を返す(1始まり・配列順)。
 * 対象行が共通/自由記述・見つからない場合は 0。
 * @param {Array<object>} handouts
 * @param {string} handoutId
 */
export function handoutNumberOf(handouts, handoutId) {
    let n = 0;
    for (const h of handouts ?? []) {
        const style = h?.recommendedStyle ?? "";
        if (style === HANDOUT_STYLE_COMMON || style === HANDOUT_STYLE_FREE) continue;
        n += 1;
        if (h?.id === handoutId) return n;
    }
    return 0;
}

/** コネの指定方法(2026-08-13)。相手が PC か NPC か、辞典に無い相手かで入力手段が変わる。 */
export const CONTACT_TYPES = Object.freeze([
    { value: "free", label: "自由記述" },
    { value: "pc",   label: "PC" },
    { value: "npc",  label: "NPC" },
]);

/** コネの指定方法(不正・未指定は自由記述に落とす＝従来の挙動が既定)。 */
export function contactType(row) {
    const t = row?.actConnectionType;
    return CONTACT_TYPES.some(o => o.value === t) ? t : "free";
}

export function normalizeHandoutRow(row) {
    const r = row ?? {};
    // コネ＝アクトコネクション。相手は NPC とは限らないので**指定方法を3つ**持つ
    // (2026-08-13 ユーザー指示): PC=ハンドアウトから選ぶ／NPC=辞典のコネ技能をドロップ／
    // 自由記述=名前を打つ。**ハンドアウト由来のアクトコネは、ルール上の「キャスト間
    // コネクション」とは別物**(2026-08-13 ユーザー指摘)——PC を指せるだけで、相互に張る
    // 仕組みではない。
    // モードを切り替えても他モードの入力が消えないよう、値の置き場をモードごとに分ける。
    // 参照(ハンドアウト id・アイテム uuid)で持つのは、相手のキャスト名や辞典アイテム名が
    // 後で変わっても追随させるため(名前をキャッシュしない既存規約)。
    // 受け取りは HO 送信カードのボタン(handout-contact.mjs)＝アクト開始時の自動配布は廃止。
    return {
        ...r,
        // ハンドアウトはユーザーに付与されるもの(2026-08-09 裁定)＝参照は userId。
        // 旧 actorId(キャスト直接参照)は読み替え用に残す(書き換えない)
        userId: r.userId ?? "",
        actorId: r.actorId ?? "",
        actConnectionType:      contactType(r),
        // 自由記述: 名前そのもの(「コネ：」は含まない＝生成される技能名が「コネ：<入力値>」)
        actConnection:          typeof r.actConnection === "string" ? r.actConnection : "",
        // PC: 相手のハンドアウト参照 / NPC: 辞典のコネ技能の uuid
        actConnectionHandoutId: typeof r.actConnectionHandoutId === "string" ? r.actConnectionHandoutId : "",
        actConnectionUuid:      typeof r.actConnectionUuid === "string" ? r.actConnectionUuid : "",
    };
}

/**
 * アクト終了時、アクト限定技能の後始末を「削除する分」と「維持する分」に振り分ける(2026-08-13
 * ユーザー指示で無言の全削除から確認ダイアログへ)。**維持したものは isActLimited を落とす**
 * ——落とさないとアクトのたびに同じものを聞かれ続けるし、「わざわざ編集しなくても維持できる」
 * という要件がそこまで含むため。
 * @param {Array<{actorId:string, itemId:string}>} entries 対象のアクト限定技能
 * @param {Iterable<string>} keepKeys 維持するものの `${actorId}:${itemId}`
 * @returns {{deletes: Record<string, string[]>, keeps: Record<string, string[]>}} アクター id ごとのアイテム id
 */
export function planActLimitedCleanup(entries, keepKeys = []) {
    const keep = new Set(keepKeys);
    const deletes = {};
    const keeps = {};
    for (const e of entries ?? []) {
        if (!e?.actorId || !e?.itemId) continue;
        const bucket = keep.has(`${e.actorId}:${e.itemId}`) ? keeps : deletes;
        (bucket[e.actorId] ??= []).push(e.itemId);
    }
    return { deletes, keeps };
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
 * 台本をフェイズ順→行順の一本の並びに均す(台本順＝進行の順序)。
 * @param {object|null} scenes
 * @returns {Array<{phase:string, row:object}>}
 */
export function flattenScenes(scenes) {
    const flat = [];
    for (const phase of PHASE_ORDER) {
        for (const row of (Array.isArray(scenes?.[phase]) ? scenes[phase] : [])) flat.push({ phase, row });
    }
    return flat;
}

/**
 * 台本順(フェイズ順→行順)で現在シーンの次にあたる行を返す。
 * 現在シーンが不明・未指定なら先頭行(アクト開始直後のフォールバック)。最後の行なら null。
 * @param {object|null} scenes
 * @param {string} currentSceneId
 * @returns {?{phase:string, row:object}}
 */
export function nextSceneRow(scenes, currentSceneId) {
    if (!scenes) return null;
    const flat = flattenScenes(scenes);
    if (!flat.length) return null;
    const index = flat.findIndex(e => e.row?.id === currentSceneId);
    if (index < 0) return flat[0];
    return flat[index + 1] ?? null;
}

/**
 * 台本順(フェイズ順→行順)の通し番号を行 id ごとに返す(14-8)。
 * 巡回シーンを含むアクトでは上演中のシーン数が変動するため、台本の No. は手入力をやめて
 * この並び順から自動で振る(上演中の番号は実行状態のカウンタが別に持つ)。
 * @param {object|null} scenes
 * @returns {Record<string, number>}
 */
export function sceneSequenceNumbers(scenes) {
    const map = {};
    flattenScenes(scenes).forEach((entry, i) => {
        if (entry.row?.id) map[entry.row.id] = i + 1;
    });
    return map;
}

/**
 * 「次のシーンへ」の行き先(14-8)。**巡回シーンにいる間は同じ行**(再入場＝シーンプレイヤーだけ
 * 次の人へ進む)で、それ以外は台本順の次の行。
 * **実行済みのイベント行は読み飛ばす**(2026-08-09 ユーザー指示で是正)——もう一度入る意味が
 * 無く、飛ばさないと消化済みのイベント群の中で送り先が無くなるため。
 * @param {object|null} scenes
 * @param {string} currentSceneId
 * @param {Array<string>} [doneEventIds] 実行済みイベント行の id
 * @returns {?{phase:string, row:object}}
 */
export function nextSceneTarget(scenes, currentSceneId, doneEventIds = []) {
    const flat = flattenScenes(scenes);
    if (!flat.length) return null;
    const index = flat.findIndex(e => e.row?.id === currentSceneId);
    if (index < 0) return flat[0];
    if (normalizeSceneRow(flat[index].row).kind === "rotation") return flat[index];
    const done = new Set(doneEventIds ?? []);
    for (let i = index + 1; i < flat.length; i += 1) {
        const row = normalizeSceneRow(flat[i].row);
        if (row.kind === "event" && done.has(row.id)) continue;
        return flat[i];
    }
    return null;
}

/**
 * 「次のシーンへ」を出してよいか(14-8・2026-08-09 ユーザー指示)。
 * 巡回シーンは常に出す(巡回の継続)。**イベントシーンから未実行のイベントシーンへ送る形に
 * なるときだけ出さない**——起動条件を踏んでいないイベントへ順送りで滑り込ませないため。
 * 実行済みのイベントは読み飛ばした先で判定するので、消化しきった群の中でも送り先が残る。
 * 現在地が通常シーンなら塞がない(リサーチ先頭のイベントへオープニングから順送りで入る経路)。
 * @param {object|null} scenes
 * @param {string} currentSceneId
 * @param {Array<string>} [doneEventIds]
 * @returns {boolean}
 */
export function canShowNextScene(scenes, currentSceneId, doneEventIds = []) {
    const flat = flattenScenes(scenes);
    const index = flat.findIndex(e => e.row?.id === currentSceneId);
    if (index < 0) return false;
    const current = normalizeSceneRow(flat[index].row);
    if (current.kind === "rotation") return true;
    const next = nextSceneTarget(scenes, currentSceneId, doneEventIds);
    if (!next) return false;
    return !(current.kind === "event" && normalizeSceneRow(next.row).kind === "event");
}

// ─── 巡回シーン(14-8) ───────────────────────────────────────────────────────
// 巡回＝「まだシーンプレイヤーをしていない人に回す」運用の表現。位置(インデックス)ではなく
// **消化済みの記録**が正本なので、イベントシーンでシーンプレイヤーを務めた分だけ順番が飛ぶ。

/**
 * 巡回順(ユーザー id の並び)をハンドアウトの並び順から作る(2026-08-09 ユーザー確定)。
 * 共通ハンドアウトと対象ユーザー未設定の行は順から外す。同じユーザーは先に出た1件だけ。
 * **キャストを割り当てていないユーザーも外す**(2026-08-10 ユーザー裁定＝キャストが無ければ
 * シーンプレイヤーになれない＝そもそもアクトに参加していない)。GM かどうかは見ない——
 * RL がキャストを持ちハンドアウトの割り当てもあるなら、その人は巡回の正当な参加者。
 * @param {Array<object>} handouts 正規化済みハンドアウト行
 * @param {{hasCast?: (userId: string) => boolean}} [options] キャスト割当の判定(既定=常に真)
 * @returns {Array<string>}
 */
export function rotationOrder(handouts, { hasCast = () => true } = {}) {
    const seen = new Set();
    const order = [];
    for (const h of (handouts ?? [])) {
        if (h?.recommendedStyle === HANDOUT_STYLE_COMMON) continue;
        const userId = h?.userId ?? "";
        if (!userId || seen.has(userId)) continue;
        seen.add(userId);
        if (!hasCast(userId)) continue;
        order.push(userId);
    }
    return order;
}

/**
 * シーンプレイヤーの消化記録を更新する(2026-08-10 ユーザー指示で是正)。
 *
 * **リサーチのシーンだけを数える。** 以前は全フェイズで記帳し「フェイズが変わったら捨てる」
 * 形にしていたため、破棄が起きる前に読むシーン開始ダイアログがオープニングの記録を
 * 引きずり、リサーチ先頭の巡回シーンで無関係な人が「済」になっていた。
 * 巡回シーンでは、入る前に全員が務め終えていれば記録をクリアして次の巡へ。
 * ルーラーシーン(userId が空)は務め手がいないので記帳しない。
 * @param {Array<string>} done 現在の消化記録
 * @param {{phase?:string, kind?:string, order?:Array<string>, userId?:string}} args
 * @returns {Array<string>} 更新後の消化記録
 */
export function recordScenePlayerDone(done, { phase = "", kind = "normal", order = [], userId = "" } = {}) {
    const current = [...(done ?? [])];
    if (phase !== "research") return current;
    const next = kind === "rotation" ? resolveRotationDefault(order, current).done : current;
    if (userId && !next.includes(userId)) next.push(userId);
    return next;
}

/**
 * 巡回シーンに入るときの既定のシーンプレイヤー＝**未消化の先頭**。
 * 全員が務め終えていたら記録をクリアして次の巡へ(先頭から)。
 * @param {Array<string>} order 巡回順
 * @param {Array<string>} doneUserIds 今巡でシーンプレイヤーを務めたユーザー
 * @returns {{userId:string, done:Array<string>}} done=採用後に持つべき消化記録
 */
export function resolveRotationDefault(order, doneUserIds) {
    const list = order ?? [];
    const done = doneUserIds ?? [];
    // 巡回順が空(ハンドアウトに対象ユーザーが無い)なら回すものが無い＝記録には触れない
    if (!list.length) return { userId: "", done: [...done] };
    const doneSet = new Set(done);
    const remaining = list.filter(id => !doneSet.has(id));
    if (remaining.length) return { userId: remaining[0], done: [...done] };
    return { userId: list[0], done: [] };
}

// ─── イベントシーン(14-8) ───────────────────────────────────────────────────

/**
 * 「イベントシーンを起動する」の候補(2026-08-09 ユーザー指示)。同じフェイズの未実行イベントのうち、
 *
 * 1. **現在地より前にあるもの** ——踏まれずに残ったイベントは、連続イベント群の末尾にいても、
 *    リサーチ末尾の巡回シーンにいても起動できなければならない（同日追加指示）
 * 2. **現在地の直後から続くイベント群**（次の巡回シーン・通常シーンの手前まで）——当初の
 *    「次の巡回シーン(もしくはクライマックスシーン)との間にあるイベントから一つ選ぶ」
 *
 * 並びは台本順。**先頭がダイアログの初期選択**になる（＝最も上にある未実行のイベント）。
 * 現在地より後ろの、次の巡回シーンを越えた先のイベントは候補にしない（先の段階のイベントのため）。
 * @param {object|null} scenes
 * @param {string} currentSceneId
 * @param {Array<string>} [doneEventIds] 実行済みイベント行の id
 * @returns {Array<{phase:string, row:object}>}
 */
export function eventSceneCandidates(scenes, currentSceneId, doneEventIds = []) {
    const flat = flattenScenes(scenes).map(e => ({ phase: e.phase, row: normalizeSceneRow(e.row) }));
    const index = flat.findIndex(e => e.row.id === currentSceneId);
    if (index < 0) return [];
    const phase = flat[index].phase;
    const done = new Set(doneEventIds ?? []);
    const pick = i => flat[i].phase === phase && flat[i].row.kind === "event"
        && flat[i].row.id !== currentSceneId && !done.has(flat[i].row.id);

    const out = [];
    for (let i = 0; i < index; i += 1) if (pick(i)) out.push(flat[i]);
    for (let i = index + 1;
        i < flat.length && flat[i].phase === phase && flat[i].row.kind === "event"; i += 1) {
        if (pick(i)) out.push(flat[i]);
    }
    return out;
}

/**
 * そのフェイズのイベントシーンが全て実行済みか(＝「クライマックスへ」を出してよいか)。
 * イベント行が1つも無ければ最初から真＝巡回だけで進むシナリオの抜け道になる。
 * @param {object|null} scenes
 * @param {Array<string>} [doneEventIds]
 * @param {string} [phase]
 * @returns {boolean}
 */
export function areEventScenesDone(scenes, doneEventIds = [], phase = "research") {
    const done = new Set(doneEventIds ?? []);
    return (Array.isArray(scenes?.[phase]) ? scenes[phase] : [])
        .map(normalizeSceneRow)
        .filter(row => row.kind === "event")
        .every(row => done.has(row.id));
}

/**
 * シーン開始ダイアログの「舞台」候補を出すキャラクターの集合(2026-08-09 ユーザー指定)。
 * シーンプレイヤーのキャストと、そのシーンの登場キャラクター事前設定、および**それらの
 * いずれかとチームを組んでいる**キャラクター。
 * @param {{scenePlayerActorId?:string, appearanceActors?:Array, teams?:Array}} args
 * @returns {Array<string>} アクター id(重複なし・種は先頭から順)
 */
export function stageCandidateActorIds({ scenePlayerActorId = "", appearanceActors = [], teams = [] } = {}) {
    const seed = new Set();
    if (scenePlayerActorId) seed.add(scenePlayerActorId);
    for (const entry of normalizeAppearanceActors(appearanceActors)) seed.add(entry.actorId);
    const ids = new Set(seed);
    for (const team of (teams ?? [])) {
        const members = team?.memberActorIds ?? [];
        if (members.some(id => seed.has(id))) for (const id of members) ids.add(id);
    }
    return [...ids].filter(Boolean);
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

// ─── 舞台裏(14-6) ───────────────────────────────────────────────────────────
// 舞台裏はシーンの**終了処理の一部**(クリンナップ・プロセス相当)。「シーンを閉じる」で入り、
// 非登場者を順に回す。**回しきるまで「次のシーンへ」は出さない**(2026-08-08 ユーザー指示)——
// 舞台裏で何もしないことはできるので、回すこと自体は妨げず、送りの順序だけを守らせる。
// 舞台裏があるのは**リサーチシーンのみ**。

/** そのフェイズに舞台裏があるか(リサーチのみ・2026-08-08 ユーザー確定)。 */
export function hasBackstage(phase) {
    return phase === "research";
}

/**
 * 舞台裏で回す相手の列。非登場者(ライブ導出)＋RL が手動で加えた者(登場していても入る＝
 * 「登場しつつ舞台裏でも判定する」スタイル技能の表現)。並びは名前順で安定。
 * @param {Array<{id:string, name:string, appearing:boolean}>} actors 候補キャラクター
 * @param {Array<string>} [extraActorIds] RL の手動追加
 * @returns {Array<{id:string, name:string, appearing:boolean}>}
 */
export function backstageQueue(actors, extraActorIds = []) {
    const extra = new Set(extraActorIds ?? []);
    return (actors ?? [])
        // 行動不可(仮死/昏睡の治療後2シーン)は手番が回らない——その間は何もできないため
        // (2026-08-29 ユーザー裁定)。RL の手動追加より優先する
        .filter(a => !a.incapable)
        .filter(a => !a.appearing || extra.has(a.id))
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja"));
}

/**
 * 舞台裏を回す＝次のスポット。末尾の次は null(回しきり)。スポットが列から外れている
 * (その間に登場した等)ときは先頭へ戻して頑健にする。
 * @param {Array<{id:string}>} queue
 * @param {string} currentId
 * @returns {?string}
 */
export function nextBackstageSpot(queue, currentId) {
    const list = queue ?? [];
    if (!list.length) return null;
    if (!currentId) return list[0].id;
    const i = list.findIndex(a => a.id === currentId);
    if (i < 0) return list[0].id;
    return list[i + 1]?.id ?? null;
}

/**
 * 舞台裏を回しきったか(＝「次のシーンへ」を出してよいか)。
 * 開いていなければ false(まず「シーンを閉じる」)。回す相手が誰もいなければ開いた時点で true。
 * @param {{open:boolean, spotActorId:string, started?:boolean}} backstage
 * @param {Array} queue
 * @returns {boolean}
 */
export function isBackstageFinished(backstage, queue) {
    const bs = backstage ?? {};
    if (!bs.open) return false;
    if (!(queue ?? []).length) return true;
    return !bs.spotActorId && bs.started === true;
}

// ─── チャットカードの組み立て(14-3・送信元はシナリオコントロールパネル) ───
// 送信カードは4種とも判定要求カードの骨格(.tnx-card の header/body)を踏襲する
// (2026-08-15・ハンドアウトカードに揃えた)。ここは**描画コンテキストを組む純関数だけ**を持ち、
// HTML の組み立ては templates/chat/ の各テンプレートが行う。

/**
 * シーン切替カードの描画コンテキストを組む(2026-08-15・素の見出し HTML から専用テンプレートへ)。
 * ルーラーシーン(14-7)=シーンプレイヤーはいない(ルーラーはプレイヤーではない)ため
 * 「ルーラーシーン」と**だけ**表示する(「シーンプレイヤー: なし」等にしない・2026-08-08 裁定)。
 * 旧データの isMasterScene もルーラーシーンとして読み替える。
 * @param {object} scene シーン行(正規化済みでなくても可)
 * @param {{playerLabel?: string, rulerScene?: boolean, number?: ?number}} [opts]
 * @returns {{sceneLabel:string, name:string, rulerScene:boolean, playerLabel:string,
 *            message:string, hasBody:boolean}}
 */
export function buildSceneSwitchCardData(scene, { playerLabel = "", rulerScene = false, number = null } = {}) {
    const s = scene ?? {};
    // 上演中のシーン番号は実行状態のカウンタ(14-8)。巡回シーンで同じ行に何度も入るため、
    // 台本の行番号ではなく「何シーン目か」を出す
    const no = Number.isFinite(Number(number)) && number !== null ? number : (s.number || "??");
    const ruler = rulerScene === true || s.isMasterScene === true;
    const player = ruler ? "" : (playerLabel ?? "");
    const message = s.switchMessage ?? "";
    return {
        sceneLabel: `SCENE ${no}`,
        name:       s.name || "無題のシーン",
        rulerScene: ruler,
        playerLabel: player,
        message,
        // 出す行が一つも無いときは本文ブロックごと畳む(見出しだけのカードで余白が浮かないように)
        hasBody: !!(ruler || player || message),
    };
}

/**
 * トレーラー送信カードの描画コンテキストを組む(見出しはアクト名・本文は入力された長文)。
 * @param {string} trailer トレーラー本文(リッチテキスト)
 * @param {{actName?: string}} [opts]
 * @returns {?{typeLabel:string, title:string, content:string}} 空なら null(=送信しない)
 */
export function buildTrailerCardData(trailer, { actName = "" } = {}) {
    if (!trailer) return null;
    return { typeLabel: "トレーラー", title: String(actName ?? "").trim(), content: trailer };
}

/**
 * シナリオテキスト送信カードの描画コンテキストを組む。テキストの名前は RL が付けたときだけ
 * 見出しに出す(未入力時の「テキストn」は一覧で並べるための連番なので卓には出さない)。
 * @param {?{title?: string, content?: string}} text シナリオテキスト行
 * @returns {?{typeLabel:string, title:string, content:string}} 空なら null(=送信しない)
 */
export function buildScenarioTextCardData(text) {
    if (!text?.content) return null;
    return { typeLabel: "シナリオテキスト", title: String(text.title ?? "").trim(), content: text.content };
}

/**
 * ハンドアウト送信カードの描画コンテキストを組む(2026-08-12・素の HTML 組み立てから
 * 専用テンプレートへ移行)。空の欄は行ごと出さないよう真偽で畳んで渡す。
 * 見出し(表示名)・スタイル・コネの解決済み表示文字列は呼び出し側から受け取る
 * (純関数のため辞典解決・連番算出・コネの指定方法別の解決は行わない)。
 * @param {object} handout
 * @param {{title?: string, styleName?: string, playerName?: string, contactName?: string}} [options]
 * @returns {{title:string, contactName:string, suitLabel:string, styleName:string,
 *            playerName:string, content:string, ps:string}}
 */
export function buildHandoutCardData(handout, {
    title = "", styleName = "", playerName = "", contactName = "",
} = {}) {
    const h = handout ?? {};
    return {
        title:       title || h.title || "ハンドアウト",
        // コネは指定方法(PC/NPC/自由記述)ごとに解決済みの相手の名前(2026-08-13)。
        // カード側が「コネ」の見出しを付けるので、ここは素の名前
        contactName: (contactName ?? "").trim(),
        suitLabel:   h.recommendedSuit ? handoutSuitLabel(h.recommendedSuit) : "",
        styleName:   styleName ?? "",
        playerName:  playerName ?? "",
        content:     h.content ?? "",
        ps:          h.ps ?? "",
    };
}

/**
 * 情報の内容(枝)が持つ**目標値の並び**を昇順で返す(2026-08-15 ユーザー裁定＝表示上は等価)。
 *
 * どの目標値で出る情報も**並列**であり上下関係は無い(低い目標値は達成値が届かないときの
 * 受け皿・高い目標値の方がむしろ通常想定)。したがって入口の目標値と段の目標値を区別せず、
 * 1 つの並びとして扱う。
 * @param {object} content 内容(枝)
 * @param {(number|string|null)} entryTn 入口(技能行)の目標値
 * @param {?string} skillId 入口の技能行ID。未指定なら共通条件だけを返す。
 * @returns {Array<{tn:(number|string), tierId:?string, isDisclosed:boolean, text:string}>}
 */
function infoValueList(content, entryTn, skillId = null) {
    const values = [];
    if (entryTn) {
        values.push({
            tn: entryTn, tierId: null,
            isDisclosed: content?.isDisclosed === true, text: content?.text ?? "",
        });
    }
    for (const tier of infoTiers(content)) {
        for (const target of infoTierTargets(tier)) {
            if (target.skillId && target.skillId !== skillId) continue;
            if (!target.tn && !tier.text) continue;
            values.push({
                tn: target.tn ?? null, tierId: tier.id ?? null,
                isDisclosed: tier.isDisclosed === true, text: tier.text ?? "",
            });
        }
    }
    return values.sort((a, b) => (Number(a.tn) || Infinity) - (Number(b.tn) || Infinity));
}

/**
 * 情報の内容(枝)を「技能行ごとの表示単位」に開く(パネル・チャットカードで共用)。
 *
 * 1 つの枝は技能行(技能の集合＋その行の目標値)を複数持てるので、**技能行ごとに 1 単位**にし、
 * その単位が持つ目標値＝その行の目標値＋枝の段の目標値(昇順)とする。段の目標値は達成値の
 * 絶対値と比べる。追加目標値は紐づけた技能行だけに表示する（未設定の旧形式は共通）。
 * @param {object} content 内容(枝・技能名は解決済み)
 * @returns {Array<{skillLabel: string, values: Array<object>}>}
 */
export function infoSkillGroups(content) {
    const rows = (content?.skills ?? []).filter(row => row.label);
    if (!rows.length) {
        // 技能を指定していない枝でも目標値だけは持ちうる(表示は目標値の並びのみ)
        const values = infoValueList(content, null);
        return values.length ? [{ skillLabel: "", values }] : [];
    }
    return rows.map(row => ({ skillLabel: row.label, ...(row.id ? { skillId: row.id } : {}), values: infoValueList(content, row.tn, row.id) }))
        .filter(group => group.values.length);
}

/**
 * 情報項目送信カードの描画コンテキストを組む。送信は 2 つのモードを持つ。
 *
 * - **目標値の送信**(mode="targets"・開示済みが 1 つも無いとき)＝「何がどの目標値で判るか」の
 *   提示。**項目名・使用技能・目標値だけを出し、本文は一切出さない**。目標値は技能行の後ろに
 *   横並びで置く(「〈社会：ストリート、警察〉目標値: 8, 12, 15」・2026-08-15 ユーザー指定)。
 *   ※2026-06-07 `a5a51a2` で開示済み送信と組み立てを共通化した際に本文が混ざっていた。
 *     初版(`04800da`)は技能と目標値だけを送っており、2026-08-15 にユーザー指摘で是正。
 * - **開示済みの送信**(mode="disclosed")＝開いている目標値の本文を「目標値｜本文」の行で出す
 *   (罫線の無い表・シナリオの紙面と同じ体裁。2026-08-15 ユーザー指定)。
 *
 * 送れる中身が無ければ mode=null。**目標値に上下関係は無い**ので入口と段を区別せず 1 つの
 * 並びとして昇順に置く。
 *
 * 本文はリッチテキスト(ProseMirror の `<p>` を含む)なので**そのまま**返し、テンプレート側で
 * `{{{ }}}` として置く(旧実装は `<p>` で囲んでいたため空段落が挟まっていた・2026-08-15)。
 * @param {object} item 情報項目(技能名は解決済み=withResolvedInfoSkillNames を通した後)
 * @returns {{title: string, mode: ("disclosed"|"targets"|null),
 *            blocks: Array<{skillLabel: string, tnList: string,
 *                           rows: Array<{tn: (number|string), text: string}>}>}}
 */
export function buildInfoCardData(item) {
    const contents = Array.isArray(item?.contents) ? item.contents : [];
    const title = String(item?.title ?? "").trim();
    // 1 つでも開示していれば開示済みの送信(開示の累積はトグル側が保つ)。未開示の残りは
    // 「完全に未開示の時と同様」の目標値形式で下に併記する(2026-08-25 ユーザー指示＝開示が
    // 始まっても、残りを何の技能・目標値で抜けるかが表示から消えないようにする)
    const disclosed = contents.filter(c => c.isDisclosed || infoTiers(c).some(t => t.isDisclosed));
    if (disclosed.length > 0) {
        const blocks = [
            ...infoCardBlocks(disclosed, { mode: "table", filter: v => v.isDisclosed }),
            ...infoCardBlocks(contents, { mode: "targets", filter: v => !v.isDisclosed }),
        ];
        return { title, mode: "disclosed", blocks };
    }
    const blocks = infoCardBlocks(contents, { mode: "targets" });
    return { title, mode: blocks.length ? "targets" : null, blocks };
}

/**
 * 技能グループを送信カードのブロックへ整形する(buildInfoCardData / buildInfoDiscloseCardData 共用)。
 * - mode "table"  = 目標値｜本文の行(開示済み表示。本文の無い目標値は出す物が無いので落とす)
 * - mode "targets"= 技能行の後ろに目標値の横並び(「目標値: 8, 12, 15」・本文は出さない)
 * @param {Array<object>} contents 情報の内容(枝)の並び
 * @param {{mode: ("table"|"targets"), filter?: (v: object) => boolean}} args filter=値の絞り込み
 * @returns {Array<{skillLabel: string, tnList: string, rows: Array<{tn: (number|string), text: string}>}>}
 */
function infoCardBlocks(contents, { mode, filter = () => true }) {
    return contents.flatMap(content => infoSkillGroups(content))
        .map((group) => {
            const values = group.values.filter(filter);
            return {
                skillLabel: group.skillLabel,
                tnList: mode === "targets" ? values.filter(v => v.tn).map(v => v.tn).join(", ") : "",
                rows: mode === "table"
                    ? values.filter(v => v.text).map(v => ({ tn: v.tn ?? "", text: v.text }))
                    : [],
            };
        })
        .filter(block => block.tnList || block.rows.length);
}

/** 旧形式の共通目標値は読み出し時に全技能共通の1条件へ展開する。 */
export function infoTierTargets(tier) {
    return Array.isArray(tier?.targets) ? tier.targets.filter(Boolean)
        : [{ id: "legacy", skillId: "", tn: tier?.tn ?? null }];
}

/**
 * 情報の内容が持つ段(追加で判明する内容)を**目標値の昇順**で返す(2026-08-12 裁定)。
 *
 * 段は「同じ入口(＝内容の使用技能)のまま目標値が上がると情報が増える」ことの表現で、
 * 要求技能が違う場合は内容そのものを分ける(＝別の枝)。段の目標値は**達成値の絶対値**と
 * 比べる。2026-09-11: targets の各条件で入口の技能行と目標値を個別に指定できる。
 *
 * 並べ替えは**読み出し時だけ**行い、保存順は書き換えない(操作のたびに保存データの並びが
 * 変わるのを避ける)。目標値が未入力の段は末尾に置く(入力するまで足した位置に留まる)。
 * @param {?object} content 情報の内容
 * @returns {Array<object>} 目標値の昇順に並べた段
 */
export function infoTiers(content) {
    const tiers = Array.isArray(content?.tiers) ? content.tiers.filter(Boolean) : [];
    const lowest = tier => Math.min(...infoTierTargets(tier).map(target =>
        Number.isFinite(target.tn) ? target.tn : Infinity));
    return [...tiers].sort((a, b) => lowest(a) - lowest(b));
}

/** 目標値の行ラベル(パネルの開示行)。値そのものを名前として出す(2026-08-15)。 */
export function infoValueLabel(tn) {
    return tn ? `目標値 ${tn}` : "（目標値未入力）";
}

/**
 * 情報の内容の開示を切り替える(複製を返す。元データは書き換えない)。
 *
 * 段は入口本文の上に積まれるため、開示状態も累積を保つ:
 * - 段を開ける → 入口本文と、同じ技能行でそれより下の段も開く
 * - 段を閉じる → 同じ技能行でそれより上の段も閉じる
 * - 入口本文を閉じる → 全ての段が閉じる
 * @param {object} content 情報の内容
 * @param {?string} tierId 対象の段(null なら入口本文)
 * @param {?string} skillId 操作した技能行。累積対象はその行に紐づく目標値。
 * @returns {object} 切り替え後の内容
 */
export function toggleInfoDisclosure(content, tierId = null, skillId = null) {
    const stored = Array.isArray(content?.tiers) ? content.tiers : [];
    const order = [...new Set(infoValueList(content, null, skillId).map(v => v.tierId))];   // 目標値の昇順に並んだ id 列
    const withTiers = (isDisclosed, mapTier) => ({
        ...content, isDisclosed, tiers: stored.map(mapTier),
    });

    if (!tierId) {
        const on = content?.isDisclosed !== true;
        // 開けるときは段に触れない(段は段で開く)。閉じるときだけ全段を巻き取る
        return withTiers(on, tier => (on ? tier : { ...tier, isDisclosed: false }));
    }

    const rank = order.indexOf(tierId);
    if (rank < 0) return content;
    const on = stored.find(t => t.id === tierId)?.isDisclosed !== true;
    return withTiers(on ? true : content?.isDisclosed === true, (tier) => {
        const r = order.indexOf(tier.id);
        if (r < 0) return tier;
        if (on) return r <= rank ? { ...tier, isDisclosed: true } : tier;
        return r >= rank ? { ...tier, isDisclosed: false } : tier;
    });
}

/**
 * 判定成功→自動開示(14-9・2026-08-16 裁定)。**達成値以下の目標値を持つ入口・段を全て開く**
 * (抜いた目標値まで一括開示。挑んだ技能行に紐づく条件と旧形式の共通条件が対象)。
 * 開くだけで閉じない(開示は単調)。「段が開けば入口も開く」累積規約(toggleInfoDisclosure)を守る。
 * @param {object} content 情報の内容(枝)
 * @param {{achievement: number, entryTn?: ?(number|string), skillId?: ?string}} args
 *        entryTn=挑んだ技能行の目標値(入口本文の開示判定に使う)
 * @returns {object} 更新した内容(イミュータブル・元データは書き換えない)
 */
export function discloseInfoByAchievement(content, { achievement, entryTn = null, skillId = null } = {}) {
    const ach = Number(achievement);
    if (!Number.isFinite(ach)) return content;
    const reached = (tn) => {
        if (tn === null || tn === undefined || tn === "") return false;
        const n = Number(tn);
        return Number.isFinite(n) && n <= ach;
    };
    const stored = Array.isArray(content?.tiers) ? content.tiers : [];
    const validSkillId = (content?.skills ?? []).some(row => row.id === skillId) ? skillId : null;
    const tiers = stored.map(t => (infoTierTargets(t).some(target =>
        (!target.skillId || target.skillId === validSkillId) && reached(target.tn))
        ? { ...t, isDisclosed: true } : t));
    const entryOpen = content?.isDisclosed === true || reached(entryTn)
        || tiers.some(t => t?.isDisclosed === true);
    return { ...content, isDisclosed: entryOpen, tiers };
}

/**
 * 開示適用の前後差分(KI-042/14-9)。**新たに開いた**入口・段だけを列挙する——自動公開カードと
 * 帰結行は実際に開示が増えたときだけ出す(再判定の単調適用で重複送信しない)ためのゲート。
 * @param {?object} before 適用前の内容(枝)
 * @param {?object} after 適用後の内容(枝)
 * @returns {{entryOpened: boolean, tierIds: Array<string>}}
 */
export function newlyDisclosedInfo(before, after) {
    const wasOpen = new Map((Array.isArray(before?.tiers) ? before.tiers : [])
        .map(t => [t?.id, t?.isDisclosed === true]));
    const tierIds = (Array.isArray(after?.tiers) ? after.tiers : [])
        .filter(t => t?.isDisclosed === true && wasOpen.get(t?.id) !== true)
        .map(t => t.id);
    return {
        entryOpened: after?.isDisclosed === true && before?.isDisclosed !== true,
        tierIds,
    };
}

/**
 * 判定成功の自動公開カード(14-9)。**今回新たに判明した分だけ**を目標値｜本文で出し、
 * 未開示の残り(項目全体)を目標値形式で下に併記する(2026-08-25 ユーザー指示)。
 * 体裁は info-card.hbs(開示済みの送信と同じ意匠)。
 * @param {object} item 情報項目(開示適用**後**・技能名は解決済み)
 * @param {string} contentId 挑んだ内容(枝)の id
 * @param {{entryOpened: boolean, tierIds: Array<string>}} newly newlyDisclosedInfo の差分
 * @returns {?{title: string, mode: "disclosed", blocks: Array<object>}} null=新規開示なし(送らない)
 */
export function buildInfoDiscloseCardData(item, contentId, newly) {
    if (!newly || (newly.entryOpened !== true && !(newly.tierIds?.length))) return null;
    const contents = Array.isArray(item?.contents) ? item.contents : [];
    const tierIds = new Set(newly.tierIds ?? []);
    const isNew = v => (v.tierId === null ? newly.entryOpened === true : tierIds.has(v.tierId));
    const tableBlocks = infoCardBlocks(contents.filter(c => c.id === contentId), { mode: "table", filter: isNew });
    if (!tableBlocks.length) return null;
    return {
        title: String(item?.title ?? "").trim(),
        mode: "disclosed",
        blocks: [...tableBlocks, ...infoCardBlocks(contents, { mode: "targets", filter: v => !v.isDisclosed })],
    };
}

/**
 * 判定起動の指定行(14-9)。**起動ボタンは項目に1つ**(2026-08-16 裁定)で、応じ方は統合応答
 * ダイアログ(designation-response・2026-08-26 設計)が1回で選ばせる。ここは技能行を
 * 「指定の行」(キー集合+目標値+束ね表記)へ整形するだけ。キーも表示名も無い行は挑み先が
 * 無いので落とす(識別キーの無い旧自由記述行は keys=[] のまま残す=直接オープン経路)。
 * @param {?object} item 情報項目(生データ=識別キーのまま)
 * @param {Map<string,string>} nameByKey 識別キー→辞典名
 * @returns {Array<{contentId: string, keys: Array<string>, tn: ?(number|string), label: string}>}
 */
export function infoDesignationRows(item, nameByKey) {
    const contents = Array.isArray(item?.contents) ? item.contents : [];
    return contents.flatMap(content => (Array.isArray(content?.skills) ? content.skills : [])
        .map((row) => {
            const keys = infoSkillKeys(row);
            const label = resolveInfoSkillLabel(row, nameByKey);
            if (!keys.length && !label) return null;
            return { contentId: content.id ?? "", ...(row.id ? { skillId: row.id } : {}), keys, tn: row.tn ?? null, label };
        })
        .filter(Boolean));
}

/**
 * HUD 情報プレートの目標値チップ(14-9・2026-08-17 装飾化)。項目内の全目標値(入口・段)を
 * 昇順で列挙し、開示済みかを付ける——開示が進むとチップが埋まっていく表現に使う。
 * 公開項目の目標値は卓に見える情報(公開状態3段階)なので、プレートに出してよい。
 * 技能行をまたぐ同じ目標値は1つに畳む(どこかで開いていれば開示扱い)。
 * @param {?object} item 情報項目
 * @returns {Array<{tn: number, disclosed: boolean}>}
 */
export function hudInfoTnChips(item) {
    const byTn = new Map();
    for (const content of (Array.isArray(item?.contents) ? item.contents : [])) {
        for (const group of infoSkillGroups(content)) {
            for (const value of group.values) {
                const tn = Number(value.tn);
                if (value.tn === null || value.tn === undefined || value.tn === "" || !Number.isFinite(tn)) continue;
                byTn.set(tn, byTn.get(tn) === true || value.isDisclosed === true);
            }
        }
    }
    return [...byTn.entries()]
        .map(([tn, disclosed]) => ({ tn, disclosed }))
        .sort((a, b) => a.tn - b.tn);
}

/**
 * HUD の情報項目一覧の整形(14-9)。公開状態3段階の出し分け(2026-08-16 裁定):
 * PL には非公開の項目を**「非公開の情報」**として存在だけ見せる(技能・目標値・内容は伏せる)。
 * RL には実名を見せる(どれが伏さっているかの確認用。管理操作はパネル)。
 * @param {?Array<object>} items 情報項目
 * @param {{isGM?: boolean}} [args]
 * @returns {Array<{id: string, title: string, isPublic: boolean, masked: boolean}>}
 */
export function hudInfoItems(items, { isGM = false } = {}) {
    return (Array.isArray(items) ? items : []).map((item) => {
        const masked = !isGM && item?.isPublic !== true;
        return {
            id: item?.id ?? "",
            title: masked ? "非公開の情報" : (String(item?.title ?? "").trim() || "情報"),
            isPublic: item?.isPublic === true,
            masked,
        };
    });
}

/**
 * 情報項目の技能行が持つ識別キーの並び(2026-08-09 裁定＝**1 行＝技能の集合＋共通の目標値**。
 * 目標値の異なる技能は行そのものを足す)。旧形式(`identificationKey` 単体)は 1 件として読む。
 * 元データは書き換えない(読み出し時の正規化)。
 * @param {{identificationKeys?:Array<string>, identificationKey?:string}} row 技能行
 * @returns {Array<string>}
 */
export function infoSkillKeys(row) {
    if (Array.isArray(row?.identificationKeys)) return row.identificationKeys.filter(Boolean);
    return row?.identificationKey ? [row.identificationKey] : [];
}

/**
 * 情報項目の技能行の表示名を解決する(14-7)。**指定技能の表示規則は全画面で 1 つ**
 * (`formatDesignatedSkills`・2026-08-15)なので、ここは識別キーの列をその規則に渡すだけ。
 * 辞典から消えたキーは表示から落ち、解決できるキーが一つも無いときだけ旧い自由記述の name を
 * フォールバックにする。
 * @param {{identificationKeys?:Array<string>, identificationKey?:string, name?:string}} row 技能行
 * @param {Map<string,string>} nameByKey 識別キー→辞典名
 * @returns {string} 表示名(「〈社会：ストリート、警察〉」)
 */
export function resolveInfoSkillLabel(row, nameByKey) {
    const label = formatDesignatedSkills(infoSkillKeys(row), nameByKey);
    return label || (row?.name ?? "");
}

/**
 * 情報項目の技能行に解決済み表示名(`label`)を埋めた複製を返す(送信カード・パネル一覧の前処理)。
 * 元データは書き換えない(正本は識別キーのまま)。
 * @param {object} item 情報項目
 * @param {Map<string,string>} nameByKey 識別キー→辞典名
 * @returns {object}
 */
export function withResolvedInfoSkillNames(item, nameByKey) {
    return {
        ...item,
        contents: (item?.contents ?? []).map(c => ({
            ...c,
            skills: (c.skills ?? []).map(s => ({ ...s, label: resolveInfoSkillLabel(s, nameByKey) })),
        })),
    };
}

// ─── アクト開始の検査・自動配布(14-7) ───────────────────────────────────────

/**
 * キー被りチェック(2026-08-08 ユーザー裁定=プレアクトに相談してずらすもの→重複があれば
 * アクト開始をブロック)。キャストごとのキースタイル識別キー集合から、2人以上が共有する
 * キーを列挙する。同一キャスト内の重複・空キーは数えない。
 * @param {Array<{name:string, keys:Array<string>}>} entries
 * @returns {Array<{key:string, names:Array<string>}>}
 */
export function findDuplicateKeys(entries) {
    const byKey = new Map();
    for (const entry of (entries ?? [])) {
        for (const key of new Set((entry.keys ?? []).filter(Boolean))) {
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(entry.name);
        }
    }
    return [...byKey.entries()]
        .filter(([, names]) => names.length >= 2)
        .map(([key, names]) => ({ key, names }));
}

/**
 * キースタイルに対応する切り札(ニューロカード)を特定する(14-7・切り札の自動配布)。
 * **照合キー＝カード画像ファイル名(拡張子除く)＝スタイルの識別キー**(2026-08-08 ユーザー確定・
 * 完全同一)。画像パスはシステム同梱アセットへの参照でローカライズ不変・既存デッキにも存在する。
 * カード名のパースは使わない(ローカライズで壊れるため)。
 * @param {Array<{id:string, img:string}>} cards ニューロデッキのカード({id, 表面画像パス})
 * @param {string} identificationKey キースタイルの識別キー
 * @returns {?string} カード id(見つからなければ null)
 */
export function matchTrumpCard(cards, identificationKey) {
    if (!identificationKey) return null;
    const hit = (cards ?? []).find(c => {
        const basename = String(c.img ?? "").split("/").pop() ?? "";
        return basename === `${identificationKey}.png`;
    });
    return hit?.id ?? null;
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

// 旧 teamHasAppearing(チーム免除のゲート)は 2026-08-22 の「チームで登場」オミットで削除——
// チーム経由の自動登場は行わず、登場の適用は RL の操作に一本化された

/**
 * チームの退場連動(2026-08-23 ユーザー裁定＝ゲーム設定 teamLinkedExit・既定オフ)の退場対象を
 * 解決する。連動が有効で対象がチームに居るとき、**登場中**のメンバー全員(操作対象を含む)を
 * 退場対象にする。登場は判定を振るか等の判断が多く自動化しない(2026-08-22 オミット)が、退場は
 * 純粋な記帳なので連動できる——という非対称が設計根拠(ユーザー)。
 *
 * `others`(操作対象以外の巻き込まれるメンバー)は退場確認ダイアログの条件と表示に使う——
 * ダイアログは**連動が自分以外に及ぶときだけ**出す(2026-08-23 ユーザー裁定「確認ダイアログは
 * チーム退場時のみ」の機能的読み＝巻き込みの無い退場に確認は不要)。
 * @param {Array<{id: string, name: string, memberActorIds: Array<string>}>} teams
 * @param {string} actorId 退場操作の対象
 * @param {{linked: boolean, isAppearing: (id: string) => boolean}} args
 *        linked=退場連動設定・isAppearing=登場中かの判定(呼び出し側が実データを注入)
 * @returns {{targetIds: Array<string>, others: Array<string>, teamName: string}}
 */
export function teamLinkedExitTargets(teams, actorId, { linked = false, isAppearing = () => false } = {}) {
    const team = linked ? teamOf(teams, actorId) : null;
    const others = (team?.memberActorIds ?? [])
        .filter(id => id !== actorId && isAppearing(id));
    return {
        targetIds: [actorId, ...others],
        others,
        teamName: team?.name || "チーム",
    };
}

// ─── シーン登場の記帳(経験点配布の「登場」自動入力の元・2026-08-30 ユーザー承認) ────────

/**
 * キャストの登場を現在シーンの分として記帳する。「シーンに登場した」は1シーンにつき1点
 * なので、同一シーン内の再登場(退場→再登場)は数えない。数えるのは登場した事実であり、
 * 途中退場してもそのシーンの1は残る。巡回シーンの再入場は別シーン(シーン番号の意味論と同じ)。
 * @param {{appearanceCounts?: Record<string, number>, appearedThisScene?: Array<string>, actorId?: string}} args
 *        appearanceCounts=アクト内で登場したシーン数(Actor id→数)・
 *        appearedThisScene=現在シーンで登場済みの Actor id(重複防止)
 * @returns {?{appearanceCounts: Record<string, number>, appearedThisScene: Array<string>}}
 *          記帳後の状態。記帳不要(このシーンで記帳済み・id 無し)なら null
 */
export function recordSceneAppearance({ appearanceCounts = {}, appearedThisScene = [], actorId = "" } = {}) {
    if (!actorId || appearedThisScene.includes(actorId)) return null;
    return {
        appearanceCounts: {
            ...appearanceCounts,
            [actorId]: Math.max(0, Math.trunc(Number(appearanceCounts?.[actorId]) || 0)) + 1,
        },
        appearedThisScene: [...appearedThisScene, actorId],
    };
}
