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
        actions: {
            clearOwnerRef: TokyoNovaTroopSheet._onClearOwnerRef,
        },
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
        // 名前の自由入力はエニグマのみ(トループ/分身は導出名で固定＝Troops.md「種別と名前の規則」)
        context.nameLocked = this.actor.system.troopMode !== "enigma";
        // 所属(ワークス)はトループでは基本なし。「ワークスを設定」ON のときだけ表示
        context.showAffiliation = this.actor.system.hasWorks === true;
        context.troopModeOptions = Object.entries(TROOP_MODES).map(([value, label]) => ({
            value, label, selected: value === this.actor.system.troopMode,
        }));
        // トループ/エニグマはスタイルを1つだけ＝スロットも1枠だけ表示(分身は本体同一データ=3枠)。
        // 役割(ペルソナ/キー/シャドウ)表示も分身以外は持たない(2026-07-03 確定)
        if (this.actor.system.troopMode !== "bunshin") {
            context.styleSlots = context.styleSlots.slice(0, 1);
        }
        context.showStyleRoles = this.actor.system.troopMode === "bunshin";
        // トループ種別は名前が「(スタイル名)・トループ…」のためスタイル概要行は冗長＝出さない
        // (エニグマ=自由名・分身=「○○の分身」は名前にスタイルが含まれないため残す)
        context.showStyleSummary = this.actor.system.troopMode !== "troop";

        // レベルの呼称: エニグマでは「エニグマレベル」(2026-07-04 確定・Troops.md)
        context.troopLevelLabel = this.actor.system.troopMode === "enigma" ? "エニグマレベル" : "トループレベル";

        // 所有者(取得元)アクター(11-6): 名前はライブ解決(削除済みは name フォールバック=ライブ解決原則)
        const ownerRef = this.actor.system.ownerActorRef ?? {};
        let ownerName = "";
        if (ownerRef.uuid) {
            let doc = null;
            try { doc = fromUuidSync(ownerRef.uuid); } catch { doc = null; }
            ownerName = doc?.name ?? (ownerRef.name ? `${ownerRef.name}（削除済み）` : "");
        }
        context.ownerActorName = ownerName;
        return context;
    }

    /** @override 所有者欄のドロップ受け(編集モードのみ) */
    _onRender(context, options) {
        super._onRender(context, options);
        if (!this.isEditable) return;
        const zone = this.element.querySelector(".troop-owner-dropzone");
        if (zone) {
            zone.addEventListener("dragover", (ev) => ev.preventDefault());
            zone.addEventListener("drop", (ev) => this._onOwnerDrop(ev));
        }
    }

    /** 所有者(取得元)のドロップ: キャスト/ゲストのアクターのみ受け付ける */
    async _onOwnerDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Actor" || !["cast", "guest"].includes(doc.type)) {
            ui.notifications.warn("所有者にはキャストまたはゲストのアクターをドロップしてください。");
            return;
        }
        await this.actor.update({ "system.ownerActorRef": { uuid: doc.uuid, name: doc.name } });
    }

    static async _onClearOwnerRef(_event, _target) {
        await this.actor.update({ "system.ownerActorRef": { uuid: "", name: "" } });
    }

    /**
     * @override
     * トループ/エニグマはスタイルを1つしか設定できない(2026-07-03 確定・Troops.md「スタイルの数」)。
     * 既にスタイルを持つ場合はドロップ自体を拒否する(同名の再ドロップによるレベル上昇も不可＝
     * トループの強さはトループレベルで表す)。分身は本体とほぼ同一データのため制限しない。
     */
    async _onDropItem(event, data) {
        if (this.actor.system.troopMode !== "bunshin" && data?.uuid) {
            const dropped = await fromUuid(data.uuid).catch(() => null);
            if (dropped?.type === "style" && this.actor.items.some(i => i.type === "style")) {
                ui.notifications.warn("トループ／エニグマはスタイルを1つだけ持てます。");
                return false;
            }
        }
        return super._onDropItem(event, data);
    }
}
