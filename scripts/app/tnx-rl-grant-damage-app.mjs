/**
 * @fileoverview RL 任意ダメージ付与のダイアログ。
 *
 * ダメージは**既存のダメージカード以降のフローにそのまま合流**する(軽減ダイアログ・権限委譲・
 * チャート適用・トループ/エキストラ例外はすべて既存の経路が担う)。軽減を通すかどうかの選択肢は
 * 持たない(2026-07-20 裁定): 防護点で軽減できないダメージは種別 X で表現でき、軽減技能の可否は
 * 自由記述ないし口頭で伝えれば足りる。
 *
 * RL 任意付与(フェーズ12・2026-07-20 設計確定)の一部。判定を経由せず、RL がギミックや
 * ペナルティとして対象へ与える。対象はダイアログ内の共通の対象選択リスト(target-picker)で
 * 選ぶ(2026-07-21 ユーザー指示)——判定要求・報酬点の配布とも同じ形式。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { bindTargetPicker } from "../ui/target-picker.mjs";
import { buildRlDamageStagingFlag, RL_DAMAGE_TYPES, RL_DAMAGE_CATEGORIES, RL_DAMAGE_MODES } from "../rules/rl-grant.mjs";
import { formatAttackLabel } from "../rules/attack-flow.mjs";
import { listDamageGrantPresets, presetLabel, damagePresetToForm } from "../session/request-presets.mjs";
import { spinnerDialogActions } from "../ui/tnx-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CATEGORY_LABELS = { physical: "肉体", mental: "精神", social: "社会" };

const CATEGORY_OPTIONS = RL_DAMAGE_CATEGORIES;

/**
 * 中間カードの内訳プレビュー行(算出前に「何が来るか」を示す)。
 * 固定＝ダメージ値(物理は種別も)／カード×物理＝基準値(攻撃力相当)／カード×精神・社会＝カードのみ。
 */
function stagingSummaryRows({ mode, category, damageType, value }) {
    const isPhysical = category === "physical";
    if (mode === "card") {
        return isPhysical
            ? [{ label: "基準値（攻撃力相当）", value: formatAttackLabel(damageType, value) }]
            : [{ label: "ダメージ算出", value: "カードを出す" }];
    }
    const rows = [{ label: "ダメージ", value: String(Math.max(0, value)) }];
    if (isPhysical) rows.push({ label: "種別", value: damageType });
    return rows;
}

/**
 * RL 任意ダメージ付与のダイアログ。系統・決め方(固定/カード)・値・自由記述を指定して、
 * まず**命中確定・ダメージ算出前の中間カード**を投稿する(2026-07-24 ユーザー確定)。中間カードで
 * カバー等の「算出直前」効果を挟んでから、固定値の算出／カードを出す通常算出へ進む。
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
            CATEGORY_OPTIONS,
            DAMAGE_MODES: RL_DAMAGE_MODES,
            // 既定は生身の攻撃力と同じ I
            DAMAGE_TYPES: RL_DAMAGE_TYPES.map(t => ({ ...t, selected: t.value === "I" })),
            // 読み込み元(アクトシートのプリセット・2026-07-21)
            presetGroups: listDamageGrantPresets().map(g => ({
                label:   g.label,
                presets: g.presets.map((p, i) => ({ id: p.id, label: presetLabel(p, i, "ダメージ") })),
            })),
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        // 対象選択は4つのダイアログ共通の部品(2026-07-21)
        this._picker = bindTargetPicker(el.querySelector(".tnx-target-picker"));

        const categorySelect = el.querySelector("[name=category]");
        const modeSelect = el.querySelector("[name=mode]");
        // 系統・決め方に応じて欄を切り替える:
        // - ダメージ種別は物理のみ(精神・社会に対応防御力の概念が無い)
        // - 値のラベルは 固定＝「ダメージ」／カード＝「基準値（攻撃力相当）」
        // - カード×精神/社会は攻撃力の概念が無い＝ダメージ欄ごと隠す(カードのみ算出)
        const sync = () => {
            const isPhysical = (categorySelect?.value ?? "physical") === "physical";
            const isCard = (modeSelect?.value ?? "fixed") === "card";
            el.querySelector(".damage-type-field")?.toggleAttribute("hidden", !isPhysical);
            const label = el.querySelector(".damage-value-label");
            if (label) label.textContent = isCard ? "基準値" : "ダメージ";
            el.querySelector(".damage-fields-group")?.toggleAttribute("hidden", isCard && !isPhysical);
        };
        categorySelect?.addEventListener("change", sync);
        modeSelect?.addEventListener("change", sync);
        sync();

        // 読み込み元 → 各欄へ流し込む(対象アクターはプリセットに含めない)。モードも復元する
        el.querySelector("[name=presetId]")?.addEventListener("change", (e) => {
            const preset = listDamageGrantPresets().flatMap(g => g.presets).find(p => p.id === e.target.value);
            if (!preset) return;
            const values = damagePresetToForm(preset);
            for (const [name, value] of Object.entries(values)) {
                const field = el.querySelector(`[name=${name}]`);
                if (field) field.value = value;
            }
            sync();
        });
        // ± は DEFAULT_OPTIONS.actions(spinnerDialogActions)が処理する。
        // ここで手動リスナーを張ると二重発火して2ずつ動く
    }

    static async _onSubmit(event, form, _formData) {
        const targets = this._picker?.getTargets() ?? [];
        if (!targets.length) {
            ui.notifications.warn("対象を1体以上追加してください。");
            return false;
        }
        const category   = form.querySelector("[name=category]")?.value ?? "physical";
        const mode       = form.querySelector("[name=mode]")?.value ?? "fixed";
        const damageType = form.querySelector("[name=damageType]")?.value ?? "";
        const value      = Number(form.querySelector("[name=value]")?.value) || 0;
        const note       = form.querySelector("[name=note]")?.value?.trim() ?? "";

        // 命中確定・ダメージ算出前の中間カード(攻撃カードの器)。ここでカバー等の「算出直前」効果が
        // 使え、ボタンで固定算出／カードを出す通常算出へ進む。RL 由来は rlGrant マーカーで識別する。
        const flags = buildRlDamageStagingFlag({ targets, category, damageType, value, note, mode });
        await ChatMessage.create({
            content: await foundry.applications.handlebars.renderTemplate(
                "systems/tokyo-nova-axleration/templates/chat/rl-damage-card.hbs",
                {
                    categoryLabel: CATEGORY_LABELS[category] ?? category,
                    summaryRows:   stagingSummaryRows({ mode, category, damageType: flags.damageType, value }),
                }
            ),
            flags: { [SYSTEM_ID]: { attackCheck: flags } },
        });
    }
}

/** シーンコントロールから開く(GM のみ)。対象はダイアログ内で選ぶ(2026-07-21)。 */
export function openRlGrantDamage() {
    new TnxRlGrantDamageApp().render(true);
}
