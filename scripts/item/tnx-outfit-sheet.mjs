import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";
import { OUTFIT_CATEGORIES } from "../data/item/outfit-categories.mjs";

/**
 * アウトフィット(装備品)共通シート。
 * general はこのクラスをそのまま使用し、固有フィールドを持つ型(weapon 等)は
 * 本クラスを継承してデータタブの固有部分を追加する(フェーズ6-2 以降)。
 *
 * ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md
 * - 購は「購：購入値／常備化経験点」表記。解説参照時は常備化経験点を表記しない。
 * - 隠は「隠：隠匿値／危険値」表記。解説参照でも危険値は別個に表記する。
 * - 電脳制御値の略号は「電制」。
 * - カテゴリは大分類→小分類の連動ドロップダウンで、その type に有効な小分類のみを出す。
 * - タイミングはスタイル技能と共通の選択肢・構造(TnxSkillUtils を共用)。
 *
 * レイアウト(2026-06-12 ユーザー指示):
 * - 説明タブ上部にルルブ表記の概要(購/隠/電制/部位のみ)、その下に解説エディタ。
 * - 編集 UI はすべて設定タブ(スタイル技能のレイアウト踏襲)。データタブは置かない。
 * - 数値入力欄は number-input-spinner を使用(例外は使用回数のみ)。
 */
export class TokyoNovaOutfitSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "outfit"],
        position: { width: 600, height: 650 },
        actions: {
            incrementField: TokyoNovaOutfitSheet._onIncrementField,
            decrementField: TokyoNovaOutfitSheet._onDecrementField,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/outfit-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }, { id: "effects" }],
            initial: "description",
        },
    };

    /** 購入値・隠匿値の 3 状態(なし/数値/解説参照) */
    static get buyHideModes() {
        return { none: "なし", value: "数値", reference: "解説参照" };
    }

    /** 空のタイミング行 */
    static get blankTimingRow() {
        return { value: "blank", actionName: "blank", processName: "blank", timingOther: "" };
    }

    /**
     * この Item type が選択できる大分類 → 小分類リストのマップを返す。
     * @returns {Record<string, string[]>}
     */
    _categoriesForType() {
        const type = this.item.type;
        const result = {};
        for (const [major, minors] of Object.entries(OUTFIT_CATEGORIES)) {
            const valid = Object.entries(minors)
                .filter(([, t]) => t === type)
                .map(([minor]) => minor);
            if (valid.length) result[major] = valid;
        }
        return result;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = context.system;

        // timing は編集 UI 用に最低 1 行を保証する(保存はしない。表示用の正規化のみ)
        if (!Array.isArray(system.timing)) {
            system.timing = (typeof system.timing === "object" && system.timing !== null)
                ? Object.values(system.timing)
                : [];
        }
        if (!system.timing.length) system.timing = [this.constructor.blankTimingRow];

        const skillOptions = TnxSkillUtils.getSkillOptions();
        const categories = this._categoriesForType();

        const majorChoices = { "": "-" };
        for (const major of Object.keys(categories)) majorChoices[major] = major;
        const minorChoices = { "": "-" };
        for (const minor of categories[system.majorCategory] ?? []) minorChoices[minor] = minor;

        context.options = {
            ...context.options,
            timing:        skillOptions.timing,
            actions:       skillOptions.actions,
            processes:     skillOptions.processes,
            buyHideMode:   this.constructor.buyHideModes,
            majorCategory: majorChoices,
            minorCategory: minorChoices,
        };

        context.view = this._prepareView(system, skillOptions);
        return context;
    }

    /**
     * 説明タブ上部に表示するルルブ表記ラベル(購/隠/電制/部位)を生成する。
     * @param {Object} system 正規化済み system データ
     * @param {Object} _skillOptions TnxSkillUtils.getSkillOptions() の戻り値
     * @returns {Object}
     */
    _prepareView(system, _skillOptions) {
        const view = {};
        const num = (v) => (Number.isFinite(v) ? String(v) : "0");

        // 購：購入値／常備化経験点(解説参照時は常備化経験点を表記しない)
        if (system.buy.mode === "reference") {
            view.buy = "解説参照";
        } else if (system.buy.mode === "value") {
            view.buy = `${num(system.buy.value)}／${num(system.preserveExp)}`;
        } else {
            view.buy = `-／${num(system.preserveExp)}`;
        }

        // 隠：隠匿値／危険値(解説参照でも危険値は別個に表記)
        const hideVal = system.hide.mode === "reference" ? "解説参照"
            : system.hide.mode === "value" ? num(system.hide.value)
            : "-";
        view.hide = `${hideVal}／${num(system.appearancePenalty)}`;

        // 電制(電脳制御値)。null = なし
        view.hack = system.hack ?? "-";
        view.part = system.part || "-";

        if (system.majorCategory && system.minorCategory) {
            view.category = `${system.majorCategory}／${system.minorCategory}`;
        } else {
            view.category = system.majorCategory || system.minorCategory || "-";
        }

        return view;
    }

    // ─── 数値スピナー(number-input-spinner) ────────────────────────────────

    static async _onIncrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.item, field) ?? 0;
        await this.item.update({ [field]: current + 1 });
    }

    static async _onDecrementField(_event, target) {
        const field = target.dataset.field;
        if (!field) return;
        const current = foundry.utils.getProperty(this.item, field) ?? 0;
        await this.item.update({ [field]: current - 1 });
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!context.editable) return;

        // 大分類変更時は小分類をリセットする(連動ドロップダウン)
        this.element.querySelector('select[name="system.majorCategory"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this.item.update({
                    "system.majorCategory": event.currentTarget.value,
                    "system.minorCategory": "",
                });
            });

        // 購/隠のモード変更時、数値以外なら value をリセットする
        for (const key of ["buy", "hide"]) {
            this.element.querySelector(`select[name="system.${key}.mode"]`)
                ?.addEventListener("change", (event) => {
                    event.stopPropagation();
                    const mode = event.currentTarget.value;
                    const update = { [`system.${key}.mode`]: mode };
                    if (mode !== "value") update[`system.${key}.value`] = 0;
                    this.item.update(update);
                });
        }

        // 使用回数: チェック解除時に回数をリセットする
        this.element.querySelector('input[name="system.uses.isLimit"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const isChecked = event.currentTarget.checked;
                const update = { "system.uses.isLimit": isChecked };
                if (!isChecked) {
                    update["system.uses.value"] = 0;
                    update["system.uses.max"]   = 0;
                }
                this.item.update(update);
            });

        // タイミング行: 種別変更時に下位フィールドをリセットする
        for (const select of this.element.querySelectorAll('select[name^="system.timing."]')) {
            const match = select.name.match(/^system\.timing\.(\d+)\.value$/);
            if (!match) continue;
            select.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onTimingValueChange(Number(match[1]), event.currentTarget.value);
            });
        }

        // タイミング行の追加・削除
        for (const btn of this.element.querySelectorAll('.tnx-row-btn[data-target="timing"]')) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onAddTimingRow();
            });
        }
        for (const btn of this.element.querySelectorAll('.tnx-row-btn--delete[data-target="timing"]')) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onDeleteTimingRow(Number(event.currentTarget.dataset.index));
            });
        }
    }

    // ─── タイミング配列操作 ─────────────────────────────────────────────────

    /** 保存済み timing を配列に正規化して返す(最低 1 行) */
    _normalizedTiming() {
        const raw = foundry.utils.deepClone(this.item.system.timing);
        const list = Array.isArray(raw) ? raw
            : (typeof raw === "object" && raw !== null) ? Object.values(raw)
            : [];
        if (!list.length) list.push(this.constructor.blankTimingRow);
        return list;
    }

    async _onTimingValueChange(idx, value) {
        const list = this._normalizedTiming();
        if (!list[idx]) return;
        list[idx].value = value;
        if (value === "action")       { list[idx].processName = "blank"; list[idx].timingOther = ""; }
        else if (value === "process") { list[idx].actionName  = "blank"; list[idx].timingOther = ""; }
        else if (value === "other")   { list[idx].actionName  = "blank"; list[idx].processName = "blank"; }
        else {
            list[idx].actionName  = "blank";
            list[idx].processName = "blank";
            list[idx].timingOther = "";
        }
        await this.item.update({ "system.timing": list });
    }

    async _onAddTimingRow() {
        const list = this._normalizedTiming();
        list.push(this.constructor.blankTimingRow);
        await this.item.update({ "system.timing": list });
    }

    async _onDeleteTimingRow(index) {
        const list = this._normalizedTiming();
        if (index >= 0 && index < list.length) {
            list.splice(index, 1);
            await this.item.update({ "system.timing": list });
        }
    }
}
