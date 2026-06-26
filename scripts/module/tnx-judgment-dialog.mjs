/**
 * @fileoverview TnxJudgmentDialog - 判定コンテキスト表示ダイアログ
 *
 * 判定中にフローティングで表示される小さなダイアログ。
 * 手札の選択は HUD 側で行う（このダイアログにカード表示はない）。
 * 報酬点の選択はカード選択後に別プロンプトで行う（ルール順序に準拠）。
 *
 * 表示内容:
 *   - 判定種別ラベル、技能名
 *   - 使用可能スート記号
 *   - 目標値（設定されている場合）
 *   - 山札から判定ボタン、切り札ボタン、キャンセルボタン
 *
 * ×ボタンで閉じると判定をキャンセルする。
 */

import { TnxJudgmentFlow } from './tnx-judgment-flow.mjs';
import { getUserFlagData } from './user-flag-schema.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxJudgmentDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id:      "tnx-judgment-dialog",
        classes: ["tokyo-nova", "tnx-judgment-dialog"],
        window:  { title: "判定", icon: "fas fa-cards", minimizable: false },
        position: { width: 300 },
        actions: {
            drawFromDeck:    TnxJudgmentDialog._onDrawFromDeck,
            toggleTrumpMode: TnxJudgmentDialog._onToggleTrumpMode,
            cancel:          TnxJudgmentDialog._onCancel,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/dialog/judgment-dialog.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const ctx     = TnxJudgmentFlow.context;
        if (!ctx) return { ...context, noPending: true };

        const TYPE_LABEL = {
            skillCheck:   "技能判定",
            controlCheck: "制御判定",
            abilityCheck: "能力値判定",
        };
        const SUIT_SYMBOL = { spade: "♠", club: "♣", heart: "♥", diamond: "♦" };
        const SUIT_NAME   = { spade: "スペード（理性）", club: "クラブ（感情）", heart: "ハート（生命）", diamond: "ダイヤ（外界）" };

        // 切り札の有無を確認
        const userFlag  = getUserFlagData(game.user);
        const trumpPile = userFlag.trumpCardPileId ? await fromUuid(userFlag.trumpCardPileId) : null;
        const hasTrump  = (trumpPile?.cards.size ?? 0) > 0;

        return {
            ...context,
            typeLabel:      TYPE_LABEL[ctx.type] ?? ctx.type,
            skillLabel:     ctx.skillLabel,
            validSuits:     ctx.validSuits.map(s => ({
                key:    s,
                symbol: SUIT_SYMBOL[s] ?? s,
                name:   SUIT_NAME[s]   ?? s,
            })),
            hasTargetValue: ctx.targetValue !== null,
            targetValue:    ctx.targetValue,
            hasTrump,
            trumpMode:      TnxJudgmentFlow.trumpMode,
            hint:           TnxJudgmentFlow.trumpMode
                ? "手札から1枚を選択してください（Jokerとして使います）"
                : "手札からカードを選択してください",
        };
    }

    // ×ボタンで閉じたら判定をキャンセルする
    async _onClose(options) {
        await super._onClose(options);
        TnxJudgmentFlow.cancel();
    }

    // ─── アクションハンドラ ────────────────────────────────────────────────────

    static async _onDrawFromDeck(event) {
        event.preventDefault();
        await TnxJudgmentFlow.executeFromDeck();
    }

    static async _onToggleTrumpMode(event) {
        event.preventDefault();
        TnxJudgmentFlow.toggleTrumpMode();
    }

    static async _onCancel(event) {
        event.preventDefault();
        TnxJudgmentFlow.cancel();
    }
}
