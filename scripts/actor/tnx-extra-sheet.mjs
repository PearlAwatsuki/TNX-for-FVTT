/**
 * @fileoverview TokyoNovaExtraSheet - エキストラ Actor シート(フェーズ11-5・2026-07-04 再訂正)
 *
 * エキストラは**完全にデータを持たない**(名前と説明のみ・2026-07-04 確定。
 * 「スタイル・神業・技能・アウトフィットを持てる」は勘違い＝神業以外を持たないゲストとの取り違え)。
 * - アイテムのドロップは全て拒否する(神業が要るなら口頭宣言か、データを制限したゲストで作る)
 * - 固定値判定は「アウトフィットとして取得できるエキストラ」(小分類エキストラ・キャスト/ゲスト所持)の
 *   用途(固定達成値)で行うため、本シートの領分ではない(Check_Rules「固定値判定」)
 * - ダメージ概念なし(宣言だけで死亡＝Damage_Rules)・initiative 不可(combatSpeed 非保持)
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';

export class TokyoNovaExtraSheet extends TnxCharacterSheetBase {

    /** DEFAULT_OPTIONS は継承マージ(共通分は基底)。classes は配列のため上書き＝フル指定。 */
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "extra"],
        position: { width: 600, height: 520 },
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/extra-sheet.hbs",
            scrollable: [".sheet-body"],
        },
    };

    /** エキストラは全機能なし(名前と説明のみ) */
    static SHEET_FEATURES = {
        exp: false, history: false, lifePath: false,
        parts: false, miracles: false, bounty: false, heads: false,
        growth: false, personalData: false, citizenRank: false, handle: false,
        troopLevel: false, abilities: false, combat: false,
    };

    /** @override エキストラはアイテムを持てない(完全にデータなし・2026-07-04 確定) */
    async _onDropItem(_event, _data) {
        ui.notifications.warn("エキストラはデータを持ちません（名前と説明のみ）。");
        return false;
    }
}
