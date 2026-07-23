/**
 * @fileoverview 部位占有の純粋関数(フェーズ10。Foundry 非依存)。
 *
 * キャストの部位スロット集合(partSlots)と、準備済みアウトフィットの part から、
 * 各実スロットの占有(used / count / free / over)を算出する。表示・強調はシート側。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md「部位管理(フェーズ10)」。
 *
 * ルール:
 * - 占有するのは身体部位(kind=bodyPart。解説参照 reference の実部位 refSubKind=bodyPart を含む)。
 * - 非消費3型は母数から外す: slots=0 / 小分類=住宅アクセサリ / 任意(partOptional・部位全体)。
 * - relation=or の part は選択した1行(partOrChoice)だけ占有。and(既定)は全行。
 * - エイリアス(occupiesOther)は指定部位へ targetCount 倍で展開(両手持ち=片手持ち×2 等)。
 * - オプション(kind=option)はホスト側スロットの占有で別系統(本関数の対象外)。
 */

import {
  getMajorCategoryLabel, getMinorCategoryLabel, isMajorLevelSlotMajor, SLOT_KIND_MINOR_HOSTS,
} from "./outfit-categories.mjs";

/**
 * 便宜スロット「アイテム名」の種別キー。SLOT_KINDS.outfitName(extensible.mjs)と同値だが、
 * 本モジュールは Foundry 非依存を保つため文字列定数として持つ(import しない)。
 * スロットを持たないホストへ名前指定で装備するオプションが占有する仮想スロット(容量1)。
 * @type {"outfitName"}
 */
export const OUTFIT_NAME_SLOT_KIND = "outfitName";

/**
 * オプションの「その他特徴」キー → 表示ラベル。ホスト側の特徴で絞り込む(「武器(サイバーウェア)」等)。
 * isCyber は大分類サイバーウェア指定で拾う isCyber=true を絞り込みに使う(2026-06-27 ユーザー確定)。
 * 変異器官は 10-2 で新造。
 */
export const PART_HOST_FEATURE_LABELS = Object.freeze({
  isLaser:       "レーザー武器",
  isCyber:       "サイバーウェア",
  isMutantOrgan: "変異器官",
});

/**
 * ホスト候補がオプションの宣言したホスト記述子に一致するか(2026-07-23 統合)。
 * 装備先(parentItemId)候補の絞り込みと、アイテム名(hostKey)辞典プルダウンの絞り込みを**同一判定**で
 * 一本化する純関数(旧: 装備先=自身の大分類・アイテム名=記述子、という二本立ての絞りを統合)。
 *
 * - hostKey(識別キー)があれば、そのキーのホストだけが対象(種別絞りは選択時の UI 用で、実照合はキー一本)。
 * - 種別指定は 大分類→小分類(+除外)→その他特徴 の順に絞る。大分類 cyberware は isCyber でも一致
 *   (サイバーウェアは絞り込みに追加するしかない・PART_HOST_FEATURE_LABELS と同方針)。
 * - **自身の大分類では絞らない**ので、搭載兵器(武器)→ヴィークル のような大分類跨ぎが自然に通る。
 *
 * @param {{majorCategory?:string, minorCategory?:string, identificationKey?:string,
 *          isLaser?:boolean, isCyber?:boolean, isMutantOrgan?:boolean}} host ホスト候補の実効値
 *   (真偽フラグは呼び出し側で readFlag した実効値を渡す)
 * @param {{hostMajor?:string, hostMinor?:string, hostMinorExclude?:boolean,
 *          hostFeature?:string, hostKey?:string}} spec オプション部位行のホスト記述子
 * @returns {boolean}
 */
export function matchesHostDescriptor(host, spec) {
  if (!host || !spec) return false;
  const hostKey = String(spec.hostKey ?? "").trim();
  if (hostKey) return String(host.identificationKey ?? "").trim() === hostKey;
  if (spec.hostMajor) {
    const majorMatch = host.majorCategory === spec.hostMajor
      || (spec.hostMajor === "cyberware" && host.isCyber === true);
    if (!majorMatch) return false;
  }
  if (spec.hostMinor) {
    const minorMatch = host.minorCategory === spec.hostMinor;
    if (spec.hostMinorExclude ? minorMatch : !minorMatch) return false;
  }
  if (spec.hostFeature && host[spec.hostFeature] !== true) return false;
  return true;
}

/** 消費数の数字サフィックス(1 は無し、0/2/… は数字)。部位名の直後・絞り括弧の前に付く。 */
function slotNumSuffix(slots) {
  const n = Number(slots);
  return n === 1 ? "" : String(Number.isFinite(n) ? n : 0);
}

/**
 * オプション行の部位名(スロット名)を組み立てる。
 * - アイテム名あり(`row.hostName`=**解決済み表示名**) → その名前(名前指定のホスト)。
 *   保存されるのは `hostKey`(識別キー)で、resolvePartRowsForDisplay が現在名を `hostName` へ注入する。
 * - 大分類レベル(武器のみ・isMajorLevelSlotMajor) → 大分類名「武器」。小分類/特徴は絞りとして
 *   括弧併記「武器(白兵武器)」、除外は「武器(搭載兵器以外)」。
 * - 小分類レベル(大半) → 小分類名「タップ」「IANUS」「船舶」。除外は「○○以外」。特徴は括弧。
 * - 消費数の数字は名前直後・括弧の前(「武器0(白兵武器)」)。
 * @param {Object} row part 行(kind=option)。`hostName` は解決済み表示名(未解決なら種別ラベル)
 * @returns {string}
 */
export function formatOptionLabel(row) {
  const num = slotNumSuffix(row?.slots);

  // 特殊弾は大例外(2026-06-27 ユーザー確定): 大分類「武器」に畳まず「特殊弾」。
  // 装着先の武器名(ホスト名)があれば「特殊弾(スリング)」=「種別(ホスト名)」形式。
  // (一般のアイテム名オプションは名前だけ=下行。特殊弾だけ種別を前置する)
  if (row?.hostMinor === "specialAmmo") {
    return `特殊弾${num}${row?.hostName ? `(${row.hostName})` : ""}`;
  }

  if (row?.hostName) return `${row.hostName}${num}`;

  const majorLabel   = getMajorCategoryLabel(row?.hostMajor) || "";
  const minorLabel   = row?.hostMinor ? (getMinorCategoryLabel(row.hostMinor) || "") : "";
  const featureLabel = row?.hostFeature ? (PART_HOST_FEATURE_LABELS[row.hostFeature] || "") : "";
  const excl = row?.hostMinorExclude ? "以外" : "";

  if (isMajorLevelSlotMajor(row?.hostMajor)) {
    // 大分類名がスロット名。小分類・特徴は括弧で絞る。
    const narrow = [];
    if (minorLabel)   narrow.push(`${minorLabel}${excl}`);
    if (featureLabel) narrow.push(featureLabel);
    return `${majorLabel}${num}${narrow.length ? `(${narrow.join("・")})` : ""}`;
  }
  // 小分類名がスロット名(なければ大分類名)。特徴は括弧。
  // タップのソフト/ハードは実体がタップのスロットのため、ルール上の部位表示は「タップ」だけ
  // (種別の区別「タップ/ソフトウェア」は占有リストで見分けるための便宜表記であり、
  //  正本の部位表示=ここには出さない)。
  const slotHost = SLOT_KIND_MINOR_HOSTS[row?.hostMinor];
  const effMinorLabel = slotHost || minorLabel;
  const base = effMinorLabel ? `${effMinorLabel}${excl}` : majorLabel;
  return `${base}${num}${featureLabel ? `(${featureLabel})` : ""}`;
}

/**
 * part 1 行の表示ラベル。解説参照は常に「解説参照」、none は空。
 * 身体部位は**数字を付けない**(2占有は専用部位名=両手持ち 等があるため。数字は占有計算と
 * オプション=武器0 専用)。
 */
function rowDesignation(row) {
  switch (row?.kind) {
    case "bodyPart":  return row.value || "";
    case "option":    return formatOptionLabel(row);
    case "reference": return "解説参照";
    case "other":     return row.value || "";
    default:          return ""; // none
  }
}

/**
 * part 全体の部位名表記を組み立てる(ルルブ表記に一致)。
 * - partOptional(部位全体の任意) → 「任意(A、B…)」(連結は「、」)。その他行を含めば末尾「など」。素は「任意」
 * - and → 「A+B」 / or → 身体部位「A、もしくはB」・スロット持ちホスト「A／B」
 * - その他行を含む → 末尾「など」
 * - additions(フェーズ12・AE 追加行): and 追加=「(既存)+C」・or 追加=「(既存)、もしくはC」。
 *   ラベルの解決(部位キー→現在ラベル)は呼び出し側で済ませて渡す。
 * @param {Array} part part 行配列
 * @param {string} [partRelation] "and" | "or"
 * @param {boolean} [partOptional] 部位全体が任意か(行ごとではなく part 全体に効く)
 * @param {{and?: Array<{label:string}>, or?: Array<{label:string}>}} [additions] AE 追加行(表示ラベル解決済み)
 * @returns {string}
 */
export function formatPartDesignation(part, partRelation = "and", partOptional = false, additions = null) {
  const rows = (Array.isArray(part) ? part : []).filter((r) => r && r.kind !== "none");
  const labels = rows.map(rowDesignation).filter((l) => l !== "");
  const hasOther = rows.some((r) => r.kind === "other");
  const andLabels = (additions?.and ?? []).map((r) => String(r?.label ?? "").trim()).filter(Boolean);
  const orLabels  = (additions?.or ?? []).map((r) => String(r?.label ?? "").trim()).filter(Boolean);

  /** AE 追加行を base 表記へ併記する(and=「+C」・or=「、もしくはC」)。 */
  const withAdditions = (base) => {
    let out = base;
    if (andLabels.length) {
      out = (out && out !== "-") ? `${out}+${andLabels.join("+")}` : andLabels.join("+");
    }
    if (orLabels.length) {
      const alts = orLabels.join("、もしくは");
      out = (out && out !== "-") ? `${out}、もしくは${alts}` : alts;
    }
    return out || "-";
  };

  if (partOptional) {
    // 任意は部位全体に効く: 「任意(A、B…)」。その他を含めば「など」を内側末尾へ。素の任意は「任意」
    // 任意の部位は占有しない=AE 追加行も併記しない(占有計算と対応)
    if (!labels.length) return "任意";
    return `任意(${labels.join("、")}${hasOther ? "など" : ""})`;
  }
  if (!rows.length) return withAdditions("-");
  if (!labels.length) return withAdditions(hasOther ? "など" : "-");

  let joined;
  if (rows.length >= 2 && partRelation === "or") {
    joined = labels.join(rows.every((r) => r.kind === "option") ? "／" : "、もしくは");
  } else if (rows.length >= 2 && partRelation === "and") {
    joined = labels.join("+");
  } else {
    joined = labels.join("、");
  }
  return withAdditions(hasOther ? `${joined}など` : joined);
}

/**
 * 複数アウトフィットの部位表記を併記する(コンバイナ=両方の部位を占有)。
 * ルールブックの表記法則「部位：部位1+部位2」に従い「+」で連結(2026-07-02 修正・旧「、」)。
 * "-" は除外。partAdditions(AE 追加行・表示解決済み)を持つ system はそれも併記する(フェーズ12)。
 * @param {Array<{part?:Array, partRelation?:string, partOptional?:boolean,
 *                partAdditions?:{and?:Array,or?:Array}}>} systems 各 system
 * @returns {string}
 */
export function joinPartDesignations(systems) {
  const designations = (systems ?? [])
    .map((s) => formatPartDesignation(s?.part, s?.partRelation, s?.partOptional, s?.partAdditions))
    .filter((d) => d && d !== "-");
  return designations.length ? designations.join("+") : "-";
}

/** 部位スロット集合からキー→現在ラベルを引く(完全一致・先勝ち。未解決は "")。 */
export function findPartLabelByKey(slots, key) {
  const k = String(key ?? "").trim();
  if (!k) return "";
  const row = (Array.isArray(slots) ? slots : []).find((s) => String(s?.key ?? "").trim() === k);
  return row ? String(row.value ?? "").trim() : "";
}

/** 部位スロット集合からラベル→キーを引く(完全一致・先勝ち。未解決は "")。 */
export function findPartKeyByLabel(slots, label) {
  const l = String(label ?? "").trim();
  if (!l) return "";
  const row = (Array.isArray(slots) ? slots : []).find((s) => String(s?.value ?? "").trim() === l);
  return row ? String(row.key ?? "").trim() : "";
}

/**
 * 表示用に part 行のラベルを現在名へ解決した複製を返す(フェーズ12 / 2026-07-23 拡張)。
 * 「保存する参照はキー・表示は逆引きした現在名」の原則——リネームに表示が追従する。
 * - 身体部位: `partKey` から現在ラベルへ差し替え(未解決は保存ラベルへフォールバック)。
 * - オプション: `hostKey`(識別キー)を `resolveHostName` で現在名へ解決し、行に `hostName`(表示用)を
 *   注入する。formatOptionLabel はこの `hostName` を読む(「特殊弾(スリング)」「アサルトナーヴス0」等)。
 *   未解決/未指定は注入せず種別ラベルになる。保持名キャッシュは持たない(常に live 解決)。
 * @param {Array} rows part 行配列
 * @param {Array} slots 部位スロット集合(アクター=partSlotsEffective / 直下・辞典=プリセット)
 * @param {?(hostKey:string)=>string} [resolveHostName] hostKey→現在名(識別キー逆引き)。省略時はオプション名解決なし
 * @returns {Array}
 */
export function resolvePartRowsForDisplay(rows, slots, resolveHostName = null) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const effKind = r?.kind === "reference" ? r?.refSubKind : r?.kind;
    if (effKind === "bodyPart") {
      const label = findPartLabelByKey(slots, r?.partKey);
      return label && label !== r.value ? { ...r, value: label } : r;
    }
    if (effKind === "option" && typeof resolveHostName === "function" && r?.hostKey) {
      const name = resolveHostName(r.hostKey);
      if (name) return { ...r, hostName: name };
    }
    return r;
  });
}

/**
 * AE 追加部位行(partAdded)を表示用 {and:[{label}], or:[{label}]} へ解決する(フェーズ12)。
 * ラベルは部位キーから逆引き(未解決はキーをそのまま表示)。追加行が無ければ null。
 * @param {Array<PartAddedRow>} partAdded
 * @param {Array} slots 部位スロット集合
 * @returns {?{and:Array<{label:string}>, or:Array<{label:string}>}}
 */
export function resolvePartAdditions(partAdded, slots) {
  const rows = Array.isArray(partAdded) ? partAdded : [];
  if (!rows.length) return null;
  const resolve = (r) => ({ label: findPartLabelByKey(slots, r?.key) || String(r?.key ?? "").trim() });
  return {
    and: rows.filter((r) => r?.relation === "and").map(resolve),
    or:  rows.filter((r) => r?.relation === "or").map(resolve),
  };
}

/**
 * @typedef {Object} PartSlotDef キャストの部位スロット定義(cast.system.partSlots の1要素)
 * @property {string} [key] 部位キー(フェーズ12。AE・part 行・エイリアスからの安定参照)
 * @property {string} value 部位ラベル
 * @property {number} count 実スロット数(occupiesOther 時は無視)
 * @property {boolean} [occupiesOther] 「指定部位を複数占有」エイリアス
 * @property {string} [targetPart] 占有先の部位ラベル(エイリアス時・後方互換)
 * @property {string} [targetKey] 占有先の部位キー(エイリアス時。ラベルより優先)
 * @property {number} [targetCount] 占有先を消費する数(エイリアス時)
 *
 * @typedef {Object} PartAddedRow AE による追加部位行(item.system.partAdded の1要素)
 * @property {string} key 部位キー
 * @property {"and"|"or"} relation 既存部位との関係(and=追加占有 / or=択一候補)
 * @property {number} slots 消費数
 * @property {string} [source] 供給元の効果名(表示用)
 *
 * @typedef {Object} OutfitOccupant 占有計算に渡すアウトフィットの最小データ
 * @property {boolean} isPrepared 準備済みか
 * @property {string} [minorCategory] 小分類キー
 * @property {Array} part part 行配列
 * @property {string} [partRelation] "and" | "or"
 * @property {number} [partOrChoice] or 時に占有する行 index
 * @property {PartAddedRow[]} [partAdded] AE による追加部位行(フェーズ12)
 * @property {string} [partAltChoice] or 追加行を選んだときの部位キー(空=base を占有)
 */

/**
 * 部位占有を算出する。
 * 照合はキー優先・ラベル後方互換(フェーズ12): スロットの同一性トークンは key(無ければラベル)。
 * アイテム part 行は partKey で引き、無ければラベルで引く(辞典・既存データはラベルのみ)。
 * AE 追加行(partAdded): and=常に追加占有 / or=partAltChoice で選ばれたとき base 行の代わりに占有。
 * @param {PartSlotDef[]} partSlots キャストの部位スロット集合(実効値=partSlotsEffective を渡す)
 * @param {OutfitOccupant[]} outfits 占有計算対象のアウトフィット群(全件渡してよい。準備済みのみ数える)
 * @returns {{slots: Array<{key:string,label:string,count:number,used:number,free:number,over:boolean}>,
 *           unlisted: Array<{label:string,used:number}>}}
 *   slots: プリセット掲載スロットごとの占有。unlisted: リスト外ラベル/キーへの消費(非カウント枠)。
 */
export function computePartOccupancy(partSlots = [], outfits = []) {
  const realOrder = [];          // 同一性トークン(key||label)の登場順を保持
  const realCount = new Map();   // token -> count
  const labels    = new Map();   // token -> 表示ラベル
  const keys      = new Map();   // token -> 部位キー(無キー行は "")
  const keyIndex  = new Map();   // key -> token
  const labelIndex = new Map();  // label -> token
  const aliases   = new Map();   // token -> { targetPart, targetKey, targetCount }

  for (const s of (partSlots ?? [])) {
    const label = String(s?.value ?? "").trim();
    const key   = String(s?.key ?? "").trim();
    if (!label && !key) continue;
    const token = key || label;
    if (s.occupiesOther) {
      if (!aliases.has(token)) {
        aliases.set(token, {
          targetPart:  String(s.targetPart ?? "").trim(),
          targetKey:   String(s.targetKey ?? "").trim(),
          targetCount: Math.max(0, Number(s.targetCount) || 0),
        });
        if (key && !keyIndex.has(key)) keyIndex.set(key, token);
        if (label && !labelIndex.has(label)) labelIndex.set(label, token);
      }
    } else if (!realCount.has(token)) {
      realCount.set(token, Math.max(0, Number(s.count) || 0));
      labels.set(token, label || key);
      keys.set(token, key);
      realOrder.push(token);
      if (key && !keyIndex.has(key)) keyIndex.set(key, token);
      if (label && !labelIndex.has(label)) labelIndex.set(label, token);
    }
  }

  /** 消費参照(キー/ラベル)をスロットの同一性トークンへ解決する。未掲載は参照値そのまま。 */
  const resolveToken = (key, label) => {
    if (key && keyIndex.has(key)) return keyIndex.get(key);
    if (label && labelIndex.has(label)) return labelIndex.get(label);
    return label || key;
  };

  const used = new Map();
  /** トークンへ amount 消費。エイリアスは指定部位へ targetCount 倍で再帰展開(循環ガード付き)。 */
  const addConsume = (token, amount, depth = 0) => {
    if (!token || amount <= 0 || depth > 16) return;
    const alias = aliases.get(token);
    if (alias) {
      const target = resolveToken(alias.targetKey, alias.targetPart);
      if (target && target !== token) addConsume(target, amount * alias.targetCount, depth + 1);
      return;
    }
    used.set(token, (used.get(token) ?? 0) + amount);
  };

  for (const outfit of (outfits ?? [])) {
    if (!outfit?.isPrepared) continue;
    if (outfit.minorCategory === "housingAccessory") continue; // 非消費: 住宅アクセサリ
    if (outfit.partOptional) continue;                         // 非消費: 任意(部位全体)
    const rows = Array.isArray(outfit.part) ? outfit.part : [];
    const added = Array.isArray(outfit.partAdded) ? outfit.partAdded : [];
    const addedAnd = added.filter((r) => r?.relation === "and");
    const addedOr  = added.filter((r) => r?.relation === "or");
    const alt = String(outfit.partAltChoice ?? "").trim();
    // or 追加行を装備先に選んでいる(かつその行がまだ生きている)ときは base の代わりに占有
    const chosenOr = alt ? addedOr.find((r) => String(r?.key ?? "").trim() === alt) : null;

    const consumeRow = (row) => {
      if (!row) return;
      const effKind = row.kind === "reference" ? row.refSubKind : row.kind;
      if (effKind !== "bodyPart") return;       // 身体部位のみ(オプション等は対象外)
      const slots = Math.max(0, Number(row.slots) || 0);
      const label = String(row.value ?? "").trim();
      const key   = String(row.partKey ?? "").trim();
      if (slots === 0 || (!label && !key)) return; // 非消費: slots=0
      addConsume(resolveToken(key, label), slots);
    };

    const consumeAdded = (row) => {
      const slots = Math.max(0, Number(row?.slots) || 0);
      const key = String(row?.key ?? "").trim();
      if (!slots || !key) return;
      addConsume(resolveToken(key, ""), slots);
    };

    if (chosenOr) {
      consumeAdded(chosenOr);
    } else if (outfit.partRelation === "or" && rows.length >= 2) {
      // 択一: 装備先トグルで選んだ1行だけ占有
      const idx = Math.max(0, Math.min(rows.length - 1, Number(outfit.partOrChoice) || 0));
      consumeRow(rows[idx]);
    } else {
      for (const row of rows) consumeRow(row);
    }
    // and 追加行は択一の結果に関わらず常に占有する(フェーズ12・ユーザー確定)
    for (const row of addedAnd) consumeAdded(row);
  }

  const slots = realOrder.map((token) => {
    const count = realCount.get(token) ?? 0;
    const u = used.get(token) ?? 0;
    return { key: keys.get(token) ?? "", label: labels.get(token) ?? token,
      count, used: u, free: count - u, over: u > count };
  });

  // プリセット未掲載ラベル/キーへの消費(非カウント枠。表示は別扱い)
  const unlisted = [];
  for (const [token, u] of used) {
    if (!realCount.has(token)) unlisted.push({ label: labels.get(token) ?? token, used: u });
  }

  return { slots, unlisted };
}

/**
 * 実効部位スロット(partSlotsEffective)を合成する純粋関数(フェーズ12)。
 * base の partSlots に、AE デルタ(system.partSlot.<部位キー>)と負傷の partSlotMod を加算する。
 * - 照合はキー優先・ラベル後方互換(負傷レジストリの旧ラベル指定も引ける)。
 * - 未知の参照は**正のデルタのときだけ**新規実効スロットとして追加する(負は既存のみ=
 *   タイプミスや他ワールド向けの行が幽霊部位を作らない片側ガード)。ラベルは未解決のため
 *   参照トークンをそのまま表示に使う(プリセットへ登録すれば以後はそのラベルで表示される)。
 * - count は 0 でクランプ。base 配列は変更しない。
 * @param {PartSlotDef[]} baseSlots
 * @param {Record<string, number>} [aeDeltas] 部位キー -> 増減
 * @param {Map<string, number>|Record<string, number>} [woundMods] キーまたはラベル -> 増減
 * @returns {PartSlotDef[]}
 */
export function buildEffectivePartSlots(baseSlots = [], aeDeltas = {}, woundMods = new Map()) {
  const rows = (Array.isArray(baseSlots) ? baseSlots : []).map((r) => ({ ...r }));
  const findRow = (token) => {
    if (!token) return null;
    return rows.find((r) => String(r.key ?? "").trim() === token)
      ?? rows.find((r) => String(r.value ?? "").trim() === token)
      ?? null;
  };
  const apply = (token, delta) => {
    const d = Number(delta) || 0;
    if (!token || !d) return;
    const row = findRow(String(token).trim());
    if (row) {
      if (!row.occupiesOther) row.count = Math.max(0, (Number(row.count) || 0) + d);
      return;
    }
    if (d > 0) {
      rows.push({ key: String(token).trim(), value: String(token).trim(), count: d,
        occupiesOther: false, targetPart: "", targetKey: "", targetCount: 1 });
    }
  };
  for (const [k, d] of Object.entries(aeDeltas ?? {})) apply(k, d);
  const wm = woundMods instanceof Map ? woundMods : new Map(Object.entries(woundMods ?? {}));
  for (const [k, d] of wm) apply(k, d);
  return rows;
}

/**
 * @typedef {Object} HostOutfit ホスト候補(準備済みのスロット保有アウトフィット)
 * @property {string} id Item id(オプションの parentItemId と突き合わせる)
 * @property {string} name 表示名
 * @property {Array<{kind:string,count:number}>} [slots] スロット種別ごとの容量(count は解決済み数値)
 *
 * @typedef {Object} HostOption ホストへ準備されたオプション(装備先指定済み)
 * @property {string} name 表示名
 * @property {string} parentItemId 装備先ホストの Item id
 * @property {string} [parentSlotKind] 占有するスロット種別
 * @property {number} [slots] 消費数(部位表記の数字。既定 1)
 */

/**
 * ホストスロット占有を算出する。準備済みホストの容量(スロット種別ごと)に、準備済みオプションの
 * 消費(parentItemId/parentSlotKind)を当てる。種別は IANUS の意識3種・タップの soft/hard を含む。
 * - **スロット 0 / 無スロットは「何も装備できない」ので拾わない**(2026-06-27 ユーザー確定)。
 *   容量>0 のスロットを持つホストだけを候補にし、容量0の種別は出さない。
 * - 装備先が準備済みホスト一覧に無い/そのホストに使えるスロットが無いオプションは数えない(準備ゲート)。
 * kind→表示ラベルの解決は呼び出し側(SLOT_KINDS)に委ねる(本関数は Foundry 非依存を保つ)。
 *
 * @param {HostOutfit[]} hosts 準備済みホスト候補(全件渡してよい)
 * @param {HostOption[]} options 準備済みオプション(装備先指定済み)
 * @returns {Array<{hostId:string,hostName:string,kind:string,capacity:number,used:number,
 *                  free:number,over:boolean,occupants:Array<{name:string,slots:number}>}>}
 *   ホスト×スロット種別(容量>0)ごとの占有。
 */
export function computeHostOccupancy(hosts = [], options = []) {
  // ホスト: id -> { name, caps: Map<kind,容量> }。容量>0 の実スロットを積む。
  // スロットなし/容量0のホストも登録する(便宜スロット「アイテム名」の受け皿になるため。2026-07-23)。
  const hostMap = new Map();
  for (const h of (hosts ?? [])) {
    const id = String(h?.id ?? "").trim();
    if (!id) continue;
    const caps = new Map();
    for (const s of (Array.isArray(h?.slots) ? h.slots : [])) {
      const kind = String(s?.kind ?? "").trim();
      if (!kind) continue;
      const cap = Math.max(0, Number(s?.count) || 0);
      if (cap > 0) caps.set(kind, (caps.get(kind) ?? 0) + cap);
    }
    hostMap.set(id, { name: String(h?.name ?? ""), caps });
  }

  // 使用量: host id -> kind -> { used, occupants }。
  // - 実スロット種別は容量>0 が無いと数えない(そのホストに無い種別)。
  // - 便宜スロット「アイテム名」(OUTFIT_NAME_SLOT_KIND)は実スロット不要(容量1・スロットなしホスト用)。
  const usage = new Map();
  for (const o of (options ?? [])) {
    const pid = String(o?.parentItemId ?? "").trim();
    if (!pid || !hostMap.has(pid)) continue;          // 準備済みホストに紐づくものだけ
    const host = hostMap.get(pid);
    const kind = String(o?.parentSlotKind ?? "").trim();
    if (kind !== OUTFIT_NAME_SLOT_KIND && !host.caps.has(kind)) continue; // 実スロットに無い種別は数えない
    const n = Number(o?.slots);
    const amount = Number.isFinite(n) ? Math.max(0, n) : 1;
    if (!usage.has(pid)) usage.set(pid, new Map());
    const km = usage.get(pid);
    if (!km.has(kind)) km.set(kind, { used: 0, occupants: [] });
    const e = km.get(kind);
    e.used += amount;
    e.occupants.push({ name: String(o?.name ?? ""), slots: amount });
  }

  // 出力: ホスト順 → 実スロット種別(容量あり) + 便宜スロット「アイテム名」(占有時のみ・容量1)。
  const rows = [];
  for (const [id, host] of hostMap) {
    const km = usage.get(id) ?? new Map();
    for (const [kind, capacity] of host.caps) {
      const e = km.get(kind) ?? { used: 0, occupants: [] };
      rows.push({
        hostId: id, hostName: host.name, kind, capacity,
        used: e.used, free: capacity - e.used, over: e.used > capacity, occupants: e.occupants,
      });
    }
    // 便宜スロット「アイテム名」: 名前指定オプションが実際に載ったホストにだけ 1/容量 を出す
    // (全スロットなし品に 0/1 を出さない)。容量1なので2個目は over=対象1つにつき1個の制限が自動で効く。
    const on = km.get(OUTFIT_NAME_SLOT_KIND);
    if (on && on.used > 0 && !host.caps.has(OUTFIT_NAME_SLOT_KIND)) {
      rows.push({
        hostId: id, hostName: host.name, kind: OUTFIT_NAME_SLOT_KIND, capacity: 1,
        used: on.used, free: 1 - on.used, over: on.used > 1, occupants: on.occupants,
      });
    }
  }
  return rows;
}
