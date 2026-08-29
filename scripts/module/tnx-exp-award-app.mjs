/**
 * @fileoverview 経験点配布アプリ(フェーズ14-7・2026-08-08 ユーザー裁定＝半自動)。
 *
 * アクト終了(シナリオコントロールパネル)の確定後に開く。RL がプレイヤーごとのチェック項目と
 * 数値カウント(神業・登場シーン=手入力)を入れると合計を自動計算し、確定で各ユーザーの
 * **履歴(User flag)へ行を自動追加**する(`exp.total` は既存の履歴集計に乗る)。RL 自身の分
 * (会場手配＋PL合計÷min(3, PL人数)[切り捨て])も同時に記帳する。
 *
 * 取得条件の判定そのもの(良い RP だったか等)は主観を含むため自動化しない(§4.2)——
 * 集計と記帳だけを引き受ける。純ロジックは exp-award-logic.mjs。
 */

import { EXP_AWARD_CHECKS, calcPlayerExpTotal, calcRlExpBreakdown, awardEntryDate } from "./exp-award-logic.mjs";
import { getUserFlagData, historyAdd, saveUserFlagHistory } from "./user-flag-schema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** 表ヘッダー用の短縮ラベル(タイトル属性に正式名と配点を出す)。 */
const CHECK_SHORT_LABELS = {
    request: "依頼", venue: "会場", fullPlay: "参加", roleplay: "RP",
    ps: "PS", sps: "SPS", assist: "助力", progress: "進行",
};

export class TnxExpAwardApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /**
     * @param {{actName: string, onFinish: ?Function}} awardContext アクト名(履歴のタイトルに使う)と
     *   閉じた後に走らせる後続処理。**ポストアクトで経験点配布の後に来るもの**(アクト限定技能の
     *   後始末)をここに渡す——確定・キャンセル・✕のどれで閉じても最後に一度だけ走る
     *   (2026-08-13 ユーザー指示「コネ維持のダイアログは経験点配布後に」)
     */
    constructor(awardContext = {}, options = {}) {
        super(options);
        this.actName = awardContext.actName ?? "";
        this.onFinish = awardContext.onFinish ?? null;
        // 行の入力状態(ユーザー id → {checks, miracleCount, sceneCount})
        this.rows = new Map();
        for (const user of game.users.filter(u => !u.isGM)) {
            this.rows.set(user.id, { checks: {}, miracleCount: 0, sceneCount: 0 });
        }
        this.rlVenue = false;
    }

    static DEFAULT_OPTIONS = {
        id: "tnx-exp-award",
        classes: ["tokyo-nova", "tnx-exp-award-app"],
        window: { title: "経験点の配布", resizable: true },
        position: { width: 760, height: "auto" },
        actions: {
            spinUp:   TnxExpAwardApp._onSpin,
            spinDown: TnxExpAwardApp._onSpin,
            confirm:  TnxExpAwardApp._onConfirm,
            cancel:   TnxExpAwardApp._onCancel,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/exp-award-app.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.actName = this.actName;
        context.checkDefs = EXP_AWARD_CHECKS.map(def => ({
            ...def, short: CHECK_SHORT_LABELS[def.key] ?? def.key,
        }));
        context.rows = [...this.rows.entries()].map(([userId, row]) => {
            const user = game.users.get(userId);
            return {
                userId,
                userName: user?.name ?? "",
                castName: user?.character?.name ?? "",
                checks: EXP_AWARD_CHECKS.map(def => ({ key: def.key, value: row.checks[def.key] === true })),
                miracleCount: row.miracleCount,
                sceneCount: row.sceneCount,
                total: calcPlayerExpTotal(row),
            };
        });
        context.rlName = game.users.activeGM?.name ?? game.user.name;
        context.rlVenue = this.rlVenue;
        const rl = this._rlBreakdown();
        context.rlPlayerTotal = rl.playerTotal;
        context.rlDivisor = rl.divisor;
        context.rlShare = rl.share;
        context.rlTotal = rl.total;
        // RL 行の配分セル: 依頼・会場の2列を除いた残り(チェック6列+カウント2列)を跨ぐ
        context.rlSpan = EXP_AWARD_CHECKS.length - 2 + 2;
        return context;
    }

    _rlBreakdown() {
        const playerTotal = [...this.rows.values()].reduce((sum, row) => sum + calcPlayerExpTotal(row), 0);
        return calcRlExpBreakdown({ venue: this.rlVenue, playerTotal, playerCount: this.rows.size });
    }

    /** 入力の変更を状態に取り込み、合計表示を更新する(全再描画で反映)。 */
    _onRender(_context, _options) {
        for (const input of this.element.querySelectorAll('input[type="checkbox"][data-check-key]')) {
            input.addEventListener("change", (event) => {
                const { userId, checkKey } = event.currentTarget.dataset;
                const row = this.rows.get(userId);
                if (row) row.checks[checkKey] = event.currentTarget.checked;
                this.render(false);
            });
        }
        for (const input of this.element.querySelectorAll('input[type="number"]')) {
            input.addEventListener("change", (event) => {
                const { userId } = event.currentTarget.dataset;
                const row = this.rows.get(userId);
                if (!row) return;
                const value = Math.max(0, Math.trunc(Number(event.currentTarget.value) || 0));
                if (event.currentTarget.name === "miracleCount") row.miracleCount = value;
                else row.sceneCount = value;
                this.render(false);
            });
        }
        this.element.querySelector("input[data-rl-venue]")?.addEventListener("change", (event) => {
            this.rlVenue = event.currentTarget.checked;
            this.render(false);
        });
    }

    static async _onSpin(_event, target) {
        const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
        if (!input) return;
        if (target.dataset.action === "spinUp") input.stepUp();
        else input.stepDown();
        input.dispatchEvent(new Event("change", { bubbles: false }));
    }

    static async _onConfirm(_event, _target) {
        const date = awardEntryDate();
        const rl = game.users.activeGM?.name ?? game.user.name;
        const players = [...this.rows.keys()]
            .map(id => game.users.get(id)?.name)
            .filter(Boolean)
            .join("・");
        let written = 0;

        for (const [userId, row] of this.rows.entries()) {
            const total = calcPlayerExpTotal(row);
            if (total <= 0) continue;
            const user = game.users.get(userId);
            if (!user) continue;
            const entry = {
                id: foundry.utils.randomID(),
                date, title: this.actName || "アクト", exp: total, rl, players,
                // このアクトに連れて行ったキャスト(=ユーザーの割当キャラクター・cast 型のみ。
                // 2026-08-09 裁定)。キャストシートの履歴はこれで絞る
                castUuid: user.character?.type === "cast" ? user.character.uuid : "",
            };
            await saveUserFlagHistory(user, historyAdd(getUserFlagData(user).history, entry));
            written++;
        }

        const rlTotal = this._rlBreakdown().total;
        const gm = game.users.activeGM;
        if (gm && rlTotal > 0) {
            const entry = {
                id: foundry.utils.randomID(),
                date, title: this.actName || "アクト", exp: rlTotal, rl, players,
                // RL の分はキャストを連れて行っていない(卓を回した分)ため紐づけない
                castUuid: "",
            };
            await saveUserFlagHistory(gm, historyAdd(getUserFlagData(gm).history, entry));
            written++;
        }

        ui.notifications.info(`経験点を配布し、${written} 件を履歴に記帳しました。`);
        this.close();
    }

    static async _onCancel(_event, _target) {
        this.close();
    }

    /** 閉じたら後続処理(アクト限定技能の後始末)へ渡す。二重起動しないよう一度で捨てる。 */
    async _onClose(options) {
        super._onClose(options);
        const finish = this.onFinish;
        this.onFinish = null;
        if (finish) await finish();
    }
}
