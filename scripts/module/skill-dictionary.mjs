/**
 * @fileoverview スキル辞典(compendium)ローダ。
 *
 * 代用先技能の選択・用途のベース技能選択など、ワールド直下/辞典内でも技能を選べるようにするための
 * 辞典参照ヘルパー。RL 判定要求(tnx-rl-request-app.mjs)と同じく compendium を読み、
 * `identificationKey` をキー、`name` を表示名として選択肢化する。
 *
 * 対象辞典(system.json packs): general-skills(一般技能) / style-skills(スタイル技能) / works-skills(ワークス専用技能)。
 */

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
export const ONOMASTIC_TYPES = {
  society: "社会",
  operate: "操縦",
  craft:   "製作",
  art:     "芸術",
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
      opts[wholeCategoryToken(prefix)] = `〈${wholeLabel}〉（カテゴリ全体）`;
      inserted.add(prefix);
    }
    opts[e.identificationKey] = e.name;
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
      for (const e of general.filter((x) => x.generalSkillCategory === "initialSkill")) opts[e.identificationKey] = e.name;
      push("skill", "技能名", opts, path.skill);
    } else if (path.group === "onomasticSkill") {
      const subOpts = { "": "-" };
      for (const [k, label] of Object.entries(ONOMASTIC_TYPES)) {
        if (general.some((x) => x.generalSkillCategory === "onomasticSkill" && idKeyPrefix(x.identificationKey) === k)) subOpts[k] = label;
      }
      push("sub", "小分類", subOpts, path.sub);
      if (path.sub) {
        // 小分類リストの先頭にカテゴリ全体(〈社会〉等)を置く
        const opts = { "": "-", [wholeCategoryToken(path.sub)]: `〈${ONOMASTIC_TYPES[path.sub] ?? path.sub}〉（カテゴリ全体）` };
        for (const e of general.filter((x) => x.generalSkillCategory === "onomasticSkill" && idKeyPrefix(x.identificationKey) === path.sub)) opts[e.identificationKey] = e.name;
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
      for (const e of works.filter((x) => x.organization === path.group)) opts[e.identificationKey] = e.name;
      push("skill", "技能名", opts, path.skill);
    }
  }
  return steps;
}

const _cache = new Map();

/**
 * 1 つの辞典から `{identificationKey, name}` の配列を読み込む(名前順・identificationKey 無しは除外)。結果はキャッシュ。
 * @param {string} packName compendium の完全名
 * @returns {Promise<{identificationKey: string, name: string}[]>}
 */
export async function loadSkillEntries(packName) {
  if (_cache.has(packName)) return _cache.get(packName);
  const pack = game.packs?.get(packName);
  if (!pack) return [];
  try {
    const docs = await pack.getDocuments();
    const entries = docs
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
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    _cache.set(packName, entries);
    return entries;
  } catch (e) {
    console.error(`TokyoNOVA | Failed to load skill compendium ${packName}:`, e);
    return [];
  }
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
