/**
 * @fileoverview コンディション(BS・戦闘不能)の kind レジストリと適用ヘルパー(フェーズ9-4)。
 *
 * 設計正本: llm-wiki/01_Wiki/Game_Mechanics/Conditions.md
 *
 * condition は自己完結する実体: 同一性(status id / conditionKind / 回復) ＋ 可変効果値
 * (condition 専用フラグ)。効果値は汎用 changes でなく condition 専用フィールドで設定し、
 * **コードが kind ＋効果値を読んで適用**する(アイテムバフ v2 とは別系統)。
 *
 * 本モジュールは純粋関数(Foundry 非依存)に徹し、actor / item / targets の解決は呼び出し側で行う。
 */

import { buildDamageStates } from "../data/damage-chart.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * condition の効果型。
 * - numeric:      数値修正(コードが派生値/判定に加算)。酩酊・衰弱
 * - block:        行動制限(数値でない遮断)。恐慌・重圧・捕縛・気絶 等
 * - computed:     計算型(所持物等から算出)。電子妨害
 * - continuous:   継続ダメージ(発火は13/12)。邪毒
 * - attackTarget: 条件付き攻撃判定デバフ(対象UUID照合)。萎縮・憎悪
 * - terminal:     終端マーカー(キャラロスト)。完全死亡 等
 * - wound:        負傷(ダメージチャート)。直接効果は持たず inflicts/notes で表す
 *
 * group(ドロップダウンのグルーピング): "bs" / "incapacitation" / "physical" / "mental" / "social"。
 */
// キーは CONFIG.statusEffects の id と一致(conditionKind = status id)。Bad_Status.md 準拠。
// 効果値は「固定(fixedMagnitude=欄なし)」と「可変(magnitudeField/abilityField/targetField/
// weaponField=詳細タブ)」を区別。重複可否(stackable)は BS ごとにルール固定(切替不可)。
// apply: "checkAndControl" / "control"。inflicts: 付与時に自動付与する別状態(汎用カスケード)。
// 統合順(ユーザー確定 2026-06-23): BS → 戦闘不能 → 肉体 → 精神 → 社会。
const BS_AND_INCAPACITATION = {
  // --- バッドステータス(group: "bs") ---
  "panic":        { label: "恐慌",     group: "bs", img: "icons/svg/terror.svg",    type: "block", block: "reaction",     stackable: false },
  "poison":       { label: "邪毒",     group: "bs", img: "icons/svg/poison.svg",     type: "continuous", magnitudeField: true, stackable: false },
  // 重圧: 能力値は指定/未指定(受ける際に引く)あり。abilityField 空欄可(空欄=指定なし=カードで決定)。
  "pressure":     { label: "重圧",     group: "bs", img: "icons/svg/down.svg",       type: "block", block: "abilityCheck", abilityField: "optional", abilityBlankLabel: "指定なし（カードで決定）", stackable: false },
  // 衰弱: 数字なし=引いたスート1つの制御値を引いた数字分(対象・数字とも引く)/ (-数字)=全制御値。
  // 対象は選択でなく引いて決まるため abilityField なし。当面 magnitude のみ(空欄=全制御)。
  "weakness":     { label: "衰弱",     group: "bs", img: "icons/svg/degen.svg",      type: "numeric", apply: "control", magnitudeField: true, stackable: true },
  "capture":      { label: "捕縛",     group: "bs", img: "icons/svg/net.svg",        type: "block", block: "attackWith", weaponField: true, stackable: true },
  // 酩酊: 減少量は固定(小-2 / 大-5)。小↔大は別BSで重なる。
  "doped-major":  { label: "酩酊(大)", group: "bs", img: "icons/svg/daze.svg",       type: "numeric", apply: "checkAndControl", fixedMagnitude: 5, stackable: false },
  "doped-minor":  { label: "酩酊(小)", group: "bs", img: "icons/svg/sleep.svg",      type: "numeric", apply: "checkAndControl", fixedMagnitude: 2, stackable: false },
  // 萎縮/憎悪: -5 固定。対象(targetUuid)のみ可変。萎縮=対象ごと重複、憎悪=非重複。
  "fear":         { label: "萎縮",     group: "bs", img: "icons/svg/cowled.svg",     type: "attackTarget", targetMode: "include", penalty: 5, targetField: true, stackable: true },
  "hatred":       { label: "憎悪",     group: "bs", img: "icons/svg/fire.svg",       type: "attackTarget", targetMode: "exclude", penalty: 5, targetField: true, stackable: false },
  "interference": { label: "電子妨害", group: "bs", img: "icons/svg/lightning.svg",  type: "computed", magnitudeField: true, stackable: false },
  // 狼狽: ムーブ不可＋メジャー達成値-10(回復=マイナー)。メジャー/ムーブは行動系=13 前提のため器のみ。
  "confusion":    { label: "狼狽",     group: "bs", img: "icons/svg/explosion.svg",  type: "block", block: "move", stackable: false },
  // --- 戦闘不能(group: "incapacitation"。発火=メインプロセス不可は13・回復は15。効果値なし・非重複) ---
  "faint":      { label: "気絶",     group: "incapacitation", img: "icons/svg/unconscious.svg", type: "block", block: "mainProcess", stackable: false },
  "swoon":      { label: "失神",     group: "incapacitation", img: "icons/svg/unconscious.svg", type: "block", block: "mainProcess", stackable: false },
  "coma":       { label: "仮死",     group: "incapacitation", img: "icons/svg/skull.svg",       type: "block", block: "mainProcess", terminalPending: true, stackable: false },
  "stupor":     { label: "昏睡",     group: "incapacitation", img: "icons/svg/skull.svg",       type: "block", block: "mainProcess", terminalPending: true, stackable: false },
  "dead":       { label: "完全死亡", group: "incapacitation", img: "icons/svg/blood.svg",       type: "terminal", stackable: false },
  "mind-break": { label: "精神崩壊", group: "incapacitation", img: "icons/svg/blood.svg",       type: "terminal", stackable: false },
  "erased":     { label: "抹殺",     group: "incapacitation", img: "icons/svg/blood.svg",       type: "terminal", stackable: false }, // 社会(適用はセッション終了後)
};

/**
 * 全コンディション(BS → 戦闘不能 → 肉体 → 精神 → 社会)の統合レジストリ。
 * 負傷状態(肉体/精神/社会)は damage-chart.mjs から取り込む(buildDamageStates)。
 */
export const CONDITION_KINDS = Object.freeze({ ...BS_AND_INCAPACITATION, ...buildDamageStates() });

/** group キー → 表示ラベル(ドロップダウンのグループ見出し)。 */
export const CONDITION_GROUP_LABELS = Object.freeze({
  bs:             "バッドステータス",
  incapacitation: "戦闘不能",
  physical:       "肉体ダメージ",
  mental:         "精神ダメージ",
  social:         "社会ダメージ",
});

/**
 * AE が持つ condition 種別を**すべて**返す。1 つの ActiveEffect は複数の状態(statuses)を
 * 持てるため、該当する status id を漏れなく集める(フェーズ9-4)。`flags…conditionKind` は
 * フォールバック。CONFIG.statusEffects の独自 flags が付与時に伝播しない環境でも status id から得る。
 * @param {object} effect ActiveEffect(statuses / flags)
 * @returns {string[]} CONDITION_KINDS のキー配列
 */
export function getConditionKinds(effect) {
  const out = [];
  const st = effect?.statuses;
  const ids = st instanceof Set ? [...st] : (Array.isArray(st) ? st : []);
  for (const id of ids) if (CONDITION_KINDS[id] && !out.includes(id)) out.push(id);
  const flagKind = effect?.flags?.[SCOPE]?.conditionKind;
  if (flagKind && CONDITION_KINDS[flagKind] && !out.includes(flagKind)) out.push(flagKind);
  return out;
}

/** AE の代表 condition 種別(先頭)。複数判定が不要な箇所の簡便用。 */
export function getConditionKind(effect) {
  return getConditionKinds(effect)[0] ?? null;
}

/**
 * ActiveEffect が持つ condition 設定を**配列**で返す(状態1つにつき1要素)。
 * 効果値は **kind 別キー** `flags.tokyo-nova-axleration.conditions[<kind>]` に保持する
 * (複数状態を1 AE に載せても各々別に設定できる)。旧フラットフラグはフォールバックで読む。
 * @param {object} effect ActiveEffect(name / active / statuses / flags / id)
 * @returns {Array<object>}
 */
export function readConditions(effect) {
  const f = effect?.flags?.[SCOPE] ?? {};
  const perKind = f.conditions ?? {};
  return getConditionKinds(effect).map(kind => {
    const def = CONDITION_KINDS[kind] ?? null;
    const v = perKind[kind] ?? {};
    // 効果量: 固定(fixedMagnitude)があればそれ。無ければ可変フラグ。
    const magnitude = def?.fixedMagnitude !== undefined
      ? def.fixedMagnitude
      : (Number(v.magnitude ?? f.magnitude ?? 0) || 0);
    return {
      kind,
      label:         def?.label ?? kind,
      def,
      name:          effect.name || def?.label || "(無名効果)",
      identity:      `${effect.id ?? ""}:${kind}`,
      active:        effect.active !== false,
      stackable:     def?.stackable === true, // BS ごとにルール固定(切替不可)
      magnitude,
      targetAbility: v.targetAbility || f.targetAbility || null,
      targetUuid:    v.targetUuid || f.targetUuid || null,
      targetMode:    def?.targetMode ?? null,
      durationUnit:  v.durationUnit ?? f.durationUnit ?? null,
    };
  });
}

/** AE の代表 condition(先頭)。後方互換・単一前提の簡便用。 */
export function readCondition(effect) {
  return readConditions(effect)[0] ?? null;
}

/**
 * ある状態(kind)が `inflicts` で付与する別状態の **ActiveEffect 生成データ**を返す(フェーズ9-4)。
 * 状態のみ(changes なし=コンディション)＋必要フラグ。ダメージ/カスケード由来は hideFromList=true で
 * AE 本体をリスト非表示(供給元が浮くため。状態アイコンは出る)。純粋関数(Foundry 非依存)。
 *
 * - ability:        付与状態の targetAbility(重圧の理性 等)
 * - controlNegate:  当面はそのまま付与し、`pendingControlNegate` フラグで保持(制御判定での無効/降格は
 *                   制御判定機構＝後続が解決)
 * - duration:       `durationNote` フラグで保持(失効発火は13/15)
 *
 * @param {string} kind
 * @param {{hidden?:boolean}} [opts]
 * @returns {Array<object>} createEmbeddedDocuments("ActiveEffect", ...) 用のデータ配列
 */
export function buildInflictedEffectsData(kind, { hidden = true } = {}) {
  const def = CONDITION_KINDS[kind];
  const out = [];
  for (const inf of (def?.inflicts ?? [])) {
    const idef = CONDITION_KINDS[inf.kind];
    if (!idef) continue;
    const cond = {};
    if (inf.ability) cond.targetAbility = inf.ability;
    if (inf.duration) cond.durationNote = inf.duration;
    if (inf.controlNegate) cond.pendingControlNegate = inf.controlNegate;
    const flags = { conditionKind: inf.kind, hideFromList: hidden };
    if (Object.keys(cond).length) flags.conditions = { [inf.kind]: cond };
    out.push({
      name:     idef.label,
      img:      idef.img ?? "icons/svg/aura.svg",
      statuses: [inf.kind],
      flags:    { [SCOPE]: flags },
    });
  }
  return out;
}

/**
 * 重複排除(同一効果の重複適用不可)を施した値リストを返す共通処理。
 * 非 stackable は identity ごとに最も有利(最大)1つ、stackable は全て。
 * ここでの value は「ペナルティ量(正)」を想定し、最大採用＝最も重いペナルティ。
 * @param {Array<{identity:string, stackable:boolean, name:string, value:number}>} entries
 * @returns {Array<{name:string, value:number}>}
 */
function dedupeEntries(entries) {
  const byIdentity = new Map();
  const stackables = [];
  for (const e of entries) {
    if (e.stackable) stackables.push({ name: e.name, value: e.value });
    else {
      const prev = byIdentity.get(e.identity);
      if (!prev || e.value > prev.value) byIdentity.set(e.identity, { name: e.name, value: e.value });
    }
  }
  return [...byIdentity.values(), ...stackables];
}

/**
 * 判定への condition 由来の達成値修正を {name, value} で返す(value は符号付き＝ペナルティは負)。
 * 判定バフ(アイテム)の内訳と統合してチャート表示・達成値合算に用いる。
 *
 * 扱う型:
 * - numeric(酩酊): apply に "Check" を含む kind は**上方判定のみ** -magnitude。
 * - attackTarget(萎縮/憎悪): isAttack かつ対象照合一致時 -penalty(照合は呼び出し側が解決し
 *   targetMatched を渡す)。
 * computed(電子妨害)の算出値は呼び出し側で magnitude 相当を解決し本関数に numeric として渡す。
 *
 * @param {Array<object>} conditions readCondition() 済みの配列
 * @param {{upward:boolean, isAttack:boolean, targetMatched:boolean}} ctx
 * @returns {Array<{name:string, value:number}>}
 */
export function gatherConditionCheckSources(conditions, ctx) {
  const entries = [];
  // condition の非 stackable は「同じ kind は重複しない」(同名 BS は複数発生しない)。
  // よって dedup キーは effect identity でなく **kind**。stackable(萎縮等)は重ねる。
  for (const c of (conditions ?? [])) {
    if (!c || !c.active) continue;
    // 数値修正型: 上方判定の達成値に -magnitude(制御は派生側で別途)
    if (c.def?.type === "numeric" && /check/i.test(c.def?.apply ?? "")) {
      if (ctx?.upward && c.magnitude) {
        entries.push({ identity: c.kind, stackable: c.stackable, name: c.name, value: -c.magnitude });
      }
    }
    // 条件付き攻撃判定デバフ(萎縮/憎悪)
    if (c.def?.type === "attackTarget" && ctx?.isAttack) {
      const hit = c.targetMode === "include" ? ctx.targetMatched : !ctx.targetMatched;
      if (hit) {
        entries.push({ identity: c.kind, stackable: c.stackable, name: c.name, value: -(c.def.penalty ?? 0) });
      }
    }
  }
  // ペナルティは絶対値の大きい方＝最も不利を最大採用するため、いったん正に変換して dedupe
  const deduped = dedupeEntries(entries.map(e => ({ ...e, value: Math.abs(e.value) })));
  return deduped.map(e => ({ name: e.name, value: -e.value }));
}

/**
 * condition による制御値の減少量を返す。`apply` に "control" を含む numeric 型。
 * - `targetAbility` 指定あり(衰弱の数字なし)→ その能力値のみ。
 * - 指定なし(衰弱(-数字)・酩酊)→ 全制御値(`all`)。
 * 非 stackable(酩酊)は同 kind で重複排除、stackable(衰弱)は重ねる。
 * @param {Array<object>} conditions readConditions() 済みの配列
 * @returns {{all:number, byAbility:Object<string,number>}} 正の減少量
 */
export function gatherConditionControlPenalty(conditions) {
  const allEntries = [];
  const abilityEntries = {};
  for (const c of (conditions ?? [])) {
    if (!c?.active) continue;
    if (c.def?.type !== "numeric" || !/control/i.test(c.def?.apply ?? "") || !c.magnitude) continue;
    const entry = { identity: c.kind, stackable: c.stackable, name: c.name, value: c.magnitude };
    if (c.targetAbility) (abilityEntries[c.targetAbility] ??= []).push(entry);
    else allEntries.push(entry);
  }
  const sum = (es) => dedupeEntries(es).reduce((s, e) => s + e.value, 0);
  const byAbility = {};
  for (const [ab, es] of Object.entries(abilityEntries)) byAbility[ab] = sum(es);
  return { all: sum(allEntries), byAbility };
}

/** 電子妨害がアウトフィット個数を数えるカテゴリ(武器/サイバーウェア/トロン=大、アーマーギア/サイコアプリ=小)。 */
const JAMMING_MAJOR = ["weapon", "cyberware", "tron"];
const JAMMING_MINOR = ["armorGear", "psychoApp"];
/** ウェットのアウトフィット識別キー(辞典の実値に合わせる。フェーズ17 で確定)。 */
export const WET_IDENT_KEY = "wet";

/**
 * 電子妨害(強度 n)による全(上方)判定へのマイナス量を算出する(正の値)。Conditions §3③。
 * 準備中アウトフィットの記述子配列から計算する純粋関数(actor/item 解決は呼び出し側)。
 *
 * - 該当(対象カテゴリ＋電制≤n)の準備アウトフィット個数を数える(上限10)。
 * - 該当する全身義体(fullCyborg)・ヴィークルを準備、または該当タップ(tap)でゴースト登場中 → 10。
 * - ウェット(準備中に WET_IDENT_KEY あり)かつ該当1個以上 → 1。
 * - それ以外 → min(個数, 10)。
 *
 * @param {number} n 強度
 * @param {Array<{majorCategory:?string, minorCategory:?string, hack:?number, identKey:?string}>} preparedOutfits
 * @param {{isGhost?:boolean}} [opts]
 * @returns {number} マイナス量(正)
 */
export function computeJammingPenalty(n, preparedOutfits, { isGhost = false } = {}) {
  const list = preparedOutfits ?? [];
  const withinHack = (o) => typeof o.hack === "number" && o.hack <= n;
  const inScope = (o) =>
    JAMMING_MAJOR.includes(o.majorCategory) || JAMMING_MINOR.includes(o.minorCategory);

  const counted = list.filter(o => inScope(o) && withinHack(o));
  const count = counted.length;

  // −10 分岐: 該当(電制≤n)の全身義体・ヴィークル準備、または該当タップでゴースト登場中
  const heavy = list.some(o => withinHack(o) && (o.minorCategory === "fullCyborg" || o.majorCategory === "vehicle"))
    || (isGhost && list.some(o => withinHack(o) && o.minorCategory === "tap"));
  if (heavy) return 10;

  // ウェット分岐
  const isWet = list.some(o => o.identKey === WET_IDENT_KEY);
  if (isWet) return count >= 1 ? 1 : 0;

  return Math.min(count, 10);
}

/**
 * 上方判定が condition により禁止されているかを返す(重圧)。
 * @param {Array<object>} conditions readCondition() 済みの配列
 * @param {{upward:boolean, ability:string}} ctx
 * @returns {{blocked:boolean, by:?string}} by は禁止した condition の表示名
 */
export function getCheckBlock(conditions, ctx) {
  if (!ctx?.upward) return { blocked: false, by: null };
  for (const c of (conditions ?? [])) {
    if (!c?.active) continue;
    if (c.def?.type === "block" && c.def?.block === "abilityCheck" && c.targetAbility === ctx.ability) {
      return { blocked: true, by: c.name };
    }
  }
  return { blocked: false, by: null };
}
