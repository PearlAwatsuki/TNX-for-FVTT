/**
 * @fileoverview 対象解決とカード形式の決定表(2026-07-18 ユーザー確定・Foundry 非依存)。
 * 正本: Combat_Flow.md「対象解決とカード形式の一般化」。
 *
 * 起動用途のタイプで場合分けせず、用途の「対決」(対決欄の有効行の有無)と「対象」の値で決める。
 * - 対象「-」「解説参照」「その他」= 対象という概念がない(レティクルも読まない)。対決ありなら
 *   オープンリアクション。
 * - 対象「自身」= 常に自分へレティクル自動付与(いかなる場合でも)。
 * - 対象「単体」(※=単体+変更不可フラグは保存値が同じ single)= 非対決なら未ターゲット時に
 *   自動セルフ・対決ありなら選択ダイアログ。
 * - それ以外(チーム/シーン/範囲等)= 対決ありなら未ターゲット時に選択ダイアログ・非対決は要求なし。
 * - 「自身に適用できない」(cannotTargetSelf)= 自動セルフ解決の抑止(→ダイアログ)。
 * - 手動ターゲットの妥当性: ①フラグオンで自分をターゲット中 ②対象「自身」で自分以外を
 *   ターゲット中 → invalid(「ターゲットが間違っています」で起動中止)。数・単複は検証しない。
 */

/**
 * 対象値の群分け。
 * @param {string|undefined} target 用途の対象値(blank/self/single/team/scene/sceneSelect/area/areaSelect/explanation/other)
 * @returns {"none"|"self"|"single"|"manual"}
 */
export function usageTargetGroup(target) {
    if (!target || target === "blank" || target === "explanation" || target === "other") return "none";
    if (target === "self") return "self";
    if (target === "single") return "single";
    return "manual";
}

/**
 * カード形式: 対決あり×対象なし群=オープンリアクション / 対決あり×対象あり群=攻撃扱いの対決
 * (対象行つき対決判定カード) / 非対決=普通のカード。
 * 攻撃タイプの専用項目(武器・ダメージ・非対決時の制御値即確定)はタイプ駆動のままで、
 * この関数は対象要求とリアクションの形式だけを決める。
 * @param {{target?: string, opposed?: boolean}} usage
 * @returns {"open"|"targeted"|"plain"}
 */
export function usageCardForm({ target, opposed = false }) {
    if (!opposed) return "plain";
    return usageTargetGroup(target) === "none" ? "open" : "targeted";
}

/**
 * 対象解決の決定。
 * @param {object} p
 * @param {string} [p.target] 用途の対象値
 * @param {boolean} [p.cannotTargetSelf] 「自身に適用できない」フラグ
 * @param {boolean} [p.opposed] 対決判定か(対決欄に有効行があるか)
 * @param {boolean} [p.targetedSelf] 使用者自身をターゲット(レティクル)中か
 * @param {boolean} [p.targetedOthers] 使用者以外をターゲット中か
 * @returns {{mode: "none"|"invalid"|"targets"|"autoSelf"|"dialog"}}
 *   none=対象なしで進行 / invalid=ターゲットが間違っています(中止) /
 *   targets=現在のレティクルをそのまま使う / autoSelf=自分へレティクル付与 /
 *   dialog=対象選択ダイアログ
 */
export function planUsageTargets({
    target, cannotTargetSelf = false, opposed = false,
    targetedSelf = false, targetedOthers = false,
} = {}) {
    const group = usageTargetGroup(target);
    if (group === "none") return { mode: "none" };

    // 手動ターゲットの妥当性(2026-07-18 ユーザー確定): 対象にとれないキャラクターが
    // ターゲットに含まれていれば invalid。数・単複は検証しない
    if (targetedSelf || targetedOthers) {
        if (cannotTargetSelf && targetedSelf) return { mode: "invalid" };
        if (group === "self" && targetedOthers) return { mode: "invalid" };
        return { mode: "targets" };
    }

    // 未ターゲット: 自動セルフはフラグで抑止(→ダイアログ)
    if (group === "self") return { mode: cannotTargetSelf ? "dialog" : "autoSelf" };
    if (group === "single") {
        if (cannotTargetSelf) return { mode: "dialog" };
        return { mode: opposed ? "dialog" : "autoSelf" };
    }
    // manual(チーム/シーン/範囲等): 対決ありのみダイアログ・非対決は対象要求なし
    return { mode: opposed ? "dialog" : "none" };
}
