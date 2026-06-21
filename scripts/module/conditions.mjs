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
export const CONDITION_KINDS = Object.freeze({
  // --- バッドステータス ---
  "panic":        { label: "恐慌",     type: "block",        block: "reaction" },
  "poison":       { label: "邪毒",     type: "continuous",   magnitude: true },
  "pressure":     { label: "重圧",     type: "block",        block: "abilityCheck", targetAbility: true },
  "weakness":     { label: "衰弱",     type: "numeric",      apply: "allControl",        magnitude: true, stackable: true },
  "capture":      { label: "捕縛",     type: "block",        block: "attackWith",        targetWeapon: true, stackable: true },
  "doped-major":  { label: "酩酊(大)", type: "numeric",      apply: "allCheckAndControl", magnitude: true, magnitudeDefault: 5, stackable: true },
  "doped-minor":  { label: "酩酊(小)", type: "numeric",      apply: "allCheckAndControl", magnitude: true, magnitudeDefault: 2, stackable: true },
  "fear":         { label: "萎縮",     type: "attackTarget", targetMode: "include", penalty: 5, stackable: true },
  "hatred":       { label: "憎悪",     type: "attackTarget", targetMode: "exclude", penalty: 5 },
  "interference": { label: "電子妨害", type: "computed",     magnitude: true },
  // --- 戦闘不能(statusEffects への登録は後続) ---
  "faint":        { label: "気絶",     type: "block",        block: "mainProcess" },
  "coma":         { label: "仮死",     type: "block",        block: "mainProcess", terminalPending: true },
  "dead":         { label: "完全死亡", type: "terminal" },
});

/**
 * ActiveEffect から condition 設定を読み取る。conditionKind を持たない AE は null。
 * @param {object} effect ActiveEffect(name / active / flags / id)
 * @returns {{kind:string, label:string, def:object, name:string, identity:string,
 *   active:boolean, stackable:boolean, magnitude:number, targetAbility:?string,
 *   targetUuid:?string, targetMode:?string, durationUnit:?string}|null}
 */
export function readCondition(effect) {
  const f = effect?.flags?.[SCOPE];
  if (!f?.conditionKind) return null;
  const def = CONDITION_KINDS[f.conditionKind] ?? null;
  return {
    kind:         f.conditionKind,
    label:        def?.label ?? f.conditionKind,
    def,
    name:         effect.name || def?.label || "(無名効果)",
    identity:     f.effectId || effect.id,
    active:       effect.active !== false,
    stackable:    f.stackable === true || def?.stackable === true,
    magnitude:    Number(f.magnitude ?? def?.magnitudeDefault ?? 0) || 0,
    targetAbility: f.targetAbility ?? null,
    targetUuid:   f.targetUuid ?? null,
    targetMode:   f.targetMode ?? def?.targetMode ?? null,
    durationUnit: f.durationUnit ?? null,
  };
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
    if (c.def?.type === "numeric" && /Check/.test(c.def?.apply ?? "")) {
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
 * condition による**全制御値の減少量**(正の合計)を返す(派生パスで totalControl から引く)。
 * 衰弱(allControl)・酩酊(allCheckAndControl) 等、apply に "Control" を含む numeric 型。
 * 非 stackable は同 kind で重複排除(最大)、stackable(衰弱・酩酊) は重ねる。
 * @param {Array<object>} conditions readCondition() 済みの配列
 * @returns {number}
 */
export function gatherConditionControlPenalty(conditions) {
  const entries = [];
  for (const c of (conditions ?? [])) {
    if (!c?.active) continue;
    if (c.def?.type === "numeric" && /Control/.test(c.def?.apply ?? "") && c.magnitude) {
      entries.push({ identity: c.kind, stackable: c.stackable, name: c.name, value: c.magnitude });
    }
  }
  return dedupeEntries(entries).reduce((sum, e) => sum + e.value, 0);
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
