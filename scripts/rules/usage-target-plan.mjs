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
 * - 明示ターゲットは常に尊重する(2026-07-19 ユーザー裁定): 対象の自動解決は「ターゲットの
 *   し忘れ」の救済であり、ターゲット済みの対象を「正規ではない」とはじかない。旧・手動
 *   ターゲットの妥当性(invalid=「ターゲットが間違っています」で中止)は撤廃。数・単複も検証しない。
 *   対象「自身」だけは値の意味どおり常に自分に解決する(他者レティクルは読み替え・ブロックはしない)。
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
 * @returns {{mode: "none"|"targets"|"autoSelf"|"dialog"}}
 *   none=対象なしで進行 / targets=現在のレティクルをそのまま使う /
 *   autoSelf=自分へレティクル付与 / dialog=対象選択ダイアログ
 */
export function planUsageTargets({
    target, cannotTargetSelf = false, opposed = false,
    targetedSelf = false, targetedOthers = false,
} = {}) {
    const group = usageTargetGroup(target);
    if (group === "none") return { mode: "none" };

    // 対象「自身」は値の意味どおり常に自分(いかなる場合でも自動付与=2026-07-18 確定。
    // 他者レティクルが立っていてもブロックせず自分へ読み替える=2026-07-19 妥当性 invalid 撤廃)
    if (group === "self") return { mode: cannotTargetSelf && !targetedSelf ? "dialog" : "autoSelf" };

    // 明示ターゲットは常に尊重する(2026-07-19 ユーザー裁定: 自動解決はターゲットし忘れの救済。
    // ターゲット済みの対象を「正規ではない」とはじかない。数・単複も検証しない)
    if (targetedSelf || targetedOthers) return { mode: "targets" };

    // 未ターゲット(し忘れ)の自動解決: 自動セルフは「自身に適用できない」フラグで抑止(→ダイアログ)
    if (group === "single") {
        if (cannotTargetSelf) return { mode: "dialog" };
        return { mode: opposed ? "dialog" : "autoSelf" };
    }
    // manual(チーム/シーン/範囲等): 対決ありのみダイアログ・非対決は対象要求なし
    return { mode: opposed ? "dialog" : "none" };
}
