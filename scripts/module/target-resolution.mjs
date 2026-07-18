/**
 * @fileoverview 用途実行時のターゲット解決(2026-07-16 一本化 → 2026-07-18 決定表駆動へ全面改訂)。
 *
 * 起動用途のタイプで場合分けせず、用途の「対決」×「対象」の決定表(usage-target-plan.mjs・
 * Combat_Flow.md「対象解決とカード形式の一般化」)で解決する。
 * - 対象「-」「解説参照」「その他」= 対象という概念がない(レティクルも読まない)。
 * - 対象「自身」= 常に自分へレティクル自動付与。「単体」= 非対決なら未ターゲット時に自動セルフ。
 * - 「自身に適用できない」(cannotTargetSelf)= 自動セルフ抑止(→選択ダイアログ・候補から自分を除外)。
 * - 手動ターゲットが対象にとれないキャラクターなら「ターゲットが間違っています」で中止。
 * - 対象にレティクルが付与されないのは対象なし群のみ=効果やダメージの対象は常に明示される。
 *   旧「自分を対象に続行」確認(回復/適用効果)と選択ダイアログの「（対象なし）」は全廃。
 */

import { planUsageTargets } from "./usage-target-plan.mjs";
import { isOpposedConfrontation } from "./confrontation-logic.mjs";

/** 現在ターゲット中(レティクル)のアクターを列挙する。 */
export function currentTargetActors() {
    return [...(game.user?.targets ?? [])].map(t => t?.actor).filter(Boolean);
}

/** アクターの場のトークンへレティクルを付与する(トークンが無ければ何もしない)。 */
function targetActorToken(actor) {
    const token = actor?.getActiveTokens?.()[0] ?? null;
    token?.setTarget(true, { releaseOthers: true });
}

/**
 * 用途の対象解決(決定表駆動・2026-07-18)。判定起動の全経路がここを通る。
 * @param {Actor} actor 使用者
 * @param {object} usage 用途エントリ(target / cannotTargetSelf / confrontation を読む)
 * @returns {Promise<Array<{uuid:string,name:string}>|null>} null=中止(通知済み)。[]=対象なし
 */
export async function resolveUsageTargetRefs(actor, usage) {
    const targeted = currentTargetActors();
    const plan = planUsageTargets({
        target:           usage?.target,
        cannotTargetSelf: usage?.cannotTargetSelf === true,
        opposed:          isOpposedConfrontation(usage?.confrontation),
        targetedSelf:     targeted.some(a => a.uuid === actor.uuid),
        targetedOthers:   targeted.some(a => a.uuid !== actor.uuid),
    });

    switch (plan.mode) {
        case "none":
            return [];
        case "invalid":
            // 手動ターゲットの妥当性(2026-07-18 ユーザー確定): 対象にとれないキャラクターが含まれる
            ui.notifications.warn("ターゲットが間違っています。");
            return null;
        case "targets": {
            const byUuid = new Map(targeted.map(a => [a.uuid, { uuid: a.uuid, name: a.name }]));
            return [...byUuid.values()];
        }
        case "autoSelf":
            // 対象「自身」(常時)・「単体」(非対決): 自分へレティクルを自動付与(2026-07-18 ユーザー確定)
            targetActorToken(actor);
            return [{ uuid: actor.uuid, name: actor.name }];
        case "dialog":
        default:
            return promptTargetToken(actor);
    }
}

/**
 * 未ターゲット時の対象選択ダイアログ。選んだトークンには**必ずレティクルを付与**して進める
 * (内部だけで対象を決めず、必ずターゲットされた対象に効果が及ぶようにする)。
 * 「（対象なし）」は置かない(2026-07-18 ユーザー確定=レティクル無しへの働きかけ不可。対象なしの
 * 運用は対象「-」等の用途で表す)。自分自身は候補に出さない(ダイアログに来るのは対決あり
 * または「自身に適用できない」のときだけのため)。
 * @param {Actor} actor 使用者(候補から除外)
 * @returns {Promise<Array<{uuid:string,name:string}>|null>} null=キャンセル(中止)
 */
async function promptTargetToken(actor) {
    const seen = new Set();
    const options = [];
    if (canvas?.ready) {
        for (const t of canvas.tokens.placeables) {
            const a = t.actor;
            if (!a || a.uuid === actor.uuid || seen.has(t.id)) continue;
            seen.add(t.id);
            options.push({ value: t.id, label: a.name });
        }
    }
    if (!options.length) {
        ui.notifications.warn("対象にできるトークンがありません（対象をターゲットしてから使用してください）。");
        return null;
    }
    // tnx-dialog はモジュールレベルで foundry を参照するため動的 import(テスト環境の非依存を保つ)
    const { TargetSelectionDialog } = await import("./tnx-dialog.mjs");
    const sel = await TargetSelectionDialog.prompt({
        title: "対象の選択",
        label: "対象を選択してください（トークンをターゲットしておくと複数対象を一括で狙えます）。",
        options,
        selectLabel: "決定",
    });
    if (sel === null || sel === undefined || sel === "") return null; // キャンセル
    const token = canvas.tokens?.get(sel);
    if (!token?.actor) return null;
    token.setTarget(true, { releaseOthers: true }); // 必ずレティクルを付与
    return [{ uuid: token.actor.uuid, name: token.actor.name }];
}
