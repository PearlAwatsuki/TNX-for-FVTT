/**
 * @fileoverview TokyoNovaTroopSheet - トループ Actor シート(フェーズ11-4)
 *
 * トループの構成はスタイル(1つ)・能力値・技能・アウトフィット・状態で、判定はキャストと同じ
 * (正本 Troops.md)。共通基底(TnxCharacterSheetBase)をそのまま用い、差異は——
 * - 神業なし(features.miracles=false。ドロップ・スタイル由来の自動取得もガード)
 * - 報酬点・EXP・セッション履歴・ライフパス・部位管理なし
 * - 個人識別キャラでないため市民ランク・パーソナルデータ・ハンドルなし(2026-07-03 確定)。
 *   代わりにトループレベル(能力値の決定項)を表示する
 * - 能力値の成長欄なし(スタイル基本値＋トループレベルで決定)
 * - 種別(トループ/エニグマ/分身)のドロップダウンと人数/エニグマポイントをサイドバーに表示。
 *   heads はトークンリソースバーに割当(features.heads)
 * - 名前はトループ=「(スタイル名)・トループ」/分身=「(分身元キャラ)の分身」で固定
 *   (自由入力はエニグマのみ。同期は tnx.mjs の syncTroopName)
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';
import { TROOP_MODES } from '../data/actor/troop.mjs';

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

    /** トループ: 神業・報酬点・部位・成長・個人識別系なし、heads/トループレベルあり */
    static SHEET_FEATURES = {
        exp: false, history: false, lifePath: false,
        parts: false, miracles: false, bounty: false, heads: true,
        growth: false, personalData: false, citizenRank: false, handle: false,
        troopLevel: true,
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // 名前の自由入力はエニグマのみ(トループ/分身は導出名で固定＝Troops.md)
        context.nameLocked = this.actor.system.troopMode !== "enigma";
        context.troopModeOptions = Object.entries(TROOP_MODES).map(([value, label]) => ({
            value, label, selected: value === this.actor.system.troopMode,
        }));
        return context;
    }
}
