/**
 * @fileoverview TnxCheckDialog - 判定コンテキスト表示ダイアログ
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

import { TnxCheckFlow } from '../module/tnx-check-flow.mjs';
import { getUserFlagData } from '../module/user-flag-schema.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxCheckDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id:      "tnx-check-dialog",
        classes: ["tokyo-nova", "tnx-check-dialog"],
        window:  { title: "判定", icon: "fas fa-cards", minimizable: false },
        position: { width: 300 },
        actions: {
            drawFromDeck:    TnxCheckDialog._onDrawFromDeck,
            toggleTrumpMode: TnxCheckDialog._onToggleTrumpMode,
            cancel:          TnxCheckDialog._onCancel,
            modDecrement:    TnxCheckDialog._onModStep,
            modIncrement:    TnxCheckDialog._onModStep,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/dialog/check-dialog.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const ctx     = TnxCheckFlow.context;
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

        // スタン/説得の宣言トグル(攻撃の判定のみ・2026-07-15 ユーザー確定): 物理攻撃かつ canStun→
        // スタン、精神攻撃→説得(常時)、社会・非攻撃→出さない。既定オフ・宣言は攻撃ペイロードに載る
        const atk = ctx.attack;
        let stunOption = null;
        if (atk?.category === "physical" && atk.stunCapable) {
            stunOption = { label: "スタン攻撃として実行", checked: atk.stunDeclared === true };
        } else if (atk?.category === "mental") {
            stunOption = { label: "説得として実行", checked: atk.stunDeclared === true };
        }

        return {
            stunOption,
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
            trumpMode:      TnxCheckFlow.trumpMode,
            // 状況ボーナス/ペナルティの手動入力(2026-07-14 ユーザー確定=全ての判定で入力可能に)。
            // 通常判定=達成値へ加算・制御判定=制御値(成功条件)へ加算。代用判定・再判定の
            // 引き継ぎ値(ctx.manualMod)が初期値に入る
            manualMod:      ctx.manualMod ?? 0,
            manualModLabel: ctx.type === "controlCheck" ? "制御値への修正（手動）" : "修正値（手動）",
            hint:           TnxCheckFlow.trumpMode
                ? "手札から1枚を選択してください（Jokerとして使います）"
                : "手札からカードを選択してください",
        };
    }

    /** @override 修正値入力の変更を判定コンテキストへ同期する(カードプレイ時に読まれる)。 */
    _onRender(context, options) {
        super._onRender?.(context, options);
        const input = this.element.querySelector('input[name="checkManualMod"]');
        input?.addEventListener("change", () => {
            TnxCheckFlow.setManualMod(Number(input.value) || 0);
        });
        // スタン/説得の宣言トグルを判定コンテキストへ同期する(カードプレイ時に読まれる・2026-07-15)
        const stunInput = this.element.querySelector('input[name="stunDeclared"]');
        stunInput?.addEventListener("change", () => TnxCheckFlow.setStunDeclared(stunInput.checked));
    }

    // ×ボタンで閉じたら判定をキャンセルする
    async _onClose(options) {
        await super._onClose(options);
        TnxCheckFlow.cancel();
    }

    // ─── アクションハンドラ ────────────────────────────────────────────────────

    static async _onDrawFromDeck(event) {
        event.preventDefault();
        await TnxCheckFlow.executeFromDeck();
    }

    static async _onToggleTrumpMode(event) {
        event.preventDefault();
        TnxCheckFlow.toggleTrumpMode();
    }

    static async _onCancel(event) {
        event.preventDefault();
        TnxCheckFlow.cancel();
    }

    /** 修正値スピナーの ± ボタン。step 後にコンテキストへ同期する。 */
    static _onModStep(event, target) {
        event.preventDefault();
        const input = target.closest(".number-input-spinner")?.querySelector('input[name="checkManualMod"]');
        if (!input) return;
        if (target.dataset.action === "modIncrement") input.stepUp();
        else input.stepDown();
        TnxCheckFlow.setManualMod(Number(input.value) || 0);
    }
}
