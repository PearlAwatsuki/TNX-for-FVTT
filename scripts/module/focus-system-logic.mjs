/**
 * @fileoverview FS判定の純ロジック(フェーズ12-5・正本 Focus_System.md / Focus_System_Mechanics.md)。
 *
 * Foundry に依存しない部分だけを持つ(状態の読み書きは focus-system-state.mjs)。
 */

/**
 * 敗北条件の種別(ルール16)。**選択肢の正本はここ**——テンプレートへ書き写さない
 * (写した側が欠けても気づけないため・2026-07-21 是正の一般化)。
 * cut のときだけカットゲージと「残りカット数」を出す。
 */
export const DEFEAT_CONDITION_TYPES = Object.freeze([
    { value: "cut",   label: "カット経過" },
    { value: "other", label: "その他" },
]);

/** 敗北条件の種別のプルダウン選択肢。 */
export function defeatConditionOptions(selected = "cut") {
    return DEFEAT_CONDITION_TYPES.map(o => ({ ...o, selected: o.value === selected }));
}

/**
 * その進行値で有効な判定行(ルール8/9/12)。
 *
 * 判定行の「進行値」欄は**切り替えの閾値**で、**閾値 ≦ 現在進行値**を満たす行のうち
 * **閾値が最大の1行**が有効になる(2026-07-20 ユーザー裁定＝閾値ちょうどで切り替わる。
 * 「3」と書かれた行が4から有効になるなら、その表記にする意味がない)。
 * 「飛ばされた行は無視される」(ルール9)はこの定義から自動的に満たされる。
 *
 * @param {?Array<{threshold:number}>} rows 判定行
 * @param {number} progress 現在進行値
 * @returns {?object} 有効な判定行(該当なしは null)
 */
export function activeProgressRow(rows, progress) {
    const p = Number(progress) || 0;
    let best = null;
    for (const row of (rows ?? [])) {
        const t = Number(row?.threshold) || 0;
        if (t > p) continue;
        if (!best || t >= (Number(best.threshold) || 0)) best = row;
    }
    return best;
}

/**
 * ゲージの現在値(0 以上・最大値以下)。
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
export function clampGauge(value, max) {
    const m = Number(max) || 0;
    if (m <= 0) return 0;
    return Math.min(Math.max(Number(value) || 0, 0), m);
}

/**
 * 進行値ゲージに刻む切り替わりポイント(2026-07-20 ユーザー指示)。
 * 最大値(目標進行値)を超える閾値はゲージの外になるため含めない。
 * @param {?Array<{threshold:number}>} rows
 * @param {number} max 目標進行値
 * @returns {Array<{threshold:number, percent:number}>}
 */
export function gaugeMarkers(rows, max) {
    const m = Number(max) || 0;
    if (m <= 0) return [];
    return (rows ?? [])
        .map(r => Number(r?.threshold) || 0)
        .filter(t => t <= m)
        .map(t => ({ threshold: t, percent: Math.round((t / m) * 100) }));
}

/**
 * 起動時のスナップショットを組み立てる。
 *
 * **スナップショット方式**: 起動後に FS判定シートを編集しても実行中の FS は変わらない。
 * 進行状態(progress / cut)はここから始まり、以後の正本はワールド設定側にある。
 *
 * @param {{name:string, system:object}} page FS判定ページ(または同じ形の手動設定)
 * @param {{id?:string, sourcePageUuid?:?string}} [opts]
 * @returns {object} 実行中 FS のデータ
 */
export function buildFocusSystemSnapshot(page, { id = "", sourcePageUuid = null } = {}) {
    const sys = page?.system ?? {};
    return {
        id,
        sourcePageUuid,
        name:            page?.name ?? "",
        restriction:     sys.restriction ?? "",
        defeatCondition: {
            type:     sys.defeatCondition?.type ?? "cut",
            text:     sys.defeatCondition?.text ?? "",
            cutLimit: Number(sys.defeatCondition?.cutLimit) || 0,
        },
        defeatEffect:    sys.defeatEffect ?? "",
        targetProgress:  Number(sys.targetProgress) || 0,
        supportSkillKey: sys.supportSkillKey ?? "",
        rows:            (sys.rows ?? []).map(r => ({
            id:          r.id ?? "",
            threshold:   Number(r.threshold) || 0,
            skillKey:    r.skillKey ?? "",
            targetValue: Number(r.targetValue) || 0,
            progressMod: { ...(r.progressMod ?? { source: "none", param: "", formula: "" }) },
            note:        r.note ?? "",
        })),
        memo:     sys.memo ?? "",
        progress: 0,
        cut:      0,
    };
}
