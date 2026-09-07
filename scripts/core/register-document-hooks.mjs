/**
 * @fileoverview ドキュメントの作成/更新/削除に連動するフックの登録。
 *
 * tnx.mjs の init フックから切り出したもの(2026-09-07)。**呼ぶ順序に意味がある**ため、
 * tnx.mjs 側は元の並びのまま順に呼ぶ。ここで並びを変えないこと。
 */

import { refreshSheetsSoon } from "./sheet-refresh.mjs";
import { SYSTEM_ID } from "../constants.mjs";
import { usesMaxBaseOf } from "../data/item/uses.mjs";
import { miracleRemovalUpdate } from "../rules/miracle.mjs";
import { SKILL_PACKS } from "../dictionary/skill-dictionary.mjs";
import { TnxRlRequestApp } from "../app/tnx-rl-request-app.mjs";
import { openRlGrantDamage } from "../app/tnx-rl-grant-damage-app.mjs";
import { openRlGrantEffect } from "../app/tnx-rl-grant-effect-app.mjs";
import { openRlGrantBounty } from "../app/tnx-rl-grant-bounty-app.mjs";
import { openFocusSystemPanel } from "../app/tnx-focus-system-panel.mjs";
import { openScenarioPanel } from "../app/tnx-scenario-panel.mjs";
import { getSessionState } from "../session/session-state.mjs";
import { refreshSubSceneBackground } from "../session/subscenes.mjs";
import { registerAppearanceTokenSync } from "../session/appearance-state.mjs";
import { registerTimeBoundaries, registerForcedExitWounds } from "../session/time-boundary.mjs";
import { openSubScenePanel } from "../app/tnx-subscene-panel.mjs";
import { TnxSkillUtils } from "./tnx-skill-utils.mjs";

async function setupDefaultSkills(actor) {
    try {
        const packId = SKILL_PACKS.general;
        const pack = game.packs.get(packId);
        if (!pack) {
            ui.notifications.warn(`一般技能の辞典（${packId}）が見つからないため、初期技能を入れられませんでした。`);
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
        if (toImport.length === 0) {
            // 本システムはルールブックのデータを同梱していない(著作権配慮・README「著作権」)。
            // 辞典が空のままだと「新規キャストに初期技能が入らない」が**無言で**起きるため、
            // 理由を伝える(2026-09-07 ユーザー確定)
            ui.notifications.warn("一般技能の辞典が空のため、初期技能を入れられませんでした。"
                + "本システムはルールブックのデータを同梱していないため、辞典への登録は各自で行ってください。");
            return;
        }

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

export function registerDocumentHooks() {
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

    Hooks.on("preCreateCard", (card) => {
        const parentPile = card.parent;

        // 既存の切り札上限チェック処理
        if (!parentPile || !parentPile.getFlag(SYSTEM_ID, "isTrumpPile")) {
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

    // **同期のフックにする**: Foundry の pre 系フックは戻り値を同期で見るため、async にすると
    // `return false` が Promise になり削除を止められない。止めたつもりの削除がそのまま通り、
    // 後から届く update が「もう無い文書」に当たってサーバがエラーを返していた(KI-051・2026-09-05)。
    // 中で必要な非同期処理は投げっぱなしにする(止める判断は同期で済ませてから行う)。
    Hooks.on("preDeleteItem", (item) => {
        if (item.type === "miracle" && item.actor) {
            // 母数(uses.max)が2以上なら削除でなく-1(多重取得の1つを外す)。2026-07-18 uses 一本化
            const update = miracleRemovalUpdate(item.system);
            if (update) {
                item.update(update);   // 削除は下で止めるので、この更新は投げっぱなしでよい
                ui.notifications.info(`神業「${item.name}」の母数を-1しました。`);
                return false;
            }
        }
        if (item.type === "style" && item.actor) {
            // 対応する神業を1つだけ削除する(このフックはレベル1のスタイル削除時にのみ動作する想定)。
            // スタイルの削除自体は止めないので、非同期の後始末として流す
            const miracleUuid = item.system.miracle?.id;
            const actor = item.actor;
            const styleName = item.name;
            if (miracleUuid) {
                (async () => {
                    try {
                        const sourceMiracle = await fromUuid(miracleUuid);
                        if (!sourceMiracle) return;
                        const itemToDelete = actor.items.find(i => i.type === "miracle" && i.name === sourceMiracle.name);
                        if (!itemToDelete) return;
                        await itemToDelete.delete();
                        ui.notifications.info(`スタイル「${styleName}」の削除に伴い、神業「${itemToDelete.name}」を1つ削除しました。`);
                    } catch (e) {
                        console.error(`TokyoNOVA | Error deleting associated Divine Work for style ${styleName}:`, e);
                    }
                })();
            }
            return true;
        }
    });

    // pre 系は同期(理由は preDeleteItem のコメント)。非同期の連動は中の IIFE で流す
    Hooks.on("preUpdateItem", (item, changes) => {
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

    // シナリオコントロールパネルと HUD の情報項目(14-9)の表示は台本(アクトシートのフラグ)に
    // 追随する(14-3)。実行状態(sessionState)の変化は設定の onChange が再描画する。
    Hooks.on("updateJournalEntry", (doc) => {
        if (doc.id && doc.id === getSessionState().actId) {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });

    // 登場状態(Actor フラグ)の変化にパネルの「登場中」表示・チームのゲートを追随させる(14-5)。
    // 名前の非公開(14-8)も同じ一覧の表示を変えるため同じ購読に乗せる。
    // 担当キャラクターのゴースト切替は HUD のステータス表示(14-7)にも反映する
    Hooks.on("updateActor", (actor, changes) => {
        const f = changes.flags?.[SYSTEM_ID];
        const appearanceKeys = ["appearing", "-=appearing", "appearingHidden", "-=appearingHidden"];
        // ゴースト切替(2026-08-22)はチップのトグル表示を変えるため、パネルも追随させる
        if ((f && appearanceKeys.some(key => key in f)) || changes.system?.isGhost !== undefined) {
            foundry.applications.instances.get("tnx-scenario-panel")?.render(false);
        }
        // HUD のステータス表示(自分+参加者パネル)は担当キャラクターの登場状態・ゴーストにも
        // 依存するため、担当キャラクターであれば誰のものでも HUD を追随させる
        if ((changes.system?.isGhost !== undefined || (f && appearanceKeys.some(key => key in f)))
            && game.users.some(u => u.character?.id === actor.id)) {
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });

    // HUD のステータス表示(14-7)・参加者パネルの追随: シーンプレイヤー(User flag)・
    // 手札の割り当て変更はどのユーザーの分でも HUD に映る
    Hooks.on("updateUser", (user, changes) => {
        if (changes.flags?.[SYSTEM_ID]) {
            foundry.applications.instances.get("tnx-hud")?.render(false);
        }
    });
    // 参加者パネルは接続中ユーザーのみ並べるため、入退室でも HUD を追随させる
    Hooks.on("userConnected", () => {
        foundry.applications.instances.get("tnx-hud")?.render(false);
    });
    for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
        Hooks.on(hook, (effect) => {
            if (effect.parent?.id && game.users.some(u => u.character?.id === effect.parent.id)) {
                foundry.applications.instances.get("tnx-hud")?.render(false);
            }
        });
    }

    // 登場状態 ⇄ アクティブ盤面のトークン存在の双方向同期(2026-08-23 改修: 登場=トークン
    // 配置・退場=トークン削除・ゴースト=不可視。フラグ→トークンは activeGM が代行)
    registerAppearanceTokenSync();

    // 時間境界の購読=失効・リセット・回復の適用本体(15-1)。13-6/14-2 が発火してきた
    // 境界イベントに、ここで初めて購読者が付く(適用は activeGM のみ)
    registerTimeBoundaries();

    // 逮捕令状(社会17)の適用=チーム離脱→退場→登場不可の期限(15-7・activeGM のみ)
    registerForcedExitWounds();

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

    Hooks.on("createCard", () => refreshSheetsSoon());

    /**
     * Cardの子ドキュメントが削除された際にUIを更新するフック。
     * カードが山札や手札から移動した（描画された、プレイされた）場合などに作動します。
     */
    Hooks.on("deleteCard", () => refreshSheetsSoon());
}
