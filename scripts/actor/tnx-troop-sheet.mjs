/**
 * @fileoverview TokyoNovaTroopSheet - トループ Actor シート(フェーズ11-4)
 *
 * トループの構成はスタイル(1つ)・能力値・技能・アウトフィット・状態で、判定はキャストと同じ
 * (正本 Troops.md)。共通基底(TnxCharacterSheetBase)をそのまま用い、差異は——
 * - 神業なし(features.miracles=false。ドロップ・スタイル由来の自動取得もガード)
 * - 報酬点・EXP・セッション履歴・ライフパス・部位管理なし
 * - heads(人数/エニグマポイント)をサイドバーに表示・トークンリソースバーに割当(features.heads)
 * 分身(トループ級)も troop として作成し、AR=1・CS/CSカレント=0 はデータ入力で表現する。
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';

export class TokyoNovaTroopSheet extends TnxCharacterSheetBase {

    /** DEFAULT_OPTIONS は継承マージ(共通分は基底)。classes は配列のため上書き＝フル指定。 */
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "troop"],
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/troop-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar", ".tab.abilities", ".tab[data-tab='outfits']"],
        },
    };

    /** トループ: 神業・報酬点・部位管理なし、heads(人数/エニグマポイント)あり */
    static SHEET_FEATURES = {
        exp: false, history: false, lifePath: false,
        parts: false, miracles: false, bounty: false, heads: true,
    };
}
