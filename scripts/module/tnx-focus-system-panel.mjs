/**
 * @fileoverview FS判定パネル(フェーズ12-5・2026-07-20 確定)。
 *
 * シーンコントロールから開く。**全員に表示**し(プレイヤーが進行状況を参照できるようにする)、
 * 編集は RL のみ・PL は閲覧のみ。進行中の FS が無いときは「進行中のFS判定はありません」。
 *
 * 進行状態の正本はワールド設定(focus-system-state.mjs)。このパネルはその読み書き UI。
 */

import { listActiveFocusSystems, getActiveFocusSystem, startFocusSystem, updateFocusSystem, endFocusSystem } from "./focus-system-state.mjs";
import { activeProgressRow, clampGauge, gaugeMarkers } from "./focus-system-logic.mjs";
import { loadSkillEntries, SKILL_PACKS } from "./skill-dictionary.mjs";
import { formatSkillName } from "./identification.mjs";
import { requestFocusSystemCheck } from "./focus-system-request.mjs";
import { TnxFocusSystemStartApp } from "./focus-system-start-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SCOPE = "tokyo-nova-axleration";

/** 判定行の指定技能(複数)を表示名で連ねる。 */
function rowSkillLabel(row, label) {
    const keys = row?.skillKeys ?? (row?.skillKey ? [row.skillKey] : []);
    const names = keys.map(k => label(k)).filter(Boolean);
    return names.length ? names.join("・") : "（指定なし）";
}

/** 一般技能の識別キー → 〈技能名〉。 */
async function skillLabeler() {
    const entries = await loadSkillEntries(SKILL_PACKS.general);
    return (key) => {
        const hit = entries.find(s => s.identificationKey === key);
        return hit?.name ? formatSkillName(hit.name) : "";
    };
}

export class TnxFocusSystemPanel extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-focus-system-panel",
        classes: ["tokyo-nova", "tnx-fs-panel-app"],
        window: { title: "FS判定", resizable: true },
        position: { width: 460, height: "auto" },
        actions: {
            startNew:     TnxFocusSystemPanel._onStartNew,
            progressUp:   TnxFocusSystemPanel._onProgressUp,
            progressDown: TnxFocusSystemPanel._onProgressDown,
            cutUp:        TnxFocusSystemPanel._onCutUp,
            cutDown:      TnxFocusSystemPanel._onCutDown,
            succeed:      TnxFocusSystemPanel._onSucceed,
            defeat:       TnxFocusSystemPanel._onDefeat,
            requestProgress: TnxFocusSystemPanel._onRequestProgress,
            requestSupport:  TnxFocusSystemPanel._onRequestSupport,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/focus-system-panel.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const label = await skillLabeler();

        const systems = listActiveFocusSystems().map(fs => {
            const row = activeProgressRow(fs.rows, fs.progress);
            const isDefeatCut = (fs.defeatCondition?.type ?? "cut") === "cut";
            const cutLimit = Number(fs.defeatCondition?.cutLimit) || 0;
            const progress = clampGauge(fs.progress, fs.targetProgress);
            const cut      = clampGauge(fs.cut, cutLimit);
            // カット表示はカウントダウン(2026-07-24 ユーザー確定): 現在値＝cutLimit − 経過カット数。
            // 内部データ(fs.cut)は経過カット(カウントアップ・トラッカーの round と同じ向き)のまま持ち、
            // 表示だけ減算にして「リミット」感を出す。0 で敗北ライン(敗北確定は RL 操作＝ルール17)。
            const cutCurrent = Math.max(0, cutLimit - cut);
            return {
                ...fs,
                progress,
                cut,
                cutLimit,
                cutCurrent,
                isDefeatCut,
                defeatText:      isDefeatCut ? `${cutLimit} カット経過` : (fs.defeatCondition?.text ?? ""),
                progressPercent: fs.targetProgress > 0 ? Math.round((progress / fs.targetProgress) * 100) : 0,
                cutPercent:      cutLimit > 0 ? Math.round((cutCurrent / cutLimit) * 100) : 0,
                markers:         gaugeMarkers(fs.rows, fs.targetProgress),
                supportSkillLabels: (fs.supportSkillKeys ?? []).map(k => label(k)).filter(Boolean),
                activeRow:       row ? { ...row, skillLabel: rowSkillLabel(row, label) } : null,
            };
        });

        return { ...context, systems, canEdit: game.user.isGM, canStart: game.user.isGM };
    }

    // ─── 進行値・カットの手動増減(RL のみ) ────────────────────────────────────

    static async _onProgressUp(_event, target)   { await this.constructor._bump.call(this, target, "progress", 1); }
    static async _onProgressDown(_event, target) { await this.constructor._bump.call(this, target, "progress", -1); }
    static async _onCutUp(_event, target)        { await this.constructor._bump.call(this, target, "cut", 1); }
    static async _onCutDown(_event, target)      { await this.constructor._bump.call(this, target, "cut", -1); }

    static async _bump(target, field, delta) {
        const id = target.dataset.fsId;
        const fs = getActiveFocusSystem(id);
        if (!fs) return;
        const max = field === "progress"
            ? (Number(fs.targetProgress) || 0)
            : (Number(fs.defeatCondition?.cutLimit) || 0);
        await updateFocusSystem(id, { [field]: clampGauge((Number(fs[field]) || 0) + delta, max) });
        this.render();
    }

    // ─── 達成・敗北の確定(RL のみ) ────────────────────────────────────────────

    static async _onSucceed(_event, target) { await this.constructor._finish.call(this, target, true); }
    static async _onDefeat(_event, target)  { await this.constructor._finish.call(this, target, false); }

    /**
     * FS判定を終了する。**敗北時の処理はシステムが自動化しない**(内容が FS ごとに異なるため)。
     * 結果カードに敗北時の処理を掲示し、RL が任意ダメージ付与などで適用する。
     */
    static async _finish(target, succeeded) {
        const id = target.dataset.fsId;
        const fs = getActiveFocusSystem(id);
        if (!fs) return;
        const label = succeeded ? "達成" : "敗北";
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: `FS判定の${label}` },
            classes: ["tokyo-nova", "tnx-dialog"],
            content: `<p>「${foundry.utils.escapeHTML(fs.name)}」を${label}として終了しますか。</p>`,
        });
        if (!ok) return;
        const done = await endFocusSystem(id);
        if (!done) return;
        await postFocusSystemResultCard(done, succeeded);
        this.render();
    }

    // ─── 進行判定・支援判定の要求(RL のみ) ────────────────────────────────────

    static async _onRequestProgress(_event, target) {
        const fs = getActiveFocusSystem(target.dataset.fsId);
        if (fs) await requestFocusSystemCheck(fs, "progress");
    }

    static async _onRequestSupport(_event, target) {
        const fs = getActiveFocusSystem(target.dataset.fsId);
        if (fs) await requestFocusSystemCheck(fs, "support");
    }

    // ─── 起動 ────────────────────────────────────────────────────────────────

    static async _onStartNew(_event, _target) {
        const panel = this;
        new TnxFocusSystemStartApp({
            onStart: async (source, sourceUuid) => {
                const fs = await startFocusSystem(source, { sourceUuid });
                if (!fs) return;
                await postFocusSystemStartCard(fs);
                panel.render();
            },
        }).render(true);
    }

}

/**
 * FS開始カードを投稿する(全体公開)。**通知に徹し状態は持たない**(正本はワールド設定)。
 * @param {object} fs 実行中 FS
 */
export async function postFocusSystemStartCard(fs) {
    const label = await skillLabeler();
    const isCut = (fs.defeatCondition?.type ?? "cut") === "cut";
    await ChatMessage.create({
        content: await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/focus-system-start.hbs",
            {
                name:           fs.name,
                restriction:    fs.restriction,
                targetProgress: fs.targetProgress,
                defeatText:     isCut ? `${fs.defeatCondition?.cutLimit ?? 0} カット経過` : (fs.defeatCondition?.text ?? ""),
                rows: (fs.rows ?? []).map(r => ({
                    threshold:   r.threshold,
                    targetValue: r.targetValue,
                    skillLabel:  rowSkillLabel(r, label),
                })),
            }
        ),
        flags: { [SCOPE]: { focusSystemStart: { id: fs.id } } },
    });
}

/**
 * FS判定の結果カードを投稿する(全体公開)。敗北時は敗北時の処理を掲示するだけで、
 * ダメージ等の適用は RL が任意付与で行う(自動化しない=内容が FS ごとに異なるため)。
 * @param {object} fs 終了した FS
 * @param {boolean} succeeded 達成なら true
 */
export async function postFocusSystemResultCard(fs, succeeded) {
    const isCut = (fs.defeatCondition?.type ?? "cut") === "cut";
    await ChatMessage.create({
        content: await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/chat/focus-system-result.hbs",
            {
                name:           fs.name,
                succeeded,
                progress:       fs.progress,
                targetProgress: fs.targetProgress,
                isDefeatCut:    isCut,
                cut:            fs.cut,
                cutLimit:       fs.defeatCondition?.cutLimit ?? 0,
                defeatEffect:   fs.defeatEffect ?? "",
            }
        ),
        flags: { [SCOPE]: { focusSystemResult: { id: fs.id, succeeded } } },
    });
}

/** シーンコントロールから開く(全員)。 */
export function openFocusSystemPanel() {
    new TnxFocusSystemPanel().render(true);
}
