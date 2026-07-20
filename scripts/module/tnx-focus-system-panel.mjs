/**
 * @fileoverview FS判定パネル(フェーズ12-5・2026-07-20 確定)。
 *
 * シーンコントロールから開く。**全員に表示**し(プレイヤーが進行状況を参照できるようにする)、
 * 編集は RL のみ・PL は閲覧のみ。進行中の FS が無いときは「進行中のFS判定はありません」。
 *
 * 進行状態の正本はワールド設定(focus-system-state.mjs)。このパネルはその読み書き UI。
 */

import { listActiveFocusSystems, getActiveFocusSystem, startFocusSystem, updateFocusSystem, endFocusSystem } from "./focus-system-state.mjs";
import { activeProgressRow, clampGauge, gaugeMarkers, defeatConditionOptions } from "./focus-system-logic.mjs";
import { loadGroupedGeneralSkillChoices, loadSkillEntries, SKILL_PACKS } from "./skill-dictionary.mjs";
import { formatSkillName } from "./identification.mjs";
import { spinnerDialogActions } from "./tnx-dialog.mjs";
import { requestFocusSystemCheck } from "./focus-system-request.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SCOPE = "tokyo-nova-axleration";

/** 一般技能の識別キー → 〈技能名〉。 */
async function skillLabeler() {
    const entries = await loadSkillEntries(SKILL_PACKS.general);
    return (key) => {
        const hit = entries.find(s => s.identificationKey === key);
        return hit?.name ? formatSkillName(hit.name) : "";
    };
}

/** ワールドの FS判定ページを、所属ジャーナル名のグループで列挙する。 */
export function listFocusSystemPages() {
    const groups = [];
    for (const journal of game.journal) {
        const pages = journal.pages.filter(p => p.type === "focusSystem");
        if (!pages.length) continue;
        groups.push({
            label: journal.name,
            pages: pages.map(p => ({ uuid: p.uuid, name: p.name })),
        });
    }
    return groups;
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
            return {
                ...fs,
                progress,
                cut,
                cutLimit,
                isDefeatCut,
                defeatText:      isDefeatCut ? `${cutLimit} カット経過` : (fs.defeatCondition?.text ?? ""),
                cutRemaining:    Math.max(0, cutLimit - cut),
                progressPercent: fs.targetProgress > 0 ? Math.round((progress / fs.targetProgress) * 100) : 0,
                cutPercent:      cutLimit > 0 ? Math.round((cut / cutLimit) * 100) : 0,
                markers:         gaugeMarkers(fs.rows, fs.targetProgress),
                supportSkillLabel: label(fs.supportSkillKey),
                activeRow:       row ? { ...row, skillLabel: label(row.skillKey) || "（指定なし）" } : null,
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
        const page = await TnxFocusSystemPanel._promptStart();
        if (!page) return;
        const fs = await startFocusSystem(page.data, { sourcePageUuid: page.sourcePageUuid });
        if (!fs) return;
        await postFocusSystemStartCard(fs);
        this.render();
    }

    /**
     * 起動フォーム(判定要求ダイアログを踏襲)。読み込み元プルダウンで FS判定ページを選ぶと
     * 各欄が自動投入され、そのまま手で直せる。判定行はページから取り込む。
     * @returns {Promise<?{data:object, sourcePageUuid:?string}>}
     */
    static async _promptStart() {
        const content = await foundry.applications.handlebars.renderTemplate(
            "systems/tokyo-nova-axleration/templates/app/focus-system-start.hbs",
            {
                pageGroups:  listFocusSystemPages(),
                skillGroups: await loadGroupedGeneralSkillChoices(),
                defeatTypes: defeatConditionOptions("cut"),
            }
        );

        // 読み込み元を選んだ時点で各欄へ流し込む(判定行はここで保持し、送信時に使う)
        let loadedRows = [];
        const applyPage = async (el, uuid) => {
            const page = uuid ? await fromUuid(uuid) : null;
            const sys  = page?.system;
            loadedRows = sys ? foundry.utils.deepClone(sys.rows ?? []) : [];
            const set = (name, value) => {
                const input = el.querySelector(`[name="${name}"]`);
                if (input) input.value = value ?? "";
            };
            set("name",            page?.name ?? "");
            set("restriction",     sys?.restriction ?? "");
            set("targetProgress",  sys?.targetProgress ?? 0);
            set("defeatType",      sys?.defeatCondition?.type ?? "cut");
            set("cutLimit",        sys?.defeatCondition?.cutLimit ?? 0);
            set("defeatText",      sys?.defeatCondition?.text ?? "");
            set("defeatEffect",    sys?.defeatEffect ?? "");
            set("supportSkillKey", sys?.supportSkillKey ?? "");
            syncDefeat(el);
        };
        const syncDefeat = (el) => {
            const isCut = (el.querySelector('[name="defeatType"]')?.value ?? "cut") === "cut";
            el.querySelector(".fs-start-defeat-cut")?.toggleAttribute("hidden", !isCut);
            el.querySelector(".fs-start-defeat-other")?.toggleAttribute("hidden", isCut);
        };

        const result = await foundry.applications.api.DialogV2.wait({
            window: { title: "FS判定を開始" },
            classes: ["tokyo-nova", "tnx-dialog", "tnx-rl-request"],
            position: { width: 460 },
            content,
            actions: spinnerDialogActions,
            render: (_event, dialog) => {
                const el = dialog.element;
                el.querySelector('[name="sourcePageUuid"]')
                    ?.addEventListener("change", (e) => applyPage(el, e.target.value));
                el.querySelector('[name="defeatType"]')
                    ?.addEventListener("change", () => syncDefeat(el));
            },
            buttons: [
                { action: "ok", icon: "fas fa-play", label: "FS判定を開始", default: true,
                  callback: (_e, _b, dialog) => {
                      const el = dialog.element;
                      const v = (name) => el.querySelector(`[name="${name}"]`)?.value ?? "";
                      return {
                          sourcePageUuid: v("sourcePageUuid") || null,
                          data: {
                              name: v("name").trim() || "FS判定",
                              system: {
                                  restriction:     v("restriction").trim(),
                                  targetProgress:  Number(v("targetProgress")) || 0,
                                  defeatCondition: {
                                      type:     v("defeatType"),
                                      text:     v("defeatText").trim(),
                                      cutLimit: Number(v("cutLimit")) || 0,
                                  },
                                  defeatEffect:    v("defeatEffect").trim(),
                                  supportSkillKey: v("supportSkillKey"),
                                  rows:            loadedRows,
                                  memo:            "",
                              },
                          },
                      };
                  } },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });
        return result ?? null;
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
                    skillLabel:  label(r.skillKey) || "（指定なし）",
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
