import { SYSTEM_ID } from "../constants.mjs";
import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../core/tnx-skill-utils.mjs";
import { OUTFIT_CATEGORIES, OUTFIT_TYPES, getMajorCategoryLabel, getMinorCategoryLabel } from "../data/item/outfit-categories.mjs";
import { ATTACK_DAMAGE_TYPES } from "../data/item/helpers.mjs";
import { WEAPON_RANGE_MIN_OPTIONS, WEAPON_RANGE_MAX_OPTIONS, WEAPON_ATTACK_AREAS } from "../data/item/weapon.mjs";
import { SLOT_KINDS } from "../data/item/common/extensible.mjs";
import { HOUSING_AREA_RANKS, HOUSING_AREA_MOD_FIELDS } from "../data/item/housing-area.mjs";
import { PART_KINDS, PART_REFERENCE_SUB_KINDS, PART_RELATIONS, SHIKI_TYPES } from "../data/item/common/outfit-base.mjs";
import { getPartSlotPreset } from "../app/part-slot-preset-app.mjs";
import { joinPartDesignations, PART_HOST_FEATURE_LABELS, resolvePartRowsForDisplay, resolvePartAdditions, findPartKeyByLabel, matchesHostDescriptor, OUTFIT_NAME_SLOT_KIND } from "../data/item/part-helpers.mjs";
import { readFlag } from "../data/item/helpers.mjs";
import { applyOutfitFlagToggle, isEquipStateFlag, canTogglePreplayPurchase } from "../core/outfit-flags.mjs";
import { resolveItemNameByKey } from "../core/identification.mjs";
import { hideLabel } from "../ui/outfit-view.mjs";
import { loadSkillChoices, loadOnomasticChoices, STYLE_PACK, ORGANIZATION_PACK } from "../dictionary/skill-dictionary.mjs";
import { loadOutfitHostChoices, loadOutfitDictNames } from "../dictionary/outfit-dictionary.mjs";
import { buildOutfitSummaryRows, formatWeaponRangeLabel } from "../ui/outfit-view.mjs";
import { MODIFICATION_PARAMS } from "../data/item/modification-params.mjs";

/** 住宅エリア compendium の pack ID */
const HOUSING_AREA_PACK = "tokyo-nova-axleration.housing-areas";

/**
 * 大分類・小分類の両方が一意に確定している Item type → { major, minor } のマップ。
 * 該当型ではドロップダウンを非表示にし、データが異なれば自動補正する。
 */
const BOTH_FIXED_CATEGORIES = Object.freeze({
    combiner:  { major: "service",   minor: "combiner" },
    residence: { major: "housing",   minor: "residence" },
    ianus:     { major: "cyberware", minor: "ianus" },
    cyborg:    { major: "cyberware", minor: "fullCyborg" },
});

/**
 * 大分類のみ確定しており、小分類は選択できる Item type → 大分類キーのマップ。
 * 該当型では大分類をラベル表示にし、小分類だけドロップダウンで選択する。
 */
const MAJOR_FIXED_CATEGORIES = Object.freeze({
    tron:    "tron",
    tap:     "tron",
    vehicle: "vehicle",
});

/**
 * コンバイン元の比較対象パラメータ定義。
 * exists: 当該 system にフィールドが定義されているか(型依存)。
 * eq: 二値が等しいかの判定(等しければラジオ不要)。
 */
/** {mode,value} 形式のフィールド用共通比較 */
function modeValueEq(a, b) {
    const mA = a?.mode ?? "none", mB = b?.mode ?? "none";
    if (mA !== mB) return false;
    if (mA !== "value") return true;
    return (a?.value ?? 0) === (b?.value ?? 0);
}
function modeValueFmt(v) {
    return v?.mode === "value" ? String(v.value ?? 0) : "-";
}

const COMBINE_PARAM_DEFS = Object.freeze([
    {
        key: "appearancePenalty", label: "危険値",
        exists: () => true,
        get: (s) => s.appearancePenalty,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "controlMod", label: "制御値修正",
        exists: (s) => s.controlMod !== undefined,
        get: (s) => s.controlMod,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "attack", label: "攻撃力",
        exists: (s) => s.attack !== undefined,
        get: (s) => s.attack,
        // 表示は実効値(AE 込み・2026-07-13): 種別=damageTypeTotal・値=total
        fmt: (v) => `${v.damageTypeTotal || v.damageType || ""}+${v.total ?? v.value ?? 0}`,
        eq: (a, b) => a.damageType === b.damageType && (a.value ?? 0) === (b.value ?? 0),
    },
    {
        key: "defence", label: "防御値",
        exists: (s) => s.defence !== undefined,
        get: (s) => s.defence,
        fmt: (v) => v?.mode === "value"
            ? `${v.S_defence ?? 0}／${v.P_defence ?? 0}／${v.I_defence ?? 0}` : "-",
        eq: (a, b) => {
            const mA = a?.mode ?? "none", mB = b?.mode ?? "none";
            if (mA !== mB) return false;
            if (mA !== "value") return true;
            return (a.S_defence ?? 0) === (b.S_defence ?? 0)
                && (a.P_defence ?? 0) === (b.P_defence ?? 0)
                && (a.I_defence ?? 0) === (b.I_defence ?? 0);
        },
    },
    {
        key: "guardValue", label: "受け値",
        exists: (s) => s.guardValue !== undefined,
        get: (s) => s.guardValue,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "range", label: "射程",
        exists: (s) => s.range !== undefined,
        get: (s) => s.range,
        fmt: (v) => formatWeaponRangeLabel(v),
        eq: (a, b) => (a?.min ?? "none") === (b?.min ?? "none")
                   && (a?.max ?? "none") === (b?.max ?? "none"),
    },
    {
        key: "speedFactor", label: "SF",
        exists: (s) => s.speedFactor !== undefined,
        get: (s) => s.speedFactor,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "passenger", label: "乗員",
        exists: (s) => s.passenger !== undefined,
        get: (s) => s.passenger,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
    {
        key: "combatSpeedMod", label: "CS修正",
        exists: (s) => s.combatSpeedMod !== undefined,
        get: (s) => s.combatSpeedMod,
        fmt: modeValueFmt,
        eq: modeValueEq,
    },
]);


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
            deleteModification: TokyoNovaOutfitSheet._onDeleteModification,
            incrementSlot:     TokyoNovaOutfitSheet._onIncrementSlot,
            decrementSlot:     TokyoNovaOutfitSheet._onDecrementSlot,
            incrementPart:     TokyoNovaOutfitSheet._onIncrementPart,
            decrementPart:     TokyoNovaOutfitSheet._onDecrementPart,
            toggleFlag:        TokyoNovaOutfitSheet._onToggleFlag,
            clearHousingArea:    TokyoNovaOutfitSheet._onClearHousingArea,
            viewHousingArea:     TokyoNovaOutfitSheet._onViewHousingArea,
            clearCombineSource:  TokyoNovaOutfitSheet._onClearCombineSource,
            viewCombineSource:   TokyoNovaOutfitSheet._onViewCombineSource,
            deactivateCombine:   TokyoNovaOutfitSheet._onDeactivateCombine,
            viewDerivedRef:      TokyoNovaOutfitSheet._onViewDerivedRef,
            clearExtraActorRef:  TokyoNovaOutfitSheet._onClearExtraActorRef,
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

    /** 購入値の 3 状態(なし/数値/解説参照) */
    static get buyModes() {
        return { none: "なし", value: "数値", reference: "解説参照" };
    }

    /** 隠匿値の 4 状態。制御値=知覚判定で相手が使ったスートの制御値がそのまま隠匿値になる
     *  (2026-09-07 ユーザー裁定)。DataModel の choices と一致させること */
    static get hideModes() {
        return { none: "なし", value: "数値", reference: "解説参照", control: "制御値" };
    }

    /** 電脳制御値の 2 状態(なし/数値) */
    static get hackModes() {
        return { none: "なし", value: "数値" };
    }

    /** 危険値の 2 状態(なし/数値) */
    static get appearancePenaltyModes() {
        return { none: "なし", value: "数値" };
    }

    /** 汎用 なし/数値 の 2 状態(preserveExp / guardValue / controlMod / cycle / combatSpeedMod / speedFactor / passenger / slots / defence) */
    static get noneValueModes() {
        return { none: "なし", value: "数値" };
    }

    /** 空の部位行(フェーズ10: 種別ベース。新規行の既定種別は身体部位。任意は part 全体フラグ) */
    static get blankPartRow() {
        return {
            kind: "bodyPart", value: "", slots: 1,
            hostMajor: "", hostMinor: "", hostMinorExclude: false,
            hostFeature: "", hostKey: "", refSubKind: "none",
        };
    }

    /**
     * オプションの装備先絞り込みに使うホスト記述子を part 行から取り出す(先頭の option 行)。
     * 装備先(parentItemId)候補と、アイテム名(hostKey)辞典プルダウンの絞り込みで共有する。
     * @param {object} system アウトフィットの system
     * @returns {{hostMajor:string, hostMinor:string, hostMinorExclude:boolean, hostFeature:string, hostKey:string}}
     */
    _optionHostSpec(system) {
        const rows = Array.isArray(system.part) ? system.part : [];
        const row = rows.find((r) => (r?.kind === "reference" ? r?.refSubKind : r?.kind) === "option") ?? {};
        return {
            hostMajor: row.hostMajor ?? "", hostMinor: row.hostMinor ?? "",
            hostMinorExclude: row.hostMinorExclude === true,
            hostFeature: row.hostFeature ?? "", hostKey: row.hostKey ?? "",
        };
    }

    /** オプションの装備先ホストになり得る Item type */
    static OUTFIT_HOST_TYPES = new Set([
        "weapon", "armor", "cyborg", "ianus", "tron", "tap",
        "vehicle", "residence", "combiner", "general",
    ]);

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
        for (const [majorKey, major] of Object.entries(OUTFIT_CATEGORIES)) {
            const valid = Object.entries(major.minors)
                .filter(([, def]) => def.types.includes(type))
                .map(([minorKey]) => minorKey);
            if (valid.length) result[majorKey] = valid;
        }
        return result;
    }

    /**
     * 保存済み slots を型の既定プール構成に正規化して返す(表示・更新共用)。
     * 既存プールの count({mode,value})は kind で引き継ぐ。
     * @returns {Array<{kind: string, count: {mode: string, value: number}}>}
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
            count: list.find((s) => s?.kind === kind)?.count ?? { mode: "none", value: 0 },
        }));
    }

    /**
     * エキストラアクターのドロップ(11-6): エキストラ型のアクターのみ受け付ける。
     * 共有アクター前提(システムは複製しない。個人専用は新規アクターを作成して付け替える)。
     */
    async _onExtraActorDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Actor" || doc.type !== "extra") {
            ui.notifications.warn("ここにはエキストラのアクターをドロップしてください。");
            return;
        }
        await this.item.update({ "system.extraActorRef": { uuid: doc.uuid, name: doc.name } });
    }

    static async _onClearExtraActorRef(_event, _target) {
        await this.item.update({ "system.extraActorRef": { uuid: "", name: "" } });
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = context.system;
        const type = this.item.type;
        // 神業で入手した複製(17-6・《タイムリー》《買収》): 常備化できない
        context.acquiredByMiracle = this.item.getFlag(SYSTEM_ID, "fromMiracle") === true;

        context.isWeapon    = type === "weapon";
        context.isArmor     = type === "armor";
        context.isCyborg    = type === "cyborg";
        context.isIanus     = type === "ianus";
        context.isTap       = type === "tap";
        context.isVehicle   = type === "vehicle";
        context.isResidence = type === "residence";
        context.isCombiner  = type === "combiner";
        context.hasSlots    = !!this.constructor.SLOT_PRESETS[type];
        // 住宅オプション・住宅アクセサリ(一般アイテムのカテゴリ)は危険値を持たない(2026-07-09 ユーザー)。
        // 危険値の設定行を隠し、概要は隠匿値のみ表示する。住宅施設(residence)も危険値なし
        context.hidesAppearancePenalty = context.isResidence
            || system.minorCategory === "housingOption" || system.minorCategory === "housingAccessory";

        // エキストラの二重表現(11-6・Troops.md): 小分類「エキストラ」のみ、場に出るときの
        // 共有エキストラアクターの参照欄を表示する(名前は fromUuid ライブ解決・削除時のみ name)
        context.isExtraOutfit = type === "general" && system.minorCategory === "extra";
        if (context.isExtraOutfit) {
            const ref = system.extraActorRef ?? {};
            const doc = ref.uuid ? await fromUuid(ref.uuid).catch(() => null) : null;
            context.hasExtraActor = !!ref.uuid;
            context.extraActorName = doc?.name ?? (ref.name ? `${ref.name}（削除済み）` : "");
        }

        // フィールドの出し分け(複数型で共有する攻撃/防御)
        context.hasAttack  = ["weapon", "cyborg", "vehicle"].includes(type);
        context.hasGuard   = ["weapon", "cyborg"].includes(type);
        context.hasDefence = ["armor", "cyborg", "vehicle"].includes(type);

        // 残弾(2026-07-19 再導入): 表示は「射撃武器」フラグで判定する(分類ベースにしない——
        // 区分は搭載兵器・生体装備にもあるため)。ammo スキーマは weapon のみが持つ
        context.hasAmmo = type === "weapon" && system.isRangedWeapon === true;

        // ヴィークルの「対応する操縦」(辞典 operate_ 技能)の選択肢。操縦移動判定・搭乗ドッジ上書きに使う
        if (context.isVehicle) {
            context.operateSkillChoices = await loadOnomasticChoices("operate");
        }

        // part は編集 UI 用に最低 1 行を保証する(保存はしない。表示用の正規化のみ)
        if (!Array.isArray(system.part)) {
            system.part = (typeof system.part === "object" && system.part !== null)
                ? Object.values(system.part)
                : [];
        }
        if (!system.part.length) system.part = [this.constructor.blankPartRow];

        // 部位エディタ(フェーズ10): 行ごとの種別連動 UI 用データ(文脈連動の選択肢込み)
        await this._preparePartEditorData(context, system);

        // 特性(10-2): 式神装備のタイプ選択肢・派生元アウトフィットの派生データ参照(名前ライブ解決)
        context.shikiTypeChoices = { "": "-", ...SHIKI_TYPES };
        context.derivedDataRefs = await this.constructor._resolveDerivedRefs(system.derivedDataRefs);

        // 専用(10-2): スタイル/オーガニゼーション辞典を2つのオプショングループにまとめた複数行プルダウン。
        // 名前は辞典から都度解決(保持名キャッシュなし)。自動化はしない(指定のみ)。
        context.exclusiveRows = await this._prepareExclusiveRows(system);

        // slots は既定プール構成に正規化して表示する
        if (context.hasSlots) system.slots = this._normalizedSlots();

        // カテゴリ固定型: データが不整合なら自動補正し、テンプレート用フラグをセットする
        const fixedBoth = BOTH_FIXED_CATEGORIES[type];
        const fixedMajorName = MAJOR_FIXED_CATEGORIES[type];
        if (fixedBoth) {
            if (system.majorCategory !== fixedBoth.major || system.minorCategory !== fixedBoth.minor) {
                this.item.update({ "system.majorCategory": fixedBoth.major, "system.minorCategory": fixedBoth.minor });
                system.majorCategory = fixedBoth.major;
                system.minorCategory = fixedBoth.minor;
            }
            context.isBothCategoryFixed = true;
            // 固定分類は disabled プルダウンで表示する(2026-08-31 ユーザー指示=文字列表示は
            // 2行目以降と縦位置・幅が揃わない)。ラベルは disabled select の単一 option に入れる
            context.fixedMajorLabel = getMajorCategoryLabel(fixedBoth.major);
            context.fixedMinorLabel = getMinorCategoryLabel(fixedBoth.minor);
        } else if (fixedMajorName) {
            if (system.majorCategory !== fixedMajorName) {
                this.item.update({ "system.majorCategory": fixedMajorName });
                system.majorCategory = fixedMajorName;
            }
            context.isMajorCategoryFixed = true;
            context.fixedMajorLabel = getMajorCategoryLabel(fixedMajorName);
        }

        const skillOptions = TnxSkillUtils.getSkillOptions();
        const categories = this._categoriesForType();

        const majorChoices = { "": "-" };
        for (const majorKey of Object.keys(categories)) majorChoices[majorKey] = getMajorCategoryLabel(majorKey);
        const minorChoices = { "": "-" };
        for (const minorKey of categories[system.majorCategory] ?? []) minorChoices[minorKey] = getMinorCategoryLabel(minorKey);

        // isOption のとき: **宣言したホスト記述子**(hostMajor/hostMinor/除外/特徴/hostKey)に一致する
        // 非オプションのアウトフィットを装備先候補にする(2026-07-23 統合)。自身の大分類では絞らない
        // ——搭載兵器(武器)→ヴィークル のような大分類跨ぎが通る。照合はアイテム名辞典と同じ matchesHostDescriptor。
        const parentItemChoices = { "": "-" };
        const parentSlotChoices = { "": "-" };
        if (system.isOption && this.item.parent?.documentName === "Actor") {
            const spec = this._optionHostSpec(system);
            for (const sibling of this.item.parent.items) {
                if (sibling.id === this.item.id) continue;
                if (!OUTFIT_TYPES.has(sibling.type)) continue;
                if (sibling.system.isOption) continue;
                const sm = sibling.system;
                const host = {
                    majorCategory: sm.majorCategory, minorCategory: sm.minorCategory,
                    additionalCategories: sm.additionalCategories,
                    identificationKey: sm.identificationKey ?? "",
                    isLaser: readFlag(sm, "isLaser"),
                    isMutantOrgan: readFlag(sm, "isMutantOrgan"),
                };
                if (!matchesHostDescriptor(host, spec)) continue;
                parentItemChoices[sibling.id] = sibling.name;
            }
            // 親アイテム選択済み: 実スロット(容量>0)があればその種別、無ければ便宜スロット「アイテム名」を候補に
            if (system.parentItemId) {
                const parentItem = this.item.parent.items.get(system.parentItemId);
                const slots = Array.isArray(parentItem?.system?.slots) ? parentItem.system.slots : [];
                const realSlots = slots.filter((s) => s?.count?.mode === "value" && Number(s.count.total ?? s.count.value) > 0);
                if (realSlots.length) {
                    for (const slot of realSlots) parentSlotChoices[slot.kind] = SLOT_KINDS[slot.kind] ?? slot.kind;
                } else if (parentItem) {
                    // スロットなしホスト=便宜スロット「アイテム名」。表示はホスト名(アイテムごとに変わる)
                    parentSlotChoices[OUTFIT_NAME_SLOT_KIND] = parentItem.name;
                }
            }
        }
        context.parentHasSlots = Object.keys(parentSlotChoices).length > 1;
        // 装備先 UI(部位セクション最下部)は、オプション・キャスト所属のときだけ出す
        context.showOptionHost = system.isOption && this.item.parent?.documentName === "Actor";

        context.options = {
            ...context.options,
            usesType:      skillOptions.usesType,
            buyMode:                this.constructor.buyModes,
            hideMode:               this.constructor.hideModes,
            hackMode:               this.constructor.hackModes,
            appearancePenaltyMode:  this.constructor.appearancePenaltyModes,
            noneValueMode:          this.constructor.noneValueModes,
            majorCategory: majorChoices,
            minorCategory: minorChoices,
            damageTypes:   ATTACK_DAMAGE_TYPES,
            weaponRangeMin: WEAPON_RANGE_MIN_OPTIONS,
            weaponRangeMax: WEAPON_RANGE_MAX_OPTIONS,
            attackArea:    WEAPON_ATTACK_AREAS,
            slotKinds:     SLOT_KINDS,
            parentItem:    parentItemChoices,
            parentSlot:    parentSlotChoices,
        };

        // ダメージ種別のドロップダウン選択肢。表記は S/P/I/X そのものが正式(2026-07-21 指摘)
        if (context.hasAttack) {
            context.options.damageType = { "": "-", ...ATTACK_DAMAGE_TYPES };
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
                    img: linked.img,
                    rankLabel: HOUSING_AREA_RANKS[linked.system.area] ?? "-",
                    mods: HOUSING_AREA_MOD_FIELDS.map((m) => {
                        const v = linked.system[m.key] ?? 0;
                        return { ...m, value: v > 0 ? `+${v}` : String(v) };
                    }),
                };
            }
        }

        // 副分類(フェーズ16-1・2026-08-30 裁定): 「複数の分類を持つアウトフィット」の追加分類行。
        // チェック状態は副分類の有無から導出(状態レス)。行の選択肢は**全分類の樹**から出す
        // (主分類の選択肢はアイテムタイプで絞るが、副分類は型跨ぎの横断がまさに用途のため絞らない)。
        // 旧 isCyber フラグとその自動セットは廃止(副分類へ完全統合・migrateData が移行)。
        const additionalRows = Array.isArray(system.additionalCategories) ? system.additionalCategories : [];
        const allMajorChoices = { "": "-" };
        for (const majorKey of Object.keys(OUTFIT_CATEGORIES)) allMajorChoices[majorKey] = getMajorCategoryLabel(majorKey);
        context.hasAdditionalCategories = additionalRows.length > 0;
        context.additionalCategoryRows = additionalRows.map((row, index) => {
            const minors = { "": "-" };
            for (const minorKey of Object.keys(OUTFIT_CATEGORIES[row.major]?.minors ?? {})) {
                minors[minorKey] = getMinorCategoryLabel(minorKey);
            }
            return { index, major: row.major ?? "", minor: row.minor ?? "", minorChoices: minors, isFirst: index === 0 };
        });
        context.options.additionalMajorCategory = allMajorChoices;

        // コンバイナー: カテゴリ自動補正は BOTH_FIXED_CATEGORIES で処理済み
        if (context.isCombiner) {
            context.combine = await this._prepareCombinePreview(system);
            context.combine.isActive = system.isCombineActive;
        }

        // アイテム名(hostKey)→現在名の解決子: アクター所持品の逆引き優先・辞典名フォールバック
        // (identification.mjs。保持名キャッシュなし＝常に live 解決)。オプションの部位ラベルに使う。
        const outfitDictNames = await loadOutfitDictNames();
        const actorForResolve = this.item.parent?.documentName === "Actor" ? this.item.parent : null;
        const resolveHostName = (key) => resolveItemNameByKey(actorForResolve, key, outfitDictNames);

        context.view = this._prepareView(system, type, areaMods, resolveHostName);
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

        const hackOf = (it) => (it?.system?.hack?.mode === "value" ? num(it.system.hack.value) : null);
        const hideOf = (sys) => hideLabel(sys?.hide);
        const penaltyOf = (sys) => sys?.appearancePenalty?.mode === "value"
            ? String(num(sys.appearancePenalty.value)) : "-";

        const result = {
            source1: s1 ? { name: s1.name, img: s1.img } : null,
            source2: s2 ? { name: s2.name, img: s2.img } : null,
            appearance: system.combine.appearance,
        };

        if (s1 && s2) {
            // 常備化経験点: コンバイナー本体 + 元1 + 元2 の合計(2026-06-13 ユーザー確定)
            const expNum = (s) => s?.preserveExp?.mode === "value" ? num(s.preserveExp.value) : 0;
            const preserveExpTotal = expNum(system)
                + expNum(s1.system)
                + expNum(s2.system);

            // 部位: 両方の指定部位を全て占有(merged.part で joinPartDesignations により併記)

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
            const appearSrc = system.combine.appearance === "2" ? s2 : s1;
            const appearSys = appearSrc.system;

            // 分類: 大分類が同じ場合は短縮形(2026-06-13 ユーザー確定)。表示は label を引く
            const maj1 = getMajorCategoryLabel(s1.system.majorCategory) || "-", min1 = getMinorCategoryLabel(s1.system.minorCategory) || "-";
            const maj2 = getMajorCategoryLabel(s2.system.majorCategory) || "-", min2 = getMinorCategoryLabel(s2.system.minorCategory) || "-";
            const category = s1.system.majorCategory === s2.system.majorCategory
                ? `${maj1}／${min1}、${min2}`
                : `${maj1}／${min1}、${maj2}／${min2}`;

            const mergedSlotsCtx = this.item.parent?.system?.partSlotsEffective
                ?? this.item.parent?.system?.partSlots ?? getPartSlotPreset();
            const resolvedPartSys = (src) => ({
                part: resolvePartRowsForDisplay(src.system.part, mergedSlotsCtx),
                partRelation: src.system.partRelation,
                partOptional: src.system.partOptional,
                partAdditions: resolvePartAdditions(src.system.partAdded, mergedSlotsCtx),
            });
            result.merged = {
                name: appearSrc.name,
                part: joinPartDesignations([resolvedPartSys(s1), resolvedPartSys(s2)]),
                category,
                preserveExpTotal,
                // 電制: どちらか高い方(両方なしなら -)
                hack: (() => {
                    const a = hackOf(s1), b = hackOf(s2);
                    const vals = [a, b].filter((v) => v !== null);
                    return vals.length ? String(Math.max(...vals)) : "-";
                })(),
                // 隠：見た目元の隠匿値(コンバイナーの隠匿値)／選択した元の危険値
                hide: (() => {
                    const penaltySrc = system.combine.params?.appearancePenalty === "2" ? s2 : s1;
                    return `${hideOf(appearSys)}(${hideOf(system)})／${penaltyOf(penaltySrc.system)}`;
                })(),
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
        // エリア(セキュリティ・ランク)順に並べる。ランクを参照するため index に system.area を含める。
        // 順番: レッド→イエロー→グリーン→ホワイト→サンクチュアリ→なし。
        // 「なし」は治安が悪いのでなく、セキュリティの概念の外(たどり着けない/認識されない)エリアのため
        // 別枠として最下部に置く。
        // 同ランク内は辞典内の元順を保つ(Array.sort は安定ソート＝名前ではなく辞典順を維持)。
        const index = await pack.getIndex({ fields: ["system.area"] });
        const rankOrder = [...Object.keys(HOUSING_AREA_RANKS).filter((k) => k !== "none"), "none"];
        const rankIdx = (e) => {
            const i = rankOrder.indexOf(e.system?.area ?? "none");
            return i < 0 ? rankOrder.length - 1 : i; // 該当なしは「なし」扱い(最下部)
        };
        const entries = [...index].sort((a, b) => rankIdx(a) - rankIdx(b));
        const choices = {};
        for (const entry of entries) choices[entry.uuid] = entry.name;
        return choices;
    }

    // ─── 閲覧表示の組み立て ─────────────────────────────────────────────────

    /**
     * 説明タブ上部のサマリ(ルルブ表記順の {label, value} 配列)とヘッダー表示を生成する。
     * @param {Object} system 正規化済み system データ
     * @param {string} type Item type
     * @param {Object|null} areaMods 住宅施設の場合、紐づけた住宅エリアの system(合算用)。なければ null
     * @param {?(hostKey:string)=>string} [resolveHostName] オプション部位ラベルの hostKey→現在名
     * @returns {Object}
     */
    _prepareView(system, type, areaMods = null, resolveHostName = null) {
        const view = {};
        // サマリ(ルルブ略号行)は共通ビルダー(outfit-view.mjs・フェーズ16-2 で切り出し=
        // 辞典ブラウザのカード・アイテムツールチップと共用)。部位スロット文脈はアクター所属時
        // のみ実効値、AE 追加部位(partAdded)も所属時のみ存在する
        const partSlotsCtx = this.item.parent?.system?.partSlotsEffective
            ?? this.item.parent?.system?.partSlots ?? getPartSlotPreset();
        view.summary = buildOutfitSummaryRows(system, type, {
            areaMods, resolveHostName, partSlotsCtx,
            partAdded: this.item.system.partAdded ?? [],
        });

        // 改造記録(16-4): 説明タブの「改造」セクション(実効値は上の略号行に合流済み)。
        // note=適用時の出所スナップショット(履歴・ライブ解決しない)
        view.modifications = (system.modifications ?? []).map((r, index) => {
            const label = MODIFICATION_PARAMS[r?.param]?.label ?? r?.param ?? "";
            const v = Number(r?.value) || 0;
            const text = r?.param === "drugTiming"
                ? label
                : `${label}${v >= 0 ? `＋${v}` : `−${Math.abs(v)}`}`;
            return { index, text, note: r?.note ?? "" };
        });

        const fmtCategory = (major, minor) => {
            const M = getMajorCategoryLabel(major);
            const m = getMinorCategoryLabel(minor);
            return M && m ? `${M}／${m}` : (M || m || "");
        };
        // primaryCategory=主分類のみ(編集モードの固定ラベル用・副分類は編集行が別にあるため重複させない)。
        // category=閲覧モードの分類表示(副分類を「＋」で列挙=複数分類が見えるように・フェーズ16-1)
        view.primaryCategory = fmtCategory(system.majorCategory, system.minorCategory) || "-";
        const extraLabels = (system.additionalCategories ?? [])
            .map((r) => fmtCategory(r?.major, r?.minor)).filter(Boolean);
        view.category = extraLabels.length
            ? `${view.primaryCategory} ＋ ${extraLabels.join(" ＋ ")}`
            : view.primaryCategory;

        return view;
    }



    // ─── レンダリング後のイベント結線 ───────────────────────────────────────

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);

        // エキストラアクター参照(11-6): 小分類「エキストラ」のドロップ受け(編集モードのみ)
        if (context.isExtraOutfit && context.editable) {
            const zone = this.element.querySelector(".extra-actor-dropzone");
            if (zone) {
                zone.addEventListener("dragover", (ev) => ev.preventDefault());
                zone.addEventListener("drop", (ev) => this._onExtraActorDrop(ev));
            }
        }

        // 閲覧モードでは部位エディタを読み取り専用にする(入力・スピナーを無効化。
        // 追加/削除ボタンは CSS で非表示)。設定タブは閲覧でも見えるため明示的に無効化する。
        if (!context.isEditMode) {
            for (const el of this.element.querySelectorAll(
                ".tnx-part-fieldset input, .tnx-part-fieldset select, .tnx-part-fieldset .tnx-btn"
            )) {
                el.disabled = true;
            }
        }

        // コンバイン元ボタン: editable に関わらず閲覧コンテキストメニューを設置する
        if (context.isCombiner) this._setupCombineSourceMenu();

        // 住宅エリアリンクボタン: editable に関わらず閲覧コンテキストメニューを設置する
        if (context.isResidence) this._setupHousingAreaMenu();

        // 派生データ参照ボタン: editable に関わらず閲覧コンテキストメニューを設置する
        if (this.element.querySelector('[data-context-menu="derived-ref"]')) this._setupDerivedMenu();

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
            // 住宅施設・住宅オプション・住宅アクセサリは携帯しない=携帯トグルを出さない(2026-07-09)
            const noCarrying = this.item.type === "residence"
                || this.item.system.minorCategory === "housingOption"
                || this.item.system.minorCategory === "housingAccessory";
            // サービス大分類は故障/破壊しない(免疫)。サービス/バックグラウンドは必ず準備・携帯される
            // (未準備にできない)=携帯/準備トグルを出さない(2026-07-18 ユーザー確定)。
            const isServiceImmune = this.item.system.majorCategory === "service";
            const isBackground = this.item.system.minorCategory === "background";
            const toggles = [
                { flag: "isPre-play",    icon: "fa-cart-shopping",       title: "プレアクト購入" },
                { flag: "isCarrying",    icon: "fa-suitcase",            title: "携帯中" },
                { flag: "isPrepared",    icon: "fa-shield-halved",       title: "準備済み" },
                { flag: "isMalfunction", icon: "fa-triangle-exclamation", title: "故障" },
                { flag: "isDestroyed",   icon: "fa-burst",               title: "破壊" },
            // 部位「-」は準備できない=準備トグルを出さない(準備不要で常時適用・2026-07-09)
            ].filter(t => !(t.flag === "isCarrying" && noCarrying))
             .filter(t => !(t.flag === "isPrepared" && this.item.system.isPartless === true))
             .filter(t => !((t.flag === "isCarrying" || t.flag === "isPrepared") && isBackground))
             .filter(t => !((t.flag === "isMalfunction" || t.flag === "isDestroyed") && isServiceImmune));
            for (const t of toggles) {
                const a = document.createElement("a");
                const isDisabled = t.flag === "isPre-play"
                    && !canTogglePreplayPurchase(this.item.system);
                const cls = ["outfit-flag-toggle"];
                if (this.item.system[t.flag] === true) cls.push("active");
                if (isDisabled) cls.push("disabled");
                a.className = cls.join(" ");
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

        // 購/隠/電制/常備化経験点/受け値/制御値修正/サイクル/CS修正/SF/乗員/防御力のモード変更時、
        // 数値以外なら value をリセットする
        for (const key of ["buy", "hide", "hack",
                            "preserveExp", "guardValue", "controlMod",
                            "cycle", "combatSpeedMod", "speedFactor", "passenger"]) {
            this.element.querySelector(`select[name="system.${key}.mode"]`)
                ?.addEventListener("change", (event) => {
                    event.stopPropagation();
                    const mode = event.currentTarget.value;
                    const update = { [`system.${key}.mode`]: mode };
                    if (mode !== "value") update[`system.${key}.value`] = 0;
                    this.item.update(update);
                });
        }

        // 防御力モード変更時、"none" なら S/P/I をリセットする
        this.element.querySelector('select[name="system.defence.mode"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const mode = event.currentTarget.value;
                const update = { "system.defence.mode": mode };
                if (mode !== "value") {
                    update["system.defence.S_defence"] = 0;
                    update["system.defence.P_defence"] = 0;
                    update["system.defence.I_defence"] = 0;
                }
                this.item.update(update);
            });

        // スロットの mode 変更(kind ベース)
        for (const select of this.element.querySelectorAll(".slot-mode-select")) {
            select.addEventListener("change", (event) => {
                event.stopPropagation();
                const kind = event.currentTarget.dataset.kind;
                const mode = event.currentTarget.value;
                this._updateSlotCount(kind, (count) => ({
                    ...count, mode, value: mode === "none" ? 0 : (count.value ?? 0),
                }));
            });
        }

        // 使用回数: チェック解除時に回数・種別をリセットする(スタイル技能と同挙動)
        this.element.querySelector('input[name="system.uses.isLimit"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const isChecked = event.currentTarget.checked;
                const update = { "system.uses.isLimit": isChecked };
                if (!isChecked) {
                    update["system.uses.spent"] = 0;
                    update["system.uses.max"]   = "";  // StringField(式可・2026-08-09)
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
                this._updateSlotCount(kind, (count) => ({ ...count, value }));
            });
        }


        // 部位行の入力(配列フィールドのため全体更新で保存する。種別連動で欄が変わるため、
        // 保存後の再描画は item.update のドキュメント更新フックに委ねる)
        for (const el of this.element.querySelectorAll("[data-part-field]")) {
            el.addEventListener("change", (event) => {
                event.stopPropagation();
                const t = event.currentTarget;
                const index = Number(t.dataset.index);
                const field = t.dataset.partField;
                // 身体部位プリセット(直下・辞典): 「その他」は自由入力欄を表示、それ以外(プリセット/—)は value へ反映
                if (field === "bodyPreset") {
                    const textInput = t.parentElement?.querySelector('input[data-part-field="value"]');
                    if (t.value === "__other__") {
                        if (textInput) { textInput.hidden = false; textInput.focus(); }
                        return; // 保存は自由入力欄の change に任せる
                    }
                    if (textInput) textInput.hidden = true;
                    this._updatePartRow(index, (row) => { row.value = t.value; }); // プリセット or "" (—でクリア)
                    return;
                }
                let value;
                if (t.type === "checkbox") value = t.checked;
                else if (field === "slots") value = Math.max(0, Number(t.value) || 0);
                else value = t.value;
                this._updatePartRow(index, (row) => {
                    if (field === "kind") {
                        // 種別変更時は他フィールドを既定にリセットする(裏に前の種別の値が残らないように・2026-07-09 修正)
                        Object.assign(row, this.constructor.blankPartRow, { kind: value });
                    } else {
                        row[field] = value;
                        if (field === "hostMajor") row.hostMinor = ""; // 大分類変更で小分類をリセット
                        // ホスト記述子が変わればアイテム名(hostKey)の辞典絞りが変わる=選択をリセット
                        if (["hostMajor", "hostMinor", "hostMinorExclude", "hostFeature"].includes(field)) row.hostKey = "";
                    }
                });
            });
        }

        // 部位全体の結合(and/or)・任意(partOptional)は name= の名前付きフィールドなので
        // フォームの submitOnChange で自動保存される(カスタムハンドラ不要)。

        // 部位行の追加・削除
        for (const btn of this.element.querySelectorAll(".tnx-part-add")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onAddPartRow();
            });
        }
        for (const btn of this.element.querySelectorAll(".tnx-part-del")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onDeletePartRow(Number(event.currentTarget.dataset.index));
            });
        }

        // 専用(辞典参照配列): 行プルダウンの変更・追加・削除を全体更新で保存する
        for (const sel of this.element.querySelectorAll("select[data-exclusive-index]")) {
            sel.addEventListener("change", (event) => {
                event.stopPropagation();
                const index = Number(event.currentTarget.dataset.exclusiveIndex);
                const token = event.currentTarget.value; // "style:key" / "organization:key" / ""
                const sep = token.indexOf(":");
                const entry = sep < 0 ? { type: "", key: "" }
                    : { type: token.slice(0, sep), key: token.slice(sep + 1) };
                this._updateExclusive((arr) => { arr[index] = entry; });
            });
        }
        this.element.querySelector("[data-exclusive-add]")?.addEventListener("click", (event) => {
            event.preventDefault();
            this._updateExclusive((arr) => arr.push({ type: "", key: "" }));
        });
        for (const btn of this.element.querySelectorAll("[data-exclusive-del]")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                const index = Number(event.currentTarget.dataset.index);
                this._updateExclusive((arr) => { if (index >= 0 && index < arr.length) arr.splice(index, 1); });
            });
        }

        // 副分類(フェーズ16-1): チェックボックス展開・行の変更・追加・削除(配列フィールド=全体更新)。
        // チェック ON=空行を1つ作って展開・OFF=全消去(チェック状態は副分類の有無から導出=状態レス)
        this.element.querySelector("[data-additional-category-toggle]")?.addEventListener("change", (event) => {
            event.stopPropagation();
            const rows = event.currentTarget.checked ? [{ major: "", minor: "" }] : [];
            this.item.update({ "system.additionalCategories": rows });
        });
        for (const el of this.element.querySelectorAll("[data-additional-category-field]")) {
            el.addEventListener("change", (event) => {
                event.stopPropagation();
                const index = Number(event.currentTarget.dataset.index);
                const field = event.currentTarget.dataset.additionalCategoryField;
                const value = event.currentTarget.value;
                this._updateAdditionalCategories((arr) => {
                    if (!arr[index]) arr[index] = { major: "", minor: "" };
                    arr[index][field] = value;
                    if (field === "major") arr[index].minor = ""; // 大分類変更で小分類をリセット(主分類と同じ挙動)
                });
            });
        }
        this.element.querySelector("[data-additional-category-add]")?.addEventListener("click", (event) => {
            event.preventDefault();
            this._updateAdditionalCategories((arr) => { arr.push({ major: "", minor: "" }); });
        });
        for (const btn of this.element.querySelectorAll("[data-additional-category-del]")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                const index = Number(event.currentTarget.dataset.index);
                this._updateAdditionalCategories((arr) => { if (index >= 0 && index < arr.length) arr.splice(index, 1); });
            });
        }

        // 装備対象変更時: スロット種別をリセット(親が変わればスロット構成も変わる)。
        // スロットなしホストは便宜スロット「アイテム名」しか無いので既定で選んでおく(2026-07-23)。
        this.element.querySelector('select[name="system.parentItemId"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const hostId = event.currentTarget.value;
                const host = hostId ? this.item.parent?.items?.get(hostId) : null;
                const hostSlots = Array.isArray(host?.system?.slots) ? host.system.slots : [];
                const hasRealSlots = hostSlots.some((s) => s?.count?.mode === "value" && Number(s.count.total ?? s.count.value) > 0);
                this.item.update({
                    "system.parentItemId":   hostId,
                    "system.parentSlotKind": (hostId && !hasRealSlots) ? OUTFIT_NAME_SLOT_KIND : "",
                });
            });

        // 住宅施設: ドロップモードチェックボックスの切り替え(オフ時はリンクをクリア)
        this.element.querySelector('input[name="system.useHousingAreaDrop"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                const isChecked = event.currentTarget.checked;
                const update = { "system.useHousingAreaDrop": isChecked };
                if (!isChecked) update["system.housingArea"] = "";
                this.item.update(update);
            });

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

            // 両方のソースが同一アクター内の埋め込みアイテムになった場合、自動活性化する
            if (!this.item.system.isCombineActive
                    && this.item.parent?.documentName === "Actor") {
                const actor = this.item.parent;
                const s1 = actor.items.find(i => i.uuid === this.item.system.combine.source1);
                const s2 = actor.items.find(i => i.uuid === this.item.system.combine.source2);
                if (s1 && s2) {
                    await actor.updateEmbeddedDocuments("Item", [
                        { _id: this.item.id, "system.isCombineActive": true },
                        { _id: s1.id, "system.combineGroupId": this.item.id },
                        { _id: s2.id, "system.combineGroupId": this.item.id },
                    ]);
                }
            }
        }

        // 派生元アウトフィット: 派生データ参照(複数可)を追加。重複は無視
        if (area === "derived-data") {
            const cur = [...(this.item.system.derivedDataRefs ?? [])];
            if (cur.some((r) => r.uuid === dropped.uuid)) return;
            cur.push({ uuid: dropped.uuid, name: dropped.name });
            await this.item.update({ "system.derivedDataRefs": cur });
        }
    }

    // ─── 派生データ参照(10-2) ───────────────────────────────────────────────
    /** derivedDataRefs を表示用に解決(名前ライブ解決・削除済みフォールバック)。 */
    static async _resolveDerivedRefs(refs) {
        const out = [];
        for (const r of (Array.isArray(refs) ? refs : [])) {
            const doc = r?.uuid ? await fromUuid(r.uuid).catch(() => null) : null;
            out.push({ uuid: r?.uuid ?? "", name: doc?.name ?? r?.name ?? "(不明)", img: doc?.img ?? null, missing: !doc });
        }
        return out;
    }
    /** data-index から派生データ参照を解決する。 */
    _derivedRefAt(el) {
        const index = Number(el?.dataset.index);
        const list = this.item.system.derivedDataRefs ?? [];
        return { index, list, ref: (index >= 0 && index < list.length) ? list[index] : null };
    }
    async _openDerivedRef(el, { edit = false } = {}) {
        const { ref } = this._derivedRefAt(el);
        const doc = ref?.uuid ? await fromUuid(ref.uuid).catch(() => null) : null;
        if (doc) doc.sheet.render(true, edit ? {} : { editable: false });
    }
    async _removeDerivedRef(el) {
        const { index, list } = this._derivedRefAt(el);
        if (index < 0 || index >= list.length) return;
        const cur = [...list];
        cur.splice(index, 1);
        await this.item.update({ "system.derivedDataRefs": cur });
    }
    static async _onViewDerivedRef(_event, target) { await this._openDerivedRef(target); }
    /** 派生データ参照ボタンの右クリックメニュー(閲覧/編集/削除)。 */
    _setupDerivedMenu() {
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu="derived-ref"]', [
            { name: "閲覧", icon: '<i class="fas fa-eye"></i>', callback: (el) => this._openDerivedRef(el) },
            { name: "編集", icon: '<i class="fas fa-edit"></i>', callback: (el) => this._openDerivedRef(el, { edit: true }) },
            { name: "削除", icon: '<i class="fas fa-trash"></i>', condition: () => this.isEditable, callback: (el) => this._removeDerivedRef(el) },
        ], { jQuery: false, fixed: true });
    }

    // ─── 専用(スタイル/オーガニゼーション辞典参照・10-2) ──────────────────────
    /** 専用プルダウンの行データ(行ごとに2オプショングループ＋選択フラグ)を組み立てる。 */
    async _prepareExclusiveRows(system) {
        const [styleNames, orgNames] = await Promise.all([
            loadSkillChoices([STYLE_PACK]),
            loadSkillChoices([ORGANIZATION_PACK]),
        ]);
        const styleOpts = Object.entries(styleNames).filter(([k]) => k);
        const orgOpts   = Object.entries(orgNames).filter(([k]) => k);
        const stored = Array.isArray(system.exclusive) ? system.exclusive : [];
        const exclusive = stored.length ? stored : [{ type: "", key: "" }]; // 空でも1行表示(＋を出すため。timing と同方式)
        return exclusive.map((e, index) => ({
            index,
            groups: [
                { label: "スタイル", options: styleOpts.map(([k, name]) => ({ value: `style:${k}`, label: name, selected: e.type === "style" && e.key === k })) },
                { label: "オーガニゼーション", options: orgOpts.map(([k, name]) => ({ value: `organization:${k}`, label: name, selected: e.type === "organization" && e.key === k })) },
            ],
        }));
    }
    /** 専用配列を全体更新で保存する(配列フィールドのため。空でも1要素から始める)。 */
    _updateExclusive(mutator) {
        const stored = this.item.system.exclusive ?? [];
        const arr = foundry.utils.deepClone(stored.length ? stored : [{ type: "", key: "" }]);
        mutator(arr);
        return this.item.update({ "system.exclusive": arr });
    }

    /** 副分類(additionalCategories)の全体更新(フェーズ16-1)。配列フィールドのため丸ごと保存する。 */
    _updateAdditionalCategories(mutator) {
        const arr = foundry.utils.deepClone(this.item.system.additionalCategories ?? []);
        mutator(arr);
        return this.item.update({ "system.additionalCategories": arr });
    }

    /** 住宅エリアの紐づけを解除する */
    static async _onClearHousingArea(_event, _target) {
        await this.item.update({ "system.housingArea": "" });
    }

    /** 住宅エリアを閲覧モードで開く(左クリックアクション) */
    static async _onViewHousingArea(_event, _target) {
        const uuid = this.item.system.housingArea;
        if (!uuid) return;
        const item = await fromUuid(uuid).catch(() => null);
        if (item) item.sheet.render(true, { editable: false });
    }

    /**
     * 住宅エリアリンクボタンの右クリックコンテキストメニューを設置する。
     * editable に関わらず閲覧は可能。削除は condition で制御する。
     */
    _setupHousingAreaMenu() {
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu="housing-area"]', [
            {
                name: "閲覧",
                icon: '<i class="fas fa-eye"></i>',
                callback: async (_target) => {
                    const uuid = this.item.system.housingArea;
                    const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
                    if (item) item.sheet.render(true, { editable: false });
                },
            },
            {
                name: "編集",
                icon: '<i class="fas fa-edit"></i>',
                callback: async (_target) => {
                    const uuid = this.item.system.housingArea;
                    const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
                    if (item) item.sheet.render(true);
                },
            },
            {
                name: "削除",
                icon: '<i class="fas fa-unlink"></i>',
                condition: () => this.isEditable,
                callback: (_target) => {
                    this.item.update({ "system.housingArea": "" });
                },
            },
        ], { jQuery: false, fixed: true });
    }

    /** コンバイン元の紐づけを解除する。活性中の場合は完全解除する */
    static async _onClearCombineSource(_event, _target) {
        if (this.item.system.isCombineActive) {
            await TokyoNovaOutfitSheet._deactivateCombine(this.item);
        } else {
            const key = _target.dataset.source === "2" ? "source2" : "source1";
            await this.item.update({ [`system.combine.${key}`]: "" });
        }
    }

    /** コンバイン解除ボタン */
    static async _onDeactivateCombine(_event, _target) {
        await TokyoNovaOutfitSheet._deactivateCombine(this.item);
    }

    /**
     * コンバインを解除する共通処理。
     * isCombineActive を false にし、source1/source2 をクリア、
     * 関連ソースアイテムの combineGroupId をクリアする。
     * @param {Item} combinerItem コンバイナーアイテム
     */
    static async _deactivateCombine(combinerItem) {
        const actor = combinerItem.parent;
        const s1Uuid = combinerItem.system.combine.source1;
        const s2Uuid = combinerItem.system.combine.source2;
        const updates = [{
            _id: combinerItem.id,
            "system.isCombineActive": false,
            "system.combine.source1": "",
            "system.combine.source2": "",
        }];
        if (actor?.documentName === "Actor") {
            for (const uuid of [s1Uuid, s2Uuid].filter(Boolean)) {
                const src = actor.items.find(i => i.uuid === uuid);
                if (src) updates.push({ _id: src.id, "system.combineGroupId": "" });
            }
            await actor.updateEmbeddedDocuments("Item", updates);
        } else {
            await combinerItem.update({
                "system.isCombineActive": false,
                "system.combine.source1": "",
                "system.combine.source2": "",
            });
        }
    }

    /** コンバイン元を閲覧モードで開く(左クリックアクション) */
    static async _onViewCombineSource(_event, target) {
        const uuid = target.dataset.source === "2"
            ? this.item.system.combine.source2
            : this.item.system.combine.source1;
        if (!uuid) return;
        const item = await fromUuid(uuid).catch(() => null);
        if (item) item.sheet.render(true, { editable: false });
    }

    /**
     * コンバイン元ボタンの右クリックコンテキストメニューを設置する。
     * editable に関わらず閲覧は可能。リンク解除は condition で制御する。
     */
    _setupCombineSourceMenu() {
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu="combine-source"]', [
            {
                name: "閲覧",
                icon: '<i class="fas fa-eye"></i>',
                callback: async (target) => {
                    const uuid = target.dataset.source === "2"
                        ? this.item.system.combine.source2
                        : this.item.system.combine.source1;
                    const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
                    if (item) item.sheet.render(true, { editable: false });
                },
            },
            {
                name: "編集",
                icon: '<i class="fas fa-edit"></i>',
                callback: async (target) => {
                    const uuid = target.dataset.source === "2"
                        ? this.item.system.combine.source2
                        : this.item.system.combine.source1;
                    const item = uuid ? await fromUuid(uuid).catch(() => null) : null;
                    if (item) item.sheet.render(true);
                },
            },
            {
                name: "リンク解除",
                icon: '<i class="fas fa-unlink"></i>',
                condition: () => this.isEditable,
                callback: (target) => {
                    const key = target.dataset.source === "2" ? "source2" : "source1";
                    this.item.update({ [`system.combine.${key}`]: "" });
                },
            },
        ], { jQuery: false, fixed: true });
    }

    // ─── ヘッダーの状態トグル(準備済み/携帯中/プリプレイ購入) ────────────────

    /**
     * D&D 5e の装備済みトグルを踏襲したヘッダーアイコン。閲覧モードでも操作できる
     * (プレイ中に切り替える運用状態のため)。
     */
    static async _onToggleFlag(_event, target) {
        const flag = target.dataset.flag;
        if (!flag) return;
        // 携帯中/準備済みはアクターシートと同じ不変条件を通す(2026-09-07 一本化)。従来ここは
        // 素で反転しており、アイテムシートのヘッダからだけ「携帯していないのに準備済み」を
        // 作れていた(防御力の合算は isPrepared を見るため実効値に乗っていた)。
        // 無所属アイテム(辞典の原本など)は装備先も配下も無いので従来どおり素で反転する
        // プレアクト購入は経験点保全が数値のときだけ。従来は CSS の pointer-events でしか
        // 止まっておらず、規則が意匠にしか無かった(2026-09-07)
        if (flag === "isPre-play" && !canTogglePreplayPurchase(this.item.system)) return;
        const actor = this.item.actor;
        if (actor && isEquipStateFlag(flag)) {
            await applyOutfitFlagToggle(this.item, flag, actor);
            return;                                  // 適用済み、または不変条件で断られた
        }
        const current = foundry.utils.getProperty(this.item.system, flag) === true;
        await this.item.update({ [`system.${flag}`]: !current });
    }

    /** 改造行の削除(16-4): 説明タブの「改造」セクションのゴミ箱から。 */
    static async _onDeleteModification(_event, target) {
        const index = Number(target.dataset.index);
        const rows = Array.isArray(this.item.system.modifications) ? this.item.system.modifications : [];
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
        await this.item.update({ "system.modifications": rows.filter((_, i) => i !== index) });
    }

    // ─── スロットプール操作 ─────────────────────────────────────────────────

    static async _onIncrementSlot(_event, target) {
        await this._updateSlotCount(target.dataset.kind, (count) => ({
            ...count, value: (count.value ?? 0) + 1,
        }));
    }

    static async _onDecrementSlot(_event, target) {
        await this._updateSlotCount(target.dataset.kind, (count) => ({
            ...count, value: Math.max(0, (count.value ?? 0) - 1),
        }));
    }

    /**
     * 指定 kind のプールの count({mode,value})を更新する(配列全体を送って保存する)。
     * @param {string} kind スロット種別
     * @param {(count: {mode:string,value:number}) => {mode:string,value:number}} mutate
     */
    async _updateSlotCount(kind, mutate) {
        const slots = this._normalizedSlots();
        const pool = slots.find((s) => s.kind === kind);
        if (!pool) return;
        pool.count = mutate(pool.count ?? { mode: "none", value: 0 });
        await this.item.update({ "system.slots": slots });
    }

    // ─── 部位エディタ(フェーズ10) ───────────────────────────────────────────

    /**
     * 部位エディタ用に行ごとの種別連動データと文脈連動の選択肢を組み立てる。
     * D&D 5e「消費」UI を参考: 身体部位はワールド直下ではプリセット、キャラ所属ではその部位から。
     * オプションの「アイテム名」は**アウトフィット辞典**から宣言記述子で絞った hostKey 候補
     * (2026-07-23。直下・辞典でも辞典参照＝自由記入を廃止)。
     * @param {Object} context テンプレートコンテキスト
     * @param {Object} system 正規化済み system(part は配列)
     */
    async _preparePartEditorData(context, system) {
        const isActorOwned = this.item.parent?.documentName === "Actor";
        context.partIsActorOwned = isActorOwned;
        context.partKindChoices    = PART_KINDS;
        context.partRefSubChoices  = PART_REFERENCE_SUB_KINDS;
        context.partRelationChoices = PART_RELATIONS;
        context.partRelation = system.partRelation ?? "and";
        context.partOptional = system.partOptional === true; // 任意は部位全体に効く
        context.partMultiRow = (system.part?.length ?? 0) >= 2;

        // 身体部位の選択肢: アクター所属=部位スロットのプルダウン / 直下・辞典=プリセットのプルダウン＋(その他選択時のみ)自由入力
        // アクター所属は実効部位(partSlotsEffective=AE 追加込み)から出す(フェーズ12)
        const partSlotsCtx = isActorOwned
            ? (this.item.parent.system?.partSlotsEffective ?? this.item.parent.system?.partSlots ?? [])
            : getPartSlotPreset();
        let bodyPresetSet = null;
        if (isActorOwned) {
            const choices = { "": "—" };
            for (const s of partSlotsCtx) {
                if (s?.value) choices[s.value] = s.value;
            }
            context.partBodyChoices = choices;
        } else {
            context.partBodyChoices = null; // null => プリセットのプルダウン＋(その他)自由入力
            const presets = [...new Set(partSlotsCtx.map((s) => s.value).filter(Boolean))];
            bodyPresetSet = new Set(presets);
            context.partBodyPresetChoices = { "": "—", ...Object.fromEntries(presets.map((v) => [v, v])), "__other__": "その他（自由入力）" };
        }

        // ホスト大分類・その他特徴の選択肢
        const majorChoices = { "": "—" };
        for (const [k, m] of Object.entries(OUTFIT_CATEGORIES)) majorChoices[k] = m.label;
        context.partHostMajorChoices = majorChoices;
        context.partHostFeatureChoices = { "": "—", ...PART_HOST_FEATURE_LABELS };

        // アイテム名(hostKey)の解決/フォールバック用: 全アウトフィット辞典の {識別キー: 名前}
        const outfitDictNames = await loadOutfitDictNames();

        context.partRows = await Promise.all((system.part ?? []).map(async (p, idx) => {
            // 解説参照は refSubKind を実効種別として欄を出し分ける(表示ラベルは常に「解説参照」)
            const effKind = p.kind === "reference" ? (p.refSubKind ?? "none") : p.kind;
            // 身体部位の表示ラベルは partKey の逆引きを優先(部位のリネームに追従・フェーズ12)
            const bodyLabel = effKind === "bodyPart"
                ? (partSlotsCtx.find((s) => s?.key && s.key === p.partKey)?.value || p.value)
                : p.value;
            p = (bodyLabel !== p.value) ? { ...p, value: bodyLabel } : p;

            const minorChoices = { "": "—" };
            const major = OUTFIT_CATEGORIES[p.hostMajor];
            if (major) for (const [mk, mv] of Object.entries(major.minors)) minorChoices[mk] = mv.label;

            // オプションのアイテム名(hostKey): アウトフィット辞典から、宣言記述子で絞った候補
            // (大分類/小分類/除外/特徴。直下・辞典・アクターいずれでも辞典参照)。
            let hostKeyChoices = null;
            if (effKind === "option") {
                hostKeyChoices = await loadOutfitHostChoices({
                    hostMajor: p.hostMajor, hostMinor: p.hostMinor,
                    hostMinorExclude: p.hostMinorExclude, hostFeature: p.hostFeature,
                });
                // 保存済み hostKey が絞りに含まれない場合でも表示を失わないよう現在名を補う
                if (p.hostKey && !hostKeyChoices[p.hostKey]) {
                    const name = resolveItemNameByKey(isActorOwned ? this.item.parent : null, p.hostKey, outfitDictNames);
                    if (name) hostKeyChoices[p.hostKey] = name;
                }
            }

            return {
                idx,
                kind: p.kind,
                value: p.value,
                slots: p.slots,
                hostMajor: p.hostMajor,
                hostMinor: p.hostMinor,
                hostMinorExclude: p.hostMinorExclude,
                hostFeature: p.hostFeature,
                hostKey: p.hostKey,
                refSubKind: p.refSubKind,
                isReference: p.kind === "reference",
                showBody:   effKind === "bodyPart",
                showOption: effKind === "option",
                showOther:  effKind === "other",
                // 直下・辞典の身体部位: 値がプリセット外なら「その他」(自由入力欄を表示)
                bodyIsOther: !!bodyPresetSet && effKind === "bodyPart" && !!p.value && !bodyPresetSet.has(p.value),
                bodyPresetSelected: !bodyPresetSet ? "" : (bodyPresetSet.has(p.value) ? p.value : (p.value ? "__other__" : "")),
                minorChoices,
                hostKeyChoices,
            };
        }));
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
     * 身体部位行はラベル(value)から部位キー(partKey)を解決して同期する(フェーズ12。
     * 参照はキーで持ち、占有照合・表示逆引きがリネームに耐える)。ラベル・種別が変わった
     * ときだけ解決し直す——他フィールドの編集でリネーム済みラベルからキーを消さないため。
     * @param {number} index 行番号
     * @param {(row: {value: string, slots: number}) => void} mutate 行を書き換える関数
     */
    async _updatePartRow(index, mutate) {
        const list = this._normalizedPart();
        if (!list[index]) return;
        const prev = { value: list[index].value, kind: list[index].kind, refSubKind: list[index].refSubKind };
        mutate(list[index]);
        const row = list[index];
        const identityChanged = row.value !== prev.value || row.kind !== prev.kind
            || row.refSubKind !== prev.refSubKind;
        if (identityChanged || !row.partKey) {
            const effKind = row.kind === "reference" ? row.refSubKind : row.kind;
            if (effKind === "bodyPart") {
                const slots = this.item.parent?.system?.partSlotsEffective
                    ?? this.item.parent?.system?.partSlots ?? getPartSlotPreset();
                row.partKey = findPartKeyByLabel(slots, row.value);
            } else {
                row.partKey = "";
            }
        }
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
