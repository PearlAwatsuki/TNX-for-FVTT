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

import { getComboSuits, comboUsesBounty, ALL_SUITS } from './tnx-check-engine.mjs';
import { TnxCheckFlow } from './tnx-check-flow.mjs';
import { buildSkillOptions } from './skill-select.mjs';
import { findItemByIdentificationKey } from './identification.mjs';

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

const CHECK_TYPE_LABELS = Object.freeze({
    skillCheck:   "技能判定",
    abilityCheck: "能力値判定",
    controlCheck: "制御判定",
});

const SUIT_SYMBOLS = Object.freeze({
    spade: "♠", club: "♣", heart: "♥", diamond: "♦",
});

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

    /** @type {{identificationKey: string, name: string}[]|null} */
    static _compendiumSkillCache = null;

    // ─── コンテキスト準備 ─────────────────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const compendiumSkills = await TnxRlRequestApp._loadCompendiumSkills();
        const activePlayers = game.users
            .filter(u => !u.isGM && u.active && u.character)
            .map(u => ({
                userId:    u.id,
                userName:  u.name,
                actorId:   u.character.id,
                actorName: u.character.name,
                color:     u.color?.css ?? "#ffffff",
            }));
        return {
            ...context,
            compendiumSkills,
            activePlayers,
            SUIT_OPTIONS,
            ABILITY_OPTIONS,
        };
    }

    // ─── 描画後イベント配線 ────────────────────────────────────────────────────

    _onRender(context, options) {
        super._onRender(context, options);
        const el = this.element;

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

    // ─── コンペンディウム技能読み込み ─────────────────────────────────────────

    static async _loadCompendiumSkills() {
        if (TnxRlRequestApp._compendiumSkillCache) return TnxRlRequestApp._compendiumSkillCache;
        const pack = game.packs.get("tokyo-nova-axleration.general-skills");
        if (!pack) return [];
        try {
            const docs = await pack.getDocuments();
            const skills = docs
                .filter(d => d.system.identificationKey)
                .map(d => ({ identificationKey: d.system.identificationKey, name: d.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
            TnxRlRequestApp._compendiumSkillCache = skills;
            return skills;
        } catch (e) {
            console.error("TokyoNOVA | Failed to load general-skills compendium:", e);
            return [];
        }
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
            if (identificationKey) {
                const cached = TnxRlRequestApp._compendiumSkillCache?.find(
                    s => s.identificationKey === identificationKey
                );
                skillLabel = cached?.name ?? identificationKey;
            } else {
                skillLabel = form.querySelector("[name=customSkillName]")?.value?.trim()
                    || "（指定技能）";
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

        // 対象 PL（アクティブな非 GM で、キャラクター所持者）
        const targets = game.users
            .filter(u => !u.isGM && u.active && u.character)
            .filter(u => form.querySelector(`[name="target_${u.id}"]`)?.checked)
            .map(u => ({
                userId:    u.id,
                actorId:   u.character.id,
                actorName: u.character.name,
                userName:  u.name,
            }));

        if (!targets.length) {
            ui.notifications.warn("対象プレイヤーを1人以上選択してください。");
            return false;
        }

        // チャットカード HTML を生成（GM 側は目標値を常に表示）
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

        await ChatMessage.create({
            content,
            flags: {
                "tokyo-nova-axleration": {
                    checkRequest: {
                        checkType,
                        identificationKey: identificationKey || null,
                        skillLabel,
                        validSuits,
                        targetValue,
                        targetValueHidden,
                        description,
                        targets,
                        results: {},
                        status: "pending",
                    }
                }
            },
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

        const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);
        let skillIds          = [];
        let resolvedValidSuits = flagSuits?.length ? [...flagSuits] : [...ALL_SUITS];
        let bountyAvailable   = 0;
        let effectiveSkillLabel = skillLabel;
        let substitution = null;
        let manualMod = 0;

        if (checkType === "skillCheck" && identificationKey) {
            // 識別キーでキャラクター上の技能を検索。
            // 代用判定(2026-07-09 ユーザー確定): 技能が指定される判定は、指定と別の技能で
            // 任意に代用できる(可否・ペナルティ修正の裁定は卓=修正は判定者が手入力)。
            // 指定技能を持たない場合もハードブロックせず代用判定を提示する。
            // ※能力値判定・制御判定は代用の対象外(技能判定内でのみ代用が成立する)
            const matchedItem = findItemByIdentificationKey(actor, identificationKey, { type: "generalSkill" });
            const choice = await TnxRlRequestApp._promptSkillUse(actor, { matchedItem, requestedLabel: skillLabel });
            if (!choice) return;
            skillIds           = [choice.item.id];
            resolvedValidSuits = getComboSuits([choice.item.system]);
            bountyAvailable    = comboUsesBounty([choice.item.system]) ? actorBounty : 0; // 単独技能(2026-07-10 統一)
            if (!resolvedValidSuits.length) {
                ui.notifications.warn(`「${choice.item.name}」には使用できるスートがありません。`);
                return;
            }
            if (choice.substitute) {
                substitution = { requestedLabel: skillLabel, usedName: choice.item.name };
                manualMod = choice.manualMod;
                effectiveSkillLabel = choice.item.name;
            }
        }
        // abilityCheck: bountyAvailable = 0 (能力値判定では報酬点を消費できない・2026-07-10 ユーザー確定)
        // controlCheck: bountyAvailable = 0 (default)
        // skillCheck + その他: validSuits = flagSuits, bountyAvailable = 0

        await TnxCheckFlow.open({
            type:            checkType,
            actorId:         actor.id,
            skillIds,
            skillLabel:      effectiveSkillLabel,
            validSuits:      resolvedValidSuits,
            targetValue:     targetValue ?? null,
            bountyAvailable,
            requestMessageId: messageId,
            // 代用判定: 使用技能・指定・手動修正(達成値に加算)を判定フローへ渡す
            substitution,
            manualMod,
            // 制御判定要求が controlNegate(BS の無効/降格)由来の場合、完了継続で結果を適用する
            controlNegate:   flagData.controlNegate ?? null,
        });
    }

    /**
     * 指定技能で判定するか、代用判定(別技能+手動修正)を行うかを選ばせる(2026-07-09)。
     * 指定技能を所持していない場合は代用判定の選択のみ提示する。
     * @param {Actor} actor
     * @param {{matchedItem: Item|null, requestedLabel: string}} opts
     * @returns {Promise<?{item: Item, substitute: boolean, manualMod: number}>}
     */
    static async _promptSkillUse(actor, { matchedItem, requestedLabel }) {
        if (matchedItem) {
            const mode = await foundry.applications.api.DialogV2.wait({
                window: { title: requestedLabel },
                classes: ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
                position: { width: 340 },
                content: "",
                buttons: [
                    { action: "direct", icon: "fas fa-diamond", label: `「${matchedItem.name}」で判定`, default: true, callback: () => "direct" },
                    { action: "sub", icon: "fas fa-shuffle", label: "代用判定（別の技能で判定）", callback: () => "sub" },
                    { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
                ],
                close: () => null,
            });
            if (!mode) return null;
            if (mode === "direct") return { item: matchedItem, substitute: false, manualMod: 0 };
        }

        // 代用判定: 技能を選び、ペナルティ等の修正を手入力する(裁定は卓)。
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
