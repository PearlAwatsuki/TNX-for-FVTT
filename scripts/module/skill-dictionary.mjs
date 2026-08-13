/**
 * @fileoverview スキル辞典(compendium)ローダ。
 *
 * 代用先技能の選択・用途のベース技能選択など、ワールド直下/辞典内でも技能を選べるようにするための
 * 辞典参照ヘルパー。RL 判定要求(tnx-rl-request-app.mjs)と同じく compendium を読み、
 * `identificationKey` をキー、`name` を表示名として選択肢化する。
 *
 * 対象辞典(system.json packs): general-skills(一般技能) / style-skills(スタイル技能) / works-skills(ワークス専用技能)。
 *
 * **技能の源は辞典とワールド直下の両方**(2026-08-12 ユーザー指示)。アイテムの置き場所で選べる
 * 技能の集合が変わらないようにするためで、収集層(loadSkillEntries / loadDictionarySkillItems)で
 * 合成するので、その上に乗る選択肢・逆引き・カスケードは呼び出し側を変えずに両方を見る。
 * 技能でない辞典(スタイル・組織)にはワールドの源を置かない。
 */

import { formatSkillName, skillSortPosition, styleSortPosition } from "./identification.mjs";

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
    // 並びはスタイルの正規順(2026-08-12 指示)。ここは技能側の style フィールドから拾うため、
    // 辞典の並び(loadSkillEntries)には乗らない。正規順に無いキーは末尾へ名前順で置く。
    const styleKeys = [...new Set(style.map((x) => x.style).filter(Boolean))].sort((a, b) => {
      const pa = styleSortPosition(a);
      const pb = styleSortPosition(b);
      if (pa !== pb) return pa < pb ? -1 : 1;
      return String(data.styleNames?.[a] ?? a).localeCompare(String(data.styleNames?.[b] ?? b), "ja");
    });
    for (const sKey of styleKeys) styleOpts[sKey] = data.styleNames?.[sKey] ?? sKey;
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

// 技能辞典に対応する**ワールド直下**の技能(2026-08-12 ユーザー指示)。アイテムの置き場所で
// 選べる技能の集合が変わらないようにするための第二の源で、**技能だけ**に置く
// ——スタイル辞典・組織辞典など技能でないパックには源が無く、従来どおり辞典のみを読む。
// スタイル技能とワークス専用技能はどちらも type="styleSkill" で、works.value で分かれる。
const WORLD_SKILL_SOURCES = {
  [SKILL_PACKS.general]: (i) => i.type === "generalSkill",
  [SKILL_PACKS.style]:   (i) => i.type === "styleSkill" && i.system?.special?.works?.value !== true,
  [SKILL_PACKS.works]:   (i) => i.type === "styleSkill" && i.system?.special?.works?.value === true,
};

/** その辞典の並びに使う正規位置関数(スタイル辞典だけスタイルの正規順)。 */
function positionFor(packName) {
  return packName === STYLE_PACK ? styleSortPosition : skillSortPosition;
}

/**
 * 辞典インデックスの項目・ワールドアイテムの `toObject()` を共通のエントリ形へ揃える。
 * どちらも `{_id, name, system}` の形なので同じ写し方でよい。
 * @param {{_id?:string, name?:string, system?:object}} src
 * @param {string} uuid 実体への参照(辞典は pack.getUuid・ワールドは item.uuid)
 */
function toSkillEntry(src, uuid) {
  const sys = src.system ?? {};
  return {
    id: src._id,
    uuid,
    identificationKey: sys.identificationKey,
    name: src.name,
    // カスケード絞り込み用メタデータ:
    // - generalSkillCategory: 一般技能の "initialSkill"(無条件取得) / "onomasticSkill"(固有名詞)
    // - 固有名詞の小分類は identificationKey のプレフィックス(区切り「_」まで)で判定する
    // - style: スタイル技能の所属スタイル(styles 辞典 identificationKey)
    // - organization: ワークス専用技能の所属組織(organizations 辞典 identificationKey)
    generalSkillCategory: sys.generalSkillCategory ?? "",
    style: sys.style ?? "",
    organization: sys.special?.works?.organization ?? "",
    isAction: sys.isAction === true,
    suits: { ...(sys.suits ?? {}) },
    // 用途タイプの所持(2026-07-18): 対決欄の無印技能名行の吸収判定に使う(その技能が手段の
    // リアクション用途タイプを持つか)。アクター未所持(辞典アイテム編集等)でも参照できる索引
    usageTypes: [...new Set((sys.actions ?? []).map((a) => a?.type).filter(Boolean))],
  };
}

/**
 * 辞典＋ワールドのエントリを識別キーで束ねて並べる純粋部。同じ識別キーは**辞典を優先**する
 * ——識別キーは一意な参照なので衝突は重複であって上書きの意図ではなく、辞典側は全クライアントに
 * 見えるため解決が揃う。並びは正規位置→名前(ja)。
 * @param {Array<object>} packEntries 辞典側(先に入れた方が勝つ)
 * @param {Array<object>} worldEntries ワールド直下側
 * @param {(key: string) => number} [position] 正規位置関数
 * @returns {Array<object>}
 */
export function mergeSkillEntries(packEntries, worldEntries, position = skillSortPosition) {
  const byKey = new Map();
  for (const e of [...(packEntries ?? []), ...(worldEntries ?? [])]) {
    if (!e?.identificationKey || byKey.has(e.identificationKey)) continue;
    byKey.set(e.identificationKey, e);
  }
  return [...byKey.values()].sort((a, b) => {
    const pa = position(a.identificationKey);
    const pb = position(b.identificationKey);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
  });
}

/** 辞典(compendium)側だけを読む。結果はキャッシュする(ワールド分は都度読みなので混ぜない)。 */
async function loadPackSkillEntries(packName) {
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
    const position = positionFor(packName);
    const entries = [...docs]
      .filter((d) => d.system?.identificationKey)
      // uuid は pack.getUuid で作る(文字列組み立てにしない=書式の権威は Foundry 側)
      .map((d) => toSkillEntry(d, pack.getUuid(d._id)))
      .sort((a, b) => {
        const pa = position(a.identificationKey);
        const pb = position(b.identificationKey);
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

/** ワールド直下から、その辞典に対応する技能アイテムを読む(識別キー無しは除外)。 */
function loadWorldSkillEntries(packName) {
  const source = WORLD_SKILL_SOURCES[packName];
  if (!source) return [];
  const out = [];
  for (const item of game.items ?? []) {
    if (!source(item)) continue;
    // DataModel をそのまま読まず toObject() で素のデータにする(索引の項目と同じ形になる)
    const src = item.toObject();
    if (!src.system?.identificationKey) continue;
    out.push(toSkillEntry(src, item.uuid));
  }
  return out;
}

/**
 * 1 つの辞典から `{identificationKey, name, uuid, …}` の配列を読み込む(identificationKey 無しは除外)。
 * **技能の辞典は、辞典(compendium)とワールド直下の両方を源とする**(2026-08-12 ユーザー指示)。
 * 辞典分はキャッシュ・ワールド分は都度読み(作った直後に候補へ出る)・同じ識別キーは辞典を優先。
 * 並びは正規ソート順(シートの技能リストと同じ・2026-07-19 ユーザー指示で名前順から変更)。
 * スタイル辞典だけは技能の正規順を持たないため、スタイルの正規順(STYLE_SORT_KEYS)で並べる
 * (2026-08-12 ユーザー指示・スタイル選択プルダウンの並びをシステム内で固定するため)。
 * どちらの正規位置も持たない項目(ワークス等)は従来どおり名前順。
 * @param {string} packName compendium の完全名
 * @returns {Promise<{identificationKey: string, name: string, uuid: string}[]>}
 */
export async function loadSkillEntries(packName) {
  const packEntries = await loadPackSkillEntries(packName);
  const worldEntries = loadWorldSkillEntries(packName);
  if (!worldEntries.length) return packEntries;
  return mergeSkillEntries(packEntries, worldEntries, positionFor(packName));
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
 * 全技能辞典(一般・スタイル・ワークス)**とワールド直下**の技能を、チェーン解決・自動入力・
 * 候補表示に使える軽量な技能オブジェクト `{id, name, type, system}` の配列で返す(2026-07-18 統一・
 * ワールド直下の追加は 2026-08-12)。アクター非所持の用途のベース技能/組み合わせ候補はここを参照する
 * ——辞典アイテムの同パック限定/ワールド直下は game.items のみ、という区別を撤去する。
 * getIndex で必要フィールドだけを引く(文書インスタンスを作らない＝KI-026 の孤児化を起こさない)。
 * 同じ識別キーは辞典を優先する(収集層と同じ規則)。
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
  const seen = new Set();   // 識別キー(空でないもの)の重複除け=辞典優先
  const push = (o) => {
    const key = o.system?.identificationKey;
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(o);
  };
  for (const packName of [SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]) {
    const pack = game.packs?.get(packName);
    if (!pack) continue;
    try {
      const index = await pack.getIndex({ fields });
      for (const e of index) {
        if (e.type !== "generalSkill" && e.type !== "styleSkill") continue;
        push({ id: e._id, name: e.name, type: e.type, system: foundry.utils.deepClone(e.system ?? {}) });
      }
    } catch (err) {
      console.error(`TokyoNOVA | Failed to load skill items from ${packName}:`, err);
    }
  }
  for (const item of game.items ?? []) {
    if (item.type !== "generalSkill" && item.type !== "styleSkill") continue;
    const src = item.toObject();
    push({ id: item.id, name: item.name, type: item.type, system: src.system ?? {} });
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
 * コネ技能(アクトコネクション)の索引を、一般技能辞典と**ワールド直下**の両方から作る
 * (2026-08-12 ユーザー指示)。アクト限定のコネは恒久的な辞典に置きたくないという運用上の
 * 理由がコネ固有のため、この拡張はコネだけに留める(他の技能欄は辞典のみのまま)。
 * ワールド分は `game.items` の都度読み(キャッシュしない=作った直後に候補へ出る)。
 * @returns {Promise<Map<string, {name: string, uuid: string}>>} 識別キー → 名前と参照
 */
export async function loadContactSkillIndex() {
  // 辞典とワールド直下の合成・uuid の組み立ては収集層(loadSkillEntries)が担う。
  // ここは一般技能から contact プレフィックスを絞るだけ
  return mergeContactEntries(await loadSkillEntries(SKILL_PACKS.general));
}

/**
 * コネ技能の索引を組み立てる純粋部。辞典とワールドで**同じ絞り込み条件**を使い(一般技能の
 * 固有名詞技能かつ識別キーが contact プレフィックス)、同じ識別キーは**辞典を優先**する
 * ——識別キーは一意な参照なので衝突は重複であって上書きの意図ではなく、辞典側は全クライアントに
 * 見えるため解決が揃うから。並びは名前順で、出所によるグループ分けはしない(2026-08-12 裁定＝
 * 辞典優先で同一キーが畳まれる以上、分けても同名・別キーの区別にはならず意味がない)。
 * @param {Array<{identificationKey?:string, name?:string, generalSkillCategory?:string, uuid?:string}>} packEntries
 * @param {Array<{identificationKey?:string, name?:string, generalSkillCategory?:string, uuid?:string}>} worldEntries
 * @returns {Map<string, {name: string, uuid: string}>}
 */
export function mergeContactEntries(packEntries, worldEntries) {
  const isContact = (e) => e?.generalSkillCategory === "onomasticSkill"
    && idKeyPrefix(e?.identificationKey) === "contact";
  const byKey = new Map();
  // 辞典を先に入れ、既にあるキーはワールド側で上書きしない(=辞典優先)
  for (const e of [...(packEntries ?? []), ...(worldEntries ?? [])]) {
    if (!isContact(e) || byKey.has(e.identificationKey)) continue;
    byKey.set(e.identificationKey, { name: e.name ?? "", uuid: e.uuid ?? "" });
  }
  const sorted = [...byKey].sort(([ka, a], [kb, b]) =>
    a.name.localeCompare(b.name, "ja") || ka.localeCompare(kb));
  return new Map(sorted);
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
 * 一般技能辞典の「識別キー→現在名」逆引き Map を返す(14-7)。識別キー参照の表示解決
 * (シーン指定技能チップ・情報項目の技能行など)に共用する。
 * @returns {Promise<Map<string,string>>}
 */
export async function loadGeneralSkillNameByKey() {
  const general = await loadSkillEntries(SKILL_PACKS.general);
  return new Map(general.map(e => [e.identificationKey, e.name]));
}

/**
 * 固有名詞技能名から小分類の接頭(「社会：」)を落とす。接頭を持たない辞典名はそのまま返す。
 * @param {string} name 辞典名
 * @param {string} category 小分類ラベル(ONOMASTIC_TYPES の値)
 * @returns {string}
 */
export function stripSkillCategory(name, category) {
  const s = String(name ?? "");
  for (const sep of ["：", ":"]) {
    if (s.startsWith(`${category}${sep}`)) return s.slice(category.length + sep.length);
  }
  return s;
}

/**
 * 識別キーの列を表示名(〈〉囲い)の列に整形する。**同じ小分類の固有名詞技能は一つに束ねる**
 * (2026-08-09 ユーザー指示): 社会が2つなら〈社会：N◎VA、ストリート〉・コネが2つなら
 * 〈コネ：キース・シュナイダー、エウラリア〉。束ねる位置はその小分類の初出位置、小分類を持たない
 * 技能(無条件取得技能)は個別に並ぶ。逆引きできないキーは落とす(生キーは表示しない)。
 * @param {Array<string>} keys 識別キーの列
 * @param {Map<string,string>} nameByKey 識別キー→辞典名(loadGeneralSkillNameByKey)
 * @returns {Array<string>} 「〈…〉」の列
 */
export function formatGroupedSkillNames(keys, nameByKey) {
  const groups = [];
  const byPrefix = new Map();
  for (const key of keys ?? []) {
    const name = nameByKey?.get(key);
    if (!name) continue;
    const prefix = idKeyPrefix(key);
    const category = ONOMASTIC_TYPES[prefix];
    if (!category) {
      groups.push({ category: "", parts: [name] });
      continue;
    }
    let group = byPrefix.get(prefix);
    if (!group) {
      group = { category, parts: [] };
      byPrefix.set(prefix, group);
      groups.push(group);
    }
    group.parts.push(stripSkillCategory(name, category));
  }
  return groups.map(g => formatSkillName(
    g.category ? `${g.category}：${g.parts.join("、")}` : g.parts[0]));
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
