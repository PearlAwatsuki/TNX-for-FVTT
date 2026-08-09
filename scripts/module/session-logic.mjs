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
import { formatSkillName } from "./identification.mjs";
import { normalizeAppearanceActors } from "./appearance-logic.mjs";

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
        // 登場設定(14-7): area=エリア準拠(既定)/fixed=数値指定/none=登場不可。
        // appearanceSkills=シーン指定の使用技能(識別キー・複数可・候補の提示であって制限しない)
        appearanceMode:   r.appearanceMode   ?? "area",
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

export function normalizeHandoutRow(row) {
    const r = row ?? {};
    // コネ＝アクトコネクション(14-7): **必ず一つ**(2026-08-09 ユーザー裁定)。辞典のコネ技能
    // (識別キー contact プレフィックス)のプルダウンから選ぶ単一の識別キー。指定するコネ技能は
    // 辞典への格納が前提(2026-08-08 裁定・D&D 撤回)。アクト開始時にコピー付与(isActLimited)され、
    // アクト終了時に自動削除される。
    // 旧形式は読み出し時に吸収(書き換えない): 配列 actConnections → 先頭の文字列キー。
    // {uuid} 形式は実機確認前に廃止(対象にしない)
    const legacyArray = Array.isArray(r.actConnections)
        ? (r.actConnections.find(c => typeof c === "string") ?? "")
        : "";
    return {
        ...r,
        // ハンドアウトはユーザーに付与されるもの(2026-08-09 裁定)＝参照は userId。
        // 旧 actorId(キャスト直接参照)は読み替え用に残す(書き換えない)
        userId: r.userId ?? "",
        actorId: r.actorId ?? "",
        actConnection: typeof r.actConnection === "string" ? r.actConnection : legacyArray,
    };
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
 * 台本順(フェイズ順→行順)で現在シーンの次にあたる行を返す(「次のシーンへ」)。
 * 現在シーンが不明・未指定なら先頭行(アクト開始直後のフォールバック)。最後の行なら null。
 * @param {object|null} scenes
 * @param {string} currentSceneId
 * @returns {?{phase:string, row:object}}
 */
export function nextSceneRow(scenes, currentSceneId) {
    if (!scenes) return null;
    const flat = [];
    for (const phase of PHASE_ORDER) {
        for (const row of (Array.isArray(scenes[phase]) ? scenes[phase] : [])) flat.push({ phase, row });
    }
    if (!flat.length) return null;
    const index = flat.findIndex(e => e.row?.id === currentSceneId);
    if (index < 0) return flat[0];
    return flat[index + 1] ?? null;
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

// ─── チャット内容の組み立て(14-3・シナリオコントロールパネルとアクトシートで共用) ───

/**
 * シーン切替の見出しチャットを組む(旧アクトシート「切替」ボタンの書式を踏襲)。
 * ルーラーシーン(14-7)=シーンプレイヤーはいない(ルーラーはプレイヤーではない)ため
 * 「ルーラーシーン」と**だけ**表示する(「シーンプレイヤー: なし」等にしない・2026-08-08 裁定)。
 * 旧データの isMasterScene もルーラーシーンとして読み替える。
 * @param {object} scene シーン行(正規化済みでなくても可)
 * @param {{playerLabel?: string, rulerScene?: boolean}} [opts]
 * @returns {string} HTML
 */
export function buildSceneSwitchMessage(scene, { playerLabel = "", rulerScene = false } = {}) {
    const s = scene ?? {};
    const title = `<h2>SCENE ${s.number || "??"} : ${s.name || "無題のシーン"}</h2>`;
    const details = (rulerScene || s.isMasterScene) ? "<p>ルーラーシーン</p>"
        : playerLabel ? `<p><strong>シーンプレイヤー:</strong> ${playerLabel}</p>` : "";
    const custom = s.switchMessage ? `<hr>${s.switchMessage}` : "";
    return title + details + custom;
}

/**
 * トレーラー送信のチャットを組む。
 * @param {string} trailer
 * @returns {?string} HTML(空なら null=送信しない)
 */
export function buildTrailerMessage(trailer) {
    return trailer ? `<h3>シナリオトレーラー</h3><hr>${trailer}` : null;
}

/**
 * ハンドアウト送信のチャットを組む(コネ・推奨欄・PS は空なら省く)。
 * 見出し(表示名)・コネ(単一の識別キー)の解決済み表示名・スタイルの解決済み表示文字列は
 * 呼び出し側から受け取る(純関数のため辞典解決・連番算出は行わない)。コネは旧自由テキスト
 * `connections` をフォールバック表示する。
 * @param {object} handout
 * @param {{title?: string, connectionName?: string, styleName?: string}} [options]
 * @returns {string} HTML
 */
export function buildHandoutMessage(handout, { title = "", connectionName = "", styleName = "" } = {}) {
    const h = handout ?? {};
    let html = `<h3>${title || h.title || "ハンドアウト"}</h3>`;
    const conns = connectionName || h.connections || "";
    if (conns)              html += `<p><strong>コネ:</strong> ${conns}</p>`;
    if (h.recommendedSuit)  html += `<p><strong>推奨スート:</strong> ${handoutSuitLabel(h.recommendedSuit)}</p>`;
    if (styleName)          html += `<p><strong>スタイル:</strong> ${styleName}</p>`;
    html += `<hr>${h.content}`;
    if (h.ps) html += `<hr><h4>PS</h4><p>${h.ps}</p>`;
    return html;
}

/**
 * 情報項目送信のチャットを組む。開示済み内容があればそれのみ(mode="disclosed")、
 * 無ければ全内容の技能/目標値+本文(mode="targets")。送れる中身が無ければ mode=null。
 * 同じ目標値の技能は「A / B ＞ TN」に連結(既存書式)。
 * @param {object} item 情報項目
 * @returns {{html: ?string, mode: ("disclosed"|"targets"|null)}}
 */
export function buildInfoMessage(item) {
    const contents = Array.isArray(item?.contents) ? item.contents : [];
    const head = `<h3>${item?.title ?? ""}</h3>`;

    const buildBody = (rows) => {
        let html = "";
        let added = false;
        for (const content of rows) {
            const skillsByTn = (content.skills ?? []).reduce((acc, row) => {
                const names = row.names ?? [];
                if (names.length && row.tn) (acc[row.tn] = acc[row.tn] || []).push(...names);
                return acc;
            }, {});
            const skillsHtml = Object.entries(skillsByTn)
                .map(([tn, names]) => `<strong>${names.join(" / ")} &gt; ${tn}</strong>`)
                .join("<br>");
            if (skillsHtml || content.text) {
                if (added) html += "<hr>";
                if (skillsHtml) html += `<p>${skillsHtml}</p>`;
                if (content.text) html += `<p>${content.text}</p>`;
                added = true;
            }
        }
        return { html, added };
    };

    const disclosed = contents.filter(c => c.isDisclosed);
    if (disclosed.length > 0) {
        const { html } = buildBody(disclosed);
        return { html: head + html, mode: "disclosed" };
    }
    const { html, added } = buildBody(contents);
    return added ? { html: head + html, mode: "targets" } : { html: null, mode: null };
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
 * 情報項目の技能行の表示名を解決する(14-7)。識別キーは辞典逆引きの現在名を〈〉囲いで返す
 * (生キーは表示しない)。辞典から消えたキーは表示から落ち、解決できるキーが一つも無いときだけ
 * 旧い自由記述の name をフォールバックにする。
 * @param {{identificationKeys?:Array<string>, identificationKey?:string, name?:string}} row 技能行
 * @param {Map<string,string>} nameByKey 識別キー→辞典名
 * @returns {Array<string>} 表示名の並び
 */
export function resolveInfoSkillNames(row, nameByKey) {
    const names = infoSkillKeys(row)
        .map(key => nameByKey?.get(key))
        .filter(Boolean)
        .map(dictName => formatSkillName(dictName));
    if (!names.length && row?.name) return [row.name];
    return names;
}

/**
 * 情報項目の技能行に解決済み表示名(`names`)を埋めた複製を返す(buildInfoMessage・一覧ラベルの
 * 前処理)。元データは書き換えない(正本は識別キーのまま)。
 * @param {object} item 情報項目
 * @param {Map<string,string>} nameByKey 識別キー→辞典名
 * @returns {object}
 */
export function withResolvedInfoSkillNames(item, nameByKey) {
    return {
        ...item,
        contents: (item?.contents ?? []).map(c => ({
            ...c,
            skills: (c.skills ?? []).map(s => ({ ...s, names: resolveInfoSkillNames(s, nameByKey) })),
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

/**
 * チームに登場中のメンバーがいるか(チーム免除のゲート=判定なし同時登場・後から加入の自動登場)。
 * @param {Array} teams
 * @param {string} teamId
 * @param {Set<string>} appearingActorIds 登場中アクター id の集合
 */
export function teamHasAppearing(teams, teamId, appearingActorIds) {
    const team = (teams ?? []).find(t => t.id === teamId);
    return !!team && (team.memberActorIds ?? []).some(id => appearingActorIds?.has?.(id));
}
