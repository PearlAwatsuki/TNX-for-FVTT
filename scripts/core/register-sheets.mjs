/**
 * @fileoverview アクター/アイテム/ジャーナルのシート登録。
 *
 * tnx.mjs の init フックから切り出したもの(2026-09-07)。**呼ぶ順序に意味がある**ため、
 * tnx.mjs 側は元の並びのまま順に呼ぶ。ここで並びを変えないこと。
 */

import { TokyoNovaCastSheet } from "../actor/tnx-cast-sheet.mjs";
import { TokyoNovaGuestSheet } from "../actor/tnx-guest-sheet.mjs";
import { TokyoNovaTroopSheet } from "../actor/tnx-troop-sheet.mjs";
import { TokyoNovaExtraSheet } from "../actor/tnx-extra-sheet.mjs";
import { TokyoNovaStyleSheet } from "../item/tnx-style-sheet.mjs";
import { TokyoNovaMiracleSheet } from "../item/tnx-miracle-sheet.mjs";
import { TokyoNovaGeneralSkillSheet } from "../item/tnx-general-skill-sheet.mjs";
import { TokyoNovaStyleSkillSheet } from "../item/tnx-style-skill-sheet.mjs";
import { TokyoNovaOrganizationSheet } from "../item/tnx-organization-sheet.mjs";
import { TokyoNovaLifePathSheet } from "../item/tnx-life-path-sheet.mjs";
import { TokyoNovaOutfitSheet } from "../item/tnx-outfit-sheet.mjs";
import { TokyoNovaHousingAreaSheet } from "../item/tnx-housing-area-sheet.mjs";
import { TnxScenarioSheet } from "../journal/tnx-scenario-sheet.mjs";
import { TnxFocusSystemSheet } from "../journal/tnx-focus-system-sheet.mjs";
import { registerDrawTableHooks } from "../cards/tnx-draw-table.mjs";
import { TnxSceneConfig } from "../app/tnx-scene-config.mjs";
import { SYSTEM_ID } from "../constants.mjs";

export function registerSheets() {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(Scene, SYSTEM_ID, TnxSceneConfig, {
        makeDefault: true, label: "シーン設定",
    });
    // Actor Sheetの登録
    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaCastSheet, {
        types: ["cast"],
        makeDefault: true,
        label: "プロファイルシート"
    });
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaGuestSheet, {
        types: ["guest"],
        makeDefault: true,
        label: "プロファイルシート（ゲスト）"
    });
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaTroopSheet, {
        types: ["troop"],
        makeDefault: true,
        label: "プロファイルシート（トループ）"
    });
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaExtraSheet, {
        types: ["extra"],
        makeDefault: true,
        label: "プロファイルシート（エキストラ）"
    });

    // Item Sheetの登録
    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaStyleSheet, {
        types: ["style"],
        makeDefault: true,
        label: "スタイルシート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaMiracleSheet, {
        types: ["miracle"],
        makeDefault: true,
        label: "神業シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaGeneralSkillSheet, {
        types: ["generalSkill"],
        makeDefault: true,
        label: "一般技能シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaStyleSkillSheet, {
        types: ["styleSkill"],
        makeDefault: true,
        label: "スタイル技能シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaOrganizationSheet, {
        types: ["organization"],
        makeDefault: true,
        label: "組織シート"
    });

    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaLifePathSheet, {
        types: ["lifePath"],
        makeDefault: true,
        label: "ライフパスシート"
    });

    // アウトフィット共通シート(フェーズ6-1〜)。型ごとの差分はシート内の
    // type 判定(サマリ構成・固有フィールドセット)で吸収する。
    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaOutfitSheet, {
        types: ["general", "weapon", "armor", "cyborg", "ianus", "tron", "tap",
                "vehicle", "residence", "combiner"],
        makeDefault: true,
        label: "アウトフィットシート"
    });

    // 住宅エリア専用シート(アウトフィットではなく住宅施設への修正値の集合)
    foundry.documents.collections.Items.registerSheet("tokyo-nova", TokyoNovaHousingAreaSheet, {
        types: ["housingArea"],
        makeDefault: true,
        label: "住宅エリアシート"
    });

    // Journal Sheetの登録
    foundry.documents.collections.Journal.registerSheet("tokyo-nova", TnxScenarioSheet, {
        makeDefault: false,
        label: "アクトシート",
    });

    // FS判定シート(フェーズ12-5): JournalEntryPage 型 focusSystem の専用シート
    // FS判定シート(2026-07-21 是正): JournalEntry のシート。JournalEntry はサブタイプを
    // 持てないため、アクトシートと同じく「選択可能なシート＋flags」で表す
    foundry.documents.collections.Journal.registerSheet("tokyo-nova", TnxFocusSystemSheet, {
        makeDefault: false,
        label: "FS判定シート",
    });

    // ドロー表: コア RollTable のカードドロー拡張（シート置換なし・フック注入のみ）
    registerDrawTableHooks();
}
