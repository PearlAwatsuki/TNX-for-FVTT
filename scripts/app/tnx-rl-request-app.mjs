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

import { SYSTEM_ID } from "../constants.mjs";
import { ALL_SUITS } from '../module/tnx-check-engine.mjs';
import { TnxCheckFlow } from '../module/tnx-check-flow.mjs';
import { buildSkillOptions } from '../module/skill-select.mjs';
import { formatSkillName } from '../module/identification.mjs';
import {
    loadGroupedGeneralSkillChoices, loadSkillChoices, SKILL_PACKS, formatDesignatedSkills,
} from '../module/skill-dictionary.mjs';
import { listCheckRequestPresets, presetLabel, checkRequestPresetToForm } from '../module/request-presets.mjs';
import { bindTargetPicker } from '../module/target-picker.mjs';

/** 指定技能になりうるアイテム種別(一般技能とスタイル技能。ワークス専用技能も styleSkill)。 */
const REQUEST_SKILL_TYPES = ["generalSkill", "styleSkill"];

/** 全技能辞典(＋ワールド直下)の {識別キー: 名前}。指定技能の表示解決に使う。 */
function requestSkillNames() {
    return loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
}

/**
 * 識別キーの列 → 指定技能の表示(**規則は全画面共通**＝`formatDesignatedSkills`・2026-08-15)。
 * **一般技能に限らず**スタイル技能・ワークス専用技能も引く(2026-08-12。指定技能を全技能へ
 * 広げたため)。逆引きできないキーは生キーを出さず落とし、1 つも解決できないときだけ
 * 「（参照切れ）」にする(識別キーは保存する参照であって表示するものではない)。
 */
async function requestSkillLabel(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    if (!list.length) return "";
    const names = await requestSkillNames();
    return formatDesignatedSkills(list, new Map(Object.entries(names))) || "（参照切れ）";
}
import { toCheckRequestTargets } from '../rules/target-picker.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
            [SYSTEM_ID]: {
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
            // 検証で弾いたときに閉じない(閉じると入力が全部消える)。送信できたら明示的に閉じる。
            // 指定技能が必須になった 2026-08-12 以降は、弾かれる経路を普通に踏むため
            closeOnSubmit: false,
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
            ABILITY_OPTIONS,
        };
    }

    // ─── 描画後イベント配線 ────────────────────────────────────────────────────

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;
        // 対象選択は4つのダイアログ共通の部品(2026-07-21)
        this._picker = bindTargetPicker(el.querySelector(".tnx-target-picker"));

        // 指定技能は複数可(2026-08-12)。状態はアプリ側に持ち、チップ列を描き直す
        this._skillKeys ??= [];
        this._wireSkillTags(el);

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
            set("targetValue",       form.targetValue);
            set("targetValueHidden", form.targetValueHidden);
            set("description",       form.description);
            this._skillKeys = [...form.identificationKeys];
            this._renderSkillTags();
            el.querySelector("[name=checkType]")?.dispatchEvent(new Event("change", { bubbles: true }));
        });

        // 判定種別 → 技能/能力値セクション切り替え
        const typeSelect = el.querySelector("[name=checkType]");
        typeSelect?.addEventListener("change", (e) => this._updateSections(el, e.target.value));
        this._updateSections(el, typeSelect?.value ?? "skillCheck");

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

    /**
     * 指定技能のタグ入力を配線する(2026-08-12)。**一般技能はプルダウン**(既存のグループ化選択肢)、
     * **スタイル技能・ワークス専用技能はドロップ**で足す——スタイルは 33 群あり、群ごとの
     * プルダウンを組むより辞典やシートから引いたほうが短い。一般技能も落とせる。
     * どちらから足しても同じチップ列に積まれるので、辞典をまたいだ指定が自然にできる。
     */
    _wireSkillTags(el) {
        const add = el.querySelector("[data-skill-add]");
        add?.addEventListener("change", () => {
            const key = add.value;
            add.value = "";
            this._addSkillKey(key);
        });

        const zone = el.querySelector('[data-drop-area="request-skill"]');
        zone?.addEventListener("dragover", (event) => event.preventDefault());
        zone?.addEventListener("drop", (event) => this._onDropSkill(event));

        this._renderSkillTags();
    }

    /** 指定技能を1件足す(重複は無視)。 */
    _addSkillKey(key) {
        if (!key || this._skillKeys.includes(key)) return;
        this._skillKeys.push(key);
        this._renderSkillTags();
    }

    /** ドロップされたアイテムを指定技能に足す。技能でない/識別キーが無いものは理由を出して弾く。 */
    async _onDropSkill(event) {
        event.preventDefault();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || !REQUEST_SKILL_TYPES.includes(doc.type)) {
            ui.notifications.warn("技能をドロップしてください。");
            return;
        }
        const key = doc.system?.identificationKey;
        if (!key) {
            ui.notifications.warn(`${doc.name} に識別キーが設定されていないため指定できません。`);
            return;
        }
        this._addSkillKey(key);
    }

    /** チップ列を描き直す(表示名は辞典の現在名・生キーは出さない)。 */
    async _renderSkillTags() {
        const chips = this.element?.querySelector("[data-skill-chips]");
        if (!chips) return;
        const names = await requestSkillNames();
        chips.replaceChildren();
        for (const key of this._skillKeys) {
            const tag = document.createElement("span");
            tag.className = "tnx-tag";
            tag.textContent = names[key] ? formatSkillName(names[key]) : "（参照切れ）";
            const remove = document.createElement("a");
            remove.className = "tnx-tag-remove";
            remove.title = "指定を外す";
            remove.innerHTML = '<i class="fas fa-times"></i>';
            remove.addEventListener("click", () => {
                this._skillKeys = this._skillKeys.filter(k => k !== key);
                this._renderSkillTags();
            });
            tag.append(remove);
            chips.append(tag);
        }
        if (!this._skillKeys.length) {
            const empty = document.createElement("span");
            empty.className = "tnx-tag-empty";
            empty.textContent = "（指定なし）";
            chips.append(empty);
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

        // 指定技能（技能判定時のみ・複数可＝チップ列。2026-08-12）
        const identificationKeys = (checkType === "skillCheck") ? [...(this._skillKeys ?? [])] : [];

        // 技能/能力値ラベル
        let skillLabel;
        if (checkType === "skillCheck") {
            // 辞典に無い技能は**その場でアイテムを作ってドロップする**(ドロップが自由入力の役割を
            // 果たす・2026-08-12 ユーザー指摘)。技能名の自由入力欄は廃止したので、指定は必須
            if (!identificationKeys.length) {
                ui.notifications.warn("指定技能を1つ以上追加してください。");
                return false;
            }
            // 表示は指定技能の共通規則に通す(登場判定・情報項目と同じ書き方・2026-08-15)
            skillLabel = await requestSkillLabel(identificationKeys);
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
        if (checkType === "skillCheck") {
            // PL 側の技能アイテムから getComboSuits で決定するため空
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
            checkType, identificationKeys, skillLabel, validSuits,
            targetValue, targetValueHidden, description, targets,
        });
        await this.close();
    }

    // ─── 判定実行ハンドラ（チャットから呼ばれる）─────────────────────────────

    /**
     * チャットの「判定する」ボタン押下時に呼ばれる。
     * 技能アイテムを解決し、TnxCheckFlow.open() に渡す。
     *
     * @param {object} flagData    - message.flags[SYSTEM_ID].checkRequest
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
            const resolved = await resolveDesignatedSkillResponse(actor, requestKeys);
            if (!resolved) return;
            const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
            const extra = { requestMessageId: messageId, targetValue: targetValue ?? null };
            if (resolved.usageId) extra.usageId = resolved.usageId;
            if (resolved.substitution) {
                extra.substitution = resolved.substitution;
                extra.manualMod = resolved.manualMod;
            }
            // FS 支援判定(2026-08-05 ユーザー確定): 支援は普通にターゲットして行う。判定を行う時点で
            // レティクルにした1体を支援対象とし、結果に載せて autoApplyFocusSupport が対象へ支援 AE を
            // 付与する。ターゲットが無い(または複数)ときは、他の用途と同じ対象選択ダイアログで1体を選ばせる
            // (2026-08-06 ユーザー指摘＝中止でなくダイアログ。選ぶとレティクルも付与される)。以降のフローで
            // レティクルが変わっても崩れないよう、押下時に確定して渡す。
            if (flagData.focusSystemKind === "support") {
                let picked = [...(game.user?.targets ?? [])];
                if (picked.length !== 1) {
                    const { promptTargetToken } = await import("../module/target-resolution.mjs");
                    const refs = await promptTargetToken(actor);
                    if (!refs?.length) return; // キャンセルは中止
                    picked = [...(game.user?.targets ?? [])]; // ダイアログが選んだ対象にレティクルを付与済み
                }
                const targetActorId = picked[0]?.actor?.id ?? null;
                if (!targetActorId) { ui.notifications.warn("ターゲットのアクターを解決できません。"); return; }
                extra.focusSupportTargetId = targetActorId;
            }
            await TnxCharacterSheetBase._activateItemCheck(actor, resolved.item, extra);
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
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
            ],
            close: () => null,
        });
        // 中止(キャンセル=false / × で閉じる=null)と未選択("")をまとめて弾く。
        // 選択時は "0" 等の**文字列**なので、"0" が falsy にならないことに依存してよい
        if (!res) return null;
        return choices[Number(res)] ?? null;
    }

    /**
     * 代用判定: 技能を選び、ペナルティ等の修正を手入力する(裁定は卓・2026-07-09)。
     * @param {Actor} actor
     * @param {{matchedItem: Item|null, requestedLabel: string}} opts
     * @returns {Promise<?{item: Item, substitute: boolean, manualMod: number}>}
     */
    static async _promptSubstitution(actor, { requestedLabel }) {
        // 並び順はシートと同じ(一般→スタイル・item.sort)
        const skills = actor.items.filter(i => i.type === "generalSkill" || i.type === "styleSkill");
        if (!skills.length) {
            ui.notifications.warn("代用に使える技能がありません。");
            return null;
        }
        const esc = foundry.utils.escapeHTML;
        const options = buildSkillOptions(skills)
            .map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
        const { spinnerDialogActions } = await import("../module/tnx-dialog.mjs");
        const res = await foundry.applications.api.DialogV2.wait({
            window: { title: `代用判定: ${requestedLabel}` },
            classes: ["tokyo-nova", "tnx-dialog"],
            position: { width: 360 },
            content: `
                <p>指定「${esc(requestedLabel)}」を別の技能で代用します（可否・修正の裁定は卓）。</p>
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
                { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
            ],
            close: () => null,
        });
        if (!res?.skillId) return null;
        const item = actor.items.get(res.skillId);
        if (!item) return null;
        return { item, substitute: true, manualMod: res.manualMod };
    }
}

/**
 * 指定技能(識別キー)への応答を解決する(判定要求と情報収集判定[14-9]で共用・2026-08-16 抽出)。
 * 複数キーの選択 → 所持技能の実解決(REQUEST_SKILL_TYPES=一般/スタイル/ワークス) →
 * 用途・コンボ候補の選択(KI-025) → 代用判定、までを担い、起動パラメータを返す。
 * 起動そのものは呼び出し側が `_activateItemCheck` で行う(唯一の起動関数への集約を保つ)。
 * @param {Actor} actor
 * @param {Array<string>} keys 指定技能の識別キー(1つ以上)
 * @returns {Promise<?{item: Item, usageId?: string, substitution?: {requestedLabel: string,
 *          usedName: string}, manualMod?: number}>} null=キャンセル
 */
export async function resolveDesignatedSkillResponse(actor, keys) {
    // 統合リゾルバー(2026-08-26 設計)へ委譲: 指定技能(未所持はグレーアウト)・代用技能・
    // 代用判定を1つの縦積みボタンダイアログで選ぶ。指定充足(designationStandIn)は判定種別を
    // 持つ文脈(情報収集・登場)のみのため、判定要求(checkKind なし)では並ばない
    const label = await requestSkillLabel(keys);
    const { resolveDesignationResponse } = await import("./designation-response.mjs");
    const res = await resolveDesignationResponse(actor, [{ keys, tn: null, label }],
        { checkKind: null, title: label ? `指定技能: ${label}` : "指定技能" });
    if (!res || res.direct) return null;
    const out = { item: res.item };
    if (res.usageId) out.usageId = res.usageId;
    if (res.substitution) {
        out.substitution = res.substitution;
        out.manualMod = res.manualMod;
    }
    return out;
}

/**
 * 判定要求カードの描画(目標値の可視性制御・「判定する」ボタン・結果の注入。フェーズ 8-5)。
 *
 * この描画は要求カードを作る側(TnxRlRequestApp)と対になるため、ここに置く
 * (2026-09-07 移設。従来は tnx.mjs のフック内に 70 行直書きされており、他のカードが
 * すべて機能側モジュールの render 関数を持つのに対して、ここだけ例外になっていた)。
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderCheckRequestCard(message, html) {
    const flagData = message.getFlag(SYSTEM_ID, "checkRequest");
    if (!flagData) return;

    // 目標値: targetValueHidden かつ非 GM の場合は非公開表示
    const tnEl = html.querySelector(".tnx-card__field-value--tn");
    if (tnEl && flagData.targetValueHidden && !game.user.isGM) {
        tnEl.textContent = "（非公開）";
        tnEl.classList.add("tnx-card__field-value--hidden");
    }

    // 各対象行: 結果がある場合は結果表示、未判定の場合はボタンまたは「待機中」
    for (const row of html.querySelectorAll(".tnx-card__target")) {
        const actorId  = row.dataset.actorId;
        const statusEl = row.querySelector(".tnx-card__target-status");
        if (!statusEl) continue;

        const result = flagData.results?.[actorId];
        if (result) {
            // 判定済み: 結果を表示
            const resultEl = document.createElement("div");
            resultEl.className = "tnx-card__target-result";
            if (flagData.checkType === "controlCheck") {
                // controlNegate 由来の要求は帰結(無効化/降格/継続)もライブ書き換えで表示する
                const negateText = result.negateOutcome?.text
                    ? ` <span class="tnx-card__target-negate">${foundry.utils.escapeHTML(result.negateOutcome.text)}</span>`
                    : "";
                resultEl.innerHTML = (result.success
                    ? '<span class="cr-inline-success"><i class="fas fa-check"></i> 成功</span>'
                    : '<span class="cr-inline-failure"><i class="fas fa-times"></i> 失敗</span>')
                    + negateText;
            } else if (result.fumble) {
                resultEl.innerHTML = '<span class="cr-inline-fumble"><i class="fas fa-skull"></i> ファンブル</span>';
            } else {
                const mark = result.success === true
                    ? ' <span class="cr-inline-success"><i class="fas fa-check"></i> 成功</span>'
                    : result.success === false
                        ? ' <span class="cr-inline-failure"><i class="fas fa-times"></i> 失敗</span>'
                        : '';
                // 代用判定(2026-07-09): 指定と別の技能で判定した事実を要求カードにも明示する
                const subNote = result.substitution?.usedName
                    ? ` <span class="tnx-card__target-note">代用:${foundry.utils.escapeHTML(result.substitution.usedName)}</span>`
                    : '';
                resultEl.innerHTML = `達成値 <strong>${result.achievement ?? "—"}</strong>${mark}${subNote}`;
            }
            statusEl.replaceChildren(resultEl);
        } else if (flagData.status !== "closed") {
            // 未判定: 判定ボタンはそのアクターの所有者権限を持つユーザー(+GM)に出す
            // (2026-07-19 ユーザー指示: 対象はアクター登録=ユーザー割り当て・接続状況に依存しない)
            const targetActor = game.actors.get(actorId);
            if (targetActor?.isOwner || game.user.isGM) {
                const btn = document.createElement("button");
                btn.type      = "button";
                // テキストボタンは丸型(tnx-ring-btn)に詰め込まない。アイコンは判定=カードのため
                // カードマーク(2026-07-09 修正。gavel=裁判官の木槌は「judgement」の誤訳由来)
                btn.className = "tnx-chat-btn tnx-check-do-btn";
                btn.innerHTML = '<i class="fas fa-diamond"></i> 判定する';
                btn.addEventListener("click", () => {
                    TnxRlRequestApp.onDoCheck(flagData, actorId, message.id);
                });
                statusEl.replaceChildren(btn);
            } else {
                const waiting = document.createElement("span");
                waiting.className = "tnx-card__target-waiting";
                waiting.textContent = "待機中…";
                statusEl.replaceChildren(waiting);
            }
        }
    }
}
