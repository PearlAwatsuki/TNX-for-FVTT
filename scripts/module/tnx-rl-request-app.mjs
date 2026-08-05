/**
 * @fileoverview TnxRlRequestApp - RL 判定要求ダイアログ
 *
 * GM がシーンコントロールのボタンから開く ApplicationV2 フォーム。
 * 送信すると ChatMessage を生成し、対象 PL の手元に「判定する」ボタンが出現する。
 *
 * RL 要求フロー(フェーズ 8-5):
 *   1. GM が判定要求ダイアログを開く（シーンコントロール → 判定要求ボタン）
 *   2. 判定種別・技能・目標値・対象 PL を入力して送信
 *   3. ChatMessage 生成 → 全クライアントに配信
 *   4. 対象 PL が「判定する」クリック → onDoCheck() → TnxCheckFlow.open()
 *   5. 判定結果がチャットに追記される
 */

import { ALL_SUITS } from './tnx-check-engine.mjs';
import { TnxCheckFlow } from './tnx-check-flow.mjs';
import { buildSkillOptions } from './skill-select.mjs';
import { findItemByIdentificationKey, formatSkillName, itemDisplayName } from './identification.mjs';
import { enumerateRequestComboCandidates, buildRequestUsageChoices } from './usage-check-context.mjs';
import { loadGroupedGeneralSkillChoices, loadSkillEntries, SKILL_PACKS } from './skill-dictionary.mjs';
import { listCheckRequestPresets, presetLabel, checkRequestPresetToForm } from './request-presets.mjs';
import { bindTargetPicker } from './target-picker.mjs';

/** 識別キー → 〈技能名〉(辞典に無ければキーのまま)。 */
async function requestSkillLabel(key) {
    if (!key) return "";
    const entries = await loadSkillEntries(SKILL_PACKS.general);
    const hit = entries.find(s => s.identificationKey === key);
    return hit?.name ? formatSkillName(hit.name) : key;
}
import { toCheckRequestTargets } from './target-picker-logic.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SUIT_OPTIONS = Object.freeze([
    { value: "spade",   label: "♠ スペード（理性）" },
    { value: "club",    label: "♣ クラブ（感情）" },
    { value: "heart",   label: "♥ ハート（生命）" },
    { value: "diamond", label: "♦ ダイヤ（外界）" },
]);

const ABILITY_OPTIONS = Object.freeze([
    { value: "reason",  label: "理性 (♠)" },
    { value: "passion", label: "感情 (♣)" },
    { value: "life",    label: "生命 (♥)" },
    { value: "mundane", label: "外界 (♦)" },
]);

const ABILITY_TO_SUIT = Object.freeze({
    reason: "spade", passion: "club", life: "heart", mundane: "diamond",
});

export const CHECK_TYPE_LABELS = Object.freeze({
    skillCheck:   "技能判定",
    abilityCheck: "能力値判定",
    controlCheck: "制御判定",
});

const SUIT_SYMBOLS = Object.freeze({
    spade: "♠", club: "♣", heart: "♥", diamond: "♦",
});

/**
 * 判定種別のプルダウン選択肢(CHECK_TYPE_LABELS が正本)。テンプレートへ選択肢を書き写さない
 * ——写した側が欠けても気づけないため(2026-07-21 是正の一般化)。
 * @param {string} [selected]
 */
export function checkTypeOptions(selected = "") {
    return Object.entries(CHECK_TYPE_LABELS)
        .map(([value, label]) => ({ value, label, selected: value === selected }));
}

/**
 * 判定要求カードを投稿する(判定要求ダイアログ・FS判定の進行/支援判定要求で共用)。
 *
 * GM 側は目標値を常に表示するため、テンプレートには targetValueHidden=false を渡し、
 * 非公開の扱いはフラグ側で持つ(描画フックが参照する)。`extra` は追加のフラグ
 * (FS判定の focusSystemId など・完了継続で使う文脈)。
 *
 * @param {object} opts
 * @returns {Promise<ChatMessage>}
 */
export async function postCheckRequest({
    checkType = "skillCheck", identificationKey = "", skillLabel = "",
    identificationKeys = null,
    validSuits = [], targetValue = null, targetValueHidden = false,
    description = "", targets = [], extra = {},
} = {}) {
    // 指定技能は複数ありうる(FS判定の支援判定=2026-07-21)。単数の呼び出しはそのまま通す
    const keys = identificationKeys?.length ? [...identificationKeys]
               : (identificationKey ? [identificationKey] : []);
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/check-request.hbs",
        {
            typeLabel:    CHECK_TYPE_LABELS[checkType] ?? checkType,
            skillLabel,
            validSuits,
            suitSymbols:  SUIT_SYMBOLS,
            targetValue,
            targetValueHidden: false,
            description,
            targets,
        }
    );
    return ChatMessage.create({
        content,
        flags: {
            "tokyo-nova-axleration": {
                checkRequest: {
                    checkType,
                    identificationKey: keys[0] ?? null,
                    identificationKeys: keys,
                    skillLabel,
                    validSuits,
                    targetValue,
                    targetValueHidden,
                    description,
                    targets,
                    results: {},
                    status: "pending",
                    ...extra,
                }
            }
        },
    });
}

export class TnxRlRequestApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-rl-request",
        tag: "form",
        classes: ["tokyo-nova", "tnx-rl-request"],
        window: { title: "判定要求", resizable: false },
        position: { width: 520 },
        form: {
            handler: TnxRlRequestApp._onSubmit,
            closeOnSubmit: true,
        },
    };

    static PARTS = {
        form: { template: "systems/tokyo-nova-axleration/templates/app/rl-request-app.hbs" },
    };

    // ─── コンテキスト準備 ─────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // 技能プルダウン: 分類グループ(無条件取得技能/製作/芸術/操縦/社会/コネ)×正規ソート順
        // =シートの技能リストと同じ並び(2026-07-19 ユーザー指示)
        const skillGroups = await loadGroupedGeneralSkillChoices();
        // 読み込み元(アクトシートのプリセット・2026-07-20)。選ぶと各欄を自動投入する
        const checkTypes = checkTypeOptions("skillCheck");
        const presetGroups = listCheckRequestPresets().map(g => ({
            label:   g.label,
            presets: g.presets.map((p, i) => ({ id: p.id, label: presetLabel(p, i, "判定要求") })),
        }));
        return {
            ...context,
            skillGroups,
            presetGroups,
            checkTypes,
            SUIT_OPTIONS,
            ABILITY_OPTIONS,
        };
    }

    // ─── 描画後イベント配線 ────────────────────────────────────────────────────

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        // 対象選択は4つのダイアログ共通の部品(2026-07-21)
        this._picker = bindTargetPicker(el.querySelector(".tnx-target-picker"));

        // 読み込み元 → 各欄へ流し込む(対象アクターはプリセットに含めないので触らない)
        el.querySelector("[name=presetId]")?.addEventListener("change", (e) => {
            const preset = listCheckRequestPresets()
                .flatMap(g => g.presets).find(p => p.id === e.target.value);
            if (!preset) return;
            const form = checkRequestPresetToForm(preset);
            const set = (name, value) => {
                const input = el.querySelector(`[name="${name}"]`);
                if (!input) return;
                if (input.type === "checkbox") input.checked = value === true;
                else input.value = value ?? "";
            };
            set("checkType",         form.checkType);
            set("identificationKey", form.identificationKey);
            set("customSkillName",   form.customSkillName);
            set("targetValue",       form.targetValue);
            set("targetValueHidden", form.targetValueHidden);
            set("description",       form.description);
            for (const suit of ["spade", "club", "heart", "diamond"]) {
                set(`suit_${suit}`, form.validSuits.includes(suit));
            }
            el.querySelector("[name=checkType]")?.dispatchEvent(new Event("change", { bubbles: true }));
            el.querySelector("[name=identificationKey]")?.dispatchEvent(new Event("change", { bubbles: true }));
        });

        // 判定種別 → 技能/能力値セクション切り替え
        const typeSelect = el.querySelector("[name=checkType]");
        typeSelect?.addEventListener("change", (e) => this._updateSections(el, e.target.value));
        this._updateSections(el, typeSelect?.value ?? "skillCheck");

        // 技能識別キー → その他セクション切り替え
        const keySelect = el.querySelector("[name=identificationKey]");
        const otherSection = el.querySelector(".other-skill-section");
        const syncOther = () => {
            if (otherSection) otherSection.hidden = (keySelect?.value ?? "") !== "";
        };
        keySelect?.addEventListener("change", syncOther);
        syncOther();

        // number-input-spinner ボタン
        for (const btn of el.querySelectorAll(".number-input-spinner [data-action=decrement]")) {
            btn.addEventListener("click", () => {
                btn.closest(".number-input-spinner")?.querySelector("input[type=number]")?.stepDown();
            });
        }
        for (const btn of el.querySelectorAll(".number-input-spinner [data-action=increment]")) {
            btn.addEventListener("click", () => {
                btn.closest(".number-input-spinner")?.querySelector("input[type=number]")?.stepUp();
            });
        }
    }

    /** 判定種別に応じて技能/能力値セクションを表示切替 */
    _updateSections(el, checkType) {
        const isSkill = checkType === "skillCheck";
        const skillSection   = el.querySelector(".skill-section");
        const abilitySection = el.querySelector(".ability-section");
        if (skillSection)   skillSection.hidden   = !isSkill;
        if (abilitySection) abilitySection.hidden =  isSkill;
    }

    // ─── フォーム送信ハンドラ ─────────────────────────────────────────────────

    static async _onSubmit(event, form, _formData) {
        const checkType = form.querySelector("[name=checkType]")?.value ?? "skillCheck";

        // 技能識別キー（技能判定時のみ）
        const identificationKey = (checkType === "skillCheck")
            ? (form.querySelector("[name=identificationKey]")?.value ?? "")
            : "";

        // 技能/能力値ラベル
        let skillLabel;
        if (checkType === "skillCheck") {
            // 技能名の表示は 〈〉 整形(2026-07-18・識別マーク省去。キー未解決の生値はそのまま)
            if (identificationKey) {
                const entries = await loadSkillEntries(SKILL_PACKS.general);
                const matched = entries.find(s => s.identificationKey === identificationKey);
                skillLabel = matched?.name ? formatSkillName(matched.name) : identificationKey;
            } else {
                const custom = form.querySelector("[name=customSkillName]")?.value?.trim();
                skillLabel = custom ? formatSkillName(custom) : "（指定技能）";
            }
        } else {
            const abilityKey = form.querySelector("[name=abilityKey]")?.value ?? "reason";
            const abilityLabel = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" }[abilityKey]
                ?? abilityKey;
            skillLabel = checkType === "controlCheck"
                ? `${abilityLabel}（制御判定）`
                : abilityLabel;
        }

        // 有効スート
        let validSuits;
        if (checkType === "skillCheck" && !identificationKey) {
            // その他: GM が明示的にスートを選択
            validSuits = [...form.querySelectorAll("[name^='suit_']:checked")]
                .map(cb => cb.name.replace("suit_", ""));
            if (!validSuits.length) validSuits = [...ALL_SUITS];
        } else if (checkType === "skillCheck") {
            // 識別キーあり: PL 側の技能アイテムから getComboSuits で決定するため空
            validSuits = [];
        } else {
            // abilityCheck / controlCheck: 選択した能力値のスートのみ
            const abilityKey = form.querySelector("[name=abilityKey]")?.value ?? "reason";
            validSuits = [ABILITY_TO_SUIT[abilityKey] ?? "spade"];
        }

        // 目標値
        const rawTn = parseInt(form.querySelector("[name=targetValue]")?.value);
        const targetValue        = Number.isFinite(rawTn) && rawTn > 0 ? rawTn : null;
        const targetValueHidden  = form.querySelector("[name=targetValueHidden]")?.checked ?? false;

        // 説明文
        const description = form.querySelector("[name=description]")?.value?.trim() ?? "";

        // 対象アクター(2026-07-19: ユーザー選択→アクター登録。判定ボタンはそのアクターの
        // 所有者権限を持つユーザーが押せる=接続状況・キャラクター割り当てに依存しない)
        const targets = toCheckRequestTargets(this._picker?.getTargets() ?? []);
        if (!targets.length) {
            ui.notifications.warn("対象を1体以上追加してください。");
            return false;
        }

        await postCheckRequest({
            checkType, identificationKey, skillLabel, validSuits,
            targetValue, targetValueHidden, description, targets,
        });
    }

    // ─── 判定実行ハンドラ（チャットから呼ばれる）─────────────────────────────

    /**
     * チャットの「判定する」ボタン押下時に呼ばれる。
     * 技能アイテムを解決し、TnxCheckFlow.open() に渡す。
     *
     * @param {object} flagData    - message.flags["tokyo-nova-axleration"].checkRequest
     * @param {string} actorId     - 判定を行うキャスト Actor ID
     * @param {string} messageId   - 要求元 ChatMessage ID
     */
    static async onDoCheck(flagData, actorId, messageId) {
        const actor = game.actors.get(actorId);
        if (!actor) {
            ui.notifications.warn("対象のキャストが見つかりません。");
            return;
        }

        const {
            checkType,
            identificationKey,
            skillLabel,
            validSuits: flagSuits,
            targetValue,
        } = flagData;

        // 技能判定(識別キーで技能を指定): 起動は唯一の起動関数へ集約(2026-07-15 ユーザー確定)。
        // 用途・コンボ・消費・判定ボーナス・適用効果はシートの技能クリックと全く同じ処理で解決し、
        // ここでは判定要求文脈(要求元・目標値・代用)だけを注入する。
        // 代用判定(2026-07-09): 指定技能を持たなくてもハードブロックせず、別技能で代用できる
        // (可否・ペナルティの裁定は卓=修正は判定者が手入力)。組み合わせの可否はユーザー/RL が決める。
        // ※能力値判定・制御判定・技能名のみ(識別キー無し)の要求は技能アイテムを起動しないため直接 open。
        // 指定技能が複数の要求(FS判定の支援判定)は、どの技能で応じるかを先に選ぶ。
        // 選んだ後は単数の要求と全く同じ経路を通る(KI-025 の二段階化には手を入れない)
        const requestKeys = flagData.identificationKeys?.length
            ? flagData.identificationKeys
            : (identificationKey ? [identificationKey] : []);
        if (checkType === "skillCheck" && requestKeys.length) {
            const chosenKey = requestKeys.length === 1
                ? requestKeys[0]
                : await TnxRlRequestApp._promptDesignatedSkill(requestKeys);
            if (!chosenKey) return;
            const chosenLabel = await requestSkillLabel(chosenKey);
            const matchedItem = findItemByIdentificationKey(actor, chosenKey, { type: "generalSkill" });
            // KI-025(2026-07-19): 指定技能を参加技能(ベース/組み合わせ)に含む他アイテムの用途も
            // 応答候補に列挙する(組み合わせ判定は要求への正当な応答=2026-07-17 ユーザー指摘。
            // 代用判定(卓裁定つき)へ誤誘導しない)。起動は唯一の起動関数へ用途 ID 直接指定で委譲
            const comboCandidates = enumerateRequestComboCandidates(actor, chosenKey,
                { excludeItemId: matchedItem?.id ?? "" });
            const choice = await TnxRlRequestApp._promptSkillUse(actor,
                { matchedItem, requestedLabel: chosenLabel, comboCandidates });
            if (!choice) return;
            const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
            const extra = { requestMessageId: messageId, targetValue: targetValue ?? null };
            if (choice.usageId) extra.usageId = choice.usageId;
            if (choice.substitute) {
                extra.substitution = { requestedLabel: chosenLabel, usedName: choice.item.name };
                extra.manualMod = choice.manualMod;
            }
            // FS 支援判定(2026-08-05 ユーザー確定): 支援は普通にターゲットして行う。判定を行う時点で
            // レティクルにした1体を支援対象とし、結果に載せて autoApplyFocusSupport が対象へ支援 AE を
            // 付与する。ターゲットが無い(または複数)ときは、他の用途と同じ対象選択ダイアログで1体を選ばせる
            // (2026-08-06 ユーザー指摘＝中止でなくダイアログ。選ぶとレティクルも付与される)。以降のフローで
            // レティクルが変わっても崩れないよう、押下時に確定して渡す。
            if (flagData.focusSystemKind === "support") {
                let picked = [...(game.user?.targets ?? [])];
                if (picked.length !== 1) {
                    const { promptTargetToken } = await import("./target-resolution.mjs");
                    const refs = await promptTargetToken(actor);
                    if (!refs?.length) return; // キャンセルは中止
                    picked = [...(game.user?.targets ?? [])]; // ダイアログが選んだ対象にレティクルを付与済み
                }
                const targetActorId = picked[0]?.actor?.id ?? null;
                if (!targetActorId) { ui.notifications.warn("ターゲットのアクターを解決できません。"); return; }
                extra.focusSupportTargetId = targetActorId;
            }
            await TnxCharacterSheetBase._activateItemCheck(actor, choice.item, extra);
            return;
        }

        await TnxCheckFlow.open({
            type:            checkType,
            actorId:         actor.id,
            skillIds:        [],
            skillLabel,
            validSuits:      flagSuits?.length ? [...flagSuits] : [...ALL_SUITS],
            targetValue:     targetValue ?? null,
            bountyAvailable: 0,
            requestMessageId: messageId,
            // 制御判定要求が controlNegate(BS の無効/降格)由来の場合、完了継続で結果を適用する
            controlNegate:   flagData.controlNegate ?? null,
        });
    }

    /**
     * 指定技能で判定するか、代用判定(別技能+手動修正)を行うかを選ばせる(2026-07-09)。
     * 「〈技能名〉で判定」は第2段の用途プルダウン(指定技能自身の用途+コンボ候補=KI-025・
     * **「判定」タイプ限定**=2026-07-19 ユーザー裁定)へ進む(同日指示の二段階化: ボタン列挙は
     * 量が多いとあふれる)。用途が1つなら第2段を出さず自動解決・0なら警告して中止。
     * 指定技能を所持していない場合は代用判定の選択のみ提示する。
     * @param {Actor} actor
     * @param {{matchedItem: Item|null, requestedLabel: string,
     *          comboCandidates?: Array<{item: Item, usage: object}>}} opts
     * @returns {Promise<?{item: Item, usageId?: string, substitute: boolean, manualMod: number}>}
     */
    static async _promptSkillUse(actor, { matchedItem, requestedLabel, comboCandidates = [] }) {
        if (matchedItem) {
            const mode = await foundry.applications.api.DialogV2.wait({
                window: { title: requestedLabel },
                classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
                position: { width: 340 },
                content: "",
                buttons: [
                    { action: "direct", icon: "fas fa-diamond", label: `${itemDisplayName(matchedItem)}で判定`, default: true, callback: () => "direct" },
                    { action: "sub", icon: "fas fa-shuffle", label: "代用判定（別の技能で判定）", callback: () => "sub" },
                    { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
                ],
                close: () => null,
            });
            if (!mode) return null;
            if (mode === "direct") {
                const choices = buildRequestUsageChoices(matchedItem, comboCandidates);
                // 0件=起動できる「判定」用途が無い(2026-07-19 ユーザー裁定=判定タイプ限定。
                // アイテム起動へ落とすと判定以外の用途ピッカーが開いて限定と矛盾するため中止)
                if (!choices.length) {
                    ui.notifications.warn(`${requestedLabel}に判定タイプの用途が無いため、判定要求から起動できません。`);
                    return null;
                }
                // 1件=自動解決(2026-07-19 ユーザー指示)
                if (choices.length === 1) {
                    return { item: choices[0].item, usageId: choices[0].usage._id, substitute: false, manualMod: 0 };
                }
                const picked = await TnxRlRequestApp._promptUsageChoice(requestedLabel, choices);
                if (!picked) return null;
                return { item: picked.item, usageId: picked.usage._id, substitute: false, manualMod: 0 };
            }
        }

        return TnxRlRequestApp._promptSubstitution(actor, { matchedItem, requestedLabel });
    }

    /**
     * 指定技能が複数ある要求で、どの技能で応じるかを選ばせる(2026-07-21)。
     * @param {Array<string>} keys 識別キー
     * @returns {Promise<?string>} null=キャンセル
     */
    static async _promptDesignatedSkill(keys) {
        const esc = foundry.utils.escapeHTML;
        const labels = await Promise.all(keys.map(k => requestSkillLabel(k)));
        const options = keys
            .map((k, i) => `<option value="${esc(k)}">${esc(labels[i])}</option>`).join("");
        const res = await foundry.applications.api.DialogV2.wait({
            window: { title: "指定技能を選択" },
            classes: ["tokyo-nova", "tnx-dialog"],
            position: { width: 360 },
            content: `<div class="form-group"><label>判定に使う技能</label><select name="skillKey">${options}</select></div>`,
            buttons: [
                { action: "ok", icon: "fas fa-diamond", label: "この技能で判定", default: true,
                  callback: (_e, _b, dialog) => dialog.element.querySelector('[name="skillKey"]')?.value ?? "" },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });
        return res || null;
    }

    /**
     * 第2段: 指定技能で判定できる用途のプルダウン選択(KI-025 改・2026-07-19 ユーザー指示)。
     * 中身は用途名のリスト(buildRequestUsageChoices のラベル)。
     * @param {string} requestedLabel 〈〉整形済みの指定技能名
     * @param {Array<{item: Item, usage: object, label: string}>} choices
     * @returns {Promise<?{item: Item, usage: object, label: string}>} null=キャンセル
     */
    static async _promptUsageChoice(requestedLabel, choices) {
        const esc = foundry.utils.escapeHTML;
        const options = choices
            .map((c, i) => `<option value="${i}">${esc(c.label)}</option>`).join("");
        const res = await foundry.applications.api.DialogV2.wait({
            window: { title: `${requestedLabel}で判定` },
            classes: ["tokyo-nova", "tnx-dialog"],
            position: { width: 360 },
            content: `<div class="form-group"><label>使用する用途</label><select name="usageIndex">${options}</select></div>`,
            buttons: [
                { action: "ok", icon: "fas fa-diamond", label: "この用途で判定", default: true,
                  callback: (_e, _b, dialog) => dialog.element.querySelector('[name="usageIndex"]')?.value ?? "" },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });
        if (res === null || res === undefined || res === "") return null;
        return choices[Number(res)] ?? null;
    }

    /**
     * 代用判定: 技能を選び、ペナルティ等の修正を手入力する(裁定は卓・2026-07-09)。
     * @param {Actor} actor
     * @param {{matchedItem: Item|null, requestedLabel: string}} opts
     * @returns {Promise<?{item: Item, substitute: boolean, manualMod: number}>}
     */
    static async _promptSubstitution(actor, { matchedItem, requestedLabel }) {
        // 並び順はシートと同じ(一般→スタイル・item.sort)
        const skills = actor.items.filter(i => i.type === "generalSkill" || i.type === "styleSkill");
        if (!skills.length) {
            ui.notifications.warn("代用に使える技能がありません。");
            return null;
        }
        const esc = foundry.utils.escapeHTML;
        const options = buildSkillOptions(skills)
            .map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
        const { spinnerDialogActions } = await import("./tnx-dialog.mjs");
        const res = await foundry.applications.api.DialogV2.wait({
            window: { title: `代用判定: ${requestedLabel}` },
            classes: ["tokyo-nova", "tnx-dialog"],
            position: { width: 360 },
            content: `
                <p>指定「${esc(requestedLabel)}」${matchedItem ? "を" : "を所持していないため、"}別の技能で代用します（可否・修正の裁定は卓）。</p>
                <div class="form-group"><label>使用する技能</label><select name="skillId">${options}</select></div>
                <div class="form-group"><label>修正（手動・ペナルティは負数）</label>
                    <div class="number-input-spinner">
                        <button type="button" class="tnx-btn" data-action="decrement" aria-label="Decrease">-</button>
                        <input type="number" name="manualMod" value="0" min="-99" max="99">
                        <button type="button" class="tnx-btn" data-action="increment" aria-label="Increase">+</button>
                    </div>
                </div>`,
            actions: spinnerDialogActions,
            buttons: [
                { action: "ok", icon: "fas fa-diamond", label: "この技能で判定", default: true,
                  callback: (_e, _b, dialog) => ({
                      skillId:   dialog.element.querySelector('[name="skillId"]')?.value ?? "",
                      manualMod: Number(dialog.element.querySelector('[name="manualMod"]')?.value) || 0,
                  }) },
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
            ],
            close: () => null,
        });
        if (!res?.skillId) return null;
        const item = actor.items.get(res.skillId);
        if (!item) return null;
        return { item, substitute: true, manualMod: res.manualMod };
    }
}
