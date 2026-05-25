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
 * cast と User の history マップを双方向マージして統合マップを返す(純粋関数)。
 *
 * 結合ルール: { ...userHistory, ...castHistory }
 * 同一 ID が両者に存在する場合は cast 側が優先される。
 * これは旧 _onDrop の { ...playerHistory, ...castHistory } と同仕様。
 * ID は randomID のため通常は重複しない。
 *
 * @param {object|null|undefined} castHistory  cast.system.history
 * @param {object|null|undefined} userHistory  User flag の history
 * @returns {object}  統合後の history マップ(新しいオブジェクト)
 */
export function mergeHistories(castHistory, userHistory) {
  return { ...(userHistory ?? {}), ...(castHistory ?? {}) };
}

/**
 * 履歴マップを指定した origin で分割する(純粋関数)。
 *
 * origin が originId に一致するエントリ(その主体が追加したもの)と
 * 一致しないエントリ(他の主体が追加したもの / origin なし)に分けて返す。
 *
 * 同期 OFF 時の由来分離に使用:
 *   - cast では ownedByOther を削除(User 由来を除去)
 *   - User flag では ownedByOrigin を削除(この cast 由来を除去)
 *
 * @param {object|null|undefined} historyMap  history マップ
 * @param {string} originId  分割基準となる主体 ID(cast UUID または User ID)
 * @returns {{ ownedByOrigin: object, ownedByOther: object }}
 */
export function separateHistoryByOrigin(historyMap, originId) {
  const ownedByOrigin = {};
  const ownedByOther = {};
  for (const [id, entry] of Object.entries(historyMap ?? {})) {
    if (entry.origin === originId) {
      ownedByOrigin[id] = entry;
    } else {
      ownedByOther[id] = entry;
    }
  }
  return { ownedByOrigin, ownedByOther };
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
