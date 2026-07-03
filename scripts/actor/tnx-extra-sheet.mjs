/**
 * @fileoverview TokyoNovaExtraSheet - エキストラ Actor シート(フェーズ11-5)
 *
 * エキストラは基本は名前のみのキャラクター(biography のみ・attributes 非保持)。
 * スタイル・神業・技能・アウトフィットを持てる(正本 Actor_Types.md)。差異は——
 * - 能力値・戦闘タブなし(features.abilities/combat=false。ダメージ概念もない=状態タブなし)
 * - 判定は固定値でのみ可能(Check_Rules.md「固定値判定」。通常判定は行えない)
 * - 神業は使用できる可能性がある(2026-07-03)ため神業表示・使用は残す
 * - 報酬点・EXP・セッション履歴・ライフパス・部位管理なし
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';

export class TokyoNovaExtraSheet extends TnxCharacterSheetBase {

    /** DEFAULT_OPTIONS は継承マージ(共通分は基底)。classes は配列のため上書き＝フル指定。 */
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "extra"],
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/extra-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar", ".tab.abilities", ".tab[data-tab='outfits']"],
        },
    };

    /** エキストラ: 能力値・戦闘・報酬点・部位・履歴系なし。神業・技能・アウトフィットの所持は可 */
    static SHEET_FEATURES = {
        exp: false, history: false, lifePath: false,
        parts: false, miracles: true, bounty: false, heads: false,
        growth: false, personalData: true, citizenRank: true, handle: true,
        troopLevel: false, abilities: false, combat: false,
    };
}
