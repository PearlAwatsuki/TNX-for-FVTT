import { TnxHistoryMixin } from '../module/tnx-history-mixin.mjs';
import { TnxActionHandler } from '../module/tnx-action-handler.mjs';

export class TokyoNovaPlayerSheet extends ActorSheet {
    _prepareHistoryForDisplay = TnxHistoryMixin._prepareHistoryForDisplay;
    _calculateTotalExp = TnxHistoryMixin._calculateTotalExp;

    // イベントハンドラ (Mixin)
    _onHistoryAdd = TnxHistoryMixin._onHistoryAdd;
    _onHistoryDelete = TnxHistoryMixin._onHistoryDelete;
    _onHistoryChange = TnxHistoryMixin._onHistoryChange;

    constructor(...args) {
        super(...args);
        // 所有者であればデフォルトで編集モードにするかどうか（ここではfalse開始とします）
        this._isEditMode = false;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["tokyo-nova", "sheet", "actor", "player"], // .cast-sheet はhbs側で付与するか、ここで追加しても良い
            template: "systems/tokyo-nova-axleration/templates/actor/player-sheet.hbs",
            width: 850,
            height: 900,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "history" }]
        });
    }

    _getHeaderButtons() {
        const buttons = super._getHeaderButtons();
        
        // UUIDコピーボタンを先頭（ボタン群の一番左）に追加
        // ※トグルスイッチはDOM操作で追加するためここには含めない
        buttons.unshift({
            label: "UUIDをコピー", // ホバー時に表示されるテキスト
            class: "copy-uuid",
            icon: "fas fa-passport",
            onclick: (ev) => {
                ev.preventDefault();
                game.clipboard.copyPlainText(this.document.uuid);
                ui.notifications.info(game.i18n.format("DOCUMENT.IdCopiedClipboard", {label: this.document.documentName, type: "UUID", id: this.document.uuid}));
            }
        });
        
        return buttons;
    }

    async getData(options) {
        const context = await super.getData(options);
        context.system = this.actor.system;
        
        // 編集モードフラグをテンプレートに渡す
        context.isEditable = this.isEditable;
        context.isEditMode = this._isEditMode && this.isEditable;

        // 履歴データの準備
        const historyMap = this.actor.system.history || {};
        context.history = this._prepareHistoryForDisplay(historyMap);

        // カード情報の取得
        await this._getCardPileData(context);

        return context;
    }

    /**
     * シート描画後の処理
     * モードに応じてクラスを付与し、スタイルを切り替える
     */
    async _render(force = false, options = {}) {
        await super._render(force, options);
        
        if (this.element && this.element[0]) {
            const sheetElement = this.element[0];
            const header = this.element.find('.window-header');

            // 1. モードクラスの適用
            if (this._isEditMode && this.isEditable) {
                sheetElement.classList.remove("view-mode");
                sheetElement.classList.add("edit-mode");
            } else {
                sheetElement.classList.remove("edit-mode");
                sheetElement.classList.add("view-mode");
            }

            // 2. トグルスイッチの左端挿入（権限がある場合のみ）
            // 既に挿入済みでないか確認してから追加
            if (this.isEditable && header.find('.edit-mode-toggle').length === 0) {
                // CSSのスタイルに合わせたHTML構造を作成
                const toggleBtn = $('<a class="edit-mode-toggle" title="編集モード切替"></a>');
                
                // クリックイベントの設定
                toggleBtn.on('click', (ev) => {
                    ev.preventDefault();
                    this._onToggleEditMode(ev);
                });

                // ヘッダーの先頭（左端）に追加
                header.prepend(toggleBtn);
            }

            this._applyTextSqueezing();
        }
    }

    _applyTextSqueezing() {
        if (!this.element) return;
        
        const elements = this.element.find('.squeeze-text');
        
        elements.each((i, el) => {
            const parent = el.parentElement;
            
            const parentStyle = getComputedStyle(parent);
            const parentWidth = parent.clientWidth;
            const paddingLeft = parseFloat(parentStyle.paddingLeft) || 0;
            const paddingRight = parseFloat(parentStyle.paddingRight) || 0;
            const availableWidth = parentWidth - paddingLeft - paddingRight - 2;
            
            const contentWidth = el.scrollWidth;

            const isSkewedLabel = el.classList.contains('skill-label-content');

            let transformBase = '';
            if (isSkewedLabel) {
                transformBase = 'skewX(25deg)';
            } else {
                transformBase = '';
            }

            if (contentWidth > availableWidth) {
                const scale = availableWidth / contentWidth;
                el.style.transform = `${transformBase} scaleX(${scale * 0.95})`;
            } else {
                el.style.transform = transformBase;
            }
        });
    }

    /**
     * Mixinから呼ばれる更新処理
     */
    async _performHistoryUpdate(updateData) {
        await this.actor.update(updateData);
    }

    activateListeners(html) {
        super.activateListeners(html);
        TnxHistoryMixin.activateHistoryListeners.call(this, html);

        // カード関連のリスナー
        html.find('.open-hand').click(ev => {
            ev.preventDefault();
            if (this.actor.system.handPileId) fromUuid(this.actor.system.handPileId).then(doc => doc?.sheet.render(true));
        });
        html.find('.open-trump').click(ev => {
            ev.preventDefault();
            if (this.actor.system.trumpCardPileId) fromUuid(this.actor.system.trumpCardPileId).then(doc => doc?.sheet.render(true));
        });
        
        // 手札作成ボタン
        html.find('.create-piles').click(async ev => {
            ev.preventDefault();
            await game.tnx.setupDefaultCardPiles(this.actor);
        });

        // リンク解除ボタン（編集モード時のみ表示される想定だが、安全のため）
        html.find('.unlink-pile').click(async ev => {
            ev.preventDefault();
            const target = ev.currentTarget.dataset.target; // "hand" or "trump"
            const updateKey = target === "hand" ? "system.handPileId" : "system.trumpCardPileId";
            
            // 確認ダイアログ
            const confirm = await Dialog.confirm({
                title: "リンクの解除",
                content: "<p>カード置き場とのリンクを解除しますか？</p>",
                defaultYes: false
            });
            
            if (confirm) {
                await this.actor.update({ [updateKey]: "" });
            }
        });
    }

    async _onToggleEditMode(event) {
        event.preventDefault();
        this._isEditMode = !this._isEditMode;
        this.render(false);
    }

    async _getCardPileData(context) {
        if (context.system.handPileId) {
            context.handPile = await fromUuid(context.system.handPileId);
        }
        if (context.system.trumpCardPileId) {
            context.trumpPile = await fromUuid(context.system.trumpCardPileId);
        }
    }

    /**
     * ドロップ処理（カード置き場のリンク用）
     */
    async _onDrop(event) {
        if (!this._isEditMode) return super._onDrop(event);

        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch (err) {
            return false;
        }

        if (data.type !== "Cards") return super._onDrop(event);

        const dropArea = event.target.closest("[data-drop-area]")?.dataset.dropArea;
        if (!dropArea) return false;

        const cardDoc = await fromUuid(data.uuid);
        if (!cardDoc) return false;

        // 手札のリンク
        if (dropArea === "hand-pile" && cardDoc.type === "hand") {
            await this.actor.update({ "system.handPileId": cardDoc.uuid });
            return false;
        }
        
        // 切り札のリンク
        if (dropArea === "trump-card-pile" && cardDoc.type === "pile") {
            await this.actor.update({ "system.trumpCardPileId": cardDoc.uuid });
            return false;
        }

        return super._onDrop(event);
    }
}