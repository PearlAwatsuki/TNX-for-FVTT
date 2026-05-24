/**
 * @fileoverview TnxUserFlag — User flag のスキーマ定義と読み出しヘルパー
 *
 * User は DataModel を持てないため、EXP・履歴・手札関連データは flag に保持する。
 * flag は任意 JSON であり型検証がないため、スキーマ(キー構造・初期値)はここで一元管理する。
 * 直接 user.flags を散在して読まず、必ずこのモジュールのヘルパーを経由すること。
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
