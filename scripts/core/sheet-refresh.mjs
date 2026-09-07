/**
 * @fileoverview 本システムのアプリの一括再描画(2026-09-07 tnx.mjs から移設)。
 *
 * game.tnx.refreshSheets として公開され、カードの配布・回収など「開いている画面の値が
 * まとめて変わる」操作から呼ばれる。
 */

/**
 * [All Clients] カードの増減で表示が変わる本システムのアプリを再描画する。
 *
 * 旧実装は `ui.windows`(ApplicationV1 のレジストリ)を走査していたが、本システムのアプリは
 * すべて ApplicationV2 なのでそこには 1 つも入らない——実際には**他モジュールの V1 ウィンドウ**を
 * 巻き込んで再描画していた。閉判定の `_closed` もコードのどこにも代入が無く、常に undefined で
 * 素通しだった(2026-09-07 是正)。
 *
 * 対象は id が `tnx-` で始まる、開いているアプリ。id は `foundry.applications.instances` の
 * キー=グローバルな名前空間で、本システムのアプリはすべてこの接頭辞を持つ(HUD・各パネル・
 * 記録シート)。開いていないアプリは対象外(カードが配られただけで勝手に開かない)。
 */
export function handleRefreshSheets() {
    for (const app of foundry.applications.instances.values()) {
        if (app.rendered && String(app.id ?? "").startsWith("tnx-")) app.render(false);
    }
}

/**
 * 上記を束ねて呼ぶ。配札・山札リセット等の一括操作では createCard/deleteCard が枚数分
 * 連続発火するため、そのたびに全アプリを描き直さないようまとめる(遅延は従来と同じ 50ms)。
 */
let _refreshSheetsDebounced = null;
export function refreshSheetsSoon() {
    _refreshSheetsDebounced ??= foundry.utils.debounce(handleRefreshSheets, 50);
    _refreshSheetsDebounced();
}
