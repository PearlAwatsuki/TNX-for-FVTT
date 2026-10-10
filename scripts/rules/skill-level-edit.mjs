/**
 * 技能レベル編集時に、AE等による実効値の差分を素のレベルへ焼き込まないための純ロジック。
 */

/** 素のレベルと実効レベルの差分を返す。 */
export function skillLevelAdjustment(baseLevel, effectiveLevel) {
  const base = Math.max(0, Math.trunc(Number(baseLevel) || 0));
  const effective = Math.max(0, Math.trunc(Number(effectiveLevel) || 0));
  return effective - base;
}

/** 実効レベル入力から保存すべき素のレベルを求める。 */
export function baseLevelFromEffectiveInput(inputLevel, baseLevel, effectiveLevel) {
  const input = Math.max(0, Math.trunc(Number(inputLevel) || 0));
  return Math.max(0, input - skillLevelAdjustment(baseLevel, effectiveLevel));
}

/**
 * スート変更後に保存すべき素のレベルを求める。
 * 追加時は一時修正で賄える範囲なら素のレベルを維持し、実効レベルを超える分だけ増やす。
 * 解除時は選択スート数が素のレベルを下回った場合だけ素のレベルを下げる。
 */
export function baseLevelAfterSuitChange({ baseLevel, effectiveLevel, selectedSuitCount, checked }) {
  const base = Math.max(0, Math.trunc(Number(baseLevel) || 0));
  const count = Math.max(0, Math.trunc(Number(selectedSuitCount) || 0));
  if (!checked) return Math.min(base, count);
  const adjustment = skillLevelAdjustment(base, effectiveLevel);
  return Math.max(base, count - adjustment, 0);
}


export const SKILL_SUITS = ["spade", "club", "heart", "diamond"];

/** 一時レベル枠で追加したスートの記録を正規化する。 */
export function normalizeTemporarySuitState(state) {
  const baseSuits = SKILL_SUITS.filter(suit => state?.baseSuits?.includes?.(suit));
  const addedSuits = SKILL_SUITS.filter(suit => state?.addedSuits?.includes?.(suit));
  // addedSuits は追加順を保つ必要があるため、入力順で再構成する。
  const orderedAdded = [...new Set(state?.addedSuits ?? [])].filter(suit => SKILL_SUITS.includes(suit));
  return { baseSuits, addedSuits: orderedAdded };
}

/** スート変更後に保存する一時スート状態を求める。 */
export function temporarySuitStateAfterChange({ state, suits, suitKey, checked, baseLevel, effectiveLevel, nextBaseLevel }) {
  const current = normalizeTemporarySuitState(state);
  const selectedBefore = SKILL_SUITS.filter(suit => suits?.[suit]);
  let baseSuits = current.baseSuits;
  let addedSuits = current.addedSuits.filter(suit => suit !== suitKey);

  const selectedAfterCount = selectedBefore.filter(suit => suit !== suitKey).length + (checked ? 1 : 0);
  if (checked && effectiveLevel > baseLevel && nextBaseLevel === baseLevel && selectedAfterCount > baseLevel) {
    // 素のレベルを超えた選択だけが一時枠を使う。未使用の永続枠を埋める選択は一時扱いにしない。
    if (!baseSuits.length && !current.addedSuits.length) baseSuits = selectedBefore;
    addedSuits.push(suitKey);
  }

  if (!addedSuits.length) return null;
  return { baseSuits, addedSuits };
}

/**
 * 実効レベル低下後に、一時スートのうち維持可能な数と解除対象を返す。
 * 解除対象は「一時スートとして追加したもの」に限定し、追加順の新しいものから減らす。
 */
export function reconcileTemporarySuits({ state, suits, baseLevel, effectiveLevel }) {
  const current = normalizeTemporarySuitState(state);
  const selectedTemporary = current.addedSuits.filter(suit => suits?.[suit]);
  const capacity = Math.max(0, Math.trunc(Number(effectiveLevel) || 0) - Math.max(0, Math.trunc(Number(baseLevel) || 0)));
  const keep = selectedTemporary.slice(0, capacity);
  const remove = selectedTemporary.slice(capacity);
  return {
    keep,
    remove,
    nextState: keep.length ? { baseSuits: current.baseSuits, addedSuits: keep } : null,
  };
}
