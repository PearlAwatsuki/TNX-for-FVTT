import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";
import { OUTFIT_CATEGORIES } from "../data/item/outfit-categories.mjs";
import { ATTACK_DAMAGE_TYPES } from "../data/item/helpers.mjs";
import { WEAPON_RANGES, WEAPON_ATTACK_AREAS } from "../data/item/weapon.mjs";
import { SLOT_KINDS } from "../data/item/common/extensible.mjs";

/**
 * 部位の表記(2026-06-12 ユーザー確定、2026-06-13 複数部位対応)。
 * 各行はスロット数 1 のときは部位名のみ、0 または 2 以上のときは「武器2」のように数値を付し、
 * 複数行は「、」で連結する。
 * Handlebars ヘルパー tnxPartLabel(tnx.mjs)と本シートのサマリ生成で共用する。
 * @param {Array<{value: string, slots: number}>|Object|string|null} part
 * @returns {string}
 */
export function formatPartLabel(part) {
    if (typeof part === "string") return part || "-";
    const list = Array.isArray(part) ? part
        : (part && typeof part === "object") ? Object.values(part)
        : [];
    const labels = list
        .filter((p) => p && typeof p === "object" && p.value)
        .map((p) => ((p.slots ?? 0) === 1 ? p.value : `${p.value}${p.slots ?? 0}`));
    return labels.length ? labels.join("、") : "-";
}

/**
 * 射程の表記(略号「射」)。min と max が同じなら単一表記、異なるなら「近～超遠」形式。
 * @param {{min: string, max: string}|string|null} range
 * @returns {string}
 */
export function formatWeaponRangeLabel(range) {
    if (!range || typeof range !== "object") return range ?? "-";
    const min = WEAPON_RANGES[range.min] ?? "-";
    const max = WEAPON_RANGES[range.max] ?? "-";
    return min === max ? min : `${min}～${max}`;
}

/**
 * アウトフィット(装備品)共通シート。
 * general / weapon / armor / cyborg に登録し、型ごとの差分は context のフラグと
 * サマリ(view.summary)の組み立てで吸収する(フェーズ6-2)。
 *
 * ルールの正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md
 * - 概要表記順: weapon = 購/隠/攻/受/射/ス/電制/部位、armor = 購/隠/防/制/電制/部位、
 *   cyborg = 購/隠/防/攻/受/電制/部位、その他 = 購/隠/電制/部位
 * - 攻は「攻：I+4」(ダメージ種別 + 値)、防は「防(S／P／I)：n／n／n」、制は制御値修正
 * - 消費アイテム(isConsumption)はアイテム名の右に「×個数」を表示
 *   (この数値入力は number-input-spinner を使わない例外)
 * - スロットを持つ型は型ごとの既定プール(weapon 等 = スロットのみ、
 *   ianus = スロット + 意識 3 種、tap = ソフトウェア + ハードウェア)の数のみを設定する
 */
export class TokyoNovaOutfitSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "outfit"],
        position: { width: 600, height: 650 },
        actions: {
            incrementField: TokyoNovaOutfitSheet._onIncrementField,
            decrementField: TokyoNovaOutfitSheet._onDecrementField,
            incrementSlot:  TokyoNovaOutfitSheet._onIncrementSlot,
            decrementSlot:  TokyoNovaOutfitSheet._onDecrementSlot,
            incrementPart:  TokyoNovaOutfitSheet._onIncrementPart,
            decrementPart:  TokyoNovaOutfitSheet._onDecrementPart,
            toggleFlag:     TokyoNovaOutfitSheet._onToggleFlag,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/outfit-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }, { id: "usage" }, { id: "effects" }],
            initial: "description",
        },
    };

    /** 購入値・隠匿値の 3 状態(なし/数値/解説参照) */
    static get buyHideModes() {
        return { none: "なし", value: "数値", reference: "解説参照" };
    }

    /** 電脳制御値の 2 状態(なし/数値) */
    static get hackModes() {
        return { none: "なし", value: "数値" };
    }

    /** 空の部位行 */
    static get blankPartRow() {
        return { value: "", slots: 1 };
    }

    /** 型ごとの既定スロットプール(kind の並び) */
    static SLOT_PRESETS = {
        weapon:    ["normal"],
        tron:      ["normal"],
        vehicle:   ["normal"],
        residence: ["normal"],
        ianus:     ["normal", "surface", "deep", "unconscious"],
        tap:       ["software", "hardware"],
    };

    /**
     * この Item type が選択できる大分類 → 小分類リストのマップを返す。
     * @returns {Record<string, string[]>}
     */
    _categoriesForType() {
        const type = this.item.type;
        const result = {};
        for (const [major, minors] of Object.entries(OUTFIT_CATEGORIES)) {
            const valid = Object.entries(minors)
                .filter(([, types]) => types.includes(type))
                .map(([minor]) => minor);
            if (valid.length) result[major] = valid;
        }
        return result;
    }

    /**
     * 保存済み slots を型の既定プール構成に正規化して返す(表示・更新共用)。
     * 既存プールの count は kind で引き継ぐ。
     * @returns {Array<{kind: string, count: number}>}
     */
    _normalizedSlots() {
        const preset = this.constructor.SLOT_PRESETS[this.item.type];
        if (!preset) return [];
        const raw = this.item.system.slots;
        const list = Array.isArray(raw) ? raw
            : (typeof raw === "object" && raw !== null) ? Object.values(raw)
            : [];
        return preset.map((kind) => ({
            kind,
            count: list.find((s) => s?.kind === kind)?.count ?? 0,
        }));
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = context.system;
        const type = this.item.type;

        context.isWeapon    = type === "weapon";
        context.isArmor     = type === "armor";
        context.isCyborg    = type === "cyborg";
        context.isIanus     = type === "ianus";
        context.isTap       = type === "tap";
        context.isVehicle   = type === "vehicle";
        context.isResidence = type === "residence";
        context.hasSlots    = !!this.constructor.SLOT_PRESETS[type];
        // フィールドの出し分け(複数型で共有する攻撃/防御)
        context.hasAttack  = ["weapon", "cyborg", "vehicle"].includes(type);
        context.hasGuard   = ["weapon", "cyborg"].includes(type);
        context.hasDefence = ["armor", "cyborg", "vehicle"].includes(type);

        // part は編集 UI 用に最低 1 行を保証する(保存はしない。表示用の正規化のみ)
        if (!Array.isArray(system.part)) {
            system.part = (typeof system.part === "object" && system.part !== null)
                ? Object.values(system.part)
                : [];
        }
        if (!system.part.length) system.part = [this.constructor.blankPartRow];

        // slots は既定プール構成に正規化して表示する
        if (context.hasSlots) system.slots = this._normalizedSlots();

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
            usesType:      skillOptions.usesType,
            buyHideMode:   this.constructor.buyHideModes,
            hackMode:      this.constructor.hackModes,
            majorCategory: majorChoices,
            minorCategory: minorChoices,
            damageTypes:   ATTACK_DAMAGE_TYPES,
            weaponRange:   WEAPON_RANGES,
            attackArea:    WEAPON_ATTACK_AREAS,
            slotKinds:     SLOT_KINDS,
        };

        // ダメージ種別のドロップダウン選択肢(表示は「S（斬撃）」形式、保存値はキー)
        if (context.hasAttack) {
            const damageType = { "": "-" };
            for (const [key, label] of Object.entries(ATTACK_DAMAGE_TYPES)) {
                damageType[key] = `${key}（${label}）`;
            }
            context.options.damageType = damageType;
        }

        context.view = this._prepareView(system, type);
        return context;
    }

    // ─── 閲覧表示の組み立て ─────────────────────────────────────────────────

    /**
     * 説明タブ上部のサマリ(ルルブ表記順の {label, value} 配列)とヘッダー表示を生成する。
     * @param {Object} system 正規化済み system データ
     * @param {string} type Item type
     * @returns {Object}
     */
    _prepareView(system, type) {
        const view = {};
        const num = (v) => (Number.isFinite(v) ? String(v) : "0");

        // 購：購入値／常備化経験点(解説参照時は常備化経験点を表記しない)
        let buy;
        if (system.buy.mode === "reference") buy = "解説参照";
        else if (system.buy.mode === "value") buy = `${num(system.buy.value)}／${num(system.preserveExp)}`;
        else buy = `-／${num(system.preserveExp)}`;

        // 隠匿値(単体)。隠匿値／危険値の併記版は hideFull
        const hideVal = system.hide.mode === "reference" ? "解説参照"
            : system.hide.mode === "value" ? num(system.hide.value)
            : "-";
        const hideFull = `${hideVal}／${num(system.appearancePenalty)}`;

        const hack = system.hack.mode === "value" ? num(system.hack.value) : "-";
        const part = formatPartLabel(system.part);
        const defence = () => {
            const d = system.defence;
            return `${num(d.S_defence)}／${num(d.P_defence)}／${num(d.I_defence)}`;
        };
        const slots = Array.isArray(system.slots) ? system.slots : [];
        const countOf = (kind) => slots.find((s) => s.kind === kind)?.count ?? 0;

        // 型ごとに概要の項目と順序が異なる(2026-06-12〜13 ユーザー確定)
        const rows = [];
        const push = (label, value) => rows.push({ label, value });
        switch (type) {
            case "weapon":
                push("購", buy); push("隠", hideFull);
                push("攻", this._attackLabel(system.attack));
                push("受", num(system.guardValue));
                push("射", formatWeaponRangeLabel(system.range));
                push("ス", num(countOf("normal")));
                push("電制", hack); push("部位", part);
                break;
            case "armor":
                push("購", buy); push("隠", hideFull);
                push("防(S／P／I)", defence());
                push("制", num(system.controlMod));
                push("電制", hack); push("部位", part);
                break;
            case "cyborg":
                push("購", buy); push("隠", hideFull);
                push("防(S／P／I)", defence());
                push("攻", this._attackLabel(system.attack));
                push("受", num(system.guardValue));
                push("電制", hack); push("部位", part);
                break;
            case "ianus":
                // 電制なし
                push("購", buy); push("隠", hideFull);
                push("ス", num(countOf("normal")));
                push("表", num(countOf("surface")));
                push("深", num(countOf("deep")));
                push("無", num(countOf("unconscious")));
                push("制", num(system.controlMod));
                push("部位", part);
                break;
            case "tron":
                push("購", buy); push("隠", hideFull);
                push("ス", num(countOf("normal")));
                push("電制", hack); push("部位", part);
                break;
            case "tap":
                push("購", buy); push("隠", hideFull);
                push("ソ", num(countOf("software")));
                push("ハ", num(countOf("hardware")));
                push("CS", num(system.combatSpeedMod));
                push("電制", hack); push("部位", part);
                break;
            case "vehicle":
                push("購", buy); push("隠", hideFull);
                push("攻", this._attackLabel(system.attack));
                push("SF", num(system.speedFactor));
                push("防(S／P／I)", defence());
                push("制", num(system.controlMod));
                push("乗員", num(system.passenger));
                push("ス", num(countOf("normal")));
                push("電制", hack); push("部位", part);
                break;
            case "residence":
                // 危険値・電制なし。隠は隠匿値のみ
                push("購", buy); push("隠", hideVal);
                push("登場", num(system.appearanceTarget));
                push("セ(電／ア)", `${num(system.cyberSecurity)}／${num(system.analogSecurity)}`);
                push("ス", num(countOf("normal")));
                push("部位", part);
                break;
            default: // general / combiner
                push("購", buy); push("隠", hideFull);
                push("電制", hack); push("部位", part);
        }
        view.summary = rows;

        if (system.majorCategory && system.minorCategory) {
            view.category = `${system.majorCategory}／${system.minorCategory}`;
        } else {
            view.category = system.majorCategory || system.minorCategory || "-";
        }

        return view;
    }

    /**
     * 攻撃力の表記(「攻：I+4」のダメージ種別 + 値部分)。
     * @param {{damageType: string, value: number}} attack
     * @returns {string}
     */
    _attackLabel(attack) {
        const type = attack.damageType || "";
        const value = attack.value ?? 0;
        if (!type && !value) return "-";
        const sign = value >= 0 ? `+${value}` : String(value);
        return `${type}${sign}`;
    }


    // ─── レンダリング後のイベント結線 ───────────────────────────────────────

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!context.editable) return;

        // 状態トグル(準備済み/携帯中/プレアクト購入)をウィンドウヘッダーに注入する。
        // D&D 5e の装備済みトグル踏襲。window-header は PART 外で永続するため
        // 毎レンダーで remove → 再挿入してリフレッシュする(編集モード切替ボタンと同方式)。
        // 並び順(右から): 閉じる / UUIDコピー / 準備済み / 携帯中 / プレアクト購入 / コントロール切替。
        // → UUID コピーボタンの直前(なければ閉じるボタンの直前)に挿入する。
        const header = this.element.querySelector(".window-header");
        if (header) {
            header.querySelector(".outfit-header-toggles")?.remove();
            const wrap = document.createElement("div");
            wrap.className = "outfit-header-toggles";
            const toggles = [
                { flag: "isPre-play",  icon: "fa-cart-shopping",  title: "プレアクト購入" },
                { flag: "isCarrying",  icon: "fa-suitcase",       title: "携帯中" },
                { flag: "isPrepared",  icon: "fa-shield-halved",  title: "準備済み" },
            ];
            for (const t of toggles) {
                const a = document.createElement("a");
                a.className = "outfit-flag-toggle" + (this.item.system[t.flag] === true ? " active" : "");
                a.dataset.action = "toggleFlag";
                a.dataset.flag = t.flag;
                a.title = t.title;
                a.innerHTML = `<i class="fa-solid ${t.icon}"></i>`;
                wrap.appendChild(a);
            }
            const anchor = header.querySelector('[data-action="copyUuid"]')
                ?? header.querySelector('[data-action="close"]');
            if (anchor) header.insertBefore(wrap, anchor);
            else header.appendChild(wrap);
        }

        // 大分類変更時は小分類をリセットする(連動ドロップダウン)
        this.element.querySelector('select[name="system.majorCategory"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this.item.update({
                    "system.majorCategory": event.currentTarget.value,
                    "system.minorCategory": "",
                });
            });

        // 購/隠/電制のモード変更時、数値以外なら value をリセットする
        for (const key of ["buy", "hide", "hack"]) {
            this.element.querySelector(`select[name="system.${key}.mode"]`)
                ?.addEventListener("change", (event) => {
                    event.stopPropagation();
                    const mode = event.currentTarget.value;
                    const update = { [`system.${key}.mode`]: mode };
                    if (mode !== "value") update[`system.${key}.value`] = 0;
                    this.item.update(update);
                });
        }

        // 使用回数: チェック解除時に回数・種別をリセットする(スタイル技能と同挙動)
        this.element.querySelector('input[name="system.uses.isLimit"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const isChecked = event.currentTarget.checked;
                const update = { "system.uses.isLimit": isChecked };
                if (!isChecked) {
                    update["system.uses.value"] = 0;
                    update["system.uses.max"]   = 0;
                    update["system.uses.type"]  = "";
                }
                this.item.update(update);
            });

        // フルオート: チェック解除時に FA 値をリセットする
        this.element.querySelector('input[name="system.isFullAuto"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const isChecked = event.currentTarget.checked;
                const update = { "system.isFullAuto": isChecked };
                if (!isChecked) update["system.FAValue"] = 0;
                this.item.update(update);
            });

        // スロット数の直接入力(配列フィールドのため全体更新で保存する)
        for (const input of this.element.querySelectorAll("input[data-slot-kind]")) {
            input.addEventListener("change", (event) => {
                event.stopPropagation();
                const kind = event.currentTarget.dataset.slotKind;
                const value = Math.max(0, Number(event.currentTarget.value) || 0);
                this._updateSlotCount(kind, () => value);
            });
        }

        // タイミング(単一): 種別変更時に下位フィールドをリセットする
        this.element.querySelector('select[name="system.timing.value"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const value = event.currentTarget.value;
                const update = { "system.timing.value": value };
                if (value !== "action")  update["system.timing.actionName"]  = "blank";
                if (value !== "process") update["system.timing.processName"] = "blank";
                if (value !== "other")   update["system.timing.timingOther"] = "";
                this.item.update(update);
            });

        // 部位行の入力(配列フィールドのため全体更新で保存する)
        for (const input of this.element.querySelectorAll("[data-part-field]")) {
            input.addEventListener("change", (event) => {
                event.stopPropagation();
                const el = event.currentTarget;
                const index = Number(el.dataset.index);
                const field = el.dataset.partField;
                const value = field === "slots"
                    ? Math.max(0, Number(el.value) || 0)
                    : el.value;
                this._updatePartRow(index, (row) => { row[field] = value; });
            });
        }

        // 部位行の追加・削除
        for (const btn of this.element.querySelectorAll('.tnx-row-btn[data-target="part"]')) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onAddPartRow();
            });
        }
        for (const btn of this.element.querySelectorAll('.tnx-row-btn--delete[data-target="part"]')) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onDeletePartRow(Number(event.currentTarget.dataset.index));
            });
        }
    }

    // ─── ヘッダーの状態トグル(準備済み/携帯中/プリプレイ購入) ────────────────

    /**
     * D&D 5e の装備済みトグルを踏襲したヘッダーアイコン。閲覧モードでも操作できる
     * (プレイ中に切り替える運用状態のため)。
     */
    static async _onToggleFlag(_event, target) {
        const flag = target.dataset.flag;
        if (!flag) return;
        const current = foundry.utils.getProperty(this.item.system, flag) === true;
        await this.item.update({ [`system.${flag}`]: !current });
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
        let next = current - 1;
        // data-min 指定時は下限でクランプする(part.slots の min 0 等)
        if (target.dataset.min !== undefined) next = Math.max(next, Number(target.dataset.min));
        await this.item.update({ [field]: next });
    }

    // ─── スロットプール操作 ─────────────────────────────────────────────────

    static async _onIncrementSlot(_event, target) {
        await this._updateSlotCount(target.dataset.kind, (count) => count + 1);
    }

    static async _onDecrementSlot(_event, target) {
        await this._updateSlotCount(target.dataset.kind, (count) => Math.max(0, count - 1));
    }

    /**
     * 指定 kind のプールの count を更新する(配列全体を送って保存する)。
     * @param {string} kind スロット種別
     * @param {(count: number) => number} mutate 現在値から新しい値を計算する関数
     */
    async _updateSlotCount(kind, mutate) {
        const slots = this._normalizedSlots();
        const pool = slots.find((s) => s.kind === kind);
        if (!pool) return;
        pool.count = mutate(pool.count ?? 0);
        await this.item.update({ "system.slots": slots });
    }

    // ─── 部位配列操作 ───────────────────────────────────────────────────────

    /** 保存済み part を配列に正規化して返す(最低 1 行) */
    _normalizedPart() {
        const raw = foundry.utils.deepClone(this.item.system.part);
        const list = Array.isArray(raw) ? raw
            : (typeof raw === "object" && raw !== null) ? Object.values(raw)
            : [];
        if (!list.length) list.push(this.constructor.blankPartRow);
        return list;
    }

    /**
     * 指定行を書き換えて配列全体を保存する。
     * @param {number} index 行番号
     * @param {(row: {value: string, slots: number}) => void} mutate 行を書き換える関数
     */
    async _updatePartRow(index, mutate) {
        const list = this._normalizedPart();
        if (!list[index]) return;
        mutate(list[index]);
        await this.item.update({ "system.part": list });
    }

    static async _onIncrementPart(_event, target) {
        await this._updatePartRow(Number(target.dataset.index), (row) => {
            row.slots = (row.slots ?? 0) + 1;
        });
    }

    static async _onDecrementPart(_event, target) {
        await this._updatePartRow(Number(target.dataset.index), (row) => {
            row.slots = Math.max(0, (row.slots ?? 0) - 1);
        });
    }

    async _onAddPartRow() {
        const list = this._normalizedPart();
        list.push(this.constructor.blankPartRow);
        await this.item.update({ "system.part": list });
    }

    async _onDeletePartRow(index) {
        const list = this._normalizedPart();
        if (index >= 0 && index < list.length) {
            list.splice(index, 1);
            await this.item.update({ "system.part": list });
        }
    }
}
