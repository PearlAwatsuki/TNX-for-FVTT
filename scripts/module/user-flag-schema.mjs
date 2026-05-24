/**
 * @fileoverview TnxUserFlag — User flag のスキーマ定義・読み出し・書き込みヘルパー
 *
 * User は DataModel を持てないため、EXP・履歴・手札関連データは flag に保持する。
 * flag は任意 JSON であり型検証がないため、スキーマ(キー構造・初期値)はここで一元管理する。
 * 直接 user.flags を散在して読まず、必ずこのモジュールのヘルパーを経由すること。
 *
 * 関数の種別:
 *   - 純粋関数(引数のみに依存、Foundry 不要): getUserFlagData / getUserFlagHistorySorted /
 *     calcHistoryExpTotal / historyAdd / historyUpdate / historyRemove
 *   - Foundry 依存(非同期): saveUserFlagHistory
 */

export const TNX_FLAG_SCOPE = "tokyo-nova-axleration";

/**
 * User flag のデフォルト値(スキーマの権威)。
 * 将来のバフが handMaxSize に干渉できるよう、手札上限はここで管理する。
 */
const FLAG_DEFAULTS = {
  history: {},
  exp: {
    total: 0,
    value: 0,
    spent: 0,
  },
  handPileId: "",
  trumpCardPileId: "",
  handMaxSize: 4,
};

/**
 * User の TNX flag データを初期値フォールバック付きで返す。
 * flag が未設定のキーは FLAG_DEFAULTS の値を返す。
 *
 * @param {object} user  Foundry User ドキュメント(または { flags: {...} } 形式のオブジェクト)
 * @returns {{ history: object,
 *             exp: { total: number, value: number, spent: number },
 *             handPileId: string, trumpCardPileId: string, handMaxSize: number }}
 */
export function getUserFlagData(user) {
  const f = user?.flags?.[TNX_FLAG_SCOPE] ?? {};
  return {
    history:        f.history          ?? FLAG_DEFAULTS.history,
    exp: {
      total:        f.exp?.total       ?? FLAG_DEFAULTS.exp.total,
      value:        f.exp?.value       ?? FLAG_DEFAULTS.exp.value,
      spent:        f.exp?.spent       ?? FLAG_DEFAULTS.exp.spent,
    },
    handPileId:     f.handPileId       ?? FLAG_DEFAULTS.handPileId,
    trumpCardPileId: f.trumpCardPileId ?? FLAG_DEFAULTS.trumpCardPileId,
    handMaxSize:    f.handMaxSize      ?? FLAG_DEFAULTS.handMaxSize,
  };
}

/**
 * User の TNX history flag を表示用の配列(日付昇順ソート済み)に変換する。
 * 日付なし行は末尾に並ぶ。
 *
 * @param {object} user
 * @returns {Array<{id: string, date: string, title: string, exp: number, rl: string, players: string}>}
 */
export function getUserFlagHistorySorted(user) {
  const { history } = getUserFlagData(user);
  const arr = Object.values(history);
  arr.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });
  return arr;
}

// ─── 純粋関数: history オブジェクトマップの変換 ───────────────────────────

/**
 * history マップの全エントリの exp を合計する。
 * @param {object} historyMap
 * @returns {number}
 */
export function calcHistoryExpTotal(historyMap) {
  return Object.values(historyMap ?? {}).reduce(
    (sum, entry) => sum + (Number(entry.exp) || 0),
    0,
  );
}

/**
 * history マップに新規エントリを追加した新しいマップを返す。
 * 既存マップは変更しない。
 * @param {object} historyMap
 * @param {{ id: string, date: string, title: string, exp: number, rl: string, players: string }} entry
 * @returns {object}
 */
export function historyAdd(historyMap, entry) {
  return { ...historyMap, [entry.id]: { ...entry } };
}

/**
 * history マップの指定エントリを変更した新しいマップを返す。
 * entryId が存在しない場合は元のマップをそのまま返す。
 * @param {object} historyMap
 * @param {string} entryId
 * @param {object} changes  上書きするフィールド
 * @returns {object}
 */
export function historyUpdate(historyMap, entryId, changes) {
  if (!Object.prototype.hasOwnProperty.call(historyMap, entryId)) return historyMap;
  return { ...historyMap, [entryId]: { ...historyMap[entryId], ...changes } };
}

/**
 * history マップから指定エントリを除いた新しいマップを返す。
 * entryId が存在しない場合は元のマップをそのまま返す。
 * @param {object} historyMap
 * @param {string} entryId
 * @returns {object}
 */
export function historyRemove(historyMap, entryId) {
  if (!Object.prototype.hasOwnProperty.call(historyMap, entryId)) return historyMap;
  const copy = { ...historyMap };
  delete copy[entryId];
  return copy;
}

// ─── Foundry 依存: flag への書き込み ─────────────────────────────────────

/**
 * 変更後の history マップと再計算した exp.total を一括で User flag に保存する。
 * exp.value / exp.spent はフェーズ2-2 の同期ロジックが担当するため変更しない。
 * @param {User} user  書き込み対象の Foundry User
 * @param {object} newHistoryMap  保存する新しい history マップ
 * @returns {Promise<User>}
 */
export async function saveUserFlagHistory(user, newHistoryMap) {
  const newTotal = calcHistoryExpTotal(newHistoryMap);
  return user.update({
    [`flags.${TNX_FLAG_SCOPE}.history`]: newHistoryMap,
    [`flags.${TNX_FLAG_SCOPE}.exp.total`]: newTotal,
  });
}
