/**
 * @fileoverview スキル辞典(compendium)ローダ。
 *
 * 代用先技能の選択・用途のベース技能選択など、ワールド直下/辞典内でも技能を選べるようにするための
 * 辞典参照ヘルパー。RL 判定要求(tnx-rl-request-app.mjs)と同じく compendium を読み、
 * `identificationKey` をキー、`name` を表示名として選択肢化する。
 *
 * 対象辞典(system.json packs): general-skills(一般技能) / style-skills(スタイル技能) / works-skills(ワークス専用技能)。
 */

import { formatSkillName, skillSortPosition } from "./identification.mjs";

/** pack 名 → 表示用ラベル(辞典名)。将来のオプショングループ化に使う。 */
export const SKILL_PACKS = {
  general: "tokyo-nova-axleration.general-skills",
  style:   "tokyo-nova-axleration.style-skills",
  works:   "tokyo-nova-axleration.works-skills",
};

export const SKILL_PACK_LABELS = {
  "tokyo-nova-axleration.general-skills": "一般技能",
  "tokyo-nova-axleration.style-skills":   "スタイル技能",
  "tokyo-nova-axleration.works-skills":   "ワークス専用技能",
};

// 技能以外の辞典(identificationKey 参照プルダウンで使う): スタイル / オーガニゼーション(組織)
export const STYLE_PACK = "tokyo-nova-axleration.styles";
export const ORGANIZATION_PACK = "tokyo-nova-axleration.organizations";

// 固有名詞技能の小分類: 識別キープレフィックス → ラベル(カスケード P3a-2/P4 の絞り込み)。
// 並びは正規ソート順(GENERAL_SKILL_SORT_PREFIXES のプレフィックス位置・2026-07-19 ユーザー指示=
// 技能選択の並びをシートのソート順へ統一)。選択肢化はこの記載順に依存する。
export const ONOMASTIC_TYPES = {
  craft:   "製作",
  art:     "芸術",
  operate: "操縦",
  society: "社会",
  contact: "コネ",
};

// スタイル技能の例外的カテゴリ全体(ハードコード・ユーザー入力で表現不可):
// 識別キープレフィックス → カテゴリ名。該当スタイルの技能リスト先頭にカテゴリ全体エントリを置く。
export const STYLE_WHOLE_CATEGORY_PREFIXES = {
  element:   "元力",   // バサラ
  bloodline: "血脈",   // アヤカシ
};

/**
 * 技能カスケードに必要な辞典データ一式を読み込む(Foundry 依存)。
 * @returns {Promise<{general:Array, style:Array, works:Array, styleNames:object, orgNames:object}>}
 */
export async function loadCascadeData() {
  const [general, style, works] = await Promise.all([
    loadSkillEntries(SKILL_PACKS.general),
    loadSkillEntries(SKILL_PACKS.style),
    loadSkillEntries(SKILL_PACKS.works),
  ]);
  const [styleNames, orgNames] = await Promise.all([
    loadSkillChoices([STYLE_PACK]),
    loadSkillChoices([ORGANIZATION_PACK]),
  ]);
  return { general, style, works, styleNames, orgNames };
}

/** 識別キーのプレフィックス(区切り「_」まで)。固有名詞小分類・例外カテゴリの判定に使う。 */
export function idKeyPrefix(key) {
  const s = String(key ?? "").trim();
  if (!s) return "";
  const i = s.indexOf("_");
  return i < 0 ? s : s.slice(0, i);
}

/** カテゴリ全体指定のトークン(単一技能名でない＝自動固定しない・絞り込み対象)。例: "@society" "@element"。 */
export function wholeCategoryToken(kind) {
  return `@${kind}`;
}
export function isWholeCategoryToken(value) {
  return typeof value === "string" && value.startsWith("@");
}

/**
 * comboSkill「技能名」の保存値(識別キー or カテゴリ全体トークン @kind)を表示名に解決する。
 * - `@kind`: スタイル例外(element/bloodline)→元力/血脈、固有名詞小分類(society 等)→社会 等のカテゴリ名。
 * - それ以外: 全技能辞典の {key:name} で逆引き。見つからなければ生値を返す(辞典欠落時のフォールバック)。
 * 名前はキャッシュせず、表示のたびに辞典から都度逆引きする(識別キーは安定参照)。
 * @param {string} value 保存値(識別キー or @トークン)
 * @param {Record<string,string>} skillNames loadSkillChoices([general,style,works]) の結果
 * @returns {string} 表示名(空値は "")
 */
export function resolveComboSkillName(value, skillNames = {}) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  // 解決に専念し**素の技能名**を返す(2026-07-18 一本化): 〈〉付与は表示側で formatSkillName が唯一行う。
  // 辞典で解決できない生値はそのまま返す
  if (isWholeCategoryToken(v)) {
    const kind = v.slice(1);
    return STYLE_WHOLE_CATEGORY_PREFIXES[kind] ?? ONOMASTIC_TYPES[kind] ?? kind;
  }
  return skillNames[v] ?? v;
}

/**
 * スタイルの技能リストの選択肢を作る。`element_`/`bloodline_` 技能の**並びの先頭**にカテゴリ全体
 * (〈元力〉/〈血脈〉)を挿入する(リスト全体の先頭ではなく、その prefix グループの頭)。
 * @param {Array} styleSkills その1スタイルの技能 entries
 * @returns {Record<string,string>} {value: label}
 */
function buildStyleSkillOptions(styleSkills) {
  const sorted = [...styleSkills].sort((a, b) =>
    String(a.identificationKey).localeCompare(String(b.identificationKey)));
  const opts = { "": "-" };
  const inserted = new Set();
  for (const e of sorted) {
    const prefix = idKeyPrefix(e.identificationKey);
    const wholeLabel = STYLE_WHOLE_CATEGORY_PREFIXES[prefix];
    if (wholeLabel && !inserted.has(prefix)) {
      opts[wholeCategoryToken(prefix)] = `${formatSkillName(wholeLabel)}（カテゴリ全体）`;
      inserted.add(prefix);
    }
    opts[e.identificationKey] = formatSkillName(e.name);
  }
  return opts;
}

/**
 * 技能カスケードの各段の選択肢を、辞典データ＋現在のパスから組み立てる(純粋関数)。
 * 部位エディタの大分類→小分類と同方式: パス(dict/group/sub)を保存し、段ごとに選択肢を算出する。
 * @param {object} data { general:[], style:[], works:[], styleNames:{key:name}, orgNames:{key:name} }
 * @param {object} path { dict, group, sub } 現在の選択(未選択は "")
 * @returns {Array<{key:string,label:string,options:Record<string,string>,value:string}>} 表示する各段
 */
export function buildSkillCascadeSteps(data, path = {}) {
  const general = data?.general ?? [];
  const style   = data?.style ?? [];
  const works   = data?.works ?? [];
  const steps = [];
  // 段キー → comboSkill の保存フィールド名(部位の hostMajor/hostMinor と同様にパスを保存)
  const FIELD = { dict: "skillDict", group: "skillGroup", sub: "skillSub", skill: "name" };
  const push = (key, label, options, value) => steps.push({ key, field: FIELD[key], label, options, value: value ?? "" });

  push("dict", "辞典", { "": "-", general: "一般技能", style: "スタイル技能", works: "ワークス専用技能" }, path.dict);
  if (!path.dict) return steps;

  if (path.dict === "general") {
    push("group", "種別", { "": "-", initialSkill: "無条件取得技能", onomasticSkill: "固有名詞技能" }, path.group);
    if (path.group === "initialSkill") {
      const opts = { "": "-" };
      for (const e of general.filter((x) => x.generalSkillCategory === "initialSkill")) opts[e.identificationKey] = formatSkillName(e.name);
      push("skill", "技能名", opts, path.skill);
    } else if (path.group === "onomasticSkill") {
      const subOpts = { "": "-" };
      for (const [k, label] of Object.entries(ONOMASTIC_TYPES)) {
        if (general.some((x) => x.generalSkillCategory === "onomasticSkill" && idKeyPrefix(x.identificationKey) === k)) subOpts[k] = label;
      }
      push("sub", "小分類", subOpts, path.sub);
      if (path.sub) {
        // 小分類リストの先頭にカテゴリ全体(〈社会〉等)を置く
        const opts = { "": "-", [wholeCategoryToken(path.sub)]: `${formatSkillName(ONOMASTIC_TYPES[path.sub] ?? path.sub)}（カテゴリ全体）` };
        for (const e of general.filter((x) => x.generalSkillCategory === "onomasticSkill" && idKeyPrefix(x.identificationKey) === path.sub)) opts[e.identificationKey] = formatSkillName(e.name);
        push("skill", "技能名", opts, path.skill);
      }
    }
  } else if (path.dict === "style") {
    const styleOpts = { "": "-" };
    for (const sKey of [...new Set(style.map((x) => x.style).filter(Boolean))]) styleOpts[sKey] = data.styleNames?.[sKey] ?? sKey;
    push("group", "スタイル", styleOpts, path.group);
    if (path.group) push("skill", "技能名", buildStyleSkillOptions(style.filter((x) => x.style === path.group)), path.skill);
  } else if (path.dict === "works") {
    const orgOpts = { "": "-" };
    for (const oKey of [...new Set(works.map((x) => x.organization).filter(Boolean))]) orgOpts[oKey] = data.orgNames?.[oKey] ?? oKey;
    push("group", "組織", orgOpts, path.group);
    if (path.group) {
      const opts = { "": "-" };
      for (const e of works.filter((x) => x.organization === path.group)) opts[e.identificationKey] = formatSkillName(e.name);
      push("skill", "技能名", opts, path.skill);
    }
  }
  return steps;
}

const _cache = new Map();

/**
 * 1 つの辞典から `{identificationKey, name}` の配列を読み込む(identificationKey 無しは除外)。
 * 並びは正規ソート順(シートの技能リストと同じ・2026-07-19 ユーザー指示で名前順から変更)。
 * 正規位置を持たない技能(スタイル/ワークス等)は従来どおり名前順。結果はキャッシュ。
 * @param {string} packName compendium の完全名
 * @returns {Promise<{identificationKey: string, name: string}[]>}
 */
export async function loadSkillEntries(packName) {
  if (_cache.has(packName)) return _cache.get(packName);
  const pack = game.packs?.get(packName);
  if (!pack) return [];
  try {
    // インデックスで読む(getDocuments 禁止・2026-07-17 是正): getDocuments はパック内の
    // 全キャッシュ文書を**新しいインスタンスに差し替える**ため、開いている辞典アイテムの
    // シートが孤児インスタンスに取り残され、以後の更新(用途の削除等)が画面に反映されなく
    // なる(データは更新されるのにシートだけ古いまま)。必要な値はインデックスで全て取れる
    const docs = await pack.getIndex({
      fields: [
        "system.identificationKey",
        "system.generalSkillCategory",
        "system.style",
        "system.special.works.organization",
        "system.isAction",
        "system.suits",
        "system.actions",
      ],
    });
    const entries = [...docs]
      .filter((d) => d.system?.identificationKey)
      .map((d) => ({
        identificationKey: d.system.identificationKey,
        name: d.name,
        // カスケード絞り込み用メタデータ:
        // - generalSkillCategory: 一般技能の "initialSkill"(無条件取得) / "onomasticSkill"(固有名詞)
        // - 固有名詞の小分類は identificationKey のプレフィックス(区切り「_」まで)で判定する
        // - style: スタイル技能の所属スタイル(styles 辞典 identificationKey)
        // - organization: ワークス専用技能の所属組織(organizations 辞典 identificationKey)
        generalSkillCategory: d.system.generalSkillCategory ?? "",
        style: d.system.style ?? "",
        organization: d.system.special?.works?.organization ?? "",
        isAction: d.system.isAction === true,
        suits: { ...(d.system.suits ?? {}) },
        // 用途タイプの所持(2026-07-18): 対決欄の無印技能名行の吸収判定に使う(その技能が手段の
        // リアクション用途タイプを持つか)。アクター未所持(辞典アイテム編集等)でも参照できる索引
        usageTypes: [...new Set((d.system.actions ?? []).map((a) => a?.type).filter(Boolean))],
      }))
      .sort((a, b) => {
        const pa = skillSortPosition(a.identificationKey);
        const pb = skillSortPosition(b.identificationKey);
        if (pa !== pb) return pa < pb ? -1 : 1;
        return a.name.localeCompare(b.name, "ja");
      });
    _cache.set(packName, entries);
    return entries;
  } catch (e) {
    console.error(`TokyoNOVA | Failed to load skill compendium ${packName}:`, e);
    return [];
  }
}

/**
 * 全技能辞典(一般・スタイル・ワークス)の「識別キー → 所持する用途タイプの Set」索引を返す。
 * 対決欄の無印技能名行の吸収判定(その技能が手段のリアクション用途タイプを持つか)に使う。
 * アクター未所持の技能(辞典アイテムの編集時など)を参照するための辞典側の真実(2026-07-18)。
 * @returns {Promise<Map<string, Set<string>>>}
 */
export async function loadSkillUsageTypeIndex() {
  const map = new Map();
  for (const packName of [SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]) {
    for (const e of await loadSkillEntries(packName)) {
      map.set(e.identificationKey, new Set(e.usageTypes ?? []));
    }
  }
  return map;
}

/**
 * 全技能辞典(一般・スタイル・ワークス)の技能を、チェーン解決・自動入力・候補表示に使える
 * 軽量な技能オブジェクト `{id, name, type, system}` の配列で返す(2026-07-18 統一)。
 * アクター非所持の用途(ワールド直下・辞典内を問わず)のベース技能/組み合わせ候補はここを参照する
 * ——辞典アイテムの同パック限定/ワールド直下は game.items のみ、という区別を撤去する。
 * getIndex で必要フィールドだけを引く(文書インスタンスを作らない＝KI-026 の孤児化を起こさない)。
 * @returns {Promise<Array<{id:string, name:string, type:string, system:object}>>}
 */
export async function loadDictionarySkillItems() {
  const fields = [
    "system.identificationKey", "system.isAction", "system.isSubstitute", "system.substituteTarget",
    "system.comboSkill", "system.confrontation", "system.target", "system.isFixedTarget",
    "system.range", "system.isFixedRange", "system.targetValue", "system.targetValueNumber",
    "system.timing", "system.suits", "system.level", "system.uses",
  ];
  const out = [];
  for (const packName of [SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]) {
    const pack = game.packs?.get(packName);
    if (!pack) continue;
    try {
      const index = await pack.getIndex({ fields });
      for (const e of index) {
        if (e.type !== "generalSkill" && e.type !== "styleSkill") continue;
        out.push({ id: e._id, name: e.name, type: e.type, system: foundry.utils.deepClone(e.system ?? {}) });
      }
    } catch (err) {
      console.error(`TokyoNOVA | Failed to load skill items from ${packName}:`, err);
    }
  }
  return out;
}

/**
 * 一般技能辞典から、指定した固有名詞小分類(識別キープレフィックス)の技能を `{key: name}` の
 * 選択肢オブジェクトにする(先頭に "" → "-")。例: prefix="operate" で〈操縦〉各種。
 * ヴィークルの「対応する操縦」プルダウン等に使う。
 * @param {string} prefix ONOMASTIC_TYPES のキー(例 "operate")
 * @returns {Promise<Record<string, string>>}
 */
export async function loadOnomasticChoices(prefix) {
  const general = await loadSkillEntries(SKILL_PACKS.general);
  const choices = { "": "-" };
  for (const e of general) {
    if (e.generalSkillCategory === "onomasticSkill" && idKeyPrefix(e.identificationKey) === prefix) {
      choices[e.identificationKey] = e.name;
    }
  }
  return choices;
}

/**
 * 一般技能辞典を分類ごとのグループに束ねた選択肢を返す(2026-07-19 ユーザー指示・判定要求の
 * 技能プルダウン等)。グループ=「無条件取得技能」＋固有名詞小分類(製作/芸術/操縦/社会/コネ)。
 * グループの並びは正規ソート順での初出位置(無条件取得技能→製作→芸術→操縦→社会→コネ)・
 * グループ内も正規ソート順(=シートの技能リストと同じ並び)。
 * @returns {Promise<Array<{label: string, skills: Array<{identificationKey: string, name: string}>}>>}
 */
export async function loadGroupedGeneralSkillChoices() {
  return groupGeneralSkillEntries(await loadSkillEntries(SKILL_PACKS.general));
}

/**
 * 一般技能 entries を分類グループへ束ねる純粋部(グループの並び=入力順での初出位置)。
 * @param {Array<{identificationKey:string, name:string, generalSkillCategory?:string}>} entries
 * @returns {Array<{label: string, skills: Array<{identificationKey: string, name: string}>}>}
 */
export function groupGeneralSkillEntries(entries) {
  const groups = [];
  const byLabel = new Map();
  for (const e of entries ?? []) {
    const label = e.generalSkillCategory === "onomasticSkill"
      ? (ONOMASTIC_TYPES[idKeyPrefix(e.identificationKey)] ?? "固有名詞技能")
      : "無条件取得技能";
    let group = byLabel.get(label);
    if (!group) {
      group = { label, skills: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.skills.push({ identificationKey: e.identificationKey, name: e.name });
  }
  return groups;
}

/**
 * 複数辞典をまとめて `{key: name}` の選択肢オブジェクトにする(先頭に "" → "-")。
 * selectOptions ヘルパーにそのまま渡せる。
 * @param {string[]} packNames compendium 完全名の配列
 * @returns {Promise<Record<string, string>>}
 */
export async function loadSkillChoices(packNames) {
  const choices = { "": "-" };
  for (const packName of packNames) {
    for (const e of await loadSkillEntries(packName)) {
      choices[e.identificationKey] = e.name;
    }
  }
  return choices;
}
