/**
 * @fileoverview RL 任意付与(フェーズ12・2026-07-20 設計確定)。
 *
 * 判定を経由せず、RL がギミックやペナルティとして対象へ与えるもの。
 * ダメージは**既存のダメージカード以降のフローにそのまま合流**する(軽減ダイアログ・
 * 権限委譲・チャート適用・トループ/エキストラ例外はすべて既存の経路が担う)。
 * 軽減を通すかどうかの選択肢は持たない(2026-07-20 裁定): 防護点で軽減できないダメージは
 * 種別 X で表現でき、軽減技能の可否は自由記述ないし口頭で伝えれば足りる。
 *
 * 対象はレティクル(ターゲット)で明示する。ダメージの対象が常に明示されるのは
 * 2026-07-18 の対象解決の規約どおり。
 */

import { currentTargetActors } from "./target-resolution.mjs";
import { buildRlDamageRollFlag } from "./rl-grant-logic.mjs";
import { spinnerDialogActions } from "./tnx-dialog.mjs";

const SCOPE = "tokyo-nova-axleration";
const CATEGORY_LABELS = { physical: "肉体", mental: "精神", social: "社会" };

const CATEGORY_OPTIONS = Object.freeze([
    { value: "physical", label: "肉体" },
    { value: "mental",   label: "精神" },
    { value: "social",   label: "社会" },
]);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * RL 任意ダメージ付与のダイアログ。ターゲット中のトークンへ、系統・値・自由記述を指定して
 * ダメージカードを投稿する。
 */
export class TnxRlGrantDamageApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-rl-grant-damage",
        tag: "form",
        classes: ["tokyo-nova", "tnx-rl-request"],
        window: { title: "ダメージ付与", resizable: false },
        position: { width: 440 },
        form: {
            handler: TnxRlGrantDamageApp._onSubmit,
            closeOnSubmit: true,
        },
        actions: spinnerDialogActions,
    };

    static PARTS = {
        form: { template: "systems/tokyo-nova-axleration/templates/app/rl-grant-damage.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return {
            ...context,
            targets: currentTargetActors().map(a => ({ uuid: a.uuid, name: a.name, img: a.img })),
            CATEGORY_OPTIONS,
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        for (const btn of this.element.querySelectorAll(".number-input-spinner [data-action=decrement]")) {
            btn.addEventListener("click", () => {
                btn.closest(".number-input-spinner")?.querySelector("input[type=number]")?.stepDown();
            });
        }
        for (const btn of this.element.querySelectorAll(".number-input-spinner [data-action=increment]")) {
            btn.addEventListener("click", () => {
                btn.closest(".number-input-spinner")?.querySelector("input[type=number]")?.stepUp();
            });
        }
    }

    static async _onSubmit(event, form, _formData) {
        const targets  = currentTargetActors().map(a => ({ uuid: a.uuid, name: a.name }));
        if (!targets.length) {
            ui.notifications.warn("対象をターゲットしてください。");
            return false;
        }
        const category = form.querySelector("[name=category]")?.value ?? "physical";
        const value    = Number(form.querySelector("[name=value]")?.value) || 0;
        const note     = form.querySelector("[name=note]")?.value?.trim() ?? "";

        await ChatMessage.create({
            content: await foundry.applications.handlebars.renderTemplate(
                "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs",
                { categoryLabel: CATEGORY_LABELS[category] ?? category }
            ),
            flags: {
                [SCOPE]: {
                    damageRoll: buildRlDamageRollFlag({ targets, category, value, note }),
                },
            },
        });
    }
}

/** シーンコントロールから開く(GM のみ)。 */
export function openRlGrantDamage() {
    if (!currentTargetActors().length) {
        ui.notifications.warn("対象をターゲットしてください。");
        return;
    }
    new TnxRlGrantDamageApp().render(true);
}
