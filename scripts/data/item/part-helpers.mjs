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
 * オプションの「その他特徴」キー → 表示ラベル。ホスト側の特徴で絞り込む(「武器(サイバーウェア)」等)。
 * isCyber は大分類サイバーウェア指定で拾う isCyber=true を絞り込みに使う(2026-06-27 ユーザー確定)。
 * 変異器官は 10-2 で新造。
 */
export const PART_HOST_FEATURE_LABELS = Object.freeze({
  isLaser:       "レーザー武器",
  isCyber:       "サイバーウェア",
  isMutantOrgan: "変異器官",
});

/** 消費数の数字サフィックス(1 は無し、0/2/… は数字)。部位名の直後・絞り括弧の前に付く。 */
function slotNumSuffix(slots) {
  const n = Number(slots);
  return n === 1 ? "" : String(Number.isFinite(n) ? n : 0);
}

/**
 * オプション行の部位名(スロット名)を組み立てる。
 * - アイテム名あり → アイテム名(名前照合のホスト)。
 * - 大分類レベル(武器のみ・isMajorLevelSlotMajor) → 大分類名「武器」。小分類/特徴は絞りとして
 *   括弧併記「武器(白兵武器)」、除外は「武器(搭載兵器以外)」。
 * - 小分類レベル(大半) → 小分類名「タップ」「IANUS」「船舶」。除外は「○○以外」。特徴は括弧。
 * - 消費数の数字は名前直後・括弧の前(「武器0(白兵武器)」)。
 * @param {Object} row part 行(kind=option)
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
 * @param {Array} part part 行配列
 * @param {string} [partRelation] "and" | "or"
 * @param {boolean} [partOptional] 部位全体が任意か(行ごとではなく part 全体に効く)
 * @returns {string}
 */
export function formatPartDesignation(part, partRelation = "and", partOptional = false) {
  const rows = (Array.isArray(part) ? part : []).filter((r) => r && r.kind !== "none");
  const labels = rows.map(rowDesignation).filter((l) => l !== "");
  const hasOther = rows.some((r) => r.kind === "other");

  if (partOptional) {
    // 任意は部位全体に効く: 「任意(A、B…)」。その他を含めば「など」を内側末尾へ。素の任意は「任意」
    if (!labels.length) return "任意";
    return `任意(${labels.join("、")}${hasOther ? "など" : ""})`;
  }
  if (!rows.length) return "-";
  if (!labels.length) return hasOther ? "など" : "-";

  let joined;
  if (rows.length >= 2 && partRelation === "or") {
    joined = labels.join(rows.every((r) => r.kind === "option") ? "／" : "、もしくは");
  } else if (rows.length >= 2 && partRelation === "and") {
    joined = labels.join("+");
  } else {
    joined = labels.join("、");
  }
  return hasOther ? `${joined}など` : joined;
}

/**
 * 複数アウトフィットの部位表記を併記する(コンバイナ=両方の部位を占有)。"-" は除外して「、」連結。
 * @param {Array<{part?:Array, partRelation?:string, partOptional?:boolean}>} systems 各 system
 * @returns {string}
 */
export function joinPartDesignations(systems) {
  const designations = (systems ?? [])
    .map((s) => formatPartDesignation(s?.part, s?.partRelation, s?.partOptional))
    .filter((d) => d && d !== "-");
  return designations.length ? designations.join("、") : "-";
}

/**
 * @typedef {Object} PartSlotDef キャストの部位スロット定義(cast.system.partSlots の1要素)
 * @property {string} value 部位ラベル
 * @property {number} count 実スロット数(occupiesOther 時は無視)
 * @property {boolean} [occupiesOther] 「指定部位を複数占有」エイリアス
 * @property {string} [targetPart] 占有先の部位ラベル(エイリアス時)
 * @property {number} [targetCount] 占有先を消費する数(エイリアス時)
 *
 * @typedef {Object} OutfitOccupant 占有計算に渡すアウトフィットの最小データ
 * @property {boolean} isPrepared 準備済みか
 * @property {string} [minorCategory] 小分類キー
 * @property {Array} part part 行配列
 * @property {string} [partRelation] "and" | "or"
 * @property {number} [partOrChoice] or 時に占有する行 index
 */

/**
 * 部位占有を算出する。
 * @param {PartSlotDef[]} partSlots キャストの部位スロット集合
 * @param {OutfitOccupant[]} outfits 占有計算対象のアウトフィット群(全件渡してよい。準備済みのみ数える)
 * @returns {{slots: Array<{label:string,count:number,used:number,free:number,over:boolean}>,
 *           unlisted: Array<{label:string,used:number}>}}
 *   slots: プリセット掲載スロットごとの占有。unlisted: リスト外ラベルへの消費(非カウント枠)。
 */
export function computePartOccupancy(partSlots = [], outfits = []) {
  const realOrder = [];          // ラベルの登場順を保持
  const realCount = new Map();   // label -> count
  const aliases   = new Map();   // label -> { targetPart, targetCount }

  for (const s of (partSlots ?? [])) {
    const label = String(s?.value ?? "").trim();
    if (!label) continue;
    if (s.occupiesOther) {
      aliases.set(label, {
        targetPart:  String(s.targetPart ?? "").trim(),
        targetCount: Math.max(0, Number(s.targetCount) || 0),
      });
    } else if (!realCount.has(label)) {
      realCount.set(label, Math.max(0, Number(s.count) || 0));
      realOrder.push(label);
    }
  }

  const used = new Map();
  /** ラベルへ amount 消費。エイリアスは指定部位へ targetCount 倍で再帰展開(循環ガード付き)。 */
  const addConsume = (label, amount, depth = 0) => {
    if (amount <= 0 || depth > 16) return;
    const alias = aliases.get(label);
    if (alias) {
      if (alias.targetPart) addConsume(alias.targetPart, amount * alias.targetCount, depth + 1);
      return;
    }
    used.set(label, (used.get(label) ?? 0) + amount);
  };

  for (const outfit of (outfits ?? [])) {
    if (!outfit?.isPrepared) continue;
    if (outfit.minorCategory === "housingAccessory") continue; // 非消費: 住宅アクセサリ
    if (outfit.partOptional) continue;                         // 非消費: 任意(部位全体)
    const rows = Array.isArray(outfit.part) ? outfit.part : [];

    const consumeRow = (row) => {
      if (!row) return;
      const effKind = row.kind === "reference" ? row.refSubKind : row.kind;
      if (effKind !== "bodyPart") return;       // 身体部位のみ(オプション等は対象外)
      const slots = Math.max(0, Number(row.slots) || 0);
      const label = String(row.value ?? "").trim();
      if (slots === 0 || !label) return;        // 非消費: slots=0
      addConsume(label, slots);
    };

    if (outfit.partRelation === "or" && rows.length >= 2) {
      // 択一: 装備先トグルで選んだ1行だけ占有
      const idx = Math.max(0, Math.min(rows.length - 1, Number(outfit.partOrChoice) || 0));
      consumeRow(rows[idx]);
    } else {
      for (const row of rows) consumeRow(row);
    }
  }

  const slots = realOrder.map((label) => {
    const count = realCount.get(label) ?? 0;
    const u = used.get(label) ?? 0;
    return { label, count, used: u, free: count - u, over: u > count };
  });

  // プリセット未掲載ラベルへの消費(非カウント枠。表示は別扱い)
  const unlisted = [];
  for (const [label, u] of used) {
    if (!realCount.has(label)) unlisted.push({ label, used: u });
  }

  return { slots, unlisted };
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
  // ホスト: id -> { name, caps: Map<kind,容量> }。容量>0 のスロットだけ積む。
  // スロット0/無スロットのホストは候補にしない(使えるスロットが無いため)。
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
    if (caps.size) hostMap.set(id, { name: String(h?.name ?? ""), caps });
  }

  // 使用量: host id -> kind -> { used, occupants }。使えるスロット(容量>0)が無い種別は拾わない。
  const usage = new Map();
  for (const o of (options ?? [])) {
    const pid = String(o?.parentItemId ?? "").trim();
    if (!pid || !hostMap.has(pid)) continue;          // 準備済みホストに紐づくものだけ
    const host = hostMap.get(pid);
    const kind = String(o?.parentSlotKind ?? "").trim();
    if (!host.caps.has(kind)) continue;               // そのホストに無い種別は数えない
    const n = Number(o?.slots);
    const amount = Number.isFinite(n) ? Math.max(0, n) : 1;
    if (!usage.has(pid)) usage.set(pid, new Map());
    const km = usage.get(pid);
    if (!km.has(kind)) km.set(kind, { used: 0, occupants: [] });
    const e = km.get(kind);
    e.used += amount;
    e.occupants.push({ name: String(o?.name ?? ""), slots: amount });
  }

  // 出力: ホスト順 → 容量のある種別のみ。
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
  }
  return rows;
}
