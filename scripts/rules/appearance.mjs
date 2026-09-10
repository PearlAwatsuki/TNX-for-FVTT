/**
 * @fileoverview 登場判定と登場そのものの純ロジック(フェーズ14-5/14-8・正本 Appearance_Check.md)。
 *
 * - 目標値は舞台エリアのセキュリティ・ランクで決まる(レッド8/イエロー10/グリーン10/
 *   ホワイト12/サンクチュアリ12)。
 * - 危険値ペナルティ(携帯中アウトフィットの合計=appearanceModifier・負)は**達成値に加算**
 *   (2026-08-07 ユーザー裁定)。グリーン×1・ホワイト×2・レッド/イエローなし。
 * - サンクチュアリは「危険値が0未満の装備を携帯」で登場不可——合計でなく**個別装備**で判定する
 *   (＋2 と −1 を携帯した合計 +1 でも不可)。
 * - 使用技能の既定候補=社会/コネ分類(「大抵いずれかの社会技能またはコネ技能」)。他技能の使用は
 *   卓の裁定=候補の絞り込みは表示上の既定にとどめ、システムは制限しない。
 */

import { OUTFIT_ITEM_TYPES, CHARACTER_ACTOR_TYPES } from "../data/helpers.mjs";

/** エリア別の目標値と危険値係数(正本 Appearance_Check の表)。 */
export const AREA_APPEARANCE = Object.freeze({
    red:       { tn: 8,  dangerFactor: 0 },
    yellow:    { tn: 10, dangerFactor: 0 },
    green:     { tn: 10, dangerFactor: 1 },
    white:     { tn: 12, dangerFactor: 2 },
    sanctuary: { tn: 12, dangerFactor: 0 },
});

/**
 * シーン開始ダイアログで目標値を手入力するときの初期値(2026-08-09 ユーザー指定)。
 * エリアを選ぶとそのエリアの固定値に置き換わる。
 */
export const DEFAULT_APPEARANCE_TARGET = 10;

/** エリアの固定目標値(未設定・未知のエリアは null)。 */
export function areaTargetValue(area) {
    return AREA_APPEARANCE[area]?.tn ?? null;
}

/** アクトシートのエリア指定を優先し、旧「エリア準拠」だけの行は未設定と読む。 */
export function sceneAppearanceMode(row) {
    if (row?.kind === "rotation") return "unset";
    if (row?.area) return "area";
    return ["fixed", "none"].includes(row?.appearanceMode) ? row.appearanceMode : "unset";
}

/**
 * そのシーンの登場設定を解決する。台本のエリア指定を優先し、登場判定が「未設定」の
 * ときだけ、シーン開始ダイアログが決めた実行時の上書きを使う（巡回シーンも同様）。
 *
 * 上書きは「エリアの性質＋目標値の直接指定」の形に落ちる——住宅施設を舞台にした場合も、
 * 住宅の登場判定目標値を `fixed` として渡し、エリアは住宅エリアのランクをそのまま置く。
 * こうすると危険値係数(グリーン×1・ホワイト×2)とサンクチュアリの装備ゲートが
 * 既存の `appearanceCheckParams` の経路でそのまま効く(14-7 の「数値指定＝TN の差し替えのみ」)。
 *
 * 表示(パネルの「登場：」行)と判定の双方がこの1本を通ることで、値の出所が一致する。
 * @param {?object} row 正規化済みシーン行
 * @param {?{area?:string, appearanceValue?:?number, appearanceSkills?:Array<string>}} [override]
 * @returns {{area:string, mode:string, fixedValue:?number, skills:Array<string>}}
 */
export function resolveSceneAppearance(row, override = null, phase = "") {
    if (phase === "ending") return { area: "", mode: "free", fixedValue: null, skills: [] };
    const r = row ?? {};
    const rowSkills = Array.isArray(r.appearanceSkills) ? r.appearanceSkills : [];
    const mode = sceneAppearanceMode(r);
    if (mode !== "unset") {
        return { area: r.area ?? "", mode, fixedValue: mode === "area" ? null : (r.appearanceValue ?? null), skills: rowSkills };
    }
    // 未決定(ダイアログを閉じた等)は目標値を出さない。指定技能は台本の指定が生きる
    if (!override) return { area: "", mode: "area", fixedValue: null, skills: rowSkills };
    // 空欄・null は「目標値なし」。Number("")/Number(null) は 0 になるので素通しにしない
    const raw = override.appearanceValue;
    const value = (raw === null || raw === undefined || raw === "") ? NaN : Number(raw);
    return {
        area:       override.area ?? "",
        mode:       "fixed",
        fixedValue: Number.isFinite(value) ? value : null,
        skills:     Array.isArray(override.appearanceSkills) ? override.appearanceSkills : rowSkills,
    };
}

/**
 * 登場判定のパラメータ(目標値・達成値修正・強制失敗)を算出する。
 * シーン行の登場設定(14-7): mode="area"(既定=エリアの固定 TN)/"fixed"(数値指定=TN はその値・
 * 危険値係数はエリアに従う)/"none"(登場不可=シーンプレイヤー以外登場できない)。
 * サンクチュアリの装備チェックはモードに関わらず生きる。
 *
 * **判定そのものはブロックしない**(2026-08-15 ユーザー裁定): このゲームに判定がブロックされる
 * 場面はほぼ存在せず、どの参加者にも平等に「判定を失敗する権利」がある(それによって手札を
 * 入れ替えていく)。登場できない場面(登場：不可/サンクチュアリの危険値装備)は判定を行えるが
 * 結果が必ず失敗になる=`forcedFailure` に理由コードを返す。
 * **キャラクター側の登場不可**(行動不可＝仮死/昏睡の治療後2シーン／逮捕令状)はシーンの設定より
 * 優先する——キャラクター自身の絶対条件のため。判定自体は行えて結果が必ず失敗になる、の扱いは
 * 他の不可条件と同じ(→ Damage_Rules・Appearance_Check)。
 * @param {{area: string, appearanceModifier?: number, hasNegativeDangerItem?: boolean,
 *          mode?: ("area"|"fixed"|"none"), fixedValue?: ?number, appearanceBlock?: ?string}} args
 * @returns {{forcedFailure: ?string, targetValue: ?number, modifier: number}}
 */
export function appearanceCheckParams({
    area, appearanceModifier = 0, hasNegativeDangerItem = false, mode = "area", fixedValue = null,
    appearanceBlock = null,
}) {
    if (appearanceBlock) return { forcedFailure: appearanceBlock, targetValue: null, modifier: 0 };
    if (mode === "none") return { forcedFailure: "none", targetValue: null, modifier: 0 };
    const def = AREA_APPEARANCE[area] ?? null;
    const targetValue = mode === "fixed"
        ? (Number.isFinite(Number(fixedValue)) ? Number(fixedValue) : null)
        : (def?.tn ?? null);
    if (area === "sanctuary" && hasNegativeDangerItem) {
        return { forcedFailure: "sanctuary", targetValue, modifier: 0 };
    }
    const modifier = (Number(appearanceModifier) || 0) * (def?.dangerFactor ?? 0);
    return { forcedFailure: null, targetValue, modifier: modifier || 0 };
}

/**
 * 登場判定の専用チャットカードに載せる表示情報を組み立てる(2026-08-16 ユーザー指示)。
 * 登場判定は用途を持たない(指定技能がシーンごとに変わるため)ので、カードの専用化は
 * 判定文脈(ctx.appearance)をキーにした描画の分岐で行う(攻撃カード・移動カードと同型)。
 * - エリアは**設定されているときだけ**出す(「未定」を出さない=ユーザー指示)。
 * - 帰結(シーンに登場)は success===true のときだけ(完了継続の自動適用と同じ条件。
 *   目標値なし=success null は自動登場しないため出さない)。
 * @param {?{areaLabel?: string, ghost?: boolean}} cc 登場の継続文脈(ctx.appearance)
 * @param {?{success?: ?boolean}} result 判定結果
 * @returns {?{areaLabel: string, ghost: boolean, appeared: boolean, hasInfo: boolean}}
 */
export function appearanceCardInfo(cc, result) {
    if (!cc) return null;
    const areaLabel = cc.areaLabel ?? "";
    const ghost = cc.ghost === true;
    return {
        areaLabel,
        ghost,
        appeared: result?.success === true,
        hasInfo: !!areaLabel || ghost,
    };
}

/**
 * 危険値ペナルティ(負の危険値)を持つ装備を携帯しているか(サンクチュアリの登場不可判定)。
 * 携帯条件は appearanceModifier の集計(computeOutfitAggregates)と同じ isCarrying。
 * @param {Array<{type: string, system: object}>} items アクターの全アイテム(素オブジェクト可)
 * @returns {boolean}
 */
export function hasNegativeDangerOutfit(items) {
    return (items ?? []).some(item => {
        if (!OUTFIT_ITEM_TYPES.has(item.type)) return false;
        const s = item.system;
        if (!s?.isCarrying) return false;
        if (s.appearancePenalty?.mode !== "value") return false;
        return (Number(s.appearancePenalty.value) || 0) < 0;
    });
}

/**
 * シーン行の登場設定の要約表示(シナリオコントロールパネルの「登場：」行・2026-08-09 ユーザー指示)。
 * 「〈社会：N◎VA、ストリート〉〈医療〉 10」形式＝指定技能(整形済み)を並べ、末尾に目標値。
 * 登場不可のシーンは「不可」。指定技能も目標値も無ければ ""(行そのものを出さない)。
 * @param {{mode?: string, targetValue?: ?number, skillNames?: Array<string>}} args
 *        skillNames は formatGroupedSkillNames で解決・整形済みの表示名
 * @returns {string}
 */
export function formatAppearanceSummary({ mode = "area", targetValue = null, skillNames = [] } = {}) {
    if (mode === "none") return "不可";
    const skills = (skillNames ?? []).join("");
    const tn = Number.isFinite(Number(targetValue)) && targetValue !== null && targetValue !== ""
        ? String(targetValue) : "";
    // 技能と目標値の間は不改行スペース: 幅の狭いパネルで折り返すと目標値だけが次行に取り残され、
    // 何の数値か分からなくなる(隔離描画で確認・2026-08-09)
    return [skills, tn].filter(Boolean).join("\u00A0");
}

/**
 * 「登場：不可」のシーンか(2026-08-09 ユーザー裁定)。シーンプレイヤー以外のキャストは登場
 * できないシーンで、**チーム免除でも登場できない**。登場判定そのものは行える(結果が必ず
 * 失敗になる=2026-08-15 裁定・appearanceCheckParams の forcedFailure)ため、このゲートが
 * 塞ぐのはチーム経由の自動登場だけ。RL による登場(パネルの手動登場・台本の事前設定)は
 * このゲートの外側にある。
 * @param {?{appearanceMode?: string}} row 正規化済みシーン行
 * @returns {boolean}
 */
export function isAppearanceBlockedScene(row) {
    return (row?.appearanceMode ?? "area") === "none";
}

/**
 * シーン行の「登場キャラクター」事前設定を正規化する(14-8)。
 * `hideName` は名前を伏せて登場させる指定(卓には「？？？」と表示される)。
 * @param {?Array<{actorId?: string, hideName?: boolean}>} list
 * @returns {Array<{actorId: string, hideName: boolean}>}
 */
export function normalizeAppearanceActors(list) {
    return (Array.isArray(list) ? list : [])
        .map(entry => ({
            actorId:  String(entry?.actorId ?? ""),
            hideName: entry?.hideName === true,
        }))
        .filter(entry => entry.actorId);
}

/**
 * シーン入場時に登場させるキャラクターの集合(14-8)。
 * シーンプレイヤーのキャラクター(判定なしで登場する)に、台本の事前設定を重ねる。
 * 両方に居る場合はシーンプレイヤーとしての登場を採る——シーンプレイヤーは卓に開示された
 * 主役であり、名前を伏せる対象にならないため。
 * @param {?{appearanceActors?: Array<object>}} row 正規化済みシーン行
 * @param {{scenePlayerActorId?: string}} [args]
 * @returns {Array<{actorId: string, hideName: boolean}>}
 */
export function sceneEntryAppearances(row, { scenePlayerActorId = "" } = {}) {
    const entries = scenePlayerActorId ? [{ actorId: scenePlayerActorId, hideName: false }] : [];
    for (const entry of normalizeAppearanceActors(row?.appearanceActors)) {
        if (entries.some(e => e.actorId === entry.actorId)) continue;
        entries.push(entry);
    }
    return entries;
}

/**
 * キャラクター選択プルダウンの type 別グループ(14-8)。RL の登場候補(パネル)と台本の
 * 事前設定(アクトシート)で共用する。並びは CHARACTER_ACTOR_TYPES の順、空の群は出さない。
 * RL は登場判定を経ずに誰でも登場させられる(2026-08-09 ユーザー裁定)ため、キャストも含む。
 * @param {Array<{id: string, name: string, type: string, appearing?: boolean}>} actors
 * @param {{labelOf?: (type: string) => string, excludeAppearing?: boolean}} [args]
 *        excludeAppearing=登場中を候補から外す(パネルの追加プルダウン)
 * @returns {Array<{label: string, actors: Array<{id: string, name: string}>}>}
 */
export function groupCharacterChoices(actors, { labelOf = t => t, excludeAppearing = false } = {}) {
    return CHARACTER_ACTOR_TYPES
        .map(type => ({
            label: labelOf(type),
            actors: (actors ?? [])
                .filter(a => a?.type === type && !(excludeAppearing && a.appearing === true))
                .map(a => ({ id: a.id, name: a.name })),
        }))
        .filter(group => group.actors.length > 0);
}

/** 登場判定の既定候補(社会/コネ分類)の識別キーか。 */
export function isAppearanceSkillKey(identificationKey) {
    if (!identificationKey) return false;
    return ["society", "contact"].some(p =>
        identificationKey === p || identificationKey.startsWith(`${p}_`));
}

/**
 * 登場で盤面に出すトークンの配置位置を決める(2026-08-23 ユーザー指示「トークンを盤面に
 * 出す＝登場」)。盤面矩形の中央へグリッドスナップで置き、既に同じ位置にトークンがあれば
 * グリッド単位で右へずらす(シーン開始の自動登場が複数並んでも重ならない)。
 * @param {{center: {x: number, y: number}, size: {width: number, height: number},
 *          gridSize: number, occupied?: Array<{x: number, y: number}>}} args
 *        center=盤面矩形の中心(px)・size=トークンの実寸(px)・occupied=既存トークンの左上座標
 * @returns {{x: number, y: number}}
 */
export function pickTokenDropPosition({ center, size, gridSize, occupied = [] }) {
    const grid = gridSize > 0 ? gridSize : 1;
    const snap = v => Math.round(v / grid) * grid;
    let x = snap(center.x - size.width / 2);
    const y = snap(center.y - size.height / 2);
    while (occupied.some(p => p.x === x && p.y === y)) x += grid;
    return { x, y };
}

/**
 * トークン削除が「退場」を意味するか(2026-08-23)。退場=トークン削除の新モデルでは、
 * そのアクターの**最後の1体**の削除だけが退場になる——トループの分身コピーのような同一
 * アクターの複数トークンは、残りがある限り削除しても退場ではない(旧同期の「非リンクは
 * RL の手動管理」の線引きを「最後の1体」規約に置き換えた Code 設計判断)。
 * @param {{appearing: boolean, sameActorTokenCount: number}} args
 *        sameActorTokenCount=削除対象を含む、盤面上の同一アクターのトークン数
 * @returns {boolean}
 */
export function tokenDeletionImpliesExit({ appearing, sameActorTokenCount }) {
    return appearing === true && sameActorTokenCount <= 1;
}
