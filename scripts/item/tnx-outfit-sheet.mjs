import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";
import { OUTFIT_CATEGORIES } from "../data/item/outfit-categories.mjs";
import { ATTACK_DAMAGE_TYPES } from "../data/item/helpers.mjs";
import { WEAPON_RANGES, WEAPON_ATTACK_AREAS } from "../data/item/weapon.mjs";
import { SLOT_KINDS } from "../data/item/common/extensible.mjs";
import { HOUSING_AREA_RANKS, HOUSING_AREA_MOD_FIELDS } from "../data/item/housing-area.mjs";

/** 住宅エリア compendium の pack ID */
const HOUSING_AREA_PACK = "tokyo-nova-axleration.housing-areas";

/**
 * コンバイン元の比較対象パラメータ定義。
 * exists: 当該 system にフィールドが定義されているか(型依存)。
 * eq: 二値が等しいかの判定(等しければラジオ不要)。
 */
const COMBINE_PARAM_DEFS = Object.freeze([
    {
        key: "appearancePenalty", label: "危険値",
        exists: () => true,
        get: (s) => s.appearancePenalty,
        fmt: (v) => String(v ?? 0),
        eq: (a, b) => (a ?? 0) === (b ?? 0),
    },
    {
        key: "controlMod", label: "制御値修正",
        exists: (s) => s.controlMod !== undefined,
        get: (s) => s.controlMod,
        fmt: (v) => String(v ?? 0),
        eq: (a, b) => (a ?? 0) === (b ?? 0),
    },
    {
        key: "attack", label: "攻撃力",
        exists: (s) => s.attack !== undefined,
        get: (s) => s.attack,
        fmt: (v) => `${v.damageType || ""}+${v.value ?? 0}`,
        eq: (a, b) => a.damageType === b.damageType && (a.value ?? 0) === (b.value ?? 0),
    },
    {
        key: "defence", label: "防御値",
        exists: (s) => s.defence !== undefined,
        get: (s) => s.defence,
        fmt: (v) => `${v.S_defence ?? 0}／${v.P_defence ?? 0}／${v.I_defence ?? 0}`,
        eq: (a, b) => (a.S_defence ?? 0) === (b.S_defence ?? 0)
                   && (a.P_defence ?? 0) === (b.P_defence ?? 0)
                   && (a.I_defence ?? 0) === (b.I_defence ?? 0),
    },
    {
        key: "guardValue", label: "受け値",
        exists: (s) => s.guardValue !== undefined,
        get: (s) => s.guardValue,
        fmt: (v) => String(v ?? 0),
        eq: (a, b) => (a ?? 0) === (b ?? 0),
    },
    {
        key: "range", label: "射程",
        exists: (s) => s.range !== undefined,
        get: (s) => s.range,
        fmt: (v) => formatWeaponRangeLabel(v),
        eq: (a, b) => a.min === b.min && a.max === b.max,
    },
    {
        key: "speedFactor", label: "SF",
        exists: (s) => s.speedFactor !== undefined,
        get: (s) => s.speedFactor,
        fmt: (v) => String(v ?? 0),
        eq: (a, b) => (a ?? 0) === (b ?? 0),
    },
    {
        key: "passenger", label: "乗員",
        exists: (s) => s.passenger !== undefined,
        get: (s) => s.passenger,
        fmt: (v) => String(v ?? 0),
        eq: (a, b) => (a ?? 0) === (b ?? 0),
    },
]);

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
            incrementSlot:  TokyoNovaOutfitSheet._onIncrementSlot,
            decrementSlot:  TokyoNovaOutfitSheet._onDecrementSlot,
            incrementPart:  TokyoNovaOutfitSheet._onIncrementPart,
            decrementPart:  TokyoNovaOutfitSheet._onDecrementPart,
            toggleFlag:     TokyoNovaOutfitSheet._onToggleFlag,
            clearHousingArea: TokyoNovaOutfitSheet._onClearHousingArea,
            clearCombineSource: TokyoNovaOutfitSheet._onClearCombineSource,
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
        context.isCombiner  = type === "combiner";
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

        // 住宅施設: 紐づけた住宅エリアを live 解決し、供給値 + 合算用 mod を用意する(2026-06-13)
        let areaMods = null;
        if (context.isResidence) {
            context.options.housingArea = await this._housingAreaChoices();
            const uuid = system.housingArea;
            const linked = uuid ? await fromUuid(uuid).catch(() => null) : null;
            if (linked && linked.type === "housingArea") {
                areaMods = linked.system;
                context.linkedArea = {
                    name: linked.name,
                    rankLabel: HOUSING_AREA_RANKS[linked.system.area] ?? "-",
                    mods: HOUSING_AREA_MOD_FIELDS.map((m) => ({
                        ...m, value: linked.system[m.key] ?? 0,
                    })),
                };
                // ワールドアイテムのドロップで設定された場合はドロップダウンを無効化する
                // (compendium UUID はドロップダウンで表現できるためロックしない)
                context.housingAreaDropLocked = !uuid.startsWith("Compendium.");
            }
        }

        // コンバイナー: カテゴリはサービス/コンバイナーで確定。データが異なれば自動補正する(2026-06-13)
        if (context.isCombiner) {
            if (system.majorCategory !== "サービス" || system.minorCategory !== "コンバイナー") {
                this.item.update({ "system.majorCategory": "サービス", "system.minorCategory": "コンバイナー" });
                system.majorCategory = "サービス";
                system.minorCategory = "コンバイナー";
            }
            context.combine = await this._prepareCombinePreview(system);
        }

        context.view = this._prepareView(system, type, areaMods);
        return context;
    }

    /**
     * コンバイン元二つを解決し、確定的な合成結果(部位/分類/電制/隠/常備化経験点)を組み立てる。
     * 食い違うパラメータは paramRows として返し、テンプレート側でラジオ選択 UI を表示する。
     * @param {Object} system コンバイナーの system データ
     * @returns {Promise<Object>}
     */
    async _prepareCombinePreview(system) {
        const num = (v) => (Number.isFinite(v) ? v : 0);
        const resolve = async (uuid) => (uuid ? await fromUuid(uuid).catch(() => null) : null);
        const s1 = await resolve(system.combine.source1);
        const s2 = await resolve(system.combine.source2);

        const categoryOf = (it) => {
            if (!it) return "";
            const { majorCategory: maj, minorCategory: min } = it.system;
            return maj && min ? `${maj}／${min}` : (maj || min || "-");
        };
        const hackOf = (it) => (it?.system?.hack?.mode === "value" ? num(it.system.hack.value) : null);
        const hideOf = (sys) => sys?.hide?.mode === "reference" ? "解説参照"
            : sys?.hide?.mode === "value" ? String(num(sys.hide.value)) : "-";

        const result = {
            source1: s1 ? { name: s1.name, img: s1.img } : null,
            source2: s2 ? { name: s2.name, img: s2.img } : null,
            appearance: system.combine.appearance,
        };

        if (s1 && s2) {
            // 常備化経験点: コンバイナー本体 + 元1 + 元2 の合計(2026-06-13 ユーザー確定)
            const preserveExpTotal = num(system.preserveExp)
                + num(s1.system.preserveExp)
                + num(s2.system.preserveExp);

            // 部位: 両方の指定部位を全て占有
            const parts = [
                ...(Array.isArray(s1.system.part) ? s1.system.part : []),
                ...(Array.isArray(s2.system.part) ? s2.system.part : []),
            ];

            // 食い違うパラメータのラジオ選択行を生成する
            const params = system.combine.params ?? {};
            const paramRows = [];
            for (const def of COMBINE_PARAM_DEFS) {
                const sy1 = s1.system, sy2 = s2.system;
                if (!def.exists(sy1) || !def.exists(sy2)) continue;
                const v1 = def.get(sy1), v2 = def.get(sy2);
                if (def.eq(v1, v2)) continue; // 同値なら選択不要
                paramRows.push({
                    key:    def.key,
                    label:  def.label,
                    val1:   def.fmt(v1),
                    val2:   def.fmt(v2),
                    choice: params[def.key] ?? "1",
                });
            }

            result.paramRows = paramRows;
            result.merged = {
                name: (system.combine.appearance === "2" ? s2 : s1).name,
                part: formatPartLabel(parts),
                category: `${categoryOf(s1)}／${categoryOf(s2)}`,
                preserveExpTotal,
                // 電制: どちらか高い方(両方なしなら -)
                hack: (() => {
                    const a = hackOf(s1), b = hackOf(s2);
                    const vals = [a, b].filter((v) => v !== null);
                    return vals.length ? String(Math.max(...vals)) : "-";
                })(),
                // 隠: X(Y) — X = 見た目の隠匿値、Y = コンバイナー本体の隠匿値
                hide: `${hideOf((system.combine.appearance === "2" ? s2 : s1).system)}(${hideOf(system)})`,
            };
        }
        return result;
    }

    /**
     * 住宅エリア compendium の選択肢({uuid: name})を返す。
     * @returns {Promise<Record<string, string>>}
     */
    async _housingAreaChoices() {
        const pack = game.packs.get(HOUSING_AREA_PACK);
        if (!pack) return {};
        const index = await pack.getIndex();
        const choices = {};
        for (const entry of index) choices[entry.uuid] = entry.name;
        return choices;
    }

    // ─── 閲覧表示の組み立て ─────────────────────────────────────────────────

    /**
     * 説明タブ上部のサマリ(ルルブ表記順の {label, value} 配列)とヘッダー表示を生成する。
     * @param {Object} system 正規化済み system データ
     * @param {string} type Item type
     * @param {Object|null} areaMods 住宅施設の場合、紐づけた住宅エリアの system(合算用)。なければ null
     * @returns {Object}
     */
    _prepareView(system, type, areaMods = null) {
        const view = {};
        const num = (v) => (Number.isFinite(v) ? String(v) : "0");
        // 住宅エリアの修正値を加算するヘルパー(住宅施設のみ。エリア未設定時は加算 0)
        const am = (key) => (areaMods?.[key] ?? 0);

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
            case "residence": {
                // 危険値・電制なし。隠は隠匿値のみ。住宅エリアの修正値を合算して表示する
                const preserveR = (system.preserveExp ?? 0) + am("preserveExpMod");
                let buyR;
                if (system.buy.mode === "reference") buyR = "解説参照";
                else if (system.buy.mode === "value") buyR = `${(system.buy.value ?? 0) + am("buyRatingMod")}／${preserveR}`;
                else buyR = `-／${preserveR}`;
                const hideR = system.hide.mode === "reference" ? "解説参照"
                    : system.hide.mode === "value" ? String((system.hide.value ?? 0) + am("hideMod"))
                    : "-";
                push("購", buyR); push("隠", hideR);
                push("登場", num((system.appearanceTarget ?? 0) + am("appearanceTargetMod")));
                push("セ(電／ア)", `${(system.cyberSecurity ?? 0) + am("cyberSecurityMod")}／${(system.analogSecurity ?? 0) + am("analogSecurityMod")}`);
                push("ス", num(countOf("normal") + am("slotMod")));
                push("部位", part);
                break;
            }
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

        // 住宅施設: 住宅エリアアイテムのドロップを受ける(V2 は dragDrop を自動処理しない)
        if (this.element.querySelector(".tnx-import-box--dropzone")) {
            new foundry.applications.ux.DragDrop.implementation({
                dropSelector: ".tnx-import-box--dropzone",
                permissions: { drop: () => this.isEditable },
                callbacks: { drop: this._onDropZone.bind(this) },
            }).bind(this.element);
        }
    }

    /**
     * ドロップ受付。住宅施設の住宅エリア / コンバイナーのコンバイン元を設定する。
     */
    async _onDropZone(event) {
        const area = event.target.closest("[data-drop-area]")?.dataset.dropArea;
        if (!area) return;
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch { return; }
        if (data?.type !== "Item") return;
        const dropped = (data.uuid ? await fromUuid(data.uuid).catch(() => null) : null)
            ?? await Item.fromDropData(data).catch(() => null);
        if (!dropped) return;

        // 住宅施設: 住宅エリアの紐づけ
        if (area === "housing-area" && this.item.type === "residence") {
            if (dropped.type !== "housingArea") {
                ui.notifications.warn("住宅エリアアイテムをドロップしてください。");
                return;
            }
            await this.item.update({ "system.housingArea": dropped.uuid });
            return;
        }

        // コンバイナー: コンバイン元(1/2)の指定。アウトフィット系のみ受け付ける
        if ((area === "combine-1" || area === "combine-2") && this.item.type === "combiner") {
            if (dropped.type === "housingArea" || dropped.type === "combiner") {
                ui.notifications.warn("コンバインできないアイテムです。");
                return;
            }
            const key = area === "combine-1" ? "source1" : "source2";
            await this.item.update({ [`system.combine.${key}`]: dropped.uuid });
        }
    }

    /** 住宅エリアの紐づけを解除する */
    static async _onClearHousingArea(_event, _target) {
        await this.item.update({ "system.housingArea": "" });
    }

    /** コンバイン元の指定を解除する(data-source = "1" / "2") */
    static async _onClearCombineSource(_event, target) {
        const key = target.dataset.source === "2" ? "source2" : "source1";
        await this.item.update({ [`system.combine.${key}`]: "" });
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
