/**
 * @fileoverview 改造判定の項目レジストリ(16-4・Foundry 非依存)。
 * 正本: Purchase_and_Modification.md「改造可能な項目(分類別)」テーブル(2026-08-30 ユーザー提供)
 * と改造の重複規約(2026-08-31 verbatim)。
 *
 * - 分類→改造可能項目: 小分類の特則(IANUS/全身義体/タップ/住宅施設/ドラッグ等)が大分類の行に
 *   優越し、どの行にも該当しない分類は「その他」(隠・電制)。
 * - 複数分類は全分類の項目の和集合(「両方の分類として扱う」)。
 * - **1つのアウトフィットの1つの項目に適用できる改造は1回だけ**(技能を問わず。別々の項目へは
 *   同じ改造技能で重複可=同名効果重複不可の原則の一部)。
 * - ヴィークル分類の制御値修正は改造合算後に最大0でクランプ。
 * - 住宅施設の登場判定目標値は±(負値を許す)・セキュリティは電脳/アナログ一括。
 * - ドラッグは特殊(パラメータ修正でない=選択ドラッグの用途タイミングを一時的にマイナー
 *   アクションへ上書き・2026-08-31 ユーザー提案)。数値の着地なし=読者はタイミング解決側。
 */

/** 項目キー → 表示ラベル。キーは modifications.param の保存値の正本。 */
export const MODIFICATION_PARAMS = Object.freeze({
  hide:         { label: "隠匿値" },              // 危険値は除く=hide のみ
  attack:       { label: "攻撃力" },
  guard:        { label: "受け値" },
  hack:         { label: "電制" },
  defence:      { label: "防御力（S／P／I）" },    // 一括=3フィールドへ同値加算
  control:      { label: "制御値修正" },
  passenger:    { label: "乗員" },
  slotNormal:   { label: "スロット" },
  slotSoftware: { label: "スロット：ソフトウェア" },
  slotHardware: { label: "スロット：ハードウェア" },
  combatSpeed:  { label: "CS" },
  appearance:   { label: "登場判定目標値" },       // 住宅施設・±
  security:     { label: "セキュリティ（電脳／アナログ）" }, // 一括
  drugTiming:   { label: "マイナーアクション化" },  // ドラッグ特殊
});

/** 「その他」の行(どの分類行にも該当しない場合)。 */
const DEFAULT_ROW = Object.freeze(["hide", "hack"]);

/** 大分類キー → 改造可能項目(テーブルの行)。 */
const MAJOR_ROWS = Object.freeze({
  weapon:    ["hide", "attack", "guard", "hack"],
  armor:     ["hide", "defence", "control", "hack"],
  vehicle:   ["hide", "attack", "defence", "control", "passenger", "slotNormal", "hack"],
  cyberware: DEFAULT_ROW, // IANUS・全身義体以外
  tron:      DEFAULT_ROW, // タップ以外
  housing:   DEFAULT_ROW, // 住宅オプション・アクセサリ(施設は小分類特則)
});

/** 小分類キー → 特則の行(大分類の行に優越)。 */
const MINOR_ROWS = Object.freeze({
  ianus:      ["hide", "control", "hack"],
  fullCyborg: ["hide", "defence", "attack", "guard", "hack"],
  tap:        ["hide", "hack", "slotSoftware", "slotHardware", "combatSpeed"],
  residence:  ["appearance", "security"],
  drug:       ["drugTiming"],
});

/**
 * 分類集合(outfitClassifications の戻り値)から改造可能項目の和集合を返す。
 * @param {Array<{major: string, minor: string}>} classifications
 * @returns {string[]} 項目キー配列(出現順・重複なし)
 */
export function paramsForClassifications(classifications) {
  const out = [];
  for (const { major, minor } of classifications ?? []) {
    const row = MINOR_ROWS[minor] ?? MAJOR_ROWS[major] ?? DEFAULT_ROW;
    for (const k of row) if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : [...DEFAULT_ROW];
}

/** {mode, value} フィールドの可用性("ー"「解説参照」は改造不可の一般則)。 */
function mvAvailability(field) {
  if (field?.mode === "value") return "ok";
  if (field?.mode === "reference") return "reference";
  // 隠匿値の「制御値」は数値でないため ＋［レベル］の改造ができない(2026-09-07)
  if (field?.mode === "control") return "control";
  return "novalue";
}

/**
 * 対象アウトフィット上での項目の可用性。
 * @param {object} system 対象の system(正規化済み)
 * @param {string} key 項目キー
 * @returns {"ok"|"novalue"|"reference"|"control"}
 */
export function paramAvailability(system, key) {
  switch (key) {
    case "hide":        return mvAvailability(system.hide);
    case "guard":       return mvAvailability(system.guardValue);
    case "hack":        return mvAvailability(system.hack);
    case "control":     return mvAvailability(system.controlMod);
    case "passenger":   return mvAvailability(system.passenger);
    case "combatSpeed": return mvAvailability(system.combatSpeedMod);
    case "defence":     return mvAvailability(system.defence);
    case "attack": {
      // 攻撃力の「ー」=種別も値も無い状態(略号行の attackLabel と同じ読み)
      const a = system.attack;
      return (a && (a.damageType || a.value)) ? "ok" : "novalue";
    }
    case "slotNormal":
    case "slotSoftware":
    case "slotHardware": {
      const kind = { slotNormal: "normal", slotSoftware: "software", slotHardware: "hardware" }[key];
      const slot = (Array.isArray(system.slots) ? system.slots : []).find((s) => s?.kind === kind);
      return mvAvailability(slot?.count);
    }
    case "appearance":
    case "security":
      return "ok"; // 住宅施設の数値フィールド(「ー」表現を持たない)
    case "drugTiming":
      return "ok";
    default:
      return "novalue";
  }
}

/**
 * 項目選択 UI 用の選択肢リスト。改造済み(1項目1回)と「ー」「解説参照」を不能として返す。
 * @param {object} system 対象の system
 * @param {Array<{major: string, minor: string}>} classifications 対象の分類集合
 * @returns {Array<{key: string, label: string, availability: "ok"|"novalue"|"reference"|"control"|"modified"}>}
 */
export function listModificationChoices(system, classifications) {
  const modified = new Set((system.modifications ?? []).map((r) => r?.param));
  return paramsForClassifications(classifications).map((key) => ({
    key,
    label: MODIFICATION_PARAMS[key]?.label ?? key,
    availability: modified.has(key) ? "modified" : paramAvailability(system, key),
  }));
}

/** 項目が選べない理由の文言(グレーアウトのツールチップ)。 */
export function modificationUnavailableReason(availability) {
  switch (availability) {
    case "modified":  return "改造済みの項目です（1つの項目への改造は1回まで）";
    case "reference": return "「解説参照」の項目は改造できません";
    case "control":   return "「制御値」の項目は改造できません";
    case "novalue":   return "「ー」の項目は改造できません";
    default:          return "";
  }
}

/**
 * 改造記録(system.modifications)を実効値(total 系)へ合流させる。
 * computeItemEffectiveValues の直後(=base→total 化の後・アクター段 AE の前)に呼ぶ。
 * ヴィークル分類の制御値修正は改造合算後に最大0でクランプ(改造行があるときのみ=素値は壊さない)。
 * @param {object} system アイテムの system
 * @param {Array<{major: string, minor: string}>} classifications 分類集合
 */
export function applyModificationsToTotals(system, classifications) {
  const rows = Array.isArray(system.modifications) ? system.modifications : [];
  if (!rows.length) return;
  const addMv = (field, v) => {
    if (field?.mode === "value") field.total = (Number(field.total) || 0) + v;
  };
  for (const row of rows) {
    const v = Number(row?.value) || 0;
    switch (row?.param) {
      case "hide":        addMv(system.hide, v); break;
      case "guard":       addMv(system.guardValue, v); break;
      case "hack":        addMv(system.hack, v); break;
      case "control":     addMv(system.controlMod, v); break;
      case "passenger":   addMv(system.passenger, v); break;
      case "combatSpeed": addMv(system.combatSpeedMod, v); break;
      case "attack":
        if (system.attack && (system.attack.damageType || system.attack.value)) {
          system.attack.total = (Number(system.attack.total ?? system.attack.value) || 0) + v;
        }
        break;
      case "defence":
        if (system.defence?.mode === "value") {
          for (const k of ["S", "P", "I"]) {
            system.defence[`${k}_total`] = (Number(system.defence[`${k}_total`]) || 0) + v;
          }
        }
        break;
      case "slotNormal":
      case "slotSoftware":
      case "slotHardware": {
        const kind = { slotNormal: "normal", slotSoftware: "software", slotHardware: "hardware" }[row.param];
        const slot = (Array.isArray(system.slots) ? system.slots : []).find((s) => s?.kind === kind);
        addMv(slot?.count, v);
        break;
      }
      case "appearance":
        system.appearanceTargetTotal = (Number(system.appearanceTargetTotal ?? system.appearanceTarget) || 0) + v;
        break;
      case "security":
        system.cyberSecurityTotal = (Number(system.cyberSecurityTotal ?? system.cyberSecurity) || 0) + v;
        system.analogSecurityTotal = (Number(system.analogSecurityTotal ?? system.analogSecurity) || 0) + v;
        break;
      case "drugTiming":
        break; // 数値の着地なし(用途タイミングの上書き=読者はタイミング解決側)
      default:
        break;
    }
  }
  // ヴィークル分類の制御値修正の上限0(テーブルの「制御値修正(最大0)」)
  if (rows.some((r) => r?.param === "control")
      && (classifications ?? []).some((c) => c.major === "vehicle")
      && system.controlMod?.mode === "value") {
    system.controlMod.total = Math.min(0, Number(system.controlMod.total) || 0);
  }
}

/**
 * ドラッグ特殊(用途タイミングの一時上書き)が乗っているか。
 * タイミングの読者(戦闘タブ・記帳)が実効タイミングの解決に使う。
 * @param {object} system アイテムの system
 * @returns {boolean}
 */
export function hasDrugTimingOverride(system) {
  return (Array.isArray(system?.modifications) ? system.modifications : [])
    .some((r) => r?.param === "drugTiming");
}

/**
 * 用途の実効タイミング。ドラッグ改造(マイナーアクション化)が乗ったアイテムの用途は、
 * タイミングを一時的にマイナーアクションへ上書きする(2026-08-31 ユーザー提案)。
 * 読者=戦闘タブのタイミング分類・メジャーアクション記帳。設定欄(素の timing)は不変。
 * @param {{timing?: object}} usage 用途エントリ
 * @param {object} itemSystem 用途の親アイテムの system
 * @returns {?object} 実効タイミング
 */
export function effectiveUsageTiming(usage, itemSystem) {
  if (hasDrugTimingOverride(itemSystem)) {
    return { ...(usage?.timing ?? {}), value: "action", actionName: "minor" };
  }
  return usage?.timing ?? null;
}
