/**
 * @fileoverview RL による報酬点の配布ダイアログ(ルール上の「前金」)。
 *
 * 着地は system.bounty(アクト中の増減分)で、bountyBase(外界点由来の基礎点)は変えない。
 * **負数も受け付ける**ので、没収を別の仕組みを作らずに同じ機構で表せる。
 *
 * RL 任意付与(フェーズ12・2026-07-20 設計確定)の一部。判定を経由せず、RL がギミックや
 * ペナルティとして対象へ与える。対象はダイアログ内の共通の対象選択リスト(target-picker)で
 * 選ぶ(2026-07-21 ユーザー指示)——判定要求・報酬点の配布とも同じ形式。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { bindTargetPicker } from "../ui/target-picker.mjs";
import { buildBountyGrantData } from "../rules/bounty-grant.mjs";
import { listBountyPresets, presetLabel, bountyPresetToForm } from "../session/request-presets.mjs";
import { spinnerDialogActions } from "../ui/tnx-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * 報酬点の配布ダイアログ(前金・負数で没収)。判定要求と同じアクター登録方式で、
 * 受け取りはカードのボタンを対象の所有者が押す。
 */
export class TnxRlGrantBountyApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-rl-grant-bounty",
        tag: "form",
        classes: ["tokyo-nova", "tnx-rl-request"],
        window: { title: "報酬点の配布", resizable: false },
        position: { width: 440 },
        form: {
            handler: TnxRlGrantBountyApp._onSubmit,
            closeOnSubmit: true,
        },
        actions: spinnerDialogActions,
    };

    static PARTS = {
        form: { template: "systems/tokyo-nova-axleration/templates/app/rl-grant-bounty.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return {
            ...context,
            // 読み込み元(アクトシートのプリセット・2026-07-20)
            presetGroups: listBountyPresets().map(g => ({
                label:   g.label,
                presets: g.presets.map((p, i) => ({ id: p.id, label: presetLabel(p, i, "報酬点") })),
            })),
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        this._picker = bindTargetPicker(el.querySelector(".tnx-target-picker"));

        // 読み込み元 → 各欄へ流し込む(対象アクターはプリセットに含めない)
        el.querySelector("[name=presetId]")?.addEventListener("change", (e) => {
            const preset = listBountyPresets().flatMap(g => g.presets).find(p => p.id === e.target.value);
            if (!preset) return;
            const form = bountyPresetToForm(preset);
            const amount = el.querySelector("[name=amount]");
            const note   = el.querySelector("[name=note]");
            if (amount) amount.value = form.amount;
            if (note)   note.value   = form.note;
        });
        // ± は DEFAULT_OPTIONS.actions(spinnerDialogActions)が処理する
    }

    static async _onSubmit(event, form, _formData) {
        const targets = (this._picker?.getTargets() ?? []).map(t => ({ uuid: t.uuid, name: t.name }));
        if (!targets.length) {
            ui.notifications.warn("対象を1体以上追加してください。");
            return false;
        }
        const amount = Number(form.querySelector("[name=amount]")?.value) || 0;
        const note   = form.querySelector("[name=note]")?.value?.trim() ?? "";
        const data   = buildBountyGrantData({ targets, amount, note });

        await ChatMessage.create({
            content: await foundry.applications.handlebars.renderTemplate(
                "systems/tokyo-nova-axleration/templates/chat/bounty-grant.hbs",
                {
                    amountLabel: amount < 0 ? `${amount}` : `＋${amount}`,
                    note:        data.note,
                    targets:     data.targets,
                }
            ),
            flags: { [SYSTEM_ID]: { bountyGrant: data } },
        });
    }
}

/** シーンコントロールから開く(GM のみ)。 */
export function openRlGrantBounty() {
    new TnxRlGrantBountyApp().render(true);
}
