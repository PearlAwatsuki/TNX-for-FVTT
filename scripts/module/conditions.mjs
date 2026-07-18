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
import { parseEffectTargetKey, collectActorEffectBuffs, effectAutoApplies } from "../data/item/helpers.mjs";

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
  // 衰弱: 数字なし=引いたスート1つの制御値を引いた数字分/ (-数字)=全制御値。通常は引いて決まるが、
  // 手動編集(効果編集ダイアログ)で対象制御値も指定できるよう abilityField 追加(空=全制御値)。
  // 適用側は targetAbility 指定=その制御値のみ/未指定=全制御値を既に扱う(conditions.mjs §3①)。
  "weakness":     { label: "衰弱",     group: "bs", img: "icons/svg/degen.svg",      type: "numeric", apply: "control", magnitudeField: true, abilityField: "optional", stackable: true },
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
  // 支配(2026-07-12 ユーザー確定): 特殊な精神ダメージのタグ。支配されたキャラクターは RL 操作に
  // なる=自動化なしで運用できる範囲(type なし=行動ブロックもロスト処理も持たないマーカー)。
  // 付与は主にタグ改変 AE(damage.replaceTag/addTag)経由: 昏睡/精神崩壊の上書き・抹殺への追加。
  // 解除: 上書き由来=昏睡と同じ(治療目標値20・replacedFrom フラグが根拠)/追加由来=追加元の
  // チャートの治療と同時(woundSource 紐づきで除去)。
  "dominated":  { label: "支配",     group: "incapacitation", img: "icons/svg/padlock.svg",     stackable: false },
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
      targetWeapon:  v.targetWeapon || f.targetWeapon || null,
      // 負傷が使用不可/ペナルティにする「特定技能」の選択結果(社会/コネの付与時確定・識別キー)。
      // 固定技能(知覚/信用)は def 側に持つため、ここは選択型のみ埋まる。
      targetSkill:   v.targetSkill || f.targetSkill || null,
      // 次シーン発火の休眠: sceneDeferred な負傷は発火(=13/15 が sceneFired を立てる)まで休眠。
      // 付与経路に依らず def から導出する(instance フラグの設定漏れを避ける)。
      pendingScene:  def?.sceneDeferred === true && (v.sceneFired ?? f.sceneFired) !== true,
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
 * 適用中の負傷(等)が持つ部位スロット修正(partSlotMod)を集計する(2026-07-09/フェーズ12)。
 * 例: 肉体7「腕部損傷」= 片手持ち −1(適用中のみ・治療で負傷が消えれば戻る)。
 * 同種の負傷が複数あれば加算する(両腕損傷=−2 等)。
 * 入力は **実効コンディション行**(`getEffectiveConditions` の出力)。無効(active=false)・
 * **無視ゲート済み(effectIgnored)** の行は集計しない。合成は partSlotsEffective(character-base →
 * buildEffectivePartSlots)が行う。
 * @param {Array<object>} conditions readConditions + effectIgnored 済みの行(getEffectiveConditions)
 * @returns {Map<string, number>} 部位キー(旧データはラベル) → デルタ(負値)。照合はキー優先・ラベル後方互換
 */
export function gatherPartSlotMods(conditions) {
  const mods = new Map();
  for (const c of (conditions ?? [])) {
    if (!c || c.active === false || c.effectIgnored) continue;
    const m = c.def?.partSlotMod;
    if (m?.part) mods.set(m.part, (mods.get(m.part) ?? 0) + (Number(m.delta) || 0));
  }
  return mods;
}

// ───────── コンディション効果の無視ゲート(ignore.*・フェーズ12・ユーザー確定) ─────────
// 「自分が受けているコンディションの効果(数値ペナルティ・行動制限の両方)を消費段階で無視する」
// 対象自己ゲート。タグ・BS・負傷そのものは残す(除去しない)。正本キー: Active_Effects.md「無視ゲート」。
// 実効コンディションを実効果として読む箇所は必ず getEffectiveConditions を経由する(生の
// readConditions/actor.effects 直読みは ignore が効かない=readFlag と同じ「必ず経由」規約)。

/**
 * 無視ルール(parseEffectTargetKey の scope:"ignore")が、あるコンディションに一致するか(純関数)。
 * @param {{mode:string, group?:string, kind?:string, category?:?string}} rule
 * @param {{group?:?string, kind?:string, damageCategory?:?string}} ctx コンディションの分類/由来系統
 * @returns {boolean}
 */
export function ignoreRuleMatches(rule, { group, kind, damageCategory } = {}) {
  if (!rule) return false;
  switch (rule.mode) {
    case "all":    return true;
    case "group":  return rule.group === group;
    case "kind":   return rule.kind === kind;
    // ダメージ由来系統(無視は damageCategory があるときだけ・系統 null=全ダメージ由来)
    case "damage": return damageCategory !== null && damageCategory !== undefined
      && (rule.category === null || rule.category === damageCategory);
    default:       return false;
  }
}

/**
 * 正規形の effects(collectActorEffectBuffs 相当)から ignore.* ルールを集める(純関数)。
 * 各ルールに供給元(効果名 `source`)を添える(バッヂ tooltip「『〈供給元〉』により無視」用)。
 * @param {Array<{name?:string, active?:boolean, changes?:Array<{key:string}>}>} effectBuffs
 * @returns {Array<object>} parseEffectTargetKey の scope:"ignore" 結果 + { source }
 */
export function gatherIgnoreRules(effectBuffs) {
  const rules = [];
  for (const e of (effectBuffs ?? [])) {
    if (e?.active === false) continue;
    for (const c of (e?.changes ?? [])) {
      const p = parseEffectTargetKey(c?.key);
      if (p?.scope === "ignore") rules.push({ ...p, source: e?.name });
    }
  }
  return rules;
}

/**
 * アクターの実効コンディション一覧を返す唯一の正規アクセサ(フェーズ12)。各行(readConditions の要素)に
 * `effectIgnored`(その効果が ignore ゲートで無視されているか)を付与する。コンディションを**実効果として
 * 読む箇所は必ず本関数を経由**し、`effectIgnored` の行を飛ばす。存在自体(タグ・回復・治療・カスケード・
 * バッヂ表示)は別途 readConditions/actor.effects を使う(無視されても残るため)。
 * ダメージ由来系統は各効果の woundCategory(負傷自身)または woundSource→元負傷の woundCategory で辿る。
 * @param {Actor} actor
 * @returns {Array<object>} readConditions の各行 + { effectIgnored:boolean }
 */
export function getEffectiveConditions(actor) {
  const rules = gatherIgnoreRules(collectActorEffectBuffs(actor));
  // 負傷(woundCategory を持つ効果) id → 系統
  const woundCat = new Map();
  for (const e of (actor?.effects ?? [])) {
    const wc = e.flags?.[SCOPE]?.woundCategory;
    if (wc) woundCat.set(e.id, wc);
  }
  const out = [];
  const consume = (effect) => {
    if (effect?.disabled) return;
    const f = effect?.flags?.[SCOPE] ?? {};
    let damageCategory = f.woundCategory ?? null;
    if (!damageCategory && f.woundSource) damageCategory = woundCat.get(f.woundSource) ?? null;
    // 手動オーバーライド(卓ツール・バッヂのコンテキストメニュー): このインスタンスの効果を止める。
    // ignore.* AE ルールと同じ effectIgnored に合流する(第2ソース)。
    const manuallyIgnored = f.manuallyIgnored === true;
    for (const c of readConditions(effect)) {
      const group = c.def?.group ?? null;
      const matched = rules.filter(r => ignoreRuleMatches(r, { group, kind: c.kind, damageCategory }));
      // 供給元名(重複排除・tooltip 用)。ルール由来のみ(手動は別途 manuallyIgnored で示す)
      const ignoredBy = [...new Set(matched.map(r => r.source).filter(Boolean))].join("・");
      out.push({ ...c, effectIgnored: manuallyIgnored || matched.length > 0, ignoredBy, manuallyIgnored });
    }
  };
  for (const e of (actor?.effects ?? [])) consume(e);
  for (const item of (actor?.items ?? [])) {
    for (const e of (item.effects ?? [])) {
      if (!effectAutoApplies(e)) continue; // 使用時付与用ペイロードは自動では効かない
      consume(e);
    }
  }
  return out;
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
 * 回復対象範囲(用途の recoveryTargets 行 {group, kind})にタグが合致するか(純関数)。
 * group=CONDITION_KINDS の group 値(bs/incapacitation/physical/mental/social)・
 * kind 空=そのグループ全体。複数行は OR。
 * @param {string} kind
 * @param {Array<{group?:string, kind?:string}>} rows
 * @returns {boolean}
 */
export function recoveryKindMatches(kind, rows) {
  const def = CONDITION_KINDS[kind];
  if (!def) return false;
  return (rows ?? []).some(r => r?.group === def.group && (!r.kind || r.kind === kind));
}

/**
 * タグが回復の除外指定(用途の recoveryExcludes・ダメージ効果タグのキー配列)に当たるか(純関数)。
 * 「指定したタグを含むもの以外すべて」(2026-07-13 ユーザー確定)の表現:
 * 除外タグ自身に加え、**そのタグを与える負傷**(inflicts に含む。例: 除外=完全死亡なら斬首・
 * 頭部損傷も)を除外する。ルール上の通例は「完全死亡」「精神崩壊」を除外に設定する
 * (これらはダメージ全回復系でも治療不可=神業のみ。「抹殺」は未確定のため技能ごとの設定に委ねる)。
 * システムはハードコードで強制しない=技能を強制しない方針・除外は用途の設定が担う。
 * @param {string} kind
 * @param {string[]} excludes
 * @returns {boolean}
 */
export function recoveryKindExcluded(kind, excludes) {
  const ex = excludes ?? [];
  if (!ex.length) return false;
  if (ex.includes(kind)) return true;
  const def = CONDITION_KINDS[kind];
  return def?.type === "wound" && (def.inflicts ?? []).some(i => ex.includes(i.kind));
}

/**
 * ダメージインスタンスの kind 集合(負傷＋紐づき戦闘不能/支配)を、治療用途の回復範囲が治療できるか
 * (純関数・2026-07-18 治療の用途一本化)。いずれかの kind が範囲(recoveryTargets)に合致し、かつ
 * 除外(recoveryExcludes)に当たらなければ可。通常ダメージ用の治療用途は戦闘不能系タグを全て除外に
 * 入れる設定規約(2026-07-18 ユーザー確定)により、戦闘不能を伴うダメージは負傷 kind の除外展開
 * (recoveryKindExcluded の inflicts 展開)で自動的に脱落し、タグ側 kind に合致する用途だけが残る。
 * @param {{recoveryTargets?: Array<{group?:string, kind?:string}>, recoveryExcludes?: string[]}} usage
 * @param {string[]} kinds ダメージインスタンスの kind 集合
 * @returns {boolean}
 */
export function usageCanTreatKinds(usage, kinds) {
  return (kinds ?? []).some(k =>
    recoveryKindMatches(k, usage?.recoveryTargets)
    && !recoveryKindExcluded(k, usage?.recoveryExcludes));
}

/**
 * ダメージチャートのタグ改変(2026-07-12 ユーザー確定・支配タグの導入)を inflicts 生成データへ
 * 適用する(Foundry 非依存・純関数)。対象側の AE(damage.replaceTag.<元タグ>/damage.addTag.<元タグ>・
 * 値=CONDITION_KINDS のタグキー)で:
 * - replace: 付与されようとするタグを別のタグへ置き換える(例 昏睡/精神崩壊→支配)。
 *   置換後の効果に `replacedFrom`(元タグ)を記録する=上書き由来の支配は治療で「昏睡と同じ」
 *   (目標値20)とする根拠。チャート項目由来の条件(controlNegate 等)は新タグへ引き継ぐ
 *   (無効化条件はダメージ結果の性質として持ち越し=Code 既定・要調整なら見直し)。
 * - add: 元タグが付与されるとき追加のタグも付与する(例 抹殺に支配を追加)。`addedFrom` を記録。
 *   追加分も同じ負傷に紐づく(woundSource 付与は呼び出し側の共通処理)=追加元チャートの治療で
 *   同時に解除される(ユーザー裁定)。
 * 未知のタグキー(CONDITION_KINDS に無い値)は無視する。
 * @param {Array<object>} dataList buildInflictedEffectsData の結果
 * @param {{replace?: Map<string,string>, add?: Map<string,string[]>}|null} mods
 * @returns {Array<object>}
 */
export function applyDamageTagMods(dataList, mods) {
  if (!mods) return dataList;
  const out = [];
  for (const d of (dataList ?? [])) {
    const orig = d.statuses?.[0];
    let entry = d;
    const to = mods.replace?.get?.(orig);
    if (to && to !== orig && CONDITION_KINDS[to]) {
      const ndef = CONDITION_KINDS[to];
      const f = d.flags?.[SCOPE] ?? {};
      const conds = f.conditions?.[orig];
      entry = {
        ...d,
        name:     ndef.label,
        img:      ndef.img ?? "icons/svg/aura.svg",
        statuses: [to],
        flags: { [SCOPE]: {
          conditionKind: to,
          hideFromList:  f.hideFromList === true,
          replacedFrom:  orig,
          ...(conds ? { conditions: { [to]: conds } } : {}),
        } },
      };
    }
    out.push(entry);
    for (const addTo of (mods.add?.get?.(orig) ?? [])) {
      const adef = CONDITION_KINDS[addTo];
      if (!adef || addTo === entry.statuses?.[0]) continue;
      out.push({
        name:     adef.label,
        img:      adef.img ?? "icons/svg/aura.svg",
        statuses: [addTo],
        flags:    { [SCOPE]: { conditionKind: addTo, hideFromList: true, addedFrom: orig } },
      });
    }
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
    if (!c || !c.active || c.pendingScene) continue;
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
    // 特定技能への達成値ペナルティ(眼部損傷=〈知覚〉-5): 判定参加技能(組み合わせ含む)に
    // 対象識別キーが含まれれば -value。技能の識別は名前でなく識別キーで行う。
    if (c.def?.skillPenalty && ctx?.upward) {
      const sp = c.def.skillPenalty;
      if (sp.skillKey && (ctx.skillKeys ?? []).includes(sp.skillKey)) {
        entries.push({ identity: c.kind, stackable: c.stackable, name: c.name, value: -(sp.value ?? 0) });
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

/**
 * 特定技能の使用不可(負傷の `skillBlock`)に該当する判定について、警告すべきコンディション名を返す。
 * 重圧の完全ブロック(getCheckBlock)と異なり**警告のみ**(判定は続行する。ユーザー裁定 2026-07-16)。
 * 照合キーは固定型=def.skillBlock.skillKey(知覚以外の信用等)、選択型(社会/コネ)=付与時に確定した
 * インスタンスの `targetSkill`。技能の識別は名前でなく識別キーで行う。判定参加技能(組み合わせ含む)の
 * いずれかが対象キーに一致すれば警告する。同 kind は重複して警告しない。
 * @param {Array<object>} conditions readConditions 済み(effectIgnored 除外前提)の配列
 * @param {string[]} skillKeys 判定に参加する技能の識別キー
 * @returns {string[]} 警告すべきコンディションの表示名
 */
export function gatherSkillUseWarnings(conditions, skillKeys) {
  const keys = new Set(skillKeys ?? []);
  const seen = new Set();
  const out = [];
  for (const c of (conditions ?? [])) {
    if (!c?.active || c.pendingScene) continue;
    const sb = c.def?.skillBlock;
    if (!sb) continue;
    const target = sb.skillKey || c.targetSkill; // 固定 or 付与時選択
    if (target && keys.has(target) && !seen.has(c.kind)) {
      seen.add(c.kind);
      out.push(c.name);
    }
  }
  return out;
}

/**
 * 報酬点の使用不可(負傷の `bountyBlock`)なコンディションがあるか。技能判定時の使用可能報酬点を
 * 0 に落とし、消費ダイアログ自体をスキップする判断に使う(ユーザー裁定 2026-07-16)。
 * @param {Array<object>} conditions readConditions 済み(effectIgnored 除外前提)の配列
 * @returns {boolean}
 */
export function hasBountyBlock(conditions) {
  return (conditions ?? []).some(c => c?.active && !c.pendingScene && c.def?.bountyBlock === true);
}
