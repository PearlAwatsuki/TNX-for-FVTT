import { TokyoNovaCastSheet } from './actor/tnx-cast-sheet.mjs';
import { TokyoNovaGuestSheet } from './actor/tnx-guest-sheet.mjs';
import { TokyoNovaTroopSheet } from './actor/tnx-troop-sheet.mjs';
import { TokyoNovaExtraSheet } from './actor/tnx-extra-sheet.mjs';
import { computeTroopFixedName, findDepartmentSkillName } from './data/helpers.mjs';
import { defaultWeaponKindForCategory } from './data/item/common/outfit-base.mjs';
import { usesMaxBaseOf } from './data/item/uses.mjs';
import { canonicalizeSkillActions } from './module/usage-type-migration.mjs';
import { CastDataModel } from './data/actor/cast.mjs';
import { GuestDataModel } from './data/actor/guest.mjs';
import { TroopDataModel } from './data/actor/troop.mjs';
import { ExtraDataModel } from './data/actor/extra.mjs';
import { HousingAreaDataModel } from './data/item/housing-area.mjs';
import { OrganizationDataModel } from './data/item/organization.mjs';
import { LifePathDataModel } from './data/item/life-path.mjs';
import { ArmorDataModel } from './data/item/armor.mjs';
import { CyborgDataModel } from './data/item/cyborg.mjs';
import { CombinerDataModel } from './data/item/combiner.mjs';
import { GeneralDataModel } from './data/item/general.mjs';
import { IanusDataModel } from './data/item/ianus.mjs';
import { TronDataModel } from './data/item/tron.mjs';
import { VehicleDataModel } from './data/item/vehicle.mjs';
import { WeaponDataModel } from './data/item/weapon.mjs';
import { TapDataModel } from './data/item/tap.mjs';
import { ResidenceDataModel } from './data/item/residence.mjs';
import { MiracleDataModel } from './data/item/miracle.mjs';
import { GeneralSkillDataModel } from './data/item/general-skill.mjs';
import { StyleDataModel } from './data/item/style.mjs';
import { StyleSkillDataModel } from './data/item/style-skill.mjs';
import { PlayingCardsDataModel } from './data/card/playing-cards.mjs';
import { NeuroCardsDataModel } from './data/card/neuro-cards.mjs';
import { OtherDataModel } from './data/card/other.mjs';
import { TokyoNovaItem } from './item/item.mjs';
import { TokyoNovaActiveEffect } from './module/active-effect.mjs';
import { TnxCombat } from './combat/tnx-combat.mjs';
import { TnxCombatant } from './combat/tnx-combatant.mjs';
import { TnxCombatTracker } from './module/tnx-combat-tracker.mjs';
import { TokyoNovaStyleSheet } from './item/tnx-style-sheet.mjs';
import { TokyoNovaMiracleSheet } from './item/tnx-miracle-sheet.mjs';
import { TokyoNovaGeneralSkillSheet } from './item/tnx-general-skill-sheet.mjs';
import { TokyoNovaStyleSkillSheet } from './item/tnx-style-skill-sheet.mjs';
import { TokyoNovaOrganizationSheet } from './item/tnx-organization-sheet.mjs';
import { TokyoNovaLifePathSheet } from './item/tnx-life-path-sheet.mjs';
import { TokyoNovaOutfitSheet, formatWeaponRangeLabel } from './item/tnx-outfit-sheet.mjs';
import { TokyoNovaHousingAreaSheet } from './item/tnx-housing-area-sheet.mjs';
import { TnxScenarioSheet } from './journal/tnx-scenario-sheet.mjs';
import { TnxFocusSystemSheet } from './journal/tnx-focus-system-sheet.mjs';
import { TnxCardSetupApp } from './module/tnx-card-setup-app.mjs';
import { TnxActionHandler } from './module/tnx-action-handler.mjs';
import { TnxHud } from './module/tnx-hud.mjs';
import { TnxRecordSheet } from './module/tnx-record-sheet.mjs';
import { registerDrawTableHooks } from './module/tnx-draw-table.mjs';
import { recordCastOwnerUser } from './module/cast-ownership.mjs';
import { enforceUsageChainDefaultsOnImport } from './module/tnx-usage-sheet.mjs';
import { renderAttackCard, renderReactionCard } from './module/attack-flow.mjs';
import { renderDamageCard } from './module/damage-flow.mjs';
import { renderUsageEffectButton } from './module/usage-effects.mjs';
import { TnxSocketHandler } from './module/tnx-socket-handler.mjs';
import { TnxCheckFlow, renderRecheckButton } from './module/tnx-check-flow.mjs';
import { TnxCheckDialog } from './module/tnx-check-dialog.mjs';
import { TnxRlRequestApp } from './module/tnx-rl-request-app.mjs';
import { openRlGrantDamage, openRlGrantEffect, openRlGrantBounty } from './module/rl-grant.mjs';
import { renderBountyGrantCard } from './module/bounty-grant.mjs';
import { openFocusSystemPanel } from './module/tnx-focus-system-panel.mjs';
import { openScenarioPanel } from './module/tnx-scenario-panel.mjs';
import { registerFocusSystemSetting, advanceFocusCuts } from './module/focus-system-state.mjs';
import { registerSessionStateSetting, getSessionState } from './module/session-state.mjs';
import { registerSubSceneSetting, refreshSubSceneBackground } from './module/subscenes.mjs';
import { registerAppearanceTokenSync } from './module/appearance-state.mjs';
import { openSubScenePanel } from './module/tnx-subscene-panel.mjs';
import { renderFocusProgressButton, renderFocusSupportNote } from './module/focus-system-result.mjs';
import { autoSendFocusChecks } from './module/focus-system-request.mjs';
import { registerEffectScratchHiding, sweepEffectScratchItems } from './module/effect-authoring.mjs';
import { FOCUS_SYSTEM_FLAG, defaultFocusSystemData } from './module/focus-system-data.mjs';
import { getUserFlagData, calcHistoryExpTotal, TNX_FLAG_SCOPE } from './module/user-flag-schema.mjs';
import { calcSharedSpent, buildCastHistorySyncUpdate, mergeHistories, separateHistoryByOrigin } from './module/exp-sync.mjs';
import { TnxSkillUtils } from './module/tnx-skill-utils.mjs';
import { CONDITION_KINDS, CONDITION_GROUP_LABELS, getConditionKinds, buildInflictedEffectsData, applyDamageTagMods, readConditions, blocksMainProcess, actorCannotMainProcess } from './module/conditions.mjs';
import { gatherDamageTagMods, parseEffectTargetKey, buildTransferredEffectData, readFlag, AE_FLAG_PARAMS } from './data/item/helpers.mjs';
import { registerDamageChartTextSetting } from './module/damage-chart-text-app.mjs';
import { registerPartSlotPresetSetting, getPartSlotPreset, initializeDefaultPartSlotPreset, migratePartSlotKeys } from './module/part-slot-preset-app.mjs';
import { autoAcquireForStyleSkill, autoImportDerivedData } from './module/style-skill-acquisition.mjs';
import { conditionNeedsDraw, postDrawPrompt, postControlNegatePrompt, promptWoundSkillSelection, bindConditionChatButtons, renderConditionDrawCard } from './module/condition-resolution.mjs';
import { enhanceComboboxes } from './module/combobox.mjs';
import { OUTFIT_CATEGORIES } from './data/item/outfit-categories.mjs';

async function preloadHandlebarsTemplates() {
    const templatePaths = [
        // === Actor Sheets ===
        "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",

        // === Item Sheets ===
        "systems/tokyo-nova-axleration/templates/item/miracle-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/general-skill-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/style-skill-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/organization-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/item/life-path-sheet.hbs",

        // === Journal Sheets ===
        "systems/tokyo-nova-axleration/templates/journal/scenario-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/journal/focus-system-sheet.hbs",
        "systems/tokyo-nova-axleration/templates/parts/focus-system-editor.hbs",

        // === Chat ===
        // 判定結果系カードの基底部品(2026-07-19 基底化): 全カードが参照するためパーシャルとして先読み
        "systems/tokyo-nova-axleration/templates/chat/parts/check-card-head.hbs",
        "systems/tokyo-nova-axleration/templates/chat/parts/check-calc-rows.hbs",
        "systems/tokyo-nova-axleration/templates/chat/scene-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/check-result.hbs",
        "systems/tokyo-nova-axleration/templates/chat/check-request.hbs",
        "systems/tokyo-nova-axleration/templates/chat/attack-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/reaction-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/vehicle-move-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/rl-damage-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/condition-outcome.hbs",
        "systems/tokyo-nova-axleration/templates/chat/condition-prompt.hbs",

        // === App ===
        "systems/tokyo-nova-axleration/templates/parts/target-picker.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-request-app.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-damage.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-effect.hbs",
        "systems/tokyo-nova-axleration/templates/app/rl-grant-bounty.hbs",
        "systems/tokyo-nova-axleration/templates/chat/bounty-grant.hbs",
        "systems/tokyo-nova-axleration/templates/app/focus-system-panel.hbs",
        "systems/tokyo-nova-axleration/templates/app/focus-system-start.hbs",
        "systems/tokyo-nova-axleration/templates/chat/focus-system-start.hbs",
        "systems/tokyo-nova-axleration/templates/chat/focus-system-result.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs",

        // === Dialogs ===
        "systems/tokyo-nova-axleration/templates/dialog/check-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deck-creation-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/rich-confirm-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/unlink-confirm-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/usage-creation-dialog.hbs",

        // === Partials ===
        // アクターシート共通部品(フェーズ11-2。cast/guest 等で共有・features フラグで差異をゲート)
        "systems/tokyo-nova-axleration/templates/actor/parts/sidebar.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/header.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-abilities.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-combat.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-outfits.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-status.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-history.hbs",
        "systems/tokyo-nova-axleration/templates/actor/parts/tab-profile.hbs",
        "systems/tokyo-nova-axleration/templates/parts/active-effects-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/card-setup-app.hbs",
        "systems/tokyo-nova-axleration/templates/parts/prosemirror-editor.hbs",
        "systems/tokyo-nova-axleration/templates/parts/history-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/usage-list.hbs",
        "systems/tokyo-nova-axleration/templates/item/parts/skill-traits.hbs",
        "systems/tokyo-nova-axleration/templates/parts/bad-status-list.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-combo.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-bonus-rows.hbs",

        // === User Sheets ===
        "systems/tokyo-nova-axleration/templates/user/record-sheet.hbs",
    ];
    return foundry.applications.handlebars.loadTemplates(templatePaths);
}

async function setupDefaultSkills(actor) {
    try {
        const packId = "tokyo-nova-axleration.general-skills";
        const pack = game.packs.get(packId);
        if (!pack) {
            console.warn(`TokyoNOVA | General skills pack '${packId}' not found.`);
            return;
        }

        // インデックスで対象を絞ってから個別取得する(2026-07-17 是正): getDocuments の一括
        // 再取得はパック内の全キャッシュ文書を新インスタンスへ差し替え、開いている辞典シートを
        // 孤児化させる(用途削除が画面に反映されない実因と同経路)。getDocument はキャッシュ優先で
        // 差し替えを起こさない
        const index = await pack.getIndex({
            fields: ["system.generalSkillCategory", "system.identificationKey"],
        });
        const wanted = [...index].filter(e =>
            e.system?.generalSkillCategory === 'initialSkill'
            || e.system?.identificationKey === 'society_nova'
        );
        const toImport = (await Promise.all(wanted.map(e => pack.getDocument(e._id))))
            .filter(Boolean);
        if (toImport.length === 0) return;

        // 正規ソート順でソートし、sort 値を付与
        const sorted = [...toImport].sort((a, b) =>
            TnxSkillUtils.getSkillSortPosition(a.system.identificationKey)
            - TnxSkillUtils.getSkillSortPosition(b.system.identificationKey)
        );
        const itemsData = sorted.map((doc, idx) => {
            const data = doc.toObject();
            data.sort = (idx + 1) * 1000;
            return data;
        });

        await actor.createEmbeddedDocuments("Item", itemsData);
        console.log(`TokyoNOVA | Imported ${itemsData.length} default skills to ${actor.name}.`);
        ui.notifications.info(`${actor.name} に初期技能を ${itemsData.length} 個インポートしました。`);

    } catch (err) {
        console.error(`TokyoNOVA | Error importing default skills for ${actor.name}:`, err);
    }
}

/**
 * [All Clients] 開かれている関連シートを全て再描画する
 */
function handleRefreshSheets() {
    console.log("TokyoNOVA | Refresh request received by client.");
    // game.tnx.hudが存在し、かつ閉じられていない場合に再描画
    if (game.tnx?.hud && !game.tnx.hud._closed) {
        game.tnx.hud.render(true);
    }
    for (const app of Object.values(ui.windows)) {
        if (!app._closed) {
            app.render(true);
        }
    }
}

/**
 * ownerUserId に紐づく全キャストの消費経験点を集計し、User flag の EXP データを更新する。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {User} ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
async function syncCastExpToUser(ownerUser) {
    const linkedCasts = game.actors.filter(
        a => a.type === 'cast' && a.system.ownerUserId === ownerUser.uuid && a.system.syncWithOwner
    );

    const castExpList = linkedCasts.map(a => ({
        spent:      Number(a.system.exp?.spent)      || 0,
        additional: Number(a.system.exp?.additional) || 0,
    }));

    const newSpent = calcSharedSpent(castExpList);
    const { exp: { total: currentTotal, spent: currentSpent } } = getUserFlagData(ownerUser);

    if (currentSpent === newSpent) return;

    await ownerUser.update({
        [`flags.${TNX_FLAG_SCOPE}.exp.spent`]: newSpent,
        [`flags.${TNX_FLAG_SCOPE}.exp.value`]: currentTotal - newSpent,
    }, { syncing: true });
}

/**
 * ownerUserId が新規に記録された時点で、cast の history と User flag の history を
 * 双方向マージして両者を揃える初回同期を行う。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor}  castActor  cast タイプの Actor(ownerUserId 設定済み)
 * @param {User}   ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
async function performInitialHistorySync(castActor, ownerUser) {
    if (!castActor.system.syncWithOwner) return;
    const castHistory = castActor.system.history ?? {};
    const { history: userHistory } = getUserFlagData(ownerUser);
    const mergedHistory = mergeHistories(castHistory, userHistory);
    const newTotal = calcHistoryExpTotal(mergedHistory);

    // User flag: merged history 全エントリ + exp.total を更新
    // syncing: true で updateUser フックのループを防ぐ
    const flagUpdate = { [`flags.${TNX_FLAG_SCOPE}.exp.total`]: newTotal };
    for (const [id, entry] of Object.entries(mergedHistory)) {
        flagUpdate[`flags.${TNX_FLAG_SCOPE}.history.${id}`] = entry;
    }
    await ownerUser.update(flagUpdate, { syncing: true });

    // cast: system.history を merged に差分同期
    // syncing: true で updateActor フックのループを防ぐ
    const castHistoryUpdate = buildCastHistorySyncUpdate(castActor.system.history, mergedHistory);
    if (!foundry.utils.isEmpty(castHistoryUpdate)) {
        await castActor.update(castHistoryUpdate, { calcExp: false, syncing: true });
    }

    // exp.spent / exp.value を User flag に反映(syncCastExpToUser は syncing: true で書く)
    await syncCastExpToUser(ownerUser);

    // cast の exp.total / spent / value を User flag の新しい total に基づいて更新
    await TokyoNovaCastSheet.updateCastExp(castActor);
}

/**
 * syncWithOwner が ON→OFF になった際に、cast と User flag から相互の由来エントリを除去する。
 * GM クライアントのみ呼び出すこと。
 *
 * @param {Actor}  castActor  同期を切った cast タイプの Actor
 * @param {User}   ownerUser  cast.system.ownerUserId から取得した Foundry User
 */
async function performUnsyncSeparation(castActor, ownerUser) {
    const castUuid = castActor.uuid;

    // cast から User 由来(origin !== castUuid)のエントリを削除
    const castHistory = castActor.system.history ?? {};
    const { ownedByOther: castForeignEntries } = separateHistoryByOrigin(castHistory, castUuid);
    const castUpdate = {};
    for (const id of Object.keys(castForeignEntries)) {
        castUpdate[`system.history.-=${id}`] = null;
    }
    if (!foundry.utils.isEmpty(castUpdate)) {
        await castActor.update(castUpdate, { calcExp: false, syncing: true });
    }

    // User flag からこの cast 由来(origin === castUuid)のエントリを削除
    const { history: userHistory } = getUserFlagData(ownerUser);
    const { ownedByOrigin: castEntriesInUser, ownedByOther: remainingUserHistory } = separateHistoryByOrigin(userHistory, castUuid);
    const newTotal = calcHistoryExpTotal(remainingUserHistory);
    const flagUpdate = { [`flags.${TNX_FLAG_SCOPE}.exp.total`]: newTotal };
    for (const id of Object.keys(castEntriesInUser)) {
        flagUpdate[`flags.${TNX_FLAG_SCOPE}.history.-=${id}`] = null;
    }
    await ownerUser.update(flagUpdate, { syncing: true });

    // 分離後の EXP 再集計(sync 中の他キャスト分のみが残る)
    await syncCastExpToUser(ownerUser);
    await TokyoNovaCastSheet.updateCastExp(castActor);

    // ownerUser の update は syncing:true で行うため updateUser フックの再描画が
    // スキップされる。由来分離完了後に明示的に再描画する。
    const recordSheet = foundry.applications?.instances?.get(`tnx-record-sheet-${ownerUser.id}`);
    if (recordSheet?.rendered) recordSheet.render();
}

// アウトフィット集計(outfitMod / appearanceModifier)はフェーズ9-2 で
// CastDataModel.prepareDerivedData の派生算出へ移行した(B-2)。
// 派生値を DB に書き戻すフック方式(updateCastOutfitMods / updateCastAppearanceModifier /
// recalcOutfitAggregates)・起動時スキャン・isGhost 変更時の再集計は撤去。

// ActiveEffect 設定シートの詳細タブに TNX の設定(重複可・準備先・付与先)を注入する(フェーズ9-3 v2/v3)。
// 注入フィールドは name="flags.tokyo-nova-axleration.*" を与えて**ネイティブ項目と同じフォーム送信で
// 保存**する(2026-07-13 ユーザー指摘で是正: 即時 setFlag はドキュメント更新→シート再描画で
// 未保存のフォーム状態(transfer のオン等)を巻き戻すため廃止)。
Hooks.on("renderActiveEffectConfig", (app, element) => {
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;

    // 上書き系キーの値入力を選択式にする(2026-07-13 ユーザー確定・ベタ打ちさせない):
    // - check.cardValue: 判定に使用したカードの数字の上書き(A〜K)
    // - *.attack.damageType: ダメージ種別の上書き(S/P/I/X)
    // - 特性フラグ(フェーズ12): オン/オフ(true/false)
    // options は {value,label} 可(未指定は value=label)。
    const opt = (value, label) => ({ value, label: label ?? value });
    const flagKeyParam = (key) => {
        const p = parseEffectTargetKey(key);
        if (!p?.path) return null;
        const base = p.path.replace(/Total$/, "");
        return AE_FLAG_PARAMS.includes(base) ? base : (AE_FLAG_PARAMS.includes(p.path) ? p.path : null);
    };
    const VALUE_CHOICE_RULES = [
        { match: (k) => k === "check.cardValue",
          options: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].map(o => opt(o)) },
        { match: (k) => k.endsWith(".attack.damageType") || k === "system.baseAttack.damageType",
          options: ["S", "P", "I", "X"].map(o => opt(o)) },
        // 特性フラグのオン/オフ(フェーズ12)。キーが登録フラグを指すとき値をオン/オフの選択に
        { match: (k) => !!flagKeyParam(k), options: [opt("true", "オン"), opt("false", "オフ")] },
    ];
    const syncChangeValueInputs = () => {
        for (const keyInput of root.querySelectorAll('[name^="changes."][name$=".key"]')) {
            const valueName = keyInput.name.replace(/\.key$/, ".value");
            const valueEl = root.querySelector(`[name="${CSS.escape(valueName)}"]`);
            if (!valueEl) continue;
            const rule = VALUE_CHOICE_RULES.find(r => r.match((keyInput.value ?? "").trim()));
            if (rule) {
                const sig = rule.options.map(o => o.value).join(",");
                if (valueEl.tagName === "SELECT" && valueEl.dataset.tnxChoices === sig) continue;
                const cur = valueEl.value;
                const sel = document.createElement("select");
                sel.name = valueEl.name;
                sel.dataset.tnxChoices = sig;
                sel.innerHTML = ['<option value="">──</option>',
                    ...rule.options.map(o => `<option value="${o.value}"${cur === o.value ? " selected" : ""}>${o.label}</option>`),
                ].join("");
                valueEl.replaceWith(sel);
            } else if (valueEl.tagName === "SELECT" && valueEl.dataset.tnxChoices) {
                const inp = document.createElement("input");
                inp.type = "text";
                inp.name = valueEl.name;
                inp.value = valueEl.value;
                valueEl.replaceWith(inp);
            }
            // 部位行の追加(system.part.<部位キー> 等)の値は and/or[:消費数]。自由入力を保ったまま
            // datalist で補助する(消費数付き and:2 も打てるよう select にはしない・フェーズ12)
            const parsed = parseEffectTargetKey((keyInput.value ?? "").trim());
            if (parsed?.scope === "partAdd" && valueEl.tagName === "INPUT") {
                valueEl.setAttribute("list", "tnx-ae-part-relation");
            } else if (valueEl.tagName === "INPUT" && valueEl.getAttribute("list") === "tnx-ae-part-relation") {
                valueEl.removeAttribute("list");
            }
        }
    };
    // キー入力の補助 datalist(変更キーの全キー一覧。正本は wiki Active_Effects §2 と parseEffectTargetKey)。
    // 方針(2026-07-23 ユーザー確定): リスト形式の思想＝完全性。**有限の組合せは実キーで全列挙**
    // (分類×パラメータ・アイテム狙い×パラメータも含む)。**`<key>` プレースホルダは識別キーの指定のみ**に使う
    // (技能/スタイル/ワークス/アイテムの識別キー＝唯一の任意入力軸)。候補が多いのでコンボボックス側で
    // 表示上限＋「他N件」を出す(データは全件・絞り込みで到達)。
    if (!root.querySelector("#tnx-ae-key-suggestions")) {
        const partKeys = [...new Set(getPartSlotPreset().map(s => s?.key).filter(Boolean))];
        const abilities = ["reason", "passion", "life", "mundane"]; // 能力値4種(理性/感情/生命/外界)
        const condKinds = Object.keys(CONDITION_KINDS);             // ダメージタグ改変の元タグ候補(全数)
        const bsKinds = condKinds.filter(k => CONDITION_KINDS[k]?.group === "bs"); // 個別BSの無視ゲート
        // 分類キー(§2.4・全数): 大分類＋小分類＋疑似分類(generalSkill/styleSkill)
        const catKeys = [
            ...Object.keys(OUTFIT_CATEGORIES),
            ...Object.values(OUTFIT_CATEGORIES).flatMap(m => Object.keys(m.minors)),
            "generalSkill", "styleSkill",
        ];
        // アイテムの着地パラメータ(§2.3 型別全数)＋特性フラグ(§2.3c・AE_FLAG_PARAMS)。素のキー・
        // アイテム狙い・分類狙いで共通の「乗り先アイテムの属性」軸。
        const attrs = [
            "buy", "hide", "appearancePenalty", "hack", "preserveExp",             // 全アウトフィット共通
            "attack", "attack.damageType", "guardValue", "FAValue",                // 武器
            "defence.S", "defence.P", "defence.I", "controlMod",                    // 防具/義体/ヴィークル/IANUS
            "speedFactor", "passenger",                                            // ヴィークル
            "cycle", "combatSpeedMod",                                             // タップ
            "appearanceTarget", "cyberSecurity", "analogSecurity",                 // 住宅施設
            "level",                                                               // 技能
            ...AE_FLAG_PARAMS,                                                     // 特性フラグ(§2.3c)
        ];

        // 判定バフ(§2.7): 固定＋能力値・制御判定は全列挙、識別キー狙いは `<key>`(識別キー)雛形
        const checkKeys = [
            "check.all", "check.cardValue", "check.suitChange",
            ...abilities.map(a => `check.${a}`),
            ...abilities.map(a => `controlCheck.${a}`),
            "check.<key>", "check.style.<key>", "check.works.<key>",
        ];
        // 値バフ①キャラクター(§2.1): 能力値/制御値/CS/AR/生身ダメージ種別
        const charValueKeys = [
            ...abilities.map(a => `system.ability.${a}`),
            ...abilities.map(a => `system.control.${a}`),
            "system.cs.base", "system.cs.value", "system.cs.current",
            "system.ar.max",
            "system.baseAttack.damageType",
        ];
        // 値バフ②乗り先別(§2.2)。素のキー=乗っているアイテム自身 / item.<識別キー>=識別キー狙い(`<key>`) /
        // system.category.<分類>=分類狙い(実キーで全列挙)。属性軸(attrs)は全モード共通。
        const selfKeys = ["name", ...attrs.map(a => `system.${a}`)];
        const itemKeys = ["item.<key>.name", ...attrs.map(a => `item.<key>.system.${a}`)];
        const categoryKeys = catKeys.flatMap(c => attrs.map(a => `system.category.${c}.${a}`));
        // ダメージバフ(§2.8): 与える/受ける固定キー全数＋タグ改変(元タグ全数)＋識別キー狙いは `<key>` 雛形
        const damageKeys = [
            "damage.dealt", "damage.dealt.physical", "damage.dealt.mental", "damage.dealt.social",
            "damage.taken", "damage.taken.physical", "damage.taken.mental", "damage.taken.social",
            "damage.taken.S", "damage.taken.P", "damage.taken.I", "damage.taken.X",
            "damage.vsStyle.<key>", "damage.vsWorks.<key>", "damage.fromStyle.<key>", "damage.fromWorks.<key>",
            ...condKinds.map(k => `damage.replaceTag.${k}`),
            ...condKinds.map(k => `damage.addTag.${k}`),
        ];
        // 無視ゲート(§2.11): all / 全BS / 個別BS(全数) / ダメージ由来(全・系統別)
        const ignoreKeys = [
            "ignore.all", "ignore.bs", "ignore.damage",
            "ignore.damage.physical", "ignore.damage.mental", "ignore.damage.social",
            ...bsKinds.map(k => `ignore.bs.${k}`),
        ];

        const escAttr = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const keyList = document.createElement("datalist");
        keyList.id = "tnx-ae-key-suggestions";
        // 並びは「よく使う順」→ 分類狙い(件数の大半)を末尾に置く(表示上限の先頭が有用キーになるように)。
        keyList.innerHTML = [
            ...checkKeys,
            ...charValueKeys,
            ...selfKeys,
            ...partKeys.map(k => `system.partSlot.${k}`),
            ...partKeys.map(k => `system.part.${k}`),
            ...itemKeys,
            ...damageKeys,
            ...ignoreKeys,
            ...categoryKeys,
        ].map(v => `<option value="${escAttr(v)}"></option>`).join("");
        root.appendChild(keyList);
        const relList = document.createElement("datalist");
        relList.id = "tnx-ae-part-relation";
        relList.innerHTML = ["and", "or", "and:2", "or:2"].map(v => `<option value="${v}"></option>`).join("");
        root.appendChild(relList);
    }
    // キー入力の候補付けは毎レンダー(変更行の追加にも追従)
    for (const keyInput of root.querySelectorAll('[name^="changes."][name$=".key"]')) {
        keyInput.setAttribute("list", "tnx-ae-key-suggestions");
    }
    syncChangeValueInputs();
    // ネイティブ datalist を独自コンボボックスへ昇格(スクロール可・▼位置固定・テーマ追従)。
    // キー入力＋ partAdd 値入力(tnx-ae-part-relation)をまとめて拾う。
    enhanceComboboxes(root);
    root.addEventListener("change", (ev) => {
        if (typeof ev.target?.name === "string" && ev.target.name.endsWith(".key")) {
            syncChangeValueInputs();
            enhanceComboboxes(root); // キー変更で値入力に list が付いた分を昇格
        }
    });

    if (root.querySelector(".tnx-stackable-field")) return;
    const current = app.document?.getFlag?.("tokyo-nova-axleration", "stackable") === true;
    const group = document.createElement("div");
    group.classList.add("form-group", "tnx-stackable-field");
    group.innerHTML = `
        <label>重複可</label>
        <div class="form-fields">
            <input type="checkbox" name="flags.tokyo-nova-axleration.stackable" ${current ? "checked" : ""}>
        </div>`;
    const anchor = root.querySelector('[name="transfer"], [name="disabled"]')?.closest(".form-group");
    if (anchor) anchor.after(group);
    else (root.querySelector('.tab[data-tab="details"]') ?? root.querySelector("form"))?.appendChild(group);

    // 自動適用ゲート(2026-07-13 再設計): ネイティブ transfer を「効果を対象に自動適用」として使う。
    // 対象はキーが示すもの(キャラ値・アイテムのパラメータ・分類/識別キー該当アイテム)。
    // オンのとき=常時自動適用。オフのとき=使用時付与用ペイロード(用途の「適用される効果」でのみ付与)
    const transferInput = root.querySelector('[name="transfer"]');
    const transferGroup = transferInput?.closest(".form-group");
    if (transferGroup) {
        const label = transferGroup.querySelector("label");
        if (label) {
            label.textContent = "効果を対象に自動適用";
        }
        const hint = transferGroup.querySelector("p.hint");
        if (hint) hint.textContent = "オンなら効果がキーの示す対象へ常時自動で適用されます。";
    }

    // 準備先(親アイテム)に適用(自動適用オンのときのみ意味を持つ): 素のパラメータキーの効果を
    // このアイテムの準備先ホストに効かせる(準備で転送・解除で除去)。アイテム上の効果でのみ表示
    let parentGroup = null;
    if (app.document?.parent?.documentName === "Item") {
        const cur = app.document.getFlag?.("tokyo-nova-axleration", "applyToParent") === true;
        parentGroup = document.createElement("div");
        parentGroup.classList.add("form-group", "tnx-apply-parent-field");
        parentGroup.innerHTML = `
            <label>準備先（親アイテム）に適用</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.tokyo-nova-axleration.applyToParent" ${cur ? "checked" : ""}>
            </div>`;
        (transferGroup ?? anchor)?.after(parentGroup);
    }

    // 付与先: 使用時にこの効果を誰に付与するか。対象=ターゲットしたキャラクター(既定)/
    // 自分=使用者(用途解決時に即時付与=代償デバフ等)。**自動適用とは直交**(2026-07-13 ユーザー指摘で
    // 是正: 用途の適用効果は自動適用オンの効果も選択できるため、transfer で出し分けると設定に
    // 到達できない)。用途の効果はアイテム由来のみなので、アイテム上の効果で常時表示する
    if (app.document?.parent?.documentName === "Item") {
        const grantCur = app.document.getFlag?.("tokyo-nova-axleration", "grantTarget") === "self" ? "self" : "target";
        const grantGroup = document.createElement("div");
        grantGroup.classList.add("form-group", "tnx-grant-target-field");
        grantGroup.innerHTML = `
            <label>付与先</label>
            <div class="form-fields">
                <select name="flags.tokyo-nova-axleration.grantTarget">
                    <option value="target"${grantCur === "target" ? " selected" : ""}>対象</option>
                    <option value="self"${grantCur === "self" ? " selected" : ""}>自分</option>
                </select>
            </div>`;
        (parentGroup ?? transferGroup ?? anchor)?.after(grantGroup);
        // ※適用タイミング(命中時/ダメージ時)は AE 側に持たせない(2026-07-18 ユーザー確定)——
        //   攻撃用途の「適用される効果（ダメージ時）」リスト所属で決まる(usage.damageEffects)
    }

    // 出し分け: 準備先=自動適用オンのときだけ表示する(常時自動適用の乗り先修飾のため。
    // 使用時付与ではコピー作成時に applyToParent を落とす=オフ時に意味を持つ経路が無い)
    const syncModeFields = () => {
        if (parentGroup) parentGroup.style.display = (transferInput ? !!transferInput.checked : true) ? "" : "none";
    };
    syncModeFields();
    transferInput?.addEventListener("change", syncModeFields);

    // コンディション(BS)の効果値フィールドを詳細タブの**末尾**に注入する(フェーズ9-4)。
    // - BS 種別ごとに <fieldset><legend>BS名</legend> で囲む(箇条書きの羅列を避ける)。
    // - 効果値が可変な BS のみ欄を出す(固定値=酩酊 / 効果値なし=恐慌・戦闘不能 は出さない)。
    // - 値は kind 別キー flags.tokyo-nova-axleration.conditions[<kind>] へ setFlag(condition に閉じる)。
    // - ステータス欄を変えたら statuses を即 update して再注入する(保存=シートを閉じる、を避けて
    //   未保存でも効果値欄が出るようにする)。
    const detailsTab = root.querySelector('.tab[data-tab="details"]') ?? root.querySelector("form");
    const statusCtrl = root.querySelector('[name="statuses"]');
    const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
    const setK = (k, field, v) => app.document?.setFlag("tokyo-nova-axleration", `conditions.${k}.${field}`, v);

    const injectConditionFieldsets = () => {
        if (!detailsTab) return;
        detailsTab.querySelectorAll(".tnx-condition-fieldset").forEach(el => el.remove());
        const perKind = app.document?.getFlag?.("tokyo-nova-axleration", "conditions") ?? {};
        for (const kind of getConditionKinds(app.document)) {
            const def = CONDITION_KINDS[kind];
            if (!def) continue;
            const v = perKind[kind] ?? {};
            const fields = [];
            if (def.magnitudeField) {
                const isStrength = def.type === "computed" || def.type === "continuous";
                fields.push({ label: isStrength ? "強度 n" : "効果量",
                    html: `<input type="number" value="${Number(v.magnitude ?? 0) || 0}" step="1">`,
                    bind: (el) => el.addEventListener("change", (e) => setK(kind, "magnitude", Number(e.currentTarget.value) || 0)) });
            }
            if (def.abilityField) {
                const cur = v.targetAbility ?? "";
                const blank = `<option value="" ${cur === "" ? "selected" : ""}>${def.abilityBlankLabel ?? "全制御値"}</option>`;
                const sel = blank + Object.entries(ABIL).map(([k, l]) =>
                    `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("");
                fields.push({ label: "対象能力値", html: `<select>${sel}</select>`,
                    bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetAbility", e.currentTarget.value)) });
            }
            if (def.targetField) {
                fields.push({ label: "対象(UUID)", html: `<input type="text" value="${v.targetUuid ?? ""}" placeholder="Actor UUID">`,
                    bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetUuid", e.currentTarget.value.trim())) });
            }
            if (def.weaponField) {
                // 対象武器の指定(捕縛): 対象キャラの武器＋生身から選ぶ。空=生身(攻撃の「攻撃で使用」と同型)。
                // 保存はアイテム ID(生身=空)。効果は対象アクター上の効果なので parent の武器を列挙する。
                const parentActor = app.document?.parent;
                const weapons = parentActor?.items?.filter?.(i => i.type === "weapon") ?? [];
                const cur = v.targetWeapon ?? "";
                const opts = `<option value="" ${cur === "" ? "selected" : ""}>生身</option>`
                    + weapons.map(i => `<option value="${i.id}" ${i.id === cur ? "selected" : ""}>${foundry.utils.escapeHTML(i.name)}</option>`).join("");
                fields.push({ label: "対象武器", html: `<select>${opts}</select>`,
                    bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetWeapon", e.currentTarget.value)) });
            }
            if (!fields.length) continue; // 効果値なし/固定値の BS は欄を出さない
            const fs = document.createElement("fieldset");
            fs.classList.add("tnx-condition-fieldset");
            const legend = document.createElement("legend");
            legend.textContent = `${def.label}（効果値）`;
            fs.appendChild(legend);
            for (const f of fields) {
                const g = document.createElement("div");
                g.classList.add("form-group");
                g.innerHTML = `<label>${f.label}</label><div class="form-fields">${f.html}</div>`;
                f.bind(g.querySelector("input, select"));
                fs.appendChild(g);
            }
            detailsTab.appendChild(fs);
        }
    };

    injectConditionFieldsets();

    // status 選択を群(BS/戦闘不能/肉体/精神/社会)へグループ化する。
    // 描画後に option を動かすと <multi-select> が壊れる(2026-06-24 修正)。そこで Foundry の
    // ファクトリ createMultiSelectInput で optgroup 構成済みの要素を作って置換する。
    // 失敗時は既定の選択欄にフォールバック(絶対に壊さない)。変更時は statuses を即永続化(再注入で欄即出)。
    const persist = (el) => async () => {
        const v = el.value;
        const ids = Array.isArray(v) ? v : (v ? [v] : []);
        await app.document?.update({ statuses: ids });
    };
    let boundCtrl = statusCtrl;
    if (statusCtrl) {
        try {
            const groups = Object.values(CONDITION_GROUP_LABELS);
            const options = Object.entries(CONDITION_KINDS).map(([id, def]) => ({
                value: id, label: def.label, group: CONDITION_GROUP_LABELS[def.group] ?? "",
            }));
            const grouped = foundry.applications.fields.createMultiSelectInput({
                name: statusCtrl.getAttribute("name") || "statuses",
                type: "multi", options, groups, value: [...(app.document?.statuses ?? [])],
            });
            statusCtrl.replaceWith(grouped);
            boundCtrl = grouped;
        } catch (e) {
            console.warn("Tokyo NOVA: status のグループ化に失敗、既定の選択欄を使用します。", e);
            boundCtrl = statusCtrl;
        }
        boundCtrl.addEventListener("change", persist(boundCtrl));
    }
});

// コンディション(BS)のステータスを外したら、その kind の効果値フラグを後始末する(フェーズ9-4)。
// statuses から消えた kind の flags.tokyo-nova-axleration.conditions[<kind>] を削除する。
// (AE 自体の削除時はフラグごと消えるため対象外。複数状態 AE から1つ外した場合などが対象。)
Hooks.on("preUpdateActiveEffect", (effect, changes) => {
    if (!("statuses" in changes)) return;
    const perKind = effect.flags?.["tokyo-nova-axleration"]?.conditions;
    if (!perKind) return;
    const next = new Set(changes.statuses ?? []);
    for (const kind of Object.keys(perKind)) {
        if (!next.has(kind)) changes[`flags.tokyo-nova-axleration.conditions.-=${kind}`] = null;
    }
});

// 状態カスケード(フェーズ9-4): inflicts を持つ状態(負傷等)が付与されたら、指定の別状態を自動付与する。
// 付与する別状態は **状態のみ(changes なし=コンディション)** で、ダメージ/カスケード由来は
// hideFromList=true で AE 本体をリスト非表示(状態アイコンは出る・供給元が浮かない)。
// inflicts 先の状態は inflicts を持たないため循環しない。生成は付与した本人(userId)のみが行う。
Hooks.on("createActiveEffect", async (effect, options, userId) => {
    if (game.user.id !== userId) return;
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;

    // 1. カスケード: inflicts の別状態を付与(状態のみ・hideFromList)。
    // 供給元が負傷(wound)の場合、その inflicts は「そのダメージチャートの効果」なので woundSource で
    // 負傷に紐づける(戦闘不能も BS も含め全て)。消費側で扱いを分ける:
    //   ・治療(〈医療〉): 負傷＋紐づきの非BSを除去し BS は残す(BS は独立効果)。
    //   ・制御判定の無効化: 負傷＋紐づき全て(BS 含む)を除去=ダメージ自体が無効(2026-07-09 裁定)。
    // ※BS の回復(BS 自身の解除条件・解除効果・将来の自動回復=15)は **その BS のみ**を除去し、
    //   woundSource を辿って負傷を消してはならない(BS を回復してもダメージは治療されない=2026-07-09)。
    const srcKind = getConditionKinds(effect)[0];
    const srcIsWound = CONDITION_KINDS[srcKind]?.type === "wound";
    // タグ改変(2026-07-12・支配タグ): 負傷(ダメージチャート)由来の付与のみ、対象自身の AE
    // (damage.replaceTag/addTag)でタグを置換/追加する(例 昏睡/精神崩壊→支配・抹殺に支配を追加)
    const tagMods = srcIsWound ? gatherDamageTagMods(actor) : null;
    // 説得(2026-07-15 ユーザー確定): 精神攻撃の説得は、精神ダメージの「効果タグ」＝戦闘不能
    // (incapacitation グループ・支配含む)を付けず「説得に応じる」形にする。BS は通常どおり付与する。
    const persuade = effect.flags?.["tokyo-nova-axleration"]?.persuade === true;
    const data = [];
    const seen = new Set();
    for (const kind of getConditionKinds(effect)) {
        let list = buildInflictedEffectsData(kind, { hidden: true });
        if (tagMods) list = applyDamageTagMods(list, tagMods);
        for (const d of list) {
            const ik = d.statuses[0];
            const idef = CONDITION_KINDS[ik];
            if (persuade && idef?.group === "incapacitation") continue; // 説得: 戦闘不能タグ(支配含む)を付けない
            if (idef && !idef.stackable && (actor.statuses?.has?.(ik) || seen.has(ik))) continue;
            if (srcIsWound) {
                d.flags["tokyo-nova-axleration"].woundSource = effect.id;
            }
            seen.add(ik);
            data.push(d);
        }
    }
    if (data.length) await actor.createEmbeddedDocuments("ActiveEffect", data);

    // 2. この状態自身の解決受付: 衰弱/重圧のカード決定ドロー / controlNegate の制御判定。
    //    フラグ(inflicts 由来=付与時に焼き込み)に加え、状態定義直下の controlNegate(付与状態を
    //    持たない負傷自身の制御判定=動転)も読む(2026-07-22 ユーザー指摘で配線)。
    const perKind = effect.flags?.["tokyo-nova-axleration"]?.conditions ?? {};
    for (const c of readConditions(effect)) {
        if (conditionNeedsDraw(c.kind, c)) await postDrawPrompt(actor, effect, c.kind);
        const cn = perKind[c.kind]?.pendingControlNegate ?? c.def?.controlNegate;
        if (cn) await postControlNegatePrompt(actor, effect, c.kind, cn);
    }
    // 3. 選択型負傷(造反/人脈消失/スキャンダル/信頼喪失=社会/コネ「ひとつ」)の使用不可対象を、
    //    付与ユーザーに選ばせて targetSkill を確定する(付与経路を問わない=2026-07-16 是正)。
    await promptWoundSkillSelection(actor, effect);

    // 4. メインプロセス不可の戦闘不能(気絶/失神/仮死/昏睡/完全死亡/精神崩壊=blocksMainProcess。
    //    抹殺・支配は除く)が付いたら、カット進行の脱落マーク(combatant.defeated)を自動でオンにする
    //    (2026-07-22 ユーザー指示。「dead」だけ core の特別ステータス(DEFEATED)で自動脱落になる
    //    非対称の解消)。除去時の自動オフは下の deleteActiveEffect フック。
    if (getConditionKinds(effect).some(k => blocksMainProcess(CONDITION_KINDS[k]))) {
        for (const combat of game.combats) {
            for (const c of (combat.getCombatantsByActor?.(actor) ?? [])) {
                if (!c.defeated) await c.update({ defeated: true }).catch(() => {});
            }
        }
    }
});

// 脱落マークの自動オフ: メインプロセス不可の状態が除去され、他に該当状態が残っていなければ
// 脱落マークを外す(治療・制御判定無効・カット終了回復のたびに RL の手動戻しを要しないため。
// タグと無関係に RL が手で付けた脱落は、この経路では該当状態が元々無い=除去イベントも来ないので触らない)
Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
    if (game.user.id !== userId) return;
    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (!getConditionKinds(effect).some(k => blocksMainProcess(CONDITION_KINDS[k]))) return;
    if (actorCannotMainProcess(actor)) return; // まだ別の該当状態が残っている
    for (const combat of game.combats) {
        for (const c of (combat.getCombatantsByActor?.(actor) ?? [])) {
            if (c.defeated) await c.update({ defeated: false }).catch(() => {});
        }
    }
});

// アイテム狙いの AE の物理転送(2026-07-13 再設計)+片方向同期(2026-07-12 ユーザー指摘=
// 「後から元のエフェクト側を更新した場合に反映されない」)。**供給元が正**:
// - 効果の作成/更新時・アイテムの追加/装着系更新時に、**自動適用(transfer)オン**の効果の
//   アイテム狙いの変更(item.<識別キー>/system.category)を**対象アイテム上の実体コピー**
//   (キーは素の system.<パス> に書き換え)として作成/上書きする。
// - 「準備先(親アイテム)に適用」(flags.applyToParent)の効果は、素のパラメータキーの変更を
//   準備先ホスト(bearer.system.parentItemId)へ転送する(準備で転送・解除で除去)。
// - 自動適用オフ(=使用時付与用ペイロード)は転送しない。オフへの切替・狙い外れ・供給元の削除で
//   コピーを除去する。
// コピーは対象アイテムの通常の効果=無条件にそのアイテムへ効く。コピー側の手動編集・切替は
// 供給元の次の更新で上書きされる(供給元が正の帰結)。
const TNX_TRANSFER_SCOPE = "tokyo-nova-axleration";

async function materializeItemTransfers(actor, effect, bearer) {
    if (!actor || actor.documentName !== "Actor") return;
    const flags = effect.flags?.[TNX_TRANSFER_SCOPE] ?? {};
    // 実体化済みインスタンス(転送コピー/使用時付与コピー)は転送の供給元にならない
    if (flags.transferredFrom || flags.grantedFrom) return;
    const isAuto = effect.transfer !== false; // 自動適用ゲート(オフ=ペイロード)
    const toParent = flags.applyToParent === true && bearer?.documentName === "Item";
    const hasItemTarget = isAuto && !toParent && (effect.changes ?? []).some(c => {
        const p = parseEffectTargetKey(c.key);
        return p && ["skill", "category"].includes(p.scope);
    });
    const targets = (item) => (isAuto && toParent)
        ? bearer.system?.parentItemId === item.id
        : hasItemTarget;
    for (const item of actor.items) {
        const copy = item.effects.find(e => e.flags?.[TNX_TRANSFER_SCOPE]?.transferredFrom === effect.uuid);
        if (!targets(item) && !copy) continue;
        const data = targets(item) ? buildTransferredEffectData(effect, item, bearer) : null;
        if (data) {
            if (copy) await copy.update(data); // 供給元が正: コピーを供給元の現在値で上書き
            else await item.createEmbeddedDocuments("ActiveEffect", [data]);
        } else if (copy) {
            await copy.delete(); // 供給元がこのアイテムを狙わなくなった→コピー除去
        }
    }
}

/** 供給元(uuid 群)由来の転送コピーをアクターの全アイテムから除去する。 */
async function removeItemTransferCopies(actor, sourceUuids) {
    for (const item of actor.items) {
        const ids = item.effects
            .filter(e => sourceUuids.includes(e.flags?.[TNX_TRANSFER_SCOPE]?.transferredFrom))
            .map(e => e.id);
        if (ids.length) await item.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
}

Hooks.on("createActiveEffect", async (effect, _options, userId) => {
    if (game.user.id !== userId) return;
    const parent = effect.parent;
    const actor = parent?.documentName === "Actor" ? parent : parent?.actor;
    if (actor) await materializeItemTransfers(actor, effect, parent);
});

Hooks.on("updateActiveEffect", async (effect, changed, _options, userId) => {
    if (game.user.id !== userId) return;
    // transfer(自動適用ゲート)・flags(準備先チェック等)の切替でも転送を再評価する(2026-07-13 再設計)
    if (!["changes", "disabled", "name", "img", "transfer", "flags"].some(k => k in (changed ?? {}))) return;
    const parent = effect.parent;
    const actor = parent?.documentName === "Actor" ? parent : parent?.actor;
    if (actor) await materializeItemTransfers(actor, effect, parent);
});

// 供給元の効果が削除されたら転送コピーも除去する(供給元が正・2026-07-12)
Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
    if (game.user.id !== userId) return;
    const flags = effect.flags?.[TNX_TRANSFER_SCOPE] ?? {};
    if (flags.transferredFrom || flags.grantedFrom) return; // コピー自身の削除は独立
    const parent = effect.parent;
    const actor = parent?.documentName === "Actor" ? parent : parent?.actor;
    if (actor) await removeItemTransferCopies(actor, [effect.uuid]);
});

// 供給元アイテムごと削除された場合(内包効果の deleteActiveEffect は発火しない)
Hooks.on("deleteItem", async (item, _options, userId) => {
    if (game.user.id !== userId) return;
    const actor = item.actor;
    if (!actor) return;
    const uuids = item.effects.map(e => e.uuid);
    if (uuids.length) await removeItemTransferCopies(actor, uuids);
});

// アイテムがアクターに追加されたとき: 既存の供給元効果からこのアイテムへ向く転送を実体化する
Hooks.on("createItem", async (item, _options, userId) => {
    if (game.user.id !== userId) return;
    const actor = item.actor;
    if (!actor) return;
    for (const e of actor.effects) await materializeItemTransfers(actor, e, actor);
    for (const it of actor.items) {
        if (it.id === item.id) continue;
        for (const e of it.effects) await materializeItemTransfers(actor, e, it);
    }
});

// 武器区分フラグの分類既定(2026-07-17 ユーザー確定): 分類(小分類)を変更したら、その分類の
// 既定(白兵武器→白兵/射撃武器・搭載兵器→射撃/生体装備→白兵/該当なし=両OFF)で敷き直す
// (自動入力と同じ「明示的な上書き」の意味論。以後の手動変更はそのまま生きる)
Hooks.on("preUpdateItem", (item, changes) => {
    const minor = changes?.system?.minorCategory;
    if (minor === undefined || item.system?.isMeleeWeapon === undefined) return;
    if (minor === item.system.minorCategory) return;
    const seed = defaultWeaponKindForCategory(minor) ?? { melee: false, ranged: false };
    changes.system.isMeleeWeapon  = seed.melee;
    changes.system.isRangedWeapon = seed.ranged;
});

// アイテムの装着系フィールドが変わったとき: 転送を再評価する(2026-07-13 再設計)。
// 準備/解除(parentItemId)で準備先転送が付け外しされ、分類・識別キーの変更で
// アイテム狙い転送の照合が変わる(従来はここが穴で、装着変更が反映されなかった)
Hooks.on("updateItem", async (item, changed, _options, userId) => {
    if (game.user.id !== userId) return;
    const actor = item.actor;
    if (!actor) return;
    const sys = changed?.system ?? {};
    if (!["parentItemId", "identificationKey", "majorCategory", "minorCategory"].some(k => k in sys)) return;
    for (const e of actor.effects) await materializeItemTransfers(actor, e, actor);
    for (const it of actor.items) {
        for (const e of it.effects) await materializeItemTransfers(actor, e, it);
    }
});

// チャットの受付ボタン(ドロー/制御判定)を解決処理に配線する(フェーズ9-4)。
// 効果決定カード(conditionDraw フラグ)は状態領域をライブ描画する(ボタン→結果の置換・2026-07-12)。
Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    bindConditionChatButtons(root);
    renderConditionDrawCard(message, root);
});

// ─── チャットカードのライブ描画(フラグ→表示)はトップレベルで登録する ─────────────
// チャットログの初期描画(既存メッセージの一括レンダリング)は ready 発火前に走るため、
// ready 内で登録するとリロード直後の表示分にフックが効かない(ダメージカードは本文が殻の
// ため「内容がすべて消える」ように見えていた=2026-07-14 ユーザー報告で是正)。

// 攻撃カード(12-2): 状態領域のライブ描画(未解決=系統別リアクションボタン/解決後=成否表示に置換。
// checkRequest の結果注入と同型のフラグ+再描画方式)
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "attackCheck")) {
        renderAttackCard(message, html);
    }
});

// 個別リアクションカード(12・複数対象一括・2026-07-15): GM＋対象所有者に whisper・解決で全体公開
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "attackReaction")) {
        renderReactionCard(message, html);
    }
});

// 報酬点の配布カード(12・2026-07-20): 対象行に受け取りボタン/受け取り済みをライブ描画
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "bountyGrant")) {
        renderBountyGrantCard(message, html);
    }
});

// ダメージ・カード(12-3): 台帳+状態領域のライブ描画(カード追加・適用で更新)
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "damageRoll")) {
        renderDamageCard(message, html);
    }
});

// 用途の適用効果(2026-07-10): usageEffects フラグを持つカード(判定結果/攻撃/用途使用)に
// 「効果を適用」ボタンを描画。対象所有者/GM が押すと対象へ AE を複製付与する。
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "usageEffects")) {
        renderUsageEffectButton(message, html);
    }
});

// 再判定(2026-07-11→2026-07-14 置き換え着地): checkRecheck フラグを持つカード(判定結果/攻撃)の
// 達成値を装飾する(モード外クリック=allowRecheck の素の再判定・モード中=付与/修正の発動)。
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "checkRecheck")) {
        renderRecheckButton(message, html);
    }
});

// 判定要求チャットカード: 目標値の可視性制御 + 「判定する」ボタン / 結果注入（フェーズ 8-5）
Hooks.on("renderChatMessageHTML", (message, html) => {
    const flagData = message.getFlag("tokyo-nova-axleration", "checkRequest");
    if (!flagData) return;

    // 目標値: targetValueHidden かつ非 GM の場合は非公開表示
    const tnEl = html.querySelector(".cr-req-tn-value");
    if (tnEl && flagData.targetValueHidden && !game.user.isGM) {
        tnEl.textContent = "（非公開）";
        tnEl.classList.add("cr-req-tn-hidden");
    }

    // 各対象行: 結果がある場合は結果表示、未判定の場合はボタンまたは「待機中」
    for (const row of html.querySelectorAll(".cr-req-target-row")) {
        const actorId  = row.dataset.actorId;
        const statusEl = row.querySelector(".cr-req-target-status");
        if (!statusEl) continue;

        const result = flagData.results?.[actorId];
        if (result) {
            // 判定済み: 結果を表示
            const resultEl = document.createElement("div");
            resultEl.className = "cr-req-result";
            if (flagData.checkType === "controlCheck") {
                // controlNegate 由来の要求は帰結(無効化/降格/継続)もライブ書き換えで表示する
                const negateText = result.negateOutcome?.text
                    ? ` <span class="cr-req-negate">${foundry.utils.escapeHTML(result.negateOutcome.text)}</span>`
                    : "";
                resultEl.innerHTML = (result.success
                    ? '<span class="cr-inline-success"><i class="fas fa-check"></i> 成功</span>'
                    : '<span class="cr-inline-failure"><i class="fas fa-times"></i> 失敗</span>')
                    + negateText;
            } else if (result.fumble) {
                resultEl.innerHTML = '<span class="cr-inline-fumble"><i class="fas fa-skull"></i> ファンブル</span>';
            } else {
                const mark = result.success === true
                    ? ' <span class="cr-inline-success"><i class="fas fa-check"></i> 成功</span>'
                    : result.success === false
                        ? ' <span class="cr-inline-failure"><i class="fas fa-times"></i> 失敗</span>'
                        : '';
                // 代用判定(2026-07-09): 指定と別の技能で判定した事実を要求カードにも明示する
                const subNote = result.substitution?.usedName
                    ? ` <span class="cr-req-note">代用:${foundry.utils.escapeHTML(result.substitution.usedName)}</span>`
                    : '';
                resultEl.innerHTML = `達成値 <strong>${result.achievement ?? "—"}</strong>${mark}${subNote}`;
            }
            statusEl.replaceChildren(resultEl);
        } else if (flagData.status !== "closed") {
            // 未判定: 判定ボタンはそのアクターの所有者権限を持つユーザー(+GM)に出す
            // (2026-07-19 ユーザー指示: 対象はアクター登録=ユーザー割り当て・接続状況に依存しない)
            const targetActor = game.actors.get(actorId);
            if (targetActor?.isOwner || game.user.isGM) {
                const btn = document.createElement("button");
                btn.type      = "button";
                // テキストボタンは丸型(tnx-ring-btn)に詰め込まない。アイコンは判定=カードのため
                // カードマーク(2026-07-09 修正。gavel=裁判官の木槌は「judgement」の誤訳由来)
                btn.className = "tnx-chat-btn tnx-check-do-btn";
                btn.innerHTML = '<i class="fas fa-diamond"></i> 判定する';
                btn.addEventListener("click", () => {
                    TnxRlRequestApp.onDoCheck(flagData, actorId, message.id);
                });
                statusEl.replaceChildren(btn);
            } else {
                const waiting = document.createElement("span");
                waiting.className = "cr-req-waiting";
                waiting.textContent = "待機中…";
                statusEl.replaceChildren(waiting);
            }
        }
    }
});

// FS 進行判定(13-7): 進行判定要求カードで成功した対象行に、RL(=GM)へ「進行値に加算」ボタンを描画する。
// 上の checkRequest 描画(結果を statusEl に置く)の**後**に登録し、その結果表示にボタンを足す形にする。
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "checkRequest")?.focusSystemKind === "progress") {
        renderFocusProgressButton(message, html);
    }
});

// FS 支援判定: 支援判定は結果確定で**自動適用**(メジャー記帳＋成功なら対象へ支援 AE(進行 +1)を付与＝
// autoApplyFocusSupport が _onCheckResult で実行。AR−1＋CS0 はイニシアチブ終了時に一般則で適用・
// 2026-07-26/08-05)。ここは適用済みの表示(支援成立→対象の進行+1／支援失敗)のみ描画する。
Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.getFlag("tokyo-nova-axleration", "checkRequest")?.focusSystemKind === "support") {
        renderFocusSupportNote(message, html);
    }
});

// FS判定のカット進行への合流(13-7③④): プロセス開始で進行/支援判定を自動送信する。
// メイン開始→その手番のキャストへ進行判定(ルール14)・イニシアチブ開始→AR残の参加者へ支援判定
// (ルール15)を、各実行中 FS について送る(境界イベントは GM 側発火＝autoSendFocusChecks が GM 実行)。
Hooks.on("tnxProcessStart", (combat, data) => {
    autoSendFocusChecks(combat, data?.phase);
});

// FS判定のカット連動(13-7⑥): カット境界(カットが1つ終わった=tnxCutEnd)で、実行中 FS(cut 型敗北)の
// 経過カットを +1 する。パネルのカット表示は cutLimit−経過 のカウントダウンで自動更新される。
Hooks.on("tnxCutEnd", () => {
    advanceFocusCuts();
});

Hooks.once("init", async function() {
    game.tnx = game.tnx || {}
    game.tnx.refreshSheets = handleRefreshSheets;

    // 効果の下書き置き場はアイテムディレクトリに出さない(組み立て中だけ存在する器)。
    // サイドバーの初回描画は ready より前なので、隠すフックの登録は init で行う
    registerEffectScratchHiding();

    // チャット通知のデフォルトを「チャットカード」から「通知バッジ」に変更する。
    // ユーザーが明示的に設定済みの場合はその値が優先される(デフォルト値のみの変更)。
    const chatNotifSetting = game.settings.settings.get("core.chatNotifications");
    if (chatNotifSetting) chatNotifSetting.default = "pip";
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
    });

    // 符号付き表記(判定修正の内訳等)。負値は "-n"、0以上は "+n"。ハードコードの "+" 前置だと
    // マイナス修正が "+-n" になるため(眼部損傷 -5 等)、必ず本ヘルパーで符号を付ける。
    Handlebars.registerHelper('signed', function(n) {
        const v = Number(n) || 0;
        return v >= 0 ? `+${v}` : `${v}`;
    });

    // アイテム名の表示マーカー(2026-06-12 ユーザー確定ルール)
    // - 一般技能: アクション技能なら頭に「★」(スタイル技能には付さない)
    // - スタイル技能: カテゴリが秘技「†」/ 奥義「※」/ 演出特技「＠」を頭に付す
    // - アウトフィット: isCyber なら末尾に「※」
    Handlebars.registerHelper('tnxDecoratedName', function(item) {
        const name = item?.name ?? "";
        const system = item?.system ?? {};
        if (item?.type === "generalSkill") {
            return (system.isAction ? "★" : "") + name;
        }
        if (item?.type === "styleSkill") {
            const prefix = { secret: "†", mystery: "※", performance: "＠" }[system.styleSkillCategory] ?? "";
            return prefix + name;
        }
        if (readFlag(system, "isCyber") && system.majorCategory !== "cyberware") return `${name}※`;
        return name;
    });

    // 武器射程の表記(min/max が同じなら単一表記、異なるなら「近～超遠」形式)
    Handlebars.registerHelper('tnxRangeLabel', formatWeaponRangeLabel);

    await preloadHandlebarsTemplates();
    CONFIG.Item.documentClass = TokyoNovaItem;
    // 名前装飾(フェーズ12)のためネイティブ AE 適用の一点(Actor への `name`)だけ抑止する
    CONFIG.ActiveEffect.documentClass = TokyoNovaActiveEffect;

    // ActiveEffect の転送モードを新方式にする(フェーズ9-3)。
    // レガシー(true)では「アイテムに乗せた効果がアイテム自身に適用されない」(モードA 不成立)、
    // かつ v13 のトークンアクターで transfer:true が転送されないバグがある。
    // false にすると、transfer:false の効果はアイテム自身へ、transfer:true の効果は
    // アイテム上から親アクターへ仮想適用される(着地点 effectMod に正しく流れ込む)。
    CONFIG.ActiveEffect.legacyTransferral = false;

    // カット進行(戦闘システム・フェーズ13)の Combat/Combatant 派生クラスを登録。
    // 13-2 は「器」＝クラス新設・登録・カット開始シードのロジック集約まで。
    // プロセス状態機械・CS/AR 自動記帳・トラッカー UI は 13-3 以降。
    CONFIG.Combat.documentClass = TnxCombat;
    CONFIG.Combatant.documentClass = TnxCombatant;
    // カット進行のサイドバートラッカー(13-4)。既定のコンバットトラッカーを上書きする。
    CONFIG.ui.combat = TnxCombatTracker;

    // Actor DataModel の登録(全 Actor type)
    CONFIG.Actor.dataModels = {
      cast:   CastDataModel,
      guest:  GuestDataModel,
      troop:  TroopDataModel,
      extra:  ExtraDataModel,
    };

    // Item DataModel の登録(B-7b: styleSkill 追加、全 17 type 登録完了)
    CONFIG.Item.dataModels = {
      housingArea:  HousingAreaDataModel,
      organization: OrganizationDataModel,
      lifePath:     LifePathDataModel,
      armor:        ArmorDataModel,
      cyborg:       CyborgDataModel,
      combiner:     CombinerDataModel,
      general:      GeneralDataModel,
      ianus:        IanusDataModel,
      tron:         TronDataModel,
      vehicle:      VehicleDataModel,
      weapon:       WeaponDataModel,
      tap:          TapDataModel,
      residence:    ResidenceDataModel,
      miracle:      MiracleDataModel,
      generalSkill: GeneralSkillDataModel,
      style:        StyleDataModel,
      styleSkill:   StyleSkillDataModel,
    };

    // Card DataModel の登録(B-8: 全 3 type 登録完了)
    CONFIG.Card.dataModels = {
      playingCards: PlayingCardsDataModel,
      neuroCards:   NeuroCardsDataModel,
      other:        OtherDataModel,
    };

    // システム用のCONFIG名前空間を準備
    CONFIG.TNX = {};

    // フェイズのキーと、対応する翻訳キー（または直接の日本語名）を定義
    CONFIG.TNX.phaseLabels = {
        opening: "オープニング",
        research: "リサーチ",
        climax: "クライマックス",
        ending: "エンディング"
    };

    // トーキョーN◎VA の状態(BS・戦闘不能・負傷)を CONDITION_KINDS から生成する(フェーズ9-4)。
    // id = conditionKind。flags に conditionKind を持たせ、貼付時に condition として認識させる。
    // 順は CONDITION_KINDS の統合順(BS→戦闘不能→肉体→精神→社会)。効果値はインスタンス毎に詳細タブで設定。
    // hideFromList: トークン右クリック「ステータス効果の設定」からの付与でも、ダメージ適用と同様に
    // バッジのみ追加しシートのアクティブエフェクト一覧には行を出さない(2026-07-11 ユーザー確定)
    CONFIG.statusEffects = Object.entries(CONDITION_KINDS).map(([id, def]) => ({
        id,
        name: def.label,
        img:  def.img ?? "icons/svg/aura.svg",
        flags: { "tokyo-nova-axleration": { conditionKind: id, hideFromList: true } },
    }));

    // トークンリソースバーの割当候補(フェーズ11-4)。トループの heads=人数/エニグマポイントが
    // HP のように機能する(Troops.md)。他 type はチャート式ダメージのためバー非対応。
    CONFIG.Actor.trackableAttributes = {
        troop: { bar: ["heads"], value: [] },
    };
    
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

    // --- システム設定の登録 ---
    // ダメージチャート効果文(ワールド設定＋編集アプリメニュー)
    registerDamageChartTextSetting();

    // 部位スロットプリセット(ワールド設定＋編集アプリメニュー。新規キャストへ流し込む)
    registerPartSlotPresetSetting();

    // 実行中 FS判定の正本(フェーズ12-5)
    registerFocusSystemSetting();
    registerSessionStateSetting();
    registerSubSceneSetting();

    game.settings.register("tokyo-nova-axleration", "defaultHandMaxSize", {
        name: "デフォルトの手札上限数",
        hint: "各ユーザーの手札上限の基本となる枚数を設定します。ユーザーが個別に設定していない場合、この値が適用されます。",
        scope: "world",
        config: true,
        type: Number,
        default: 4,
        requiresReload: true
    });

    // 正準名ブリッジの一回限り移行(2026-07-17)の実行済みフラグ(ready フックでゲート)
    game.settings.register("tokyo-nova-axleration", "usageTypeCanonicalMigrated", {
        scope: "world", config: false, type: Boolean, default: false,
    });

    game.settings.register("tokyo-nova-axleration", "shuffleOnDeckReset", {
        name: "山札リセット時にシャッフル",
        hint: "山札のリセット（全回収）や捨て札の回収を行った際、自動的に山札をシャッフルします。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false // デフォルトはOFF
    });

    // カードID設定（config: false — UIはカードセットアップアプリで管理）
    const _cardIdSetting = { scope: "world", config: false, type: String, default: "" };
    game.settings.register("tokyo-nova-axleration", "cardDeckId",       { ..._cardIdSetting });
    game.settings.register("tokyo-nova-axleration", "discardPileId",    { ..._cardIdSetting });
    game.settings.register("tokyo-nova-axleration", "neuroDeckId",      { ..._cardIdSetting });
    game.settings.register("tokyo-nova-axleration", "scenePileId",      { ..._cardIdSetting });
    game.settings.register("tokyo-nova-axleration", "accessCardPileId", { ..._cardIdSetting });
    game.settings.register("tokyo-nova-axleration", "gmTrumpDiscardId", { ..._cardIdSetting });

    // HUD UI 状態（クライアントローカル）
    const _hudUiSetting = { scope: "client", config: false, type: Boolean, default: false };
    game.settings.register("tokyo-nova-axleration", "hudRightCollapsed",  { ..._hudUiSetting });
    game.settings.register("tokyo-nova-axleration", "hudBottomCollapsed", { ..._hudUiSetting });
    game.settings.register("tokyo-nova-axleration", "hudAccessCollapsed", { ..._hudUiSetting, default: true });

    game.settings.register("tokyo-nova-axleration", "revealPlayerHands", {
        name: "プレイヤーの手札を開示",
        hint: "有効にすると全ユーザーのHUDにプレイヤー全員の手札が表示されます。",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    game.settings.registerMenu("tokyo-nova-axleration", "cardSetup", {
        name: "カードをセットアップ",
        label: "カードの設定を開く",
        hint: "山札・手札などのカードドキュメントを作成・割り当てします。",
        icon: "fas fa-cards",
        type: TnxCardSetupApp,
        restricted: true,
    });

    // プレイヤーリストの右クリックメニューに「レコードシートを開く」を追加する。
    // 自分の分は全員、他人の分は GM のみ表示。
    Hooks.on("getUserContextOptions", (_html, options) => {
        options.push({
            name: "レコードシートを開く",
            icon: '<i class="fas fa-id-card"></i>',
            condition: (li) => {
                const el = li instanceof Element ? li : li[0];
                const userId = el?.dataset?.userId ?? el?.dataset?.documentId;
                if (!userId) return false;
                return game.user.isGM || userId === game.user.id;
            },
            callback: (li) => {
                const el = li instanceof Element ? li : li[0];
                const userId = el?.dataset?.userId ?? el?.dataset?.documentId;
                if (!userId) return;
                const user = game.users.get(userId);
                if (!user) return;
                // 既に開いていれば最前面に出す
                const appId = `tnx-record-sheet-${user.id}`;
                const existing = foundry.applications?.instances?.get(appId);
                if (existing) { existing.bringToFront(); return; }
                new TnxRecordSheet(user).render(true);
            },
        });
    });

    // 判定・ダメージへの特殊処理の正規の置き場=チャットカードの右クリックメニュー(GM のみ表示・
    // 2026-07-14 ユーザー確定)。用途フラグ(再判定を付与/判定を修正/ダメージを修正)のアイテムロールは
    // 同じ内部機能への例外的な外部アクセス(クリック待ち経由=メニュー不要)。
    // ※登録は init で行う: ChatLog のコンテキストメニューは ready 発火前のサイドバー描画時に
    // 構築されるため、ready 内の登録では間に合わない(実機で項目が出ず 2026-07-14 修正)
    Hooks.on("getChatMessageContextOptions", (_app, options) => {
        const SCOPE = "tokyo-nova-axleration";
        const msgOf = (li) => {
            const el = li instanceof Element ? li : li[0];
            return game.messages.get(el?.dataset?.messageId);
        };
        options.push(
            {
                name: "再判定（この判定をやり直す）",
                icon: '<i class="fas fa-rotate-right"></i>',
                condition: (li) => {
                    if (!game.user.isGM) return false;
                    const m = msgOf(li);
                    return !!m?.getFlag(SCOPE, "checkRecheck") && !TnxCheckFlow.recheckBlockReason(m);
                },
                callback: (li) => TnxCheckFlow.startRecheck(msgOf(li)),
            },
            {
                name: "達成値を修正（手動）",
                icon: '<i class="fas fa-pen"></i>',
                // スナップショット持ちのカードに限る: 継続処理系(移動/治療等)は達成値だけ書き換えると
                // 適用済みの帰結と乖離し、事後修正のライブ描画もスナップショット持ちでしか動かない
                condition: (li) => game.user.isGM && !!msgOf(li)?.getFlag(SCOPE, "checkRecheck"),
                callback: (li) => TnxCheckFlow.manualEditAchievement(msgOf(li)),
            },
            {
                name: "ダメージを修正（手動）",
                icon: '<i class="fas fa-burst"></i>',
                // 達成値の手動修正と同じ最終裁定ツール=適用済みでも制限しない(2026-07-14 ユーザー確定)
                condition: (li) => game.user.isGM && !!msgOf(li)?.getFlag(SCOPE, "damageRoll"),
                callback: async (li) => {
                    const { manualEditDamage } = await import("./module/damage-flow.mjs");
                    await manualEditDamage(msgOf(li));
                },
            },
            {
                name: "ダメージ処理をリセット",
                icon: '<i class="fas fa-rotate-left"></i>',
                // 攻撃カードの damageRolled を戻し「ダメージカードを出す」ボタンを復活させる=算出の
                // やり直し(2026-07-14 ユーザー確定)。出済みのダメージカードは残る(整理は手動)。
                // タイミング系ゲート(再判定・事後修正)もリセット後は自然に再び開く
                condition: (li) => {
                    if (!game.user.isGM) return false;
                    const f = msgOf(li)?.getFlag(SCOPE, "attackCheck");
                    return !!f && f.damageRolled === true;
                },
                callback: async (li) => {
                    const { applyAttackPatch } = await import("./module/attack-flow.mjs");
                    await applyAttackPatch(msgOf(li), { damageRolled: false });
                    ui.notifications.info("ダメージ処理をリセットしました（出済みのダメージカードは必要に応じて削除してください）。");
                },
            },
        );
    });

    // v13: 標準ボタン行(header-actions)の直後に「アクトシートを作成」ボタンを 2 段目として挿入する。
    Hooks.on("renderJournalDirectory", (app, html, data) => {
        if (!game.user.isGM) return;

        const createEntryButton = html.querySelector('[data-action="createEntry"]');
        if (!createEntryButton) return;

        /** シートクラスを指定してジャーナルを作り、開く。 */
        const makeCreateButton = (label, icon, className, name, sheetClass, extraFlags = {}) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = className;
            button.innerHTML = `<i class="fas ${icon}"></i><span>${label}</span>`;
            button.addEventListener('click', async () => {
                const newJournal = await JournalEntry.create({
                    name,
                    flags: { core: { sheetClass }, ...extraFlags },
                });
                newJournal?.sheet.render(true);
            });
            return button;
        };

        // .action-buttons 内に追加し、flex-wrap で 2 段目に折り返させる（幅が自動で揃う）
        const actionsRow = createEntryButton.closest('.action-buttons') ?? createEntryButton.parentElement;
        actionsRow.style.flexWrap = 'wrap';
        actionsRow.appendChild(makeCreateButton(
            'アクトシートを作成', 'fa-file-medical', 'tnx-create-act-button',
            '新規アクトシート', `tokyo-nova.${TnxScenarioSheet.name}`,
        ));
        // FS判定シート: 空の設定フラグを入れて作る(これが「FS判定シートである」印になり、
        // 起動フォームの読み込み元の絞り込みに使われる)
        actionsRow.appendChild(makeCreateButton(
            'FS判定シートを作成', 'fa-bullseye', 'tnx-create-act-button',
            '新規FS判定', `tokyo-nova.${TnxFocusSystemSheet.name}`,
            { [FOCUS_SYSTEM_FLAG.scope]: { [FOCUS_SYSTEM_FLAG.key]: defaultFocusSystemData() } },
        ));
    });

    Hooks.on("preCreateActor", (actor, data, options, userId) => {
        // guest はセッション履歴以外キャストとデータ的に同一(フェーズ11-3)のため、部位プリセットも流し込む
        if (data.type !== "cast" && data.type !== "guest") return;

        // 部位スロット集合: 未設定なら全アクター共通プリセットを流し込む(フェーズ10)
        const hasPartSlots = Array.isArray(data.system?.partSlots) && data.system.partSlots.length > 0;
        if (!hasPartSlots) {
            const preset = getPartSlotPreset();
            if (preset.length) {
                actor.updateSource({ "system.partSlots": foundry.utils.deepClone(preset) });
            }
        }

        // 以下の所有権設定はキャスト(プレイヤー作成)のみ。ゲストは RL の持ち物のため既定のまま
        if (data.type !== "cast") return;

        const ownership = data.ownership || {};
        ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
        const user = game.users.get(userId);
        if (user && !user.isGM) {
            ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        } else {
            ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
        }
        actor.updateSource({ ownership: ownership });
    });

    /**
     * アイテム作成時の権限設定
     * GMでないユーザーが作成した場合、オーナー権限を付与する
     */
    Hooks.on("preCreateItem", (item, data, options, userId) => {
        // 一般技能がエキストラ直下に作られる場合(辞典インポート・ドロップ等の全経路)、
        // エキストラは固定値判定しか行えないため、元データの「判定」等の固定値以外の用途を
        // 自動削除し、固定値用途が無ければ自動追加する(2026-07-04 確定)
        if (data.type === "generalSkill" && item.parent?.type === "extra") {
            const original = data.system?.actions ?? [];
            const kept = original.filter(a => a.type === "check" && Number.isFinite(a.fixedResult));
            if (!kept.length) {
                kept.push({
                    _id:             foundry.utils.randomID(),
                    type:            "check",
                    // 用途名の既定は空(2026-07-17): 実効名=親アイテム名
                    name:            "",
                    description:     "",
                    timing:          { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
                    target:          "blank",
                    effects:         [],
                    skillRefs:       [],
                    weaponRefs:      [],
                    damageType:      "",
                    checkBonuses:    [],
                    damageBonuses:   [],
                    modifiableParams: [],
                    fixedResult:     10,
                });
            }
            item.updateSource({ "system.actions": kept });
            return;
        }

        // 一般技能: 用途が未設定の場合に「判定」用途を1件自動挿入する
        // baseSkillRef には親アイテム自身の ID を設定する（用途が判定の起点技能を明示的に保持）
        if (data.type === "generalSkill" && !(data.system?.actions?.length)) {
            item.updateSource({
                "system.actions": [{
                    _id:             foundry.utils.randomID(),
                    type:            "check",
                    // 用途名の既定は空(2026-07-17): 実効名=親アイテム名
                    name:            "",
                    description:     "",
                    timing:          { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
                    target:          "blank",
                    effects:         [],
                    baseSkillRef:    { itemId: item._id ?? "" },
                    skillRefs:       [],
                    weaponRefs:      [],
                    damageType:      "",
                    checkBonuses:    [],
                    damageBonuses:   [],
                    modifiableParams: [],
                    // 消費既定は空(2026-07-17 ユーザー指示=無条件の「親×1」既定行は全廃)
                    consumeTargets:  [],
                }],
            });
        }

        // 作成者がGMの場合はデフォルト処理に任せる（通常はOwnerになる）
        const user = game.users.get(userId);
        if (user && user.isGM) return;

        // 既存の権限設定を取得、または初期化
        const ownership = data.ownership || {};

        // 作成者にオーナー権限(3)を付与
        ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

        // FVTT v12 API: updateSourceを使用して更新
        item.updateSource({ ownership: ownership });
    });

    Hooks.on("preCreateCard", (card, data, options, userId) => {
        const parentPile = card.parent;

        // 既存の切り札上限チェック処理
        if (!parentPile || !parentPile.getFlag("tokyo-nova-axleration", "isTrumpPile")) {
            return true;
        }
        if (parentPile.cards.size >= 1) {
            ui.notifications.warn("切り札置き場はすでにいっぱいです。");
            return false;
        }
        return true;
    });

    Hooks.on("createActor", async (actor, options, userId) => {
        // 自身が作成したアクターのみ対象
        if (userId !== game.user.id) return;
    
        // キャストの場合：ダイアログで確認せずに手札作成は行わない
        if (actor.type === "cast") {
            // デフォルト設定の更新
            await actor.update({
                "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                "prototypeToken.actorLink": true,
                "prototypeToken.sight.enabled": true,
                "prototypeToken.sight.range": 1000
            });
            setupDefaultSkills(actor);
        }

        // ゲスト: 名前あり NPC＝リンクトークン。基本13技能もキャスト同様に流し込む(フェーズ11-3。
        // disposition は敵味方が場合によるため既定のまま)
        if (actor.type === "guest") {
            await actor.update({ "prototypeToken.actorLink": true });
            setupDefaultSkills(actor);
        }

        // トループ: heads(人数/エニグマポイント)をリソースバーへ既定割当(フェーズ11-4)。
        // 判定はキャストと同じため基本13技能も流し込む。トークンは非リンク既定(複数部隊を並べる)
        if (actor.type === "troop") {
            await actor.update({
                "prototypeToken.bar1.attribute": "heads",
                "prototypeToken.displayBars": CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
            });
            // 分身は本体からの再同期で全アイテムを写すため 13 技能を流し込まない(2026-07-08 修正。
            // 非同期シードが再同期(全削除→コピー)の後に着地して二重取得になる競合の防止)
            if (actor.system.troopMode !== "bunshin") setupDefaultSkills(actor);
        }

        // エキストラ: 名前ありの端役＝リンクトークン。基本は名前のみのため技能は流し込まない(フェーズ11-5)
        if (actor.type === "extra") {
            await actor.update({ "prototypeToken.actorLink": true });
        }
    });

    Hooks.on("preDeleteItem", async (item, options, userId) => {
        if (item.type === "miracle" && item.actor) {
            // 母数(uses.max)が2以上なら削除でなく-1(多重取得の1つを外す)。2026-07-18 uses 一本化
            // max は StringField(式可・2026-08-09)のため土台は usesMaxBaseOf・保存は文字列
            const uses = item.system.uses ?? {};
            const max = usesMaxBaseOf(item.system);
            if (max > 1) {
                const newMax = max - 1;
                await item.update({
                    "system.uses.max": String(newMax),
                    "system.uses.spent": Math.min(Number(uses.spent) || 0, newMax),
                });
                ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                return false;
            }
        }
        if (item.type === "style" && item.actor) {
            try {
                // このフックはレベル1のスタイル削除時にのみ動作する想定
                // 対応する神業を1つだけ削除する
                const miracleUuid = item.system.miracle?.id;
                if (miracleUuid) {
                    const sourceMiracle = await fromUuid(miracleUuid);
                    if (sourceMiracle) {
                        const miracleNameToDelete = sourceMiracle.name;
                        const actor = item.actor;
                        const itemToDelete = actor.items.find(i => i.type === 'miracle' && i.name === miracleNameToDelete);
    
                        if (itemToDelete) {
                            await itemToDelete.delete();
                            ui.notifications.info(`スタイル「${item.name}」の削除に伴い、神業「${itemToDelete.name}」を1つ削除しました。`);
                        }
                    }
                }
            } catch (e) {
                console.error(`TokyoNOVA | Error deleting associated Divine Work for style ${item.name}:`, e);
            }
            return true;
        }
    });

    Hooks.on("preUpdateItem", async(item, changes) => {
        // 更新されるアイテムが神業の場合の処理
        if (item.type === "miracle") {
            // 「使用済み(isUsed)」フラグが true → false に変更されたら残りを満タンへ(spent=0)。2026-07-18 uses 一本化
            const newIsUsed = foundry.utils.getProperty(changes, "system.isUsed");
            if (item.system.isUsed === true && newIsUsed === false) {
                foundry.utils.setProperty(changes, "system.uses.spent", 0);
                ui.notifications.info(`神業「${item.name}」の使用回数がリセットされました。`);
            }
        }
    
        // スタイルアイテム以外の更新は無視 (既存の処理)
        if (item.type === "style" && item.actor) {
            const oldLevel = item.system.level || 1;
            const newLevel = foundry.utils.getProperty(changes, "system.level");
    
            // レベル変更時の神業母数(uses.max)連動(2026-07-18 uses 一本化):
            // 母数 = 連動スタイルの合計レベル(上限3・「母数=スタイルレベルと同一」ユーザー確定)。
            // 万能神業(ファイト！等)による増加は AE で uses.max に乗る(ここでは基礎値のみ維持)——
            // AE は実効値 uses.maxTotal へ着地する(2026-08-09・KI-038 で着地点を新設)。
            if (newLevel !== undefined && newLevel !== oldLevel) {
                (async () => {
                    try {
                        const miracleUuid = item.system.miracle?.id;
                        if (!miracleUuid) return;
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (!sourceMiracle) return;
                        const existingMiracle = item.actor.items.find(i => i.type === 'miracle' && i.name === sourceMiracle.name);
                        if (!existingMiracle) return;

                        // 連動スタイル(同じ神業を指す)の合計レベル(更新中は newLevel を使う)→ 上限3
                        const allLinkedStyles = item.actor.items.filter(i => i.type === 'style' && i.system.miracle?.id === miracleUuid);
                        const totalStyleLevel = allLinkedStyles.reduce((sum, s) =>
                            sum + (s.id === item.id ? newLevel : (s.system.level || 1)), 0);
                        const newMax = Math.max(1, Math.min(3, totalStyleLevel));
                        const curMax = usesMaxBaseOf(existingMiracle.system);
                        if (newMax !== curMax) {
                            const spent = Math.min(Number(existingMiracle.system.uses?.spent) || 0, newMax);
                            await existingMiracle.update({ "system.uses.max": String(newMax), "system.uses.spent": spent });
                            ui.notifications.info(`神業「${existingMiracle.name}」の母数を${newMax > curMax ? "+" : "-"}1しました。`);
                        }
                    } catch (e) { console.error(`TokyoNOVA | Error updating Divine Work usage count:`, e); }
                })();

                // レベルが3になったら、役割を「ペルソナ」「キー」に強制設定
                if (newLevel === 3) {
                    foundry.utils.setProperty(changes, "system.isPersona", true);
                    foundry.utils.setProperty(changes, "system.isKey", true);
                } 
                // レベルが3から下がったら、役割を「シャドウ」にリセット
                else if (oldLevel === 3 && newLevel < 3) {
                    foundry.utils.setProperty(changes, "system.isPersona", false);
                    foundry.utils.setProperty(changes, "system.isKey", false);
                }
            }
        }
    });

    /**
     * Cardの子ドキュメントが作成された際にUIを更新するフック。
     * カードが手札や捨て札に移動した（描画された、プレイされた）場合などに作動します。
     */
    // GM 専用: シーンコントロールに「判定要求」ボタンを追加（フェーズ 8-5）
    // V13: controls は配列ではなくグループ名をキーとするオブジェクト
    // FS判定パネルは**全員**に出す(PL の参照手段を兼ねる・2026-07-20 ユーザー指示)
    Hooks.on("getSceneControlButtons", (controls) => {
        let tokenGroup;
        if (Array.isArray(controls)) {
            tokenGroup = controls.find(c => c.name === "tokens" || c.name === "token");
        } else if (controls instanceof Map) {
            tokenGroup = controls.get("tokens") ?? controls.get("token");
        } else {
            tokenGroup = controls?.["tokens"] ?? controls?.["token"];
        }
        if (!tokenGroup) return;
        // 全員可視のパネル起動ボタン: シナリオコントロール(14-3)・FS判定(12-5)
        const panelTools = [
            {
                name:    "tnxScenarioControl",
                title:   "シナリオコントロール",
                icon:    "fas fa-film",
                button:  true,
                onChange: () => openScenarioPanel(),
                visible: true,
            },
            {
                name:    "tnxFocusSystem",
                title:   "FS判定",
                icon:    "fas fa-bullseye",
                button:  true,
                onChange: () => openFocusSystemPanel(),
                visible: true,
            },
        ];
        const tools = tokenGroup.tools;
        for (const tool of panelTools) {
            if (Array.isArray(tools)) tools.push(tool);
            else if (tools instanceof Map) tools.set(tool.name, tool);
            else if (tools && typeof tools === "object") tools[tool.name] = tool;
            else tokenGroup.tools = { [tool.name]: tool };
        }
    });

    // シナリオコントロールパネルの表示は台本(アクトシートのフラグ)に追随する(14-3)。
    // 実行状態(sessionState)の変化は設定の onChange が再描画する。
    Hooks.on("updateJournalEntry", (doc) => {
        if (doc.id && doc.id === getSessionState().actId) {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
        }
    });

    // 登場状態(Actor フラグ)の変化にパネルの「登場中」表示・チームのゲートを追随させる(14-5)。
    // 名前の非公開(14-8)も同じ一覧の表示を変えるため同じ購読に乗せる。
    // 担当キャラクターのゴースト切替は HUD のステータス表示(14-7)にも反映する
    Hooks.on("updateActor", (actor, changes) => {
        const f = changes.flags?.["tokyo-nova-axleration"];
        const appearanceKeys = ["appearing", "-=appearing", "appearingHidden", "-=appearingHidden"];
        if (f && appearanceKeys.some(key => key in f)) {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
        }
        if (changes.system?.isGhost !== undefined && actor.id === game.user.character?.id) {
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });

    // HUD のステータス表示(14-7)の追随: シーンプレイヤー(自分の User flag)・抹殺(担当キャラの状態)
    Hooks.on("updateUser", (user, changes) => {
        if (user.id === game.user.id && changes.flags?.["tokyo-nova-axleration"]) {
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });
    for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
        Hooks.on(hook, (effect) => {
            if (effect.parent?.id && effect.parent.id === game.user.character?.id) {
                foundry.applications.instances.get("tnx-hud")?.render(false);
            }
        });
    }

    // 登場状態 ⇄ アクティブ盤面のトークン表示(hidden)の双方向同期(14-5・activeGM が代行)
    registerAppearanceTokenSync();

    // サブシーンの表示はドキュメントを書き換えず、クライアント側で背景テクスチャを差し替える
    // (14-4 是正・シーン読み込みを走らせない)。適用フラグの更新(updateScene)と canvasReady で
    // 再適用し、パネルの「適用中」表示も追随させる
    Hooks.on("updateScene", (scene) => {
        foundry.applications.instances.get("tnx-subscene-panel")?.render(false);
        if (scene.id === canvas?.scene?.id) refreshSubSceneBackground();
    });
    Hooks.on("canvasReady", () => refreshSubSceneBackground());

    Hooks.on("getSceneControlButtons", (controls) => {
        if (!game.user.isGM) return;
        // V13: controls はグループ名をキーとするオブジェクト（キーは複数形）
        // V12 以前: 配列
        let tokenGroup;
        if (Array.isArray(controls)) {
            tokenGroup = controls.find(c => c.name === "tokens" || c.name === "token");
        } else if (controls instanceof Map) {
            tokenGroup = controls.get("tokens") ?? controls.get("token");
        } else {
            tokenGroup = controls?.["tokens"] ?? controls?.["token"];
        }
        if (!tokenGroup) return;
        const newTools = {
            tnxCheckRequest: {
                name:    "tnxCheckRequest",
                title:   "判定要求",
                icon:    "fas fa-cards",
                button:  true,
                onChange: () => new TnxRlRequestApp().render(true),
                visible: true,
            },
            // RL 任意ダメージ付与(フェーズ12・2026-07-20): 判定を経由しないギミックのダメージ。
            // 対象はレティクルで明示する
            tnxGrantDamage: {
                name:    "tnxGrantDamage",
                title:   "ダメージ付与",
                icon:    "fas fa-burst",
                button:  true,
                onChange: () => openRlGrantDamage(),
                visible: true,
            },
            // RL 任意の状態・効果付与(フェーズ12・2026-07-20)
            tnxGrantEffect: {
                name:    "tnxGrantEffect",
                title:   "状態・効果の付与",
                icon:    "fas fa-hand-sparkles",
                button:  true,
                onChange: () => openRlGrantEffect(),
                visible: true,
            },
            // 報酬点の配布(前金・フェーズ12・2026-07-20。負数で没収)
            tnxGrantBounty: {
                name:    "tnxGrantBounty",
                title:   "報酬点の配布",
                icon:    "fas fa-coins",
                button:  true,
                onChange: () => openRlGrantBounty(),
                visible: true,
            },
            // サブシーン(フェーズ14-4): 名前付き盤面状態の保存・切替(RL 専用の道具)
            tnxSubScenes: {
                name:    "tnxSubScenes",
                title:   "サブシーン",
                icon:    "fas fa-images",
                button:  true,
                onChange: () => openSubScenePanel(),
                visible: true,
            },
        };
        const tools = tokenGroup.tools;
        for (const [key, tool] of Object.entries(newTools)) {
            if (Array.isArray(tools)) {
                tools.push(tool);
            } else if (tools instanceof Map) {
                tools.set(key, tool);
            } else if (tools && typeof tools === "object") {
                tools[key] = tool;
            } else {
                tokenGroup.tools = { ...(tokenGroup.tools ?? {}), [key]: tool };
            }
        }
    });

    Hooks.on("createCard", (cardDocument, options, userId) => {
        console.log(`TokyoNOVA | Card created in ${cardDocument.parent.name}. Refreshing UIs.`);
        setTimeout(() => game.tnx.refreshSheets(), 50);
    });

    /**
     * Cardの子ドキュメントが削除された際にUIを更新するフック。
     * カードが山札や手札から移動した（描画された、プレイされた）場合などに作動します。
     */
    Hooks.on("deleteCard", (cardDocument, options, userId) => {
        console.log(`TokyoNOVA | Card deleted from ${cardDocument.parent.name}. Refreshing UIs.`);
        setTimeout(() => game.tnx.refreshSheets(), 50);
    });
});

Hooks.once("ready", async function() {
    game.tnx = game.tnx || {};

    // 効果シートを開いたままワールドを閉じた場合にだけ残る下書きの置き忘れを片づける
    await sweepEffectScratchItems();

    // 部位スロットプリセット: ワールド初回ロードでデフォルト体部位を自動設定(GM のみ・1回)
    await initializeDefaultPartSlotPreset();

    // 部位キーの付与移行(フェーズ12・GM のみ・1回): プリセット設定と全アクターの partSlots に
    // 無キー行のキーを永続化する(既定ラベル=対応表・カスタム=生成キー)
    await migratePartSlotKeys();

    // 正準名ブリッジの一回限り移行(2026-07-17 ユーザー承認・GM のみ・1回): 既定一般技能の用途を
    // 行動種別タイプへ付け替える(回避→ドッジ・白兵→パリー・自我/信用→各リアクション・医療→治療・
    // 操縦→移動/リアクション（移動妨害）の追加)。以後の資格・候補判定は用途タイプの所持のみ
    // (skillRoles・正準名既定は廃止=この移行とインポート時正規化だけが対応表を使う)
    if (game.user.isGM && !game.settings.get("tokyo-nova-axleration", "usageTypeCanonicalMigrated")) {
        const migrateSkill = async (item) => {
            if (item.type !== "generalSkill") return;
            const src = item.toObject().system ?? {};
            const next = canonicalizeSkillActions(
                { name: item.name, identificationKey: src.identificationKey ?? "", actions: src.actions ?? [] },
                () => foundry.utils.randomID());
            if (next) await item.update({ "system.actions": next });
        };
        for (const it of game.items.contents) await migrateSkill(it);
        for (const actor of game.actors.contents) {
            for (const it of actor.items.contents) await migrateSkill(it);
        }
        await game.settings.set("tokyo-nova-axleration", "usageTypeCanonicalMigrated", true);
        console.log("TNX | 用途タイプの正準名移行を完了しました");
    }

    // 下バー展開時はホットバーを退避する。HUD 初期描画前に body クラスを付与して
    // 「ホットバー表示→直後に非表示」のチラつきを防ぐ(下バー収納の既定は false=展開)。
    if (!game.settings.get("tokyo-nova-axleration", "hudBottomCollapsed")) {
        document.body.classList.add("tnx-bottom-hud-expanded");
    }
    game.tnx.hud = new TnxHud();
    game.tnx.hud.render({ force: true });
    // サイドバー追従の沈静化: ロード直後はサイドバー位置が未確定でめり込むため、右カラムは
    // CSS で非表示にしておき、UI 安定後(ready+遅延)に実測位置をセットしてからフェードインで出す。
    // これで「安全位置→実測位置へカクっと移動」する瞬間を見せずに済む(下バーは別要素で表示のまま)。
    setTimeout(() => {
        TnxHud._settled = true;
        TnxHud._applyRightOffset?.();            // 実測位置をセット(まだ非表示)
        document.body.classList.add("tnx-hud-settled"); // 右カラムをフェードインで表示
    }, 500);

    // 判定フロー: ダイアログクラスを注入してグローバルに公開
    TnxCheckFlow.dialogClass = TnxCheckDialog;
    game.tnx.check = TnxCheckFlow;

    // システムソケットメッセージの受信（TnxSocketHandler に集約）
    game.socket.on("system.tokyo-nova-axleration", TnxSocketHandler.onMessage);

    Hooks.on("updateSetting", (setting) => {
        if (setting.key === "tokyo-nova-axleration.revealPlayerHands") {
            game.tnx?.hud?.render();
        }
    });

    Hooks.on("renderPlayerList", () => {
        if (!TnxHud._playerListObserver) {
            TnxHud._setupPlayerListObserver();
        } else if (TnxHud._playerListUpdate) {
            requestAnimationFrame(TnxHud._playerListUpdate);
        }
    });

    // サイドバー再描画時にオブザーバーをリセット(#sidebar-content が作り直される可能性)
    Hooks.on("renderSidebar", () => {
        TnxHud._rightOffsetObserver?.disconnect();
        TnxHud._rightOffsetObserver = null;
        TnxHud._setupRightOffsetObserver();
    });

    // 2-1/2-2: ownerUserId 未記録キャストの起動時初期化
    // Phase 2-1 デプロイ前に ownership が設定済みのキャストはここで補完する
    if (game.user.isGM) {
        const gmSet = new Set(game.users.filter(u => u.isGM).map(u => u.id));
        const OBSERVER = 2;
        for (const cast of game.actors.filter(a => a.type === 'cast' && !a.system.ownerUserId)) {
            for (const [userId, level] of Object.entries(cast.ownership ?? {})) {
                if (userId === 'default' || level < OBSERVER || gmSet.has(userId)) continue;
                const foundUser = game.users.get(userId);
                if (foundUser?.uuid) {
                    await cast.update({ "system.ownerUserId": foundUser.uuid }, { calcExp: false, syncing: true });
                    if (cast.system.syncWithOwner) {
                        await performInitialHistorySync(cast, foundUser);
                    }
                    break;
                }
            }
        }
    }

    // 所有トループ級の消費は取得元キャストに計上される(11-6・Troops.md)ため、
    // トループ側のアイテム変動でも所有者キャストの EXP を再計算する(分身は計上対象外)
    const recalcTroopOwnerExp = (troop) => {
        if (troop?.type !== "troop" || troop.system?.troopMode === "bunshin") return;
        const uuid = troop.system?.ownerActorRef?.uuid ?? "";
        if (!uuid) return;
        let owner = null;
        try { owner = fromUuidSync(uuid); } catch { owner = null; }
        if (owner?.type === "cast") TokyoNovaCastSheet.updateCastExp(owner);
    };

    const recalcActorExp = (item) => {
        if (!item.parent) return;
        if (item.parent.type === 'cast') {
            TokyoNovaCastSheet.updateCastExp(item.parent);
        } else if (item.parent.type === 'troop') {
            recalcTroopOwnerExp(item.parent);
        }
    };

    // 所有者参照・種別の変更で計上先が移動するため、旧所有者を preUpdate で捕捉して双方を再計算する。
    // トループ削除時も所有者の消費が減るため再計算する
    Hooks.on("preUpdateActor", (actor, changes, options) => {
        if (actor.type !== "troop") return;
        if (foundry.utils.hasProperty(changes, "system.ownerActorRef")
            || foundry.utils.hasProperty(changes, "system.troopMode")) {
            options.tnxPrevTroopOwnerUuid = actor.system.ownerActorRef?.uuid ?? "";
        }
    });
    Hooks.on("updateActor", (actor, changes, options) => {
        if (actor.type !== "troop" || options.tnxPrevTroopOwnerUuid === undefined) return;
        const uuids = new Set([options.tnxPrevTroopOwnerUuid, actor.system.ownerActorRef?.uuid ?? ""]);
        for (const uuid of uuids) {
            if (!uuid) continue;
            let owner = null;
            try { owner = fromUuidSync(uuid); } catch { owner = null; }
            if (owner?.type === "cast") TokyoNovaCastSheet.updateCastExp(owner);
        }
    });
    Hooks.on("deleteActor", (actor) => recalcTroopOwnerExp(actor));

    // トループ級シートの「所有者経験点」表示は描画時に所有者キャストの exp を読むだけのため、
    // キャスト側の exp 変動では自動再描画されない。開いている該当トループ級シートを明示的に
    // 再描画して表示を同期する(11-6)
    Hooks.on("updateActor", (actor, changes) => {
        if (actor.type !== "cast" || !foundry.utils.hasProperty(changes, "system.exp")) return;
        for (const app of foundry.applications.instances.values()) {
            const doc = app.document;
            if (doc?.documentName === "Actor" && doc.type === "troop"
                && (doc.system.ownerActorRef?.uuid ?? "") === actor.uuid) {
                app.render();
            }
        }
    });

    Hooks.on('createItem', (item) => recalcActorExp(item));
    Hooks.on('deleteItem', (item) => recalcActorExp(item));
    Hooks.on('updateItem', (item, diff, options) => recalcActorExp(item));

    // スタイル技能をアクターに取得(インポート/ドロップ)した時、自動取得対象の武器を複製生成(10-2)。
    // 多重生成を避けるため作成したユーザーのみ実行。
    Hooks.on('createItem', (item, options, userId) => {
        if (game.user.id !== userId) return;
        if (item.parent?.documentName !== "Actor") return;
        // 技能チェーンの既定(ベース技能・必須コンボ)をインポート直後に適用(2026-07-08 修正)。
        // 辞典/ワールドで用途を設定→アクターへインポートでは、用途シートを開くまで自動設定が
        // 効かなかったため、作成時に一括適用する(冪等・解決不能な旧参照の掃除を含む)。
        // 技能以外でも用途を持つアイテム(アウトフィット等)は「解説参照」→「その他」の正規化
        // (KI-033)があるため同じ整備を通す(チェーン解決は従来どおり内部の条件で判断)
        if (["generalSkill", "styleSkill"].includes(item.type)
            || (item.system?.actions?.length ?? 0) > 0) {
            enforceUsageChainDefaultsOnImport(item).catch(err =>
                console.error("TNX | 用途チェーン既定の適用に失敗しました", err));
        }
        if (item.type === "styleSkill") {
            autoAcquireForStyleSkill(item.parent, item);
        } else if (item.system?.hasDerivedData === true) {
            // 派生元アウトフィット: 派生データを自動生成(各々 isDerivedData=true＝経験点なし)
            autoImportDerivedData(item.parent, item);
        }
    });

    // アウトフィット集計(outfitMod / appearanceModifier)は CastDataModel.prepareDerivedData で
    // 都度算出するため(B-2)、アイテム変更フックでの再集計・DB 書き戻しは不要になった。

    // 起動時: 全キャストの経験点を初期化(User flag 同期のため。EXP は派生でなく実保存)。
    for (const actor of game.actors.filter(a => a.type === "cast")) {
        TokyoNovaCastSheet.updateCastExp(actor).catch(e =>
            console.error(`TokyoNOVA | Initial updateCastExp failed for ${actor.name}:`, e)
        );
    }

    Hooks.on('updateActor', async (actor, diff, options, userId) => {
        if (actor.type === 'cast' && options.calcExp !== false && !options.syncing) {
            if (diff.system) {
                 await TokyoNovaCastSheet.updateCastExp(actor);
            }
        }

        // 2-1: cast の ownership 変更 → ownerUserId(User UUID)を記録
        // GM クライアントのみ実行。syncing フラグ付きの更新(ownerUserId 記録後の折り返し等)は無視。
        // diff.ownership に依存しない: Foundry v13 の ownership 更新では diff.ownership が
        // 設定されない場合があるため。recordCastOwnerUser 自体が resolveOwnerUserIdAction で
        // 変更不要(none)の場合を早期 return するため、全 cast 更新で呼んでも安全。
        if (actor.type === 'cast' && !options.syncing && game.user.isGM) {
            try {
                await recordCastOwnerUser(actor);
            } catch (e) { console.error(`TokyoNOVA | Failed to record ownerUserId for cast ${actor.name}:`, e); }
        }

        // 2-2: ownerUserId 新規記録 → cast と User flag の history を双方向マージ(初回同期)
        // diff.system?.ownerUserId が設定されている = recordCastOwnerUser が ownerUserId を更新した
        // syncing: true の更新(起動時スキャン等)はここに到達しないため startup scan は直接呼ぶ
        if (actor.type === 'cast' && diff.system?.ownerUserId && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) await performInitialHistorySync(actor, ownerUser);
            } catch (e) { console.warn(`TokyoNOVA | Failed initial history sync for cast ${actor.name}:`, e); }
        }

        // 2-2b: syncWithOwner OFF→ON → 初回同期(performInitialHistorySync 内で syncWithOwner ゲート済み)
        if (actor.type === 'cast' && diff.system?.syncWithOwner === true && actor.system.ownerUserId && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) await performInitialHistorySync(actor, ownerUser);
            } catch (e) { console.warn(`TokyoNOVA | Failed initial history sync (ON) for cast ${actor.name}:`, e); }
        }

        // 2-2b: syncWithOwner ON→OFF → 由来分離
        if (actor.type === 'cast' && diff.system?.syncWithOwner === false && actor.system.ownerUserId && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) await performUnsyncSeparation(actor, ownerUser);
            } catch (e) { console.warn(`TokyoNOVA | Failed unsync separation for cast ${actor.name}:`, e); }
        }

        // isGhost 変更時の CS修正再集計は不要(prepareDerivedData が isGhost を見て都度算出する、B-2)。

        // 2-2: cast → User flag EXP 同期(syncWithOwner が ON の場合のみ)
        // syncing フラグで updateUser → updateCastExp → updateActor の再帰を遮断する
        if (actor.type === 'cast' && actor.system.ownerUserId && actor.system.syncWithOwner && !options.syncing && game.user.isGM) {
            try {
                const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
                if (ownerUser) {
                    await syncCastExpToUser(ownerUser);
                }
            } catch (e) { console.warn(`TokyoNOVA | Failed to sync EXP to User flag:`, e); }
        }
    });

    // 2-2: User flag(exp/history)変更 → レコードシート再描画 + cast ローカル履歴同期
    // syncCastExpToUser が { syncing: true } で書き込むため、その折り返しはここで遮断する
    // 全クライアントでレコードシートを再描画してから GM クライアントのみ cast 同期を行う
    Hooks.on('updateUser', async (user, diff, options) => {
        if (options.syncing) return;

        const flagDiff = diff.flags?.[TNX_FLAG_SCOPE];
        if (!flagDiff) return;
        if (!("exp" in flagDiff) && !("history" in flagDiff)) return;

        // 全クライアント: 開いているレコードシートを再描画
        const sheet = foundry.applications?.instances?.get(`tnx-record-sheet-${user.id}`);
        if (sheet?.rendered) sheet.render();

        if (!game.user.isGM) return;

        const linkedCasts = game.actors.filter(
            a => a.type === 'cast' && a.system.ownerUserId === user.uuid && a.system.syncWithOwner
        );
        const { history: userHistory } = getUserFlagData(user);
        for (const cast of linkedCasts) {
            // cast ローカルの system.history を User flag に合わせて同期
            const historySyncUpdate = buildCastHistorySyncUpdate(cast.system.history, userHistory);
            if (!foundry.utils.isEmpty(historySyncUpdate)) {
                await cast.update(historySyncUpdate, { calcExp: false, syncing: true });
            }
            await TokyoNovaCastSheet.updateCastExp(cast);
        }
    });

});
// ─── CS・AR のカット進行連動(フェーズ10-5 / 11 → 13-2〜13-4 で TnxCombat へ集約) ─────
// シートの「CS」「AR」表示は自動制御(カット進行中=カレント・現在AR/それ以外=CS・付与値)。
// カット進行の終了・参加/離脱で該当アクターを再準備(reset)し、開いているシートを再描画する。
// カット進行の開始は TnxCombat.startCombat の override が一括処理する(core の combatStart フックは
// update の**前**に発火するため、フック内からの別 update は本体更新に上書きされ競合する＝実機で発覚。
// フェーズ状態・turn・シードを単一フローにまとめた)。
// 以後の進行はサブターンモデル(nextTurn 1本=advanceCut・トラッカー UI から起動)。
// 途中参加(createCombatant)は開始済みカットへの参加としてそのアクターだけシードする。

// round の変わる combat 更新(カット進行の開始・次カット)で全クライアントのアクターを再準備する。
// core の updateCombatantActors は render のみで派生(inCombat)を再計算しないため、開始前に
// シードされた値の表示切替(CS=カレント表示・AR 数値表示)がここで追随する
Hooks.on("updateCombat", (combat, changed) => {
    if ("round" in (changed ?? {})) {
        TnxCombat.refreshDisplays(combat.combatants.map(c => c.actor).filter(Boolean));
    }
});

Hooks.on("deleteCombat", (combat) => {
    TnxCombat.refreshDisplays(combat.combatants.map(c => c.actor).filter(Boolean));
});

Hooks.on("createCombatant", async (combatant) => {
    if (!combatant.parent?.started || !combatant.actor) return;
    await TnxCombat.seedStartValues([combatant.actor]);
    TnxCombat.refreshDisplays([combatant.actor]);
});

Hooks.on("deleteCombatant", (combatant) => {
    if (combatant.actor) TnxCombat.refreshDisplays([combatant.actor]);
});

// ─── トループの名前固定(フェーズ11-4・正本 Troops.md「種別と名前の規則」) ─────────
// トループ=「(スタイル名)・トループ（(トループレベル)レベル）」／ワークス設定時=
// 「(組織名)（(スタイル名)(トループレベル)レベル）」／分身=「(分身元キャラ)の分身」で固定する
// (自由入力はエニグマのみ＝個体識別が必要なのはエニグマだけ・2026-07-03 確定)。
// 導出は純粋関数 computeTroopFixedName(data/helpers.mjs・テスト済)。
// 導出名と異なるときだけ update するため、update の連鎖は名前一致で収束する。

/** アクターから導出材料(スタイル名・ワークス名・分身元=所有者名)を集めて固定名を返す。 */
function deriveTroopFixedName(actor) {
    if (actor?.type !== "troop") return null;
    const styleName = actor.items.find(i => i.type === "style")?.name ?? null;
    const orgName   = actor.items.find(i => i.type === "organization")?.name ?? null;
    // 部署技能を取得している場合、ワークス名はその技能名で上書き(2026-07-03 確定。
    // 例: 千早グループ（クグツ2レベル）→ 後方処理課第二班（クグツ2レベル）)
    const worksName = findDepartmentSkillName(actor.items) ?? orgName;
    // 分身元=所有者アクターのライブ解決名(2026-07-07 確定・旧 sourceName テキスト入力は廃止)
    let sourceName = null;
    const ownerUuid = actor.system.ownerActorRef?.uuid ?? "";
    if (ownerUuid) {
        try { sourceName = fromUuidSync(ownerUuid)?.name ?? null; } catch { sourceName = null; }
    }
    return computeTroopFixedName(actor.system, styleName, worksName, sourceName);
}

async function syncTroopName(actor) {
    const fixed = deriveTroopFixedName(actor);
    if (fixed && actor.name !== fixed) await actor.update({ name: fixed });
}

Hooks.on("updateActor", (actor, diff, options, userId) => {
    if (actor.type !== "troop" || userId !== game.user.id) return;
    if (diff.name !== undefined
        || diff.system?.troopMode !== undefined
        || diff.system?.ownerActorRef !== undefined
        || diff.system?.troopLevel !== undefined
        || diff.system?.hasWorks !== undefined) {
        syncTroopName(actor);
    }
});

// 分身名は所有者(分身元)の名前から導出するため、所有者側の改名にも追従させる
Hooks.on("updateActor", (actor, diff, options, userId) => {
    if (userId !== game.user.id || diff.name === undefined) return;
    if (!["cast", "guest"].includes(actor.type)) return;
    for (const troop of game.actors) {
        if (troop.type === "troop" && troop.system.troopMode === "bunshin"
            && (troop.system.ownerActorRef?.uuid ?? "") === actor.uuid) {
            syncTroopName(troop);
        }
    }
});

// 名前の導出材料になる型: スタイル・組織・スタイル技能(部署技能の可能性)
const TROOP_NAME_SOURCE_TYPES = new Set(["style", "organization", "styleSkill"]);

Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.parent?.type === "troop" && TROOP_NAME_SOURCE_TYPES.has(item.type)) {
        syncTroopName(item.parent);
    }
});

Hooks.on("deleteItem", (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.parent?.type === "troop" && TROOP_NAME_SOURCE_TYPES.has(item.type)) {
        syncTroopName(item.parent);
    }
});

Hooks.on("updateItem", (item, diff, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.parent?.type !== "troop" || !TROOP_NAME_SOURCE_TYPES.has(item.type)) return;
    const nameChanged = diff.name !== undefined;
    const deptChanged = item.type === "styleSkill" && diff.system?.special?.works !== undefined;
    if (nameChanged || deptChanged) syncTroopName(item.parent);
});
