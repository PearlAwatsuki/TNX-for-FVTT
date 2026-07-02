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

import { getComboSuits, ALL_SUITS } from './tnx-check-engine.mjs';
import { TnxCheckFlow } from './tnx-check-flow.mjs';

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

        if (checkType === "skillCheck" && identificationKey) {
            // 識別キーでキャラクター上の技能を検索
            const matchedItem = actor.items.find(
                i => i.type === "generalSkill" && i.system.identificationKey === identificationKey
            );
            if (!matchedItem) {
                ui.notifications.warn(
                    `${actor.name} は「${skillLabel}」を持っていないため判定できません。`
                );
                return;
            }
            skillIds           = [matchedItem.id];
            resolvedValidSuits = getComboSuits([matchedItem.system]);
            bountyAvailable    = matchedItem.system.usesBounty === true ? actorBounty : 0;
        } else if (checkType === "abilityCheck") {
            // 能力値判定: 報酬点が使用可能
            bountyAvailable = actorBounty;
        }
        // controlCheck: bountyAvailable = 0 (default)
        // skillCheck + その他: validSuits = flagSuits, bountyAvailable = 0

        await TnxCheckFlow.open({
            type:            checkType,
            actorId:         actor.id,
            skillIds,
            skillLabel,
            validSuits:      resolvedValidSuits,
            targetValue:     targetValue ?? null,
            bountyAvailable,
            requestMessageId: messageId,
        });
    }
}
