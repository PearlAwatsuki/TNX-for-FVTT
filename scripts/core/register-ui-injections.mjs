/**
 * @fileoverview 既存 UI への注入(プレイヤーリスト・チャットカードの右クリック・ディレクトリのボタン)。
 *
 * tnx.mjs の init フックから切り出したもの(2026-09-07)。**呼ぶ順序に意味がある**ため、
 * tnx.mjs 側は元の並びのまま順に呼ぶ。ここで並びを変えないこと。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { TnxScenarioSheet } from "../journal/tnx-scenario-sheet.mjs";
import { TnxFocusSystemSheet } from "../journal/tnx-focus-system-sheet.mjs";
import { TnxRecordSheet } from "../app/tnx-record-sheet.mjs";
import { TnxCheckFlow } from "../flow/tnx-check-flow.mjs";
import { FOCUS_SYSTEM_FLAG, defaultFocusSystemData } from "../focus-system/data.mjs";
import { getPartSlotPreset } from "../app/part-slot-preset-app.mjs";
import { manualEditDamage } from "../flow/damage-flow.mjs";
import { applyAttackPatch } from "../flow/attack-flow.mjs";

export function registerUiInjections() {
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
                    return !!m?.getFlag(SYSTEM_ID, "checkRecheck") && !TnxCheckFlow.recheckBlockReason(m);
                },
                callback: (li) => TnxCheckFlow.startRecheck(msgOf(li)),
            },
            {
                name: "達成値を修正（手動）",
                icon: '<i class="fas fa-pen"></i>',
                // スナップショット持ちのカードに限る: 継続処理系(移動/治療等)は達成値だけ書き換えると
                // 適用済みの帰結と乖離し、事後修正のライブ描画もスナップショット持ちでしか動かない
                condition: (li) => game.user.isGM && !!msgOf(li)?.getFlag(SYSTEM_ID, "checkRecheck"),
                callback: (li) => TnxCheckFlow.manualEditAchievement(msgOf(li)),
            },
            {
                name: "ダメージを修正（手動）",
                icon: '<i class="fas fa-burst"></i>',
                // 達成値の手動修正と同じ最終裁定ツール=適用済みでも制限しない(2026-07-14 ユーザー確定)
                condition: (li) => game.user.isGM && !!msgOf(li)?.getFlag(SYSTEM_ID, "damageRoll"),
                callback: async (li) => {
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
                    const f = msgOf(li)?.getFlag(SYSTEM_ID, "attackCheck");
                    return !!f && f.damageRolled === true;
                },
                callback: async (li) => {
                    await applyAttackPatch(msgOf(li), { damageRolled: false });
                    ui.notifications.info("ダメージ処理をリセットしました（出済みのダメージカードは必要に応じて削除してください）。");
                },
            },
        );
    });

    // v13: 標準ボタン行(header-actions)の直後に「アクトシートを作成」ボタンを 2 段目として挿入する。
    Hooks.on("renderJournalDirectory", (app, html) => {
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
}
