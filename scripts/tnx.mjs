import { TokyoNovaCastSheet } from './actor/tnx-cast-sheet.mjs';
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
import { TokyoNovaStyleSheet } from './item/tnx-style-sheet.mjs';
import { TokyoNovaMiracleSheet } from './item/tnx-miracle-sheet.mjs';
import { TokyoNovaGeneralSkillSheet } from './item/tnx-general-skill-sheet.mjs';
import { TokyoNovaStyleSkillSheet } from './item/tnx-style-skill-sheet.mjs';
import { TokyoNovaOrganizationSheet } from './item/tnx-organization-sheet.mjs';
import { TokyoNovaLifePathSheet } from './item/tnx-life-path-sheet.mjs';
import { TokyoNovaOutfitSheet, formatWeaponRangeLabel } from './item/tnx-outfit-sheet.mjs';
import { TokyoNovaHousingAreaSheet } from './item/tnx-housing-area-sheet.mjs';
import { TnxScenarioSheet } from './journal/tnx-scenario-sheet.mjs';
import { TnxCardSetupApp } from './module/tnx-card-setup-app.mjs';
import { TnxActionHandler } from './module/tnx-action-handler.mjs';
import { TnxHud } from './module/tnx-hud.mjs';
import { TnxRecordSheet } from './module/tnx-record-sheet.mjs';
import { registerDrawTableHooks } from './module/tnx-draw-table.mjs';
import { recordCastOwnerUser } from './module/cast-ownership.mjs';
import { TnxSocketHandler } from './module/tnx-socket-handler.mjs';
import { TnxJudgmentFlow } from './module/tnx-judgment-flow.mjs';
import { TnxJudgmentDialog } from './module/tnx-judgment-dialog.mjs';
import { TnxRlRequestApp } from './module/tnx-rl-request-app.mjs';
import { getUserFlagData, calcHistoryExpTotal, TNX_FLAG_SCOPE } from './module/user-flag-schema.mjs';
import { calcSharedSpent, buildCastHistorySyncUpdate, mergeHistories, separateHistoryByOrigin } from './module/exp-sync.mjs';
import { TnxSkillUtils } from './module/tnx-skill-utils.mjs';
import { CONDITION_KINDS, CONDITION_GROUP_LABELS, getConditionKinds, buildInflictedEffectsData, readConditions } from './module/conditions.mjs';
import { registerDamageChartTextSetting } from './module/damage-chart-text-app.mjs';
import { registerPartSlotPresetSetting, getPartSlotPreset, initializeDefaultPartSlotPreset } from './module/part-slot-preset-app.mjs';
import { conditionNeedsDraw, postDrawPrompt, postControlNegatePrompt, bindConditionChatButtons } from './module/condition-resolution.mjs';

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

        // === Chat ===
        "systems/tokyo-nova-axleration/templates/chat/scene-card.hbs",
        "systems/tokyo-nova-axleration/templates/chat/judgment-result.hbs",
        "systems/tokyo-nova-axleration/templates/chat/judgment-request.hbs",

        // === App ===
        "systems/tokyo-nova-axleration/templates/app/rl-request-app.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs",

        // === Dialogs ===
        "systems/tokyo-nova-axleration/templates/dialog/judgment-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/amount-input-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/card-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deal-trump-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/deck-creation-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/rich-confirm-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/target-selection-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/unlink-confirm-dialog.hbs",
        "systems/tokyo-nova-axleration/templates/dialog/usage-creation-dialog.hbs",

        // === Partials ===
        "systems/tokyo-nova-axleration/templates/parts/active-effects-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/card-setup-app.hbs",
        "systems/tokyo-nova-axleration/templates/parts/scenario-setting-wizard.hbs",
        "systems/tokyo-nova-axleration/templates/parts/prosemirror-editor.hbs",
        "systems/tokyo-nova-axleration/templates/parts/history-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/usage-list.hbs",
        "systems/tokyo-nova-axleration/templates/parts/bad-status-list.hbs",
        "systems/tokyo-nova-axleration/templates/app/usage-sheet-combo.hbs",

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

        const documents = await pack.getDocuments();
        if (documents.length === 0) return;

        // 無条件取得技能 + 社会：N◎VA のみをインポート
        const toImport = documents.filter(doc =>
            doc.system.generalSkillCategory === 'initialSkill'
            || doc.system.identificationKey === 'society_nova'
        );

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

// ActiveEffect 設定シートの詳細タブに「重複可」チェックボックスを注入する(フェーズ9-3 v2)。
// 同名(同一 identity)効果は既定で重複適用不可。チェック時のみスタックする。
// flags.tokyo-nova-axleration.stackable に保存(change で明示 setFlag、フォーム依存を避ける)。
Hooks.on("renderActiveEffectConfig", (app, element) => {
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root || root.querySelector(".tnx-stackable-field")) return;
    const current = app.document?.getFlag?.("tokyo-nova-axleration", "stackable") === true;
    const group = document.createElement("div");
    group.classList.add("form-group", "tnx-stackable-field");
    group.innerHTML = `
        <label>重複可</label>
        <div class="form-fields">
            <input type="checkbox" ${current ? "checked" : ""}>
        </div>
        <p class="hint">同名（同一）効果でも重複して適用する場合にチェック。未チェックなら重複適用不可。</p>`;
    group.querySelector("input")?.addEventListener("change", (ev) => {
        app.document?.setFlag("tokyo-nova-axleration", "stackable", ev.currentTarget.checked);
    });
    const anchor = root.querySelector('[name="transfer"], [name="disabled"]')?.closest(".form-group");
    if (anchor) anchor.after(group);
    else (root.querySelector('.tab[data-tab="details"]') ?? root.querySelector("form"))?.appendChild(group);

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
                fields.push({ label: "対象武器(識別キー)", html: `<input type="text" value="${v.targetWeapon ?? ""}" placeholder="識別キー">`,
                    bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetWeapon", e.currentTarget.value.trim())) });
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
    const data = [];
    const seen = new Set();
    for (const kind of getConditionKinds(effect)) {
        for (const d of buildInflictedEffectsData(kind, { hidden: true })) {
            const ik = d.statuses[0];
            const idef = CONDITION_KINDS[ik];
            if (idef && !idef.stackable && (actor.statuses?.has?.(ik) || seen.has(ik))) continue;
            seen.add(ik);
            data.push(d);
        }
    }
    if (data.length) await actor.createEmbeddedDocuments("ActiveEffect", data);

    // 2. この状態自身の解決受付: 衰弱/重圧のカード決定ドロー / controlNegate の制御判定。
    const perKind = effect.flags?.["tokyo-nova-axleration"]?.conditions ?? {};
    for (const c of readConditions(effect)) {
        if (conditionNeedsDraw(c.kind, c)) await postDrawPrompt(actor, effect, c.kind);
        const cn = perKind[c.kind]?.pendingControlNegate;
        if (cn) await postControlNegatePrompt(actor, effect, c.kind, cn);
    }
});

// チャットの受付ボタン(ドロー/制御判定)を解決処理に配線する(フェーズ9-4)。
Hooks.on("renderChatMessageHTML", (message, html) => {
    bindConditionChatButtons(html instanceof HTMLElement ? html : html?.[0]);
});

Hooks.once("init", async function() {
    game.tnx = game.tnx || {}
    game.tnx.refreshSheets = handleRefreshSheets;

    // チャット通知のデフォルトを「チャットカード」から「通知バッジ」に変更する。
    // ユーザーが明示的に設定済みの場合はその値が優先される(デフォルト値のみの変更)。
    const chatNotifSetting = game.settings.settings.get("core.chatNotifications");
    if (chatNotifSetting) chatNotifSetting.default = "pip";
    Handlebars.registerHelper('add', function(a, b) {
        return a + b;
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
        if (system.isCyber === true && system.majorCategory !== "cyberware") return `${name}※`;
        return name;
    });

    // 武器射程の表記(min/max が同じなら単一表記、異なるなら「近～超遠」形式)
    Handlebars.registerHelper('tnxRangeLabel', formatWeaponRangeLabel);

    await preloadHandlebarsTemplates();
    CONFIG.Item.documentClass = TokyoNovaItem;

    // ActiveEffect の転送モードを新方式にする(フェーズ9-3)。
    // レガシー(true)では「アイテムに乗せた効果がアイテム自身に適用されない」(モードA 不成立)、
    // かつ v13 のトークンアクターで transfer:true が転送されないバグがある。
    // false にすると、transfer:false の効果はアイテム自身へ、transfer:true の効果は
    // アイテム上から親アクターへ仮想適用される(着地点 effectMod に正しく流れ込む)。
    CONFIG.ActiveEffect.legacyTransferral = false;

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
    CONFIG.statusEffects = Object.entries(CONDITION_KINDS).map(([id, def]) => ({
        id,
        name: def.label,
        img:  def.img ?? "icons/svg/aura.svg",
        flags: { "tokyo-nova-axleration": { conditionKind: id } },
    }));
    
    // Actor Sheetの登録
    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    foundry.documents.collections.Actors.registerSheet("tokyo-nova", TokyoNovaCastSheet, {
        types: ["cast"],
        makeDefault: true,
        label: "プロファイルシート"
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

    // ドロー表: コア RollTable のカードドロー拡張（シート置換なし・フック注入のみ）
    registerDrawTableHooks();

    // --- システム設定の登録 ---
    // ダメージチャート効果文(ワールド設定＋編集アプリメニュー)
    registerDamageChartTextSetting();

    // 部位スロットプリセット(ワールド設定＋編集アプリメニュー。新規キャストへ流し込む)
    registerPartSlotPresetSetting();

    game.settings.register("tokyo-nova-axleration", "defaultHandMaxSize", {
        name: "デフォルトの手札上限数",
        hint: "各ユーザーの手札上限の基本となる枚数を設定します。ユーザーが個別に設定していない場合、この値が適用されます。",
        scope: "world",
        config: true,
        type: Number,
        default: 4,
        requiresReload: true
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

    // v13: 標準ボタン行(header-actions)の直後に「アクトシートを作成」ボタンを 2 段目として挿入する。
    Hooks.on("renderJournalDirectory", (app, html, data) => {
        if (!game.user.isGM) return;

        const createEntryButton = html.querySelector('[data-action="createEntry"]');
        if (!createEntryButton) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tnx-create-act-button';
        button.innerHTML = '<i class="fas fa-file-medical"></i><span>アクトシートを作成</span>';
        button.addEventListener('click', async () => {
            const newJournal = await JournalEntry.create({
                name: "新規アクトシート",
                flags: {
                    core: {
                        sheetClass: `tokyo-nova.${TnxScenarioSheet.name}`
                    }
                }
            });
            newJournal?.sheet.render(true);
        });

        // .action-buttons 内に追加し、flex-wrap で 2 段目に折り返させる（幅が自動で揃う）
        const actionsRow = createEntryButton.closest('.action-buttons') ?? createEntryButton.parentElement;
        actionsRow.style.flexWrap = 'wrap';
        actionsRow.appendChild(button);
    });

    Hooks.on("preCreateActor", (actor, data, options, userId) => {
        if (data.type !== "cast") return;

        // 部位スロット集合: 未設定なら全アクター共通プリセットを流し込む(フェーズ10)
        const hasPartSlots = Array.isArray(data.system?.partSlots) && data.system.partSlots.length > 0;
        if (!hasPartSlots) {
            const preset = getPartSlotPreset();
            if (preset.length) {
                actor.updateSource({ "system.partSlots": foundry.utils.deepClone(preset) });
            }
        }

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
        // 一般技能: 用途が未設定の場合に「判定」用途を1件自動挿入する
        // baseSkillRef には親アイテム自身の ID を設定する（用途が判定の起点技能を明示的に保持）
        if (data.type === "generalSkill" && !(data.system?.actions?.length)) {
            item.updateSource({
                "system.actions": [{
                    _id:             foundry.utils.randomID(),
                    type:            "check",
                    name:            "判定",
                    description:     "",
                    timing:          { value: "blank", actionName: "blank", processName: "blank", timingOther: "" },
                    target:          "blank",
                    effects:         [],
                    baseSkillRef:    { itemId: item._id ?? "" },
                    skillRefs:       [],
                    weaponRef:       { itemId: "" },
                    damageType:      "",
                    formula:         "",
                    damageCategory:  "",
                    modifiableParams: [],
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
    });

    Hooks.on("preDeleteItem", async (item, options, userId) => {
        if (item.type === "miracle" && item.actor) {
            const usage = item.system.usageCount;
            if (usage.value > 1) {
                const newValue = usage.value - 1;
                const newTotal = Math.max(0, usage.total - 1);
                await item.update({
                    'system.usageCount.value': newValue,
                    'system.usageCount.total': newTotal
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
            // 「使用済み(isUsed)」フラグが true → false に変更されたかチェック
            const newIsUsed = foundry.utils.getProperty(changes, "system.isUsed");
            if (item.system.isUsed === true && newIsUsed === false) {
                
                //残り使用回数(total)を最大値(value + mod)にリセットする
                const usage = item.system.usageCount;
                const value = usage.value || 0;
                const mod = usage.mod || 0;
                const newTotal = value + mod;
    
                // 進行中の更新データ(changes)に、totalの変更を追加する
                foundry.utils.setProperty(changes, "system.usageCount.total", newTotal);
                ui.notifications.info(`神業「${item.name}」の使用回数がリセットされました。`);
            }
        }
    
        // スタイルアイテム以外の更新は無視 (既存の処理)
        if (item.type === "style" && item.actor) {
            const oldLevel = item.system.level || 1;
            const newLevel = foundry.utils.getProperty(changes, "system.level");
    
            // レベル変更時の神業使用回数 増減処理
            if (newLevel !== undefined && newLevel !== oldLevel) {
                (async () => {
                    try {
                        const miracleUuid = item.system.miracle?.id;
                        if (!miracleUuid) return;
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (!sourceMiracle) return;
                        const existingMiracle = item.actor.items.find(i => i.type === 'miracle' && i.name === sourceMiracle.name);
                        if (!existingMiracle) return;
    
                        const usage = existingMiracle.system.usageCount;
                        const currentValue = usage.value || 1;
                        const currentTotal = usage.total || 0;
    
                        if (newLevel > oldLevel) {
                            // レベル上昇時の処理
                            const newValue = Math.min(3, currentValue + 1);
                            const newTotal = newValue + (usage.mod || 0);
                            await existingMiracle.update({ "system.usageCount.value": newValue, "system.usageCount.total": newTotal });
                            ui.notifications.info(`神業「${existingMiracle.name}」の母数が+1されました。`);
                        } else {
                            // レベル減少時の処理（修正版）
                            
                            // この神業に関連する、アクターが所持する全スタイルを取得
                            const allLinkedStyles = item.actor.items.filter(i => i.type === 'style' && i.system.miracle?.id === miracleUuid);
                            
                            // スタイルの合計レベルを計算（更新中のアイテムは newLevel を使用）
                            const totalStyleLevel = allLinkedStyles.reduce((sum, s) => {
                                if (s.id === item.id) return sum + newLevel;
                                return sum + (s.system.level || 1);
                            }, 0);

                            // 「現在の神業母数」が「新しい合計スタイルレベル」より大きい場合のみ減らす
                            if (currentValue > totalStyleLevel) {
                                const newValue = Math.max(1, currentValue - 1);
                                const newTotal = Math.max(0, currentTotal - 1);
                                await existingMiracle.update({ "system.usageCount.value": newValue, "system.usageCount.total": newTotal });
                                ui.notifications.info(`神業「${existingMiracle.name}」の母数を-1しました。`);
                            }
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
        const newTool = {
            name:    "tnxJudgmentRequest",
            title:   "判定要求",
            icon:    "fas fa-cards",
            button:  true,
            onChange: () => new TnxRlRequestApp().render(true),
            visible: true,
        };
        const tools = tokenGroup.tools;
        if (Array.isArray(tools)) {
            tools.push(newTool);
        } else if (tools instanceof Map) {
            tools.set("tnxJudgmentRequest", newTool);
        } else if (tools && typeof tools === "object") {
            tools.tnxJudgmentRequest = newTool;
        } else {
            tokenGroup.tools = { tnxJudgmentRequest: newTool };
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

    // 部位スロットプリセット: ワールド初回ロードでデフォルト体部位を自動設定(GM のみ・1回)
    await initializeDefaultPartSlotPreset();

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
    TnxJudgmentFlow.dialogClass = TnxJudgmentDialog;
    game.tnx.judgment = TnxJudgmentFlow;

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

    const recalcActorExp = (item) => {
        if (item.parent && item.parent.type === 'cast') {
            TokyoNovaCastSheet.updateCastExp(item.parent);
        }
    };

    // 判定要求チャットカード: 目標値の可視性制御 + 「判定する」ボタン / 結果注入（フェーズ 8-5）
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const flagData = message.getFlag("tokyo-nova-axleration", "judgmentRequest");
        if (!flagData) return;

        // 目標値: targetValueHidden かつ非 GM の場合は非公開表示
        const tnEl = html.querySelector(".jr-req-tn-value");
        if (tnEl && flagData.targetValueHidden && !game.user.isGM) {
            tnEl.textContent = "（非公開）";
            tnEl.classList.add("jr-req-tn-hidden");
        }

        // 各対象行: 結果がある場合は結果表示、未判定の場合はボタンまたは「待機中」
        for (const row of html.querySelectorAll(".jr-req-target-row")) {
            const actorId  = row.dataset.actorId;
            const userId   = row.dataset.userId;
            const statusEl = row.querySelector(".jr-req-target-status");
            if (!statusEl) continue;

            const result = flagData.results?.[actorId];
            if (result) {
                // 判定済み: 結果を表示
                const resultEl = document.createElement("div");
                resultEl.className = "jr-req-result";
                if (flagData.judgmentType === "controlCheck") {
                    resultEl.innerHTML = result.success
                        ? '<span class="jr-inline-success"><i class="fas fa-check"></i> 成功</span>'
                        : '<span class="jr-inline-failure"><i class="fas fa-times"></i> 失敗</span>';
                } else if (result.fumble) {
                    resultEl.innerHTML = '<span class="jr-inline-fumble"><i class="fas fa-skull"></i> ファンブル</span>';
                } else {
                    const mark = result.success === true
                        ? ' <span class="jr-inline-success"><i class="fas fa-check"></i> 成功</span>'
                        : result.success === false
                            ? ' <span class="jr-inline-failure"><i class="fas fa-times"></i> 失敗</span>'
                            : '';
                    resultEl.innerHTML = `達成値 <strong>${result.achievement ?? "—"}</strong>${mark}`;
                }
                statusEl.replaceChildren(resultEl);
            } else if (flagData.status !== "closed") {
                // 未判定
                const isMyChar = game.user.id === userId;
                if (isMyChar || game.user.isGM) {
                    const btn = document.createElement("button");
                    btn.type      = "button";
                    btn.className = "tnx-ring-btn tnx-judgment-do-btn";
                    btn.innerHTML = '<i class="fas fa-gavel"></i> 判定する';
                    btn.addEventListener("click", () => {
                        TnxRlRequestApp.onDoJudgment(flagData, actorId, message.id);
                    });
                    statusEl.replaceChildren(btn);
                } else {
                    const waiting = document.createElement("span");
                    waiting.className = "jr-req-waiting";
                    waiting.textContent = "待機中…";
                    statusEl.replaceChildren(waiting);
                }
            }
        }
    });

    Hooks.on('createItem', (item) => recalcActorExp(item));
    Hooks.on('deleteItem', (item) => recalcActorExp(item));
    Hooks.on('updateItem', (item, diff, options) => recalcActorExp(item));

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