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
import { buildRlDamageRollFlag, buildConditionGrantData, rlConditionChoices } from "./rl-grant-logic.mjs";
import { buildGrantedEffectData } from "./usage-effects.mjs";
import { buildBountyGrantData } from "./bounty-grant-logic.mjs";
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

/**
 * RL 任意の状態・効果付与のダイアログ。
 *
 * 状態(BS・戦闘不能)は対象アクターへ直接 AE を作る(親＝アクター自身)。効果値の決定
 * (衰弱の数字・重圧の対象能力値)・カスケード・制御判定による無効化は、付与経路を問わない
 * 既存の createActiveEffect フックが担うため、ここでは値を埋めない。
 *
 * 効果は既存アイテムの効果を**切り離したコピー**として複製する(供給元の更新・削除に追随しない)。
 * ゼロからの自作は Foundry 標準のアクター効果タブで行えるため、ここには用意しない。
 */
export class TnxRlGrantEffectApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-rl-grant-effect",
        tag: "form",
        classes: ["tokyo-nova", "tnx-rl-request"],
        window: { title: "状態・効果の付与", resizable: false },
        position: { width: 440 },
        form: {
            handler: TnxRlGrantEffectApp._onSubmit,
            closeOnSubmit: true,
        },
    };

    static PARTS = {
        form: { template: "systems/tokyo-nova-axleration/templates/app/rl-grant-effect.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return {
            ...context,
            targets: currentTargetActors().map(a => ({ uuid: a.uuid, name: a.name, img: a.img })),
            conditionGroups: rlConditionChoices(),
            effectItems: game.items.filter(i => i.effects.size > 0)
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja")),
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;

        const kindSelect = el.querySelector("[name=grantKind]");
        const syncSections = () => {
            const isCondition = (kindSelect?.value ?? "condition") === "condition";
            const cond = el.querySelector(".condition-section");
            const eff  = el.querySelector(".effect-section");
            if (cond) cond.hidden = !isCondition;
            if (eff)  eff.hidden  =  isCondition;
        };
        kindSelect?.addEventListener("change", syncSections);
        syncSections();

        // 供給元アイテム → その効果の一覧(表示は効果名・生の ID は出さない)
        const itemSelect   = el.querySelector("[name=sourceItemId]");
        const effectSelect = el.querySelector("[name=sourceEffectId]");
        const syncEffects = () => {
            if (!itemSelect || !effectSelect) return;
            const item = game.items.get(itemSelect.value);
            effectSelect.innerHTML = "";
            for (const e of (item?.effects ?? [])) {
                const opt = document.createElement("option");
                opt.value = e.id;
                opt.textContent = e.name;
                effectSelect.appendChild(opt);
            }
        };
        itemSelect?.addEventListener("change", syncEffects);
        syncEffects();
    }

    static async _onSubmit(event, form, _formData) {
        const targets = currentTargetActors();
        if (!targets.length) {
            ui.notifications.warn("対象をターゲットしてください。");
            return false;
        }
        const grantKind = form.querySelector("[name=grantKind]")?.value ?? "condition";

        let data = null;
        if (grantKind === "condition") {
            const kind = form.querySelector("[name=conditionKind]")?.value ?? "";
            data = buildConditionGrantData(kind);
            if (!data) {
                ui.notifications.warn("付与できる状態を選択してください。");
                return false;
            }
        } else {
            const item = game.items.get(form.querySelector("[name=sourceItemId]")?.value ?? "");
            const eff  = item?.effects?.get(form.querySelector("[name=sourceEffectId]")?.value ?? "");
            if (!eff) {
                ui.notifications.warn("付与する効果を選択してください。");
                return false;
            }
            data = buildGrantedEffectData(eff);
        }

        for (const actor of targets) {
            await actor.createEmbeddedDocuments("ActiveEffect", [foundry.utils.deepClone(data)]);
        }
        ui.notifications.info(`「${data.name}」を${targets.length}体に付与しました。`);
    }
}

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
    };

    static PARTS = {
        form: { template: "systems/tokyo-nova-axleration/templates/app/rl-grant-bounty.hbs" },
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return {
            ...context,
            targetActors: game.actors
                .filter(a => a.type === "cast")
                .map(a => ({ actorId: a.id, actorName: a.name, img: a.img }))
                .sort((a, b) => a.actorName.localeCompare(b.actorName, "ja")),
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
        const targets = game.actors
            .filter(a => a.type === "cast")
            .filter(a => form.querySelector(`[name="target_${a.id}"]`)?.checked)
            .map(a => ({ uuid: a.uuid, name: a.name }));
        if (!targets.length) {
            ui.notifications.warn("対象アクターを1体以上選択してください。");
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
            flags: { [SCOPE]: { bountyGrant: data } },
        });
    }
}

/** シーンコントロールから開く(GM のみ)。 */
export function openRlGrantBounty() {
    new TnxRlGrantBountyApp().render(true);
}

/** シーンコントロールから開く(GM のみ)。 */
export function openRlGrantDamage() {
    if (!currentTargetActors().length) {
        ui.notifications.warn("対象をターゲットしてください。");
        return;
    }
    new TnxRlGrantDamageApp().render(true);
}

/** シーンコントロールから開く(GM のみ)。 */
export function openRlGrantEffect() {
    if (!currentTargetActors().length) {
        ui.notifications.warn("対象をターゲットしてください。");
        return;
    }
    new TnxRlGrantEffectApp().render(true);
}
