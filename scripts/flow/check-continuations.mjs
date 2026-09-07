/**
 * @fileoverview 判定の完了継続レジストリ(2026-09-07 tnx-check-flow.mjs から移設)。
 *
 * 「判定が終わったあとに何をするか」を種別ごとに 1 箇所へ集めた表。判定フロー本体は
 * この表を回すだけで、種別ごとの分岐を持たない。表はフローの状態(this)を一切参照しない
 * ——独立して読める形なので、フロー本体と分けてある。
 */

import { resolveControlNegateFromCheck } from "./condition-resolution.mjs";
import { resolveAppearanceFromCheck } from "./appearance-check.mjs";

/**
 * 完了継続(判定完了後の後処理)のレジストリ(2026-07-16 一本化 → 2026-09-07 正本化)。
 *
 * **種別・実行順・初回適用・再実行ポリシーの唯一の正本**。スナップショット保存
 * (_buildRecheckContext)・再判定への引き継ぎ(startRecheck)・再実行(_rerunContinuation)、
 * そして **_execute の初回適用**もすべてこの表から導く。
 *
 * 経緯: 2026-07-16 に「種別リストが3箇所に複製され、追加漏れでカバーが再判定に
 * 引き継がれない」問題を受けて表を作ったが、初回適用は _execute 内の 10 個の分岐のまま
 * 残り、「**新しい継続種別は、この表と _execute の両方に追加する**」という約束を
 * コメントだけが担っていた。約束はコメントでは守らせられないので、表を回して適用する。
 *
 * **この表の並び順が実行順**(オブジェクトのキーは挿入順)。
 *
 * - phase: "beforeSync"=要求カードへ結果を送る前に効かせる(result そのものを書き換える種別)。
 *   既定は "afterSync"。
 * - apply(cc, result, env): 初回適用。env={messageId, actorId, suitMismatch, recheckCtx, render}。
 *   apply を持たない種別は初回に何もしない(カード投稿側で完結しているもの)。
 * - rerun(cc, result, env): 再判定/事後修正の着地からの再実行(2026-07-15 ユーザー確定)。
 *   - reaction: 対決の再解決(副作用なし=解決済みでも再解決)
 *   - recovery/repair/modification/appearance/purchase/controlNegate: 失敗→成功の遷移でのみ
 *     副作用を適用(冪等な除去/付与)= rerunOnSuccessOnly。成功→失敗は表示のみ(手動復元)
 *   - covering: 成立なら印を付け直す(付与済み/ダメージ算出後は内部ガードが弾く)
 *   - npcAcquire/movement: 表示のみ(rerun なし。移動カードの再描画は _applyRecheckReplacement)
 */
export const CONTINUATIONS = Object.freeze({
    // BS の無効/降格。判定は通常経路そのもので行われ、ここは結果の適用のみ(2026-07-08 裁定)。
    // 帰結テキストを result に載せ、emitCheckResult 経由で要求カードをライブ書き換えする
    // (別の結果カードは出さない)。**要求カードへ送る前**に効かせる必要がある
    controlNegate: {
        phase: "beforeSync",
        rerunOnSuccessOnly: true,
        async apply(cc, result) {
            const negate = await resolveControlNegateFromCheck(cc, result);
            if (negate) result.negateOutcome = negate;
        },
        async rerun(cc, result) {
            await resolveControlNegateFromCheck(cc, result);
        },
    },
    // NPC取得(11-6): heads/sourceName の転記とトークン配置。npc-acquisition は本フローを
    // import するため動的 import で循環を避ける
    npcAcquire: {
        async apply(cc, result) {
            const { completeAcquisitionFromCheck } = await import("./npc-acquisition.mjs");
            await completeAcquisitionFromCheck(cc, result);
        },
    },
    // リアクション判定(12-2): 攻撃カード上で対決を解決し、リアクションカードを結果カード化する。
    // recheckCtx をリアクションカードに保存し、再判定/修正の導線をそこに載せる(2026-07-15)
    reaction: {
        async apply(cc, result, { suitMismatch, recheckCtx, render } = {}) {
            const { completeReactionFromCheck } = await import("./attack-flow.mjs");
            await completeReactionFromCheck(cc, result, { suitMismatch, recheckCtx, render });
        },
        async rerun(cc, result) {
            const { completeReactionFromCheck } = await import("./attack-flow.mjs");
            await completeReactionFromCheck(cc, result, { allowResolved: true });
        },
    },
    // カバー(2026-07-16): 成立なら攻撃カードの対象にカバーの印を付ける(ダメージカードを
    // 出すとき付け替えられる)。目標値「なし」運用ではスート一致で成立(success は null)
    covering: {
        async apply(cc, result, { suitMismatch, actorId } = {}) {
            const { completeCoveringFromCheck } = await import("./attack-flow.mjs");
            await completeCoveringFromCheck(cc, result, {
                suitMismatch, coverer: game.actors.get(actorId) ?? null });
        },
        async rerun(cc, result, { actorId } = {}) {
            const { completeCoveringFromCheck } = await import("./attack-flow.mjs");
            await completeCoveringFromCheck(cc, result, { coverer: game.actors.get(actorId) ?? null });
        },
    },
    // 回復(2026-07-13): 成功で選択済みの状態(BS/戦闘不能/負傷)を除去する。治療メニュー起点も
    // この継続に一本化(2026-07-18・旧 ctx.treatment は廃止)。messageId=帰結行を刻む結果カード
    recovery: {
        rerunOnSuccessOnly: true,
        async apply(cc, result, { messageId = null } = {}) {
            const { resolveRecoveryFromCheck } = await import("./recovery-flow.mjs");
            await resolveRecoveryFromCheck(cc, result, { messageId });
        },
        async rerun(cc, result, { messageId = null } = {}) {
            const { resolveRecoveryFromCheck } = await import("./recovery-flow.mjs");
            await resolveRecoveryFromCheck(cc, result, { messageId });
        },
    },
    // 修理(2026-07-18): 成功で選択アウトフィットの故障(isMalfunction)を解除する
    repair: {
        rerunOnSuccessOnly: true,
        async apply(cc, result, { messageId = null } = {}) {
            const { resolveRepairFromCheck } = await import("./repair-flow.mjs");
            await resolveRepairFromCheck(cc, result, { messageId });
        },
        async rerun(cc, result, { messageId = null } = {}) {
            const { resolveRepairFromCheck } = await import("./repair-flow.mjs");
            await resolveRepairFromCheck(cc, result, { messageId });
        },
    },
    // 改造(16-4): 成功で選択項目(判定前選択)の改造行を対象へ適用する。
    // 再判定は失敗→成功の遷移でのみ適用(適用側に1項目1回の二重ガードあり)
    modification: {
        rerunOnSuccessOnly: true,
        async apply(cc, result, { messageId = null } = {}) {
            const { resolveModificationFromCheck } = await import("./modification-flow.mjs");
            await resolveModificationFromCheck(cc, result, { messageId });
        },
        async rerun(cc, result, { messageId = null } = {}) {
            const { resolveModificationFromCheck } = await import("./modification-flow.mjs");
            await resolveModificationFromCheck(cc, result, { messageId });
        },
    },
    // 登場(14-5): 成功で登場状態を付与する(ゴースト選択時は isGhost も)
    appearance: {
        rerunOnSuccessOnly: true,
        async apply(cc, result) {
            await resolveAppearanceFromCheck(cc, result);
        },
        async rerun(cc, result) {
            await resolveAppearanceFromCheck(cc, result);
        },
    },
    // 購入(16-3): 成功で辞典原本の複製をアクターへ付与する。
    // 再判定は失敗→成功の遷移でのみ(成功→失敗の付与済み複製の除去は手動)
    purchase: {
        rerunOnSuccessOnly: true,
        async apply(cc, result) {
            const { resolvePurchaseFromCheck } = await import("./purchase-flow.mjs");
            await resolvePurchaseFromCheck(cc, result);
        },
        async rerun(cc, result) {
            const { resolvePurchaseFromCheck } = await import("./purchase-flow.mjs");
            await resolvePurchaseFromCheck(cc, result);
        },
    },
    // 情報収集(14-9): 成功で自動開示(達成値以下の目標値まで一括・2026-08-16 裁定)。
    // 開示は単調(開くだけで閉じない)なので成功のたびに適用してよい——達成値が伸びれば追加開示・
    // 下がっても既開示は維持(rerunOnSuccessOnly だと成功→成功の達成値上昇で追加開示されない
    // ため使わない)。成功以外はハンドラ内で弾く。messageId=帰結行を刻み直す着地先カード(KI-042)
    infoGathering: {
        async apply(cc, result, { messageId = null } = {}) {
            const { resolveInfoGatheringFromCheck } = await import("./info-gathering.mjs");
            await resolveInfoGatheringFromCheck(cc, result, { messageId });
        },
        async rerun(cc, result, { messageId = null } = {}) {
            const { resolveInfoGatheringFromCheck } = await import("./info-gathering.mjs");
            await resolveInfoGatheringFromCheck(cc, result, { messageId });
        },
    },
    // 移動(12): カードの投稿(postMovementCard)で完結しており、初回適用も再実行も持たない。
    // 再判定時のカード再描画は _applyRecheckReplacement が行う。**文脈キーとして表に要る**
    // (_buildRecheckContext がこの表からスナップショット対象を導くため)
    movement: {},
});
