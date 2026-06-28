/**
 * @fileoverview 技能チェーン解決(用途設定時)。
 *
 * スタイル技能の「技能」(comboSkill)欄を辿り、用途のベース/コンボの既定値と必須参加技能を確定する純関数。
 * 判定起動時には解決しない(用途で解決済みを使う)方針に従い、用途設定時にここで baseSkillRef / skillRefs の
 * 既定値を算出し、ベースが入れ替わった際の「必須技能の自動コンボ追加」や「、候補の制限」に必要な情報も返す。
 * Foundry 非依存(テスト可能)。
 *
 * 確定ルール(ユーザー確定):
 * - 起点 S の「技能」が単一技能名 X を指す間、X を辿る(例 S→守護天使→心理)。
 * - 「&」結合の複数指定は両方とも必須なので、単一技能名と同じく自動固定の対象(必須グループ)。
 *   「、」結合(任意の複数。どれか1つでよい)は対象外で、候補制限(alternativeComboNames)で扱う。
 * - 停止＝ベース確定: 辿り着いた技能が「アクション技能」または「技能欄が必須グループでない」とき、それがベース。
 * - 「&」グループにアクション技能が含まれるとき: そのアクション技能をベース、他メンバー＋起点をコンボに。
 * - 「&」グループが全員非アクション: どちらもベースになりうるためベース未確定(manual=true)。自動固定も自動コンボもしない。
 *   (起点自体がアクション技能ならループ冒頭で起点がベースになる)
 * - 代用: 各段で本体キー優先・本体が無ければ代用技能で解決(代用は本体のフォールバック)。
 * - mandatoryKeys: 必ず組み合わせなければならない参加技能の全集合。ベースもここに含まれる。
 *   用途エディタは「ベース以外の mandatoryKeys を必ずコンボに入れる(はじき出し時の自動追加)」enforcement に使う。
 */

import { isWholeCategoryToken } from "./skill-dictionary.mjs";

/** comboSkill から、意味のあるエントリ(blank/none を除く)を返す内部ヘルパー。 */
function meaningfulEntries(comboSkill) {
  const list = Array.isArray(comboSkill) ? comboSkill : [];
  return list.filter((e) => e?.value && e.value !== "blank" && e.value !== "none");
}

/** エントリ群が全て具体技能名(カテゴリ全体トークンでない skillName)か。 */
function allConcreteSkillNames(entries) {
  return entries.length > 0 && entries.every((e) => e.value === "skillName" && e.name && !isWholeCategoryToken(e.name));
}

/**
 * comboSkill が「必須の組み合わせ(単一技能名 または & 結合の複数)」を指すなら、その識別キー配列を返す。
 * - 単一の具体技能名 → [X]
 * - & 結合(2件目以降が全て isMandatory の具体技能名) → [X, Y, ...]
 * - 「、」結合(任意の複数)・カテゴリ全体・任意・単独・なし → []
 * @param {Array} comboSkill
 * @returns {string[]}
 */
export function mandatoryComboNames(comboSkill) {
  const meaningful = meaningfulEntries(comboSkill);
  if (!allConcreteSkillNames(meaningful)) return [];
  if (meaningful.length > 1 && !meaningful.slice(1).every((e) => e.isMandatory === true)) return [];
  return meaningful.map((e) => e.name);
}

/**
 * comboSkill が「、」結合(どれか1つを組み合わせればよい複数の具体技能名)を指すなら、その識別キー配列を返す。
 * (必須グループ＝全て & のときは [] を返す。1件のみのときも [] ＝候補制限の対象でない)
 * @param {Array} comboSkill
 * @returns {string[]}
 */
export function alternativeComboNames(comboSkill) {
  const meaningful = meaningfulEntries(comboSkill);
  if (meaningful.length < 2 || !allConcreteSkillNames(meaningful)) return [];
  if (meaningful.slice(1).every((e) => e.isMandatory === true)) return []; // 全て& → 必須グループ(候補制限でない)
  return meaningful.map((e) => e.name);
}

/**
 * comboSkill が「単一の特定技能名」を指すならその識別キー、そうでなければ null。
 * @param {Array} comboSkill
 * @returns {string|null}
 */
export function singleComboSkillName(comboSkill) {
  const names = mandatoryComboNames(comboSkill);
  return names.length === 1 ? names[0] : null;
}

/**
 * 技能チェーン解決(用途設定時)。起点 root の「技能」欄を必須グループで辿り、ベースの既定値と必須参加技能を確定する。
 * 各段は本体キー優先・無ければ代用技能で解決する。
 *
 * @param {{key:string, isAction:boolean, comboSkill:Array}} root 起点のスタイル技能
 * @param {(key:string)=>({key:string,isAction:boolean,comboSkill:Array}|null)} lookupOwn 識別キー→actor 所持の本体技能
 * @param {(key:string)=>({key:string,isAction:boolean,comboSkill:Array}|null)} lookupSubstitute 識別キー→actor 所持の代用技能(本体が無いとき)
 * @returns {{baseKey:string|null, comboKeys:string[], mandatoryKeys:string[], manual:boolean, defect:string|null}}
 *   baseKey/comboKeys: 既定で自動設定する値(manual のとき baseKey=null・comboKeys=[])。
 *   mandatoryKeys: 必ず組み合わせる参加技能の全集合(ベース含む)。
 *   manual: 非アクション&でベース未確定。defect: 辿る先が解決できないときの不足キー(成功時 null)。
 */
export function resolveSkillChain(root, lookupOwn, lookupSubstitute) {
  const resolve = (key) => lookupOwn(key) ?? lookupSubstitute(key);
  const participants = [root];     // 参加技能(オブジェクト)。順序つき。ベースもここに含まれる
  const seen = new Set([root.key]);
  const leaves = [];               // 必須グループを持たない末端(キー)
  const designatedBy = new Map([[root.key, root.key]]); // 参加技能キー → それを名指した「技能」キー(ベース候補算出用)
  let usedAndGroup = false;
  let defect = null;

  // 「技能」欄(必須グループ)を再帰的に辿り、参加技能を全て集める。アクション技能でも辿る
  // (「技能」＝組み合わせ相手なので、アクション技能の組み合わせ相手も必須コンボ。ベースは別途決める)。
  const visit = (skill) => {
    if (defect) return;
    const names = mandatoryComboNames(skill.comboSkill);
    if (names.length === 0) { leaves.push(skill.key); return; }
    if (names.length > 1) usedAndGroup = true;
    for (const name of names) {
      if (defect) return;
      const next = resolve(name);
      if (!next) { defect = name; return; }
      if (seen.has(next.key)) continue; // 循環・既出はスキップ
      seen.add(next.key);
      designatedBy.set(next.key, name); // この参加技能は「技能」キー name に名指された(代用解決でも指定キーを保持)
      participants.push(next);
      visit(next);
    }
  };
  visit(root);

  if (defect) return { baseKey: null, comboKeys: [], mandatoryKeys: [], manual: false, baseLocked: false, defect };

  const mandatoryKeys = participants.map((p) => p.key);
  const actionPart = participants.find((p) => p.isAction);

  let baseKey = null;
  let manual = false;
  if (actionPart) baseKey = actionPart.key;        // アクション技能は必ずベース(他は全てコンボ)。他はベースになれない
  else if (usedAndGroup) manual = true;            // & で全員非アクション → ベース未確定(手動)
  else baseKey = leaves[0] ?? root.key;            // 純線形 → 末端がベース

  return {
    baseKey: manual ? null : baseKey,
    baseDesignatedKey: manual ? null : (designatedBy.get(baseKey) ?? baseKey), // ベースを名指した「技能」キー(代用候補の照合先)
    comboKeys: manual ? [] : mandatoryKeys.filter((k) => k !== baseKey),
    mandatoryKeys,
    manual,
    baseLocked: !!actionPart,                       // アクション技能がチェーンにある＝ベースは指定技能＋その代用に限定
    defect: null,
  };
}

/**
 * resolveSkillChain を actor の技能アイテムに橋渡しする。識別キーを actor 所持アイテムの id に解決し、
 * 用途エディタが使う {ベースid, コンボid, 必須id, 「、」候補id, manual, defect} を返す。
 * 代用は substituteTarget(代用先識別キー配列)で引く。
 *
 * @param {{id:string, identificationKey:string, isAction:boolean, comboSkill:Array}} rootItem 用途を持つスタイル技能(正規化)
 * @param {Array<{id:string, identificationKey:string, isAction:boolean, isSubstitute:boolean, substituteTarget:string[], comboSkill:Array}>} skillItems actor の技能アイテム(正規化)
 * @returns {{baseItemId:string|null, comboItemIds:string[], mandatoryItemIds:string[], alternativeItemIds:string[], manual:boolean, defect:string|null}}
 */
/** rootItem＋skillItems から解決用ルックアップ群を組み立てる(resolveUsageSkills / comboLockAnalysis 共用)。 */
function buildResolver(rootItem, skillItems) {
  const byKey = new Map();
  for (const s of skillItems) if (s.identificationKey && !byKey.has(s.identificationKey)) byKey.set(s.identificationKey, s);
  byKey.set(rootItem.identificationKey, rootItem); // 起点は編集中アイテム自身を確実に引く
  const byId = new Map(skillItems.map((s) => [s.id, s]));
  byId.set(rootItem.id, rootItem);

  const subsByTarget = new Map(); // 代用先キー → [代用アイテム]
  for (const s of skillItems) {
    if (!s.isSubstitute) continue;
    for (const t of (s.substituteTarget ?? [])) {
      if (!subsByTarget.has(t)) subsByTarget.set(t, []);
      subsByTarget.get(t).push(s);
    }
  }

  const view = (s) => (s ? { key: s.identificationKey, isAction: !!s.isAction, comboSkill: s.comboSkill } : null);
  const lookupOwn = (key) => view(byKey.get(key));
  const lookupSubstitute = (key) => view((subsByTarget.get(key) ?? [])[0]);
  const idOf = (key) => byKey.get(key)?.id ?? null;
  // あるキーの「本体＋それを代用する技能」の id 群(本体優先で先頭・重複排除)
  const candidatesFor = (key) => {
    const out = [];
    if (key && byKey.has(key)) out.push(byKey.get(key).id);
    for (const sub of (subsByTarget.get(key) ?? [])) out.push(sub.id);
    return [...new Set(out)];
  };
  const chainOf = (item) => resolveSkillChain(view(item), lookupOwn, lookupSubstitute);
  const chainIds = (item) => chainOf(item).mandatoryKeys.map(idOf).filter(Boolean);
  return { byKey, byId, idOf, candidatesFor, chainOf, chainIds };
}

export function resolveUsageSkills(rootItem, skillItems, seedComboIds = []) {
  const { byKey, byId, idOf, candidatesFor, chainOf } = buildResolver(rootItem, skillItems);
  const r = chainOf(rootItem);

  // 必須クロージャ: 起点の連鎖に加え、現在の組み合わせ技能(seed)それぞれの連鎖も推移的に含める
  // (例: 技能:白兵 の用途に 技能:電脳 の技能を組み合わせたら、電脳も必須コンボに入る)
  const mandatoryKeys = new Set(r.mandatoryKeys);
  for (const id of seedComboIds) {
    const seed = byId.get(id);
    if (!seed) continue;
    const sr = chainOf(seed);
    if (sr.defect) { if (seed.identificationKey) mandatoryKeys.add(seed.identificationKey); continue; }
    for (const k of sr.mandatoryKeys) mandatoryKeys.add(k);
  }

  // ベース再決定: 全クロージャ(起点＋seed の連鎖)にアクション技能があればそれがベース。
  // 起点連鎖だけでなく、組み合わせに足した技能が連れ込んだアクション技能も反映する。
  let baseKey = r.baseKey;
  let baseDesignatedKey = r.baseDesignatedKey;
  let baseLocked = r.baseLocked;
  let manual = r.manual;
  if (!baseLocked) {
    for (const k of mandatoryKeys) {
      if (byKey.get(k)?.isAction) { baseKey = k; baseDesignatedKey = k; baseLocked = true; manual = false; break; }
    }
  }

  const ids = (keys) => keys.map(idOf).filter(Boolean);
  // 「、」候補: 指定技能の本体＋その代用(どれか1つコンボに入るまで候補制限に使う)
  const altIds = [];
  for (const k of alternativeComboNames(rootItem.comboSkill)) altIds.push(...candidatesFor(k));

  return {
    baseItemId: baseKey ? idOf(baseKey) : null,
    baseCandidateItemIds: candidatesFor(baseDesignatedKey), // ベース候補(指定技能＋その代用)。本体優先で先頭
    comboItemIds: ids(r.comboKeys),
    mandatoryItemIds: ids([...mandatoryKeys]),
    alternativeItemIds: [...new Set(altIds)],
    manual,
    baseLocked,
    defect: r.defect,
  };
}

/**
 * 組み合わせトリムダイアログ用の解析。ベース連鎖の必須 id と、各組み合わせ技能の連鎖 id を返す。
 * @returns {{rootMandatoryIds:string[], comboChains:Record<string,string[]>}}
 */
export function comboLockAnalysis(rootItem, skillItems, comboIds) {
  const { byId, chainIds } = buildResolver(rootItem, skillItems);
  const rootMandatoryIds = chainIds(rootItem);
  const comboChains = {};
  for (const id of comboIds) {
    const it = byId.get(id);
    comboChains[id] = it ? chainIds(it) : [id];
  }
  return { rootMandatoryIds, comboChains };
}

/**
 * トリムダイアログ: comboId が「外せない(必須)」か。ベース連鎖に含まれる、または残す(kept)他の技能の
 * 連鎖に含まれるとき true。削除予定(kept から外した)技能の連鎖は要求から外れる。
 */
export function isComboRequired(comboId, keptIds, rootMandatoryIds, comboChains) {
  if (rootMandatoryIds.includes(comboId)) return true;
  for (const b of keptIds) {
    if (b === comboId) continue;
    if ((comboChains[b] ?? []).includes(comboId)) return true;
  }
  return false;
}
