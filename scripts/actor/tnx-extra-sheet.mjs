/**
 * @fileoverview TokyoNovaExtraSheet - エキストラ Actor シート(フェーズ11-5)
 *
 * エキストラは名前・説明・パーソナルデータのみのキャラクター(2026-07-04 確定。
 * スタイル・神業・アウトフィットは持たない＝「神業を使うエキストラ」の観測は
 * 神業以外を持たないゲストとの取り違え)。
 * 例外として**固定値の判定**が行える(Check_Rules「固定値判定」)ため、
 * **一般技能のみ**持てる——表示はスート・レベルなしの「技能名＋達成値」で、
 * 達成値は技能の check 用途の「固定達成値」から読む(設定方法は用途＝2026-07-04 確定)。
 * ダメージ概念なし(宣言だけで死亡＝Damage_Rules)・initiative 不可(combatSpeed 非保持)。
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';

export class TokyoNovaExtraSheet extends TnxCharacterSheetBase {

    /** DEFAULT_OPTIONS は継承マージ(共通分は基底)。classes は配列のため上書き＝フル指定。 */
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "extra"],
        position: { width: 720, height: 640 },
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/extra-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar"],
        },
    };

    /** エキストラ: パーソナルデータと技能(固定値判定用)のみ。他の機能なし */
    static SHEET_FEATURES = {
        exp: false, history: false, lifePath: false,
        parts: false, miracles: false, bounty: false, heads: false,
        growth: false, personalData: true, citizenRank: false, handle: false,
        troopLevel: false, abilities: false, combat: false,
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // 技能表示欄: スート・レベルは出さず「技能名＋達成値」のみ。達成値は check 用途の
        // 固定達成値(fixedResult)から読む(設定は技能アイテムの用途タブで行う)
        context.extraSkills = (context.generalSkills ?? []).map(i => {
            const fixed = (i.system.actions ?? [])
                .find(a => a.type === "check" && Number.isFinite(a.fixedResult))?.fixedResult ?? null;
            return { _id: i.id, name: i.name, fixed, hasFixed: Number.isFinite(fixed) };
        });
        return context;
    }

    /**
     * @override
     * エキストラが持てるのは一般技能(固定値判定用)のみ(2026-07-04 確定)。
     * スタイル・神業・スタイル技能・アウトフィット等は全て拒否する。
     */
    async _onDropItem(event, data) {
        const dropped = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
        if (dropped?.type === "generalSkill") return super._onDropItem(event, data);
        ui.notifications.warn("エキストラは技能（固定値判定用）以外のデータを持ちません。");
        return false;
    }
}
