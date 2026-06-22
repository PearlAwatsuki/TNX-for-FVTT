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

const SCOPE = "tokyo-nova-axleration";

/**
 * condition の効果型。
 * - numeric:      数値修正(コードが派生値/判定に加算)。酩酊・衰弱
 * - block:        行動制限(数値でない遮断)。恐慌・重圧・捕縛・気絶 等
 * - computed:     計算型(所持物等から算出)。電子妨害
 * - continuous:   継続ダメージ(発火は13/12)。邪毒
 * - attackTarget: 条件付き攻撃判定デバフ(対象UUID照合)。萎縮・憎悪
 * - terminal:     終端マーカー(キャラロスト)。完全死亡 等
 */
// キーは CONFIG.statusEffects の id と一致させる(conditionKind = status id で一意化)。
// Bad_Status.md 準拠(2026-06-22)。効果値は「固定(fixedMagnitude=コード適用・欄なし)」と
// 「可変(magnitudeField/abilityField/targetField/weaponField=詳細タブで入力)」を区別する。
// 重複可否(stackable)は **BS ごとにルールで固定**(切替不可)。
// apply: "checkAndControl"(達成値＋制御値) / "control"(制御値のみ)。
export const CONDITION_KINDS = Object.freeze({
  // --- バッドステータス ---
  "panic":        { label: "恐慌",     type: "block", block: "reaction",     stackable: false },
  "poison":       { label: "邪毒",     type: "continuous", magnitudeField: true, stackable: false },
  "pressure":     { label: "重圧",     type: "block", block: "abilityCheck", abilityField: "required", stackable: false },
  // 衰弱: (数字なし)=対応スート1つの制御値を引いた数字分減 / (-数字)=全制御値をその数字分減。
  // abilityField=optional(空欄=全制御値)。両者とも重複する。
  "weakness":     { label: "衰弱",     type: "numeric", apply: "control", magnitudeField: true, abilityField: "optional", stackable: true },
  "capture":      { label: "捕縛",     type: "block", block: "attackWith", weaponField: true, stackable: true }, // 武器ごと
  // 酩酊: 達成値・全制御値の減少量は固定(小-2 / 大-5)。設定不可。小↔大は別BSで重なる。
  "doped-major":  { label: "酩酊(大)", type: "numeric", apply: "checkAndControl", fixedMagnitude: 5, stackable: false },
  "doped-minor":  { label: "酩酊(小)", type: "numeric", apply: "checkAndControl", fixedMagnitude: 2, stackable: false },
  // 萎縮/憎悪: -5 は固定。対象(targetUuid)のみ可変。萎縮=対象ごと重複、憎悪=ペナルティ非重複。
  "fear":         { label: "萎縮",     type: "attackTarget", targetMode: "include", penalty: 5, targetField: true, stackable: true },
  "hatred":       { label: "憎悪",     type: "attackTarget", targetMode: "exclude", penalty: 5, targetField: true, stackable: false },
  "interference": { label: "電子妨害", type: "computed", magnitudeField: true, stackable: false },
  // --- 戦闘不能(効果の発火＝メインプロセス不可は 13、回復は 15。9-4 は器のみ。効果値なし・非重複) ---
  "faint":      { label: "気絶",     type: "block", block: "mainProcess", stackable: false }, // 肉体
  "swoon":      { label: "失神",     type: "block", block: "mainProcess", stackable: false }, // 精神
  "coma":       { label: "仮死",     type: "block", block: "mainProcess", terminalPending: true, stackable: false }, // 肉体
  "stupor":     { label: "昏睡",     type: "block", block: "mainProcess", terminalPending: true, stackable: false }, // 精神
  "dead":       { label: "完全死亡", type: "terminal", stackable: false }, // 肉体
  "mind-break": { label: "精神崩壊", type: "terminal", stackable: false }, // 精神
  "erased":     { label: "抹殺",     type: "terminal", stackable: false }, // 社会(適用はセッション終了後)
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
