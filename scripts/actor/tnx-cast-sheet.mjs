/**
 * @fileoverview TokyoNovaCastSheet - キャスト Actor シート
 *
 * フェーズ11-2 で共通部品化: 共通機能(コンテキスト準備・技能/アウトフィット/戦闘/部位・判定起動・
 * ドラッグ&ドロップ・コンテキストメニュー・編集モード・CS/AR 等)は TnxCharacterSheetBase に移した。
 * 本クラスに残るのは cast 固有＝EXP 系(updateCastExp・コスト計算)と
 * セッション履歴(TnxHistoryMixin・レコードシート同期)のみ。
 */

import { TnxCharacterSheetBase } from './tnx-character-sheet-base.mjs';
import { TnxHistoryMixin } from '../module/tnx-history-mixin.mjs';
import { getUserFlagData, TNX_FLAG_SCOPE } from '../module/user-flag-schema.mjs';
import { OUTFIT_ITEM_TYPES } from '../data/helpers.mjs';
import { readFlag } from '../data/item/helpers.mjs';

export class TokyoNovaCastSheet extends TnxCharacterSheetBase {

    /**
     * DEFAULT_OPTIONS は ApplicationV2 が継承チェーンでマージする(共通分は基底が定義)。
     * classes は配列のため上書きになる＝フルで指定する。
     */
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "actor", "cast"],
        actions: {
            ...TnxHistoryMixin.ACTIONS,
        },
    };

    static PARTS = {
        main: {
            template: "systems/tokyo-nova-axleration/templates/actor/cast-sheet.hbs",
            scrollable: [".sheet-body", ".profile-sidebar", ".tab.abilities", ".tab[data-tab='outfits']"],
        },
    };

    /** cast はフル機能(EXP・セッション履歴・ライフパス・部位管理) */
    static SHEET_FEATURES = { exp: true, history: true, lifePath: true, parts: true };

    // ─── コンテキスト準備(cast 固有分) ────────────────────────────────────────

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // 履歴は**このキャストで出たセッションだけ**を出す(2026-08-15 ユーザー指示)。同期中の
        // キャストには User flag の履歴が丸ごと配られる(他キャストのセッションも入る)ため絞る。
        // 同期していないキャストは絞らない——由来分離(performUnsyncSeparation)で他キャスト由来が
        // 除かれており、system.history が元々そのキャスト固有だから(絞ると既存の自分の行まで消える)
        const linkedToUser = !!this.actor.system.ownerUserId && this.actor.system.syncWithOwner;
        context.history = TnxHistoryMixin._prepareHistoryForDisplay(
            this.actor.system.history,
            linkedToUser ? this.actor.uuid : "",
        );
        // 所有トループ級の消費小計(11-6): 経験点内訳の表示用(算入自体は updateCastExp)
        context.ownedTroopExp = await TokyoNovaCastSheet._sumOwnedTroopsCost(this.actor);
        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        TnxHistoryMixin.activateHistoryListeners.call(this, this.element);
    }

    // ─── 履歴更新(TnxHistoryMixin から呼ばれる) ──────────────────────────────

    async _performHistoryUpdate(updateData) {
        const ownerUserId = this.actor.system.ownerUserId;

        // A. User flag にリンクしている場合
        if (ownerUserId) {
            const ownerUser = game.users.find(u => u.uuid === ownerUserId);
            if (ownerUser) {
                const flagUpdate = {};
                for (const [key, value] of Object.entries(updateData)) {
                    if (key.startsWith("system.history")) {
                        flagUpdate[key.replace("system.history", `flags.${TNX_FLAG_SCOPE}.history`)] = value;
                    } else if (key === "system.exp.total") {
                        flagUpdate[`flags.${TNX_FLAG_SCOPE}.exp.total`] = value;
                    }
                }
                await ownerUser.update(flagUpdate);

                const historyUpdate = {};
                for (const [key, value] of Object.entries(updateData)) {
                    if (key.startsWith("system.history")) historyUpdate[key] = value;
                }
                if (!foundry.utils.isEmpty(historyUpdate)) {
                    await this.actor.update(historyUpdate, { calcExp: false });
                }
                return;
            }
        }

        // B. スタンドアロン
        await this.actor.update(updateData);
        TokyoNovaCastSheet.updateCastExp(this.actor);
    }

    // ─── 経験点計算(静的) ────────────────────────────────────────────────────

    /** アクターごとの EXP 再計算の合流状態(KI-008・2026-07-19): actor.uuid → {rerun, promise} */
    static _expRecalcStates = new Map();

    /**
     * EXP 再計算の入口(KI-008 是正・2026-07-19 ユーザー承認)。アイテム変動フックから 1 変動ごとに
     * 呼ばれるため、一括インポート等では同一アクターへの呼び出しが並列に走り、同内容の
     * actor.update が同時に飛んでいた。同一アクターの再計算を 1 本に合流する——実行中に来た
     * 呼び出しは「完了後にもう 1 回」へ畳む(計算は毎回の全量再計算のため、最後の 1 回が
     * 最新状態を反映する)。計算・書き込みロジック(_recalcCastExp)は不変。
     */
    static async updateCastExp(actor) {
        if (!actor || actor.type !== 'cast') return;
        const key = actor.uuid ?? actor.id;
        const running = this._expRecalcStates.get(key);
        if (running) {
            running.rerun = true;
            return running.promise;
        }
        const state = { rerun: false, promise: null };
        this._expRecalcStates.set(key, state);
        state.promise = (async () => {
            try {
                do {
                    state.rerun = false;
                    await this._recalcCastExp(actor);
                } while (state.rerun);
            } finally {
                this._expRecalcStates.delete(key);
            }
        })();
        return state.promise;
    }

    static async _recalcCastExp(actor) {
        if (!actor.system.exp) actor.prepareData();

        const abilities = ["reason", "passion", "life", "mundane"];
        let totalAbilityCost = 0;
        const allStyles = actor.items.filter(i => i.type === 'style');

        for (const key of abilities) {
            let styleValue = 0, styleControl = 0;
            allStyles.forEach(s => {
                const level = Number(s.system.level) || 1;
                styleValue   += (Number(s.system[key]?.value))   * level;
                styleControl += (Number(s.system[key]?.control)) * level;
            });
            const abilityData = actor.system[key];
            const baseVal  = styleValue   + Number(abilityData.mod);
            const baseCtrl = styleControl + Number(abilityData.controlMod);
            totalAbilityCost += this._calcSingleAbilityCost(abilityData.growth,        baseVal,  false);
            totalAbilityCost += this._calcSingleAbilityCost(abilityData.controlGrowth, baseCtrl, true);
        }

        const totalItemCost = await this._sumActorItemsCost(actor);

        // 所有トループ級の合算(11-6・Troops.md「所有トループの経験点」): トループ級キャラクターの
        // 消費経験点は**取得元キャストの消費経験点として計上**する(所有者参照が計上の前提。
        // User でなくアクター経由=2026-07-04 確定)。分身は対象外
        const ownedTroopCost = await this._sumOwnedTroopsCost(actor);

        const realSpent  = totalAbilityCost + totalItemCost + ownedTroopCost;
        const initialExp = 170;
        const additional = Number(actor.system.exp?.additional);

        let historyTotal = 0;
        if (actor.system.ownerUserId && actor.system.syncWithOwner) {
            const ownerUser = game.users.find(u => u.uuid === actor.system.ownerUserId);
            if (ownerUser) historyTotal = getUserFlagData(ownerUser).exp.total;
        } else {
            historyTotal = Object.values(actor.system.history)
                .reduce((sum, entry) => sum + Number(entry.exp), 0);
        }

        const newTotal       = additional + historyTotal;
        const newValue       = (newTotal + initialExp) - realSpent;
        const newActorSpent  = realSpent - initialExp;

        if (actor.system.exp.total !== newTotal
                || actor.system.exp.value !== newValue
                || actor.system.exp.spent !== newActorSpent) {
            // 総経験点を超えた瞬間に一度だけ知らせる(KI-040)。超過そのものは止めない——
            // 前借り・後払いは卓が決めることで、システムが止める筋合いはない。
            // 判定は書き込み前の残量で行う(更新後は newValue になるため)。既に超過している
            // 状態からのさらなる消費では出さない=繰り返し警告しない
            const crossedLimit = Number(actor.system.exp.value) >= 0 && newValue < 0;
            await actor.update({
                "system.exp.total":  newTotal,
                "system.exp.spent":  newActorSpent,
                "system.exp.value":  newValue
            }, { calcExp: false });
            // 書き込める権限のあるクライアントだけが出す(再計算は全クライアントで走るため)
            if (crossedLimit && actor.isOwner) {
                ui.notifications.warn(`${actor.name}: 消費経験点が総経験点を ${-newValue} 点超えました。`);
            }
        }
    }

    /**
     * アクターの所持アイテムの経験点コスト合計(住宅エリア修正込み)。
     * キャスト本体と所有トループ級(11-6)で共用する。
     */
    static async _sumActorItemsCost(actor) {
        let total = 0;
        for (const item of actor.items) {
            let cost = this._calcSingleItemCost(item);
            // 住宅施設は常備化経験点に住宅エリアの修正(preserveExpMod)を加味する(実効値=基本+エリア修正、0未満は0)。
            // _calcSingleItemCost が計上する条件(購入判定/プレアクト購入でない・派生でない・preserveExp=value)のときだけ加味。
            if (item.type === "residence"
                    && !item.system.isCheckAcquired
                    && item.system["isPre-play"] !== true
                    && !item.system.isDerivedData
                    && item.system.preserveExp?.mode === "value") {
                const mods = await this._resolveHousingAreaMods(item.system);
                if (mods) cost = Math.max(0, cost + (Number(mods.preserveExpMod) || 0));
            }
            total += cost;
        }
        return total;
    }

    /**
     * 所有トループ級(トループ/エニグマ)の消費経験点合計(11-6・Troops.md「所有トループの経験点」)。
     * 対象=スタイル技能の取得と成長・アウトフィットの取得・一般技能の成長(初期習得=Lv1 は既存規約で無償)。
     * トループレベルは取得技能側で計上済みのため対象外。**分身は計上しない**(本体データのコピーのため)。
     * 能力値成長のコストは無い(トループは能力値を成長させられない=スタイル基本値+レベルで決定)。
     */
    static async _sumOwnedTroopsCost(actor) {
        let total = 0;
        for (const troop of game.actors) {
            if (troop.type !== "troop") continue;
            if (troop.system.troopMode === "bunshin") continue;
            if ((troop.system.ownerActorRef?.uuid ?? "") !== actor.uuid) continue;
            total += await this._sumActorItemsCost(troop);
        }
        return total;
    }

    static _calcSingleAbilityCost(growth, base, isControl) {
        const g = Number(growth);
        if (g <= 0) return 0;
        const threshold = isControl ? 17 : 11;
        let cost = 0;
        for (let i = 1; i <= g; i++) {
            cost += ((base + i) < threshold) ? 20 : 40;
        }
        return cost;
    }

    static _calcSingleItemCost(item) {
        const system = item.system;
        const level  = Number(system.level);

        if (item.type === 'generalSkill') {
            if (level <= 0) return 0;
            const genCat = system.generalSkillCategory;
            if (genCat === 'onomasticSkill') {
                const cost = Number(system.onomasticSkill?.expCost) || 5;
                return system.onomasticSkill?.isInitial ? Math.max(0, level - 1) * cost : level * cost;
            }
            if (genCat === 'initialSkill') return Math.max(0, level - 1) * (Number(system.initialSkill?.expCost) || 10);
            return level * 5;
        }

        if (item.type === 'styleSkill') {
            // 経験点消費なし(自動習得等)・レベル自動参照(実体が同一技能の別ブロック)は計上しない
            if (system.expFree || system.levelRef?.enabled) return 0;
            if (level <= 0) return 0;
            const sCat = system.styleSkillCategory;
            if (sCat === 'secret')  return level * 20;
            if (sCat === 'mystery') return level * 50;
            return level * 10;
        }

        // style / miracle / organization のコストはアビリティ計算に含まれるため個別コスト0
        if (item.type === 'style' || item.type === 'miracle' || item.type === 'organization') {
            return 0;
        }

        // アウトフィット: 常備化経験点を集計する
        // isCheckAcquired（購入判定による入手）は経験点不要
        // isPre-play（プレアクト購入）も経験点不要(正本 Outfits.md「true だと所持した際の
        // 経験点消費がなくなる」2026-06-13 確定。16-3 是正=フラグ新設以来ここが未読だった)
        // 消費アイテムは preserveExp.value × 常備化個数(quantity.max)
        if (OUTFIT_ITEM_TYPES.has(item.type)) {
            if (system.isCheckAcquired) return 0;
            if (system["isPre-play"] === true) return 0;
            if (system.isDerivedData) return 0; // 派生データは派生元が経験点を負担するため二重計上しない
            if (system.preserveExp?.mode !== "value") return 0;
            const base = Number(system.preserveExp.value) || 0;
            return readFlag(system, "isConsumption") ? base * (Number(system.quantity?.max) || 0) : base;
        }

        return Number(item.system.expCost) || 0;
    }
}
