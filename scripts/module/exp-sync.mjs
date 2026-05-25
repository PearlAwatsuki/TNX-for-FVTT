/**
 * @fileoverview EXP 同期の純粋関数群(フェーズ2-2)
 *
 * cast → User flag EXP 同期に使う純粋関数。
 * Foundry 環境不要のためユニットテスト可能。
 */

/**
 * 複数 cast の exp データから User flag に記録する sharedSpent を計算する(純粋関数)。
 *
 * sharedSpent = Σ max(0, cast.spent - cast.additional)
 * cast.additional は各キャスト固有の追加経験点。
 * その範囲内の消費は shared にならないため差し引く。
 *
 * @param {Array<{ spent: number|string, additional: number|string }>} castExpList
 * @returns {number}
 */
export function calcSharedSpent(castExpList) {
  return castExpList.reduce((total, { spent, additional }) => {
    return total + Math.max(0, (Number(spent) || 0) - (Number(additional) || 0));
  }, 0);
}
