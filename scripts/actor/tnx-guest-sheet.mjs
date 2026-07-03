/**
 * @fileoverview TokyoNovaGuestSheet - ゲスト Actor シート(フェーズ11-3)
 *
 * ゲストはセッション履歴以外データ的にキャストと同一(2026-07-03 確定)のため、
 * 共通基底(TnxCharacterSheetBase)をそのまま用いる。差異は——
 * - EXP・セッション履歴を持たない(SHEET_FEATURES.exp=false・専用シェルに履歴タブなし)
 * - それ以外(報酬点・ライフパス・部位管理・戦闘タブ・ゴースト・判定起動)はキャストと同機能
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';

export class TokyoNovaGuestSheet extends TnxCharacterSheetBase {

    /** DEFAULT_OPTIONS は継承マージ(共通分は基底)。classes は配列のため上書き＝フル指定。 */
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "guest"],
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/guest-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar", ".tab.abilities", ".tab[data-tab='outfits']"],
        },
    };

    /** ゲストは EXP・セッション履歴・ライフパスなし(2026-07-03 再訂正)。部位管理はキャスト同様に持つ */
    static SHEET_FEATURES = { exp: false, history: false, lifePath: false, parts: true };
}
