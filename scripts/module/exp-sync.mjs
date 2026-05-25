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

/**
 * 旧 history マップと新 history マップを比較し、cast の system.history を
 * 最小変更で同期するための updateData を生成する(純粋関数)。
 *
 * User flag の history を権威とし、cast ローカルの system.history をそれに合わせる。
 * Foundry の mergeObject はキーを保持するため、削除は `-=` 構文で明示的に行う。
 *
 * @param {object} oldMap  現在の cast.system.history
 * @param {object} newMap  User flag から取得した最新 history
 * @returns {object}  cast.update() に渡せる updateData(空の場合は変更なし)
 */
export function buildCastHistorySyncUpdate(oldMap, newMap) {
  const old_ = oldMap ?? {};
  const new_ = newMap ?? {};
  const update = {};
  // 旧にあって新にないエントリは削除
  for (const id of Object.keys(old_)) {
    if (!(id in new_)) update[`system.history.-=${id}`] = null;
  }
  // 新のエントリを追加・上書き
  for (const [id, entry] of Object.entries(new_)) {
    update[`system.history.${id}`] = entry;
  }
  return update;
}
