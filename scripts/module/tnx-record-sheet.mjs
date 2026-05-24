/**
 * @fileoverview TnxRecordSheet — レコードシート(User flag ビューア・エディタ)
 *
 * 対象 User の EXP・履歴を表示・編集する ApplicationV2 ベースのシート。
 * 書き込み権限: 本人 または GM。
 *
 * DocumentSheetV2 ではなく素の ApplicationV2 を使う理由:
 * User ドキュメントのシートとしてではなく、User を引数に開く独自 Application であるため。
 */

import {
  getUserFlagData,
  getUserFlagHistorySorted,
  calcHistoryExpTotal,
  historyAdd,
  historyUpdate,
  historyRemove,
  saveUserFlagHistory,
} from "./user-flag-schema.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxRecordSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {User} user  表示・編集対象の User
   * @param {object} [options]
   */
  constructor(user, options = {}) {
    super({ id: `tnx-record-sheet-${user.id}`, ...options });
    this.user = user;
  }

  static DEFAULT_OPTIONS = {
    classes: ["tokyo-nova", "record-sheet"],
    window: {
      icon: "fas fa-id-card",
      resizable: true,
    },
    position: {
      width: 760,
      height: 520,
    },
    actions: {
      addHistory:    TnxRecordSheet._onAddHistory,
      deleteHistory: TnxRecordSheet._onDeleteHistory,
    },
  };

  static PARTS = {
    main: {
      template: "systems/tokyo-nova-axleration/templates/user/record-sheet.hbs",
    },
  };

  /** @override */
  get title() {
    return `レコードシート: ${this.user.name}`;
  }

  /** 現在のユーザーがこの User の flag を書き込める権限を持つか */
  _canEdit() {
    return game.user.isGM || this.user.id === game.user.id;
  }

  /** @override */
  async _prepareContext(_options) {
    const flagData = getUserFlagData(this.user);
    const history = getUserFlagHistorySorted(this.user);
    return {
      user: this.user,
      exp: flagData.exp,
      history,
      isEditMode: this._canEdit(),
    };
  }

  /** @override */
  _onRender(_context, _options) {
    if (!this._canEdit()) return;
    for (const input of this.element.querySelectorAll(".history-input")) {
      input.addEventListener("change", this._onHistoryInputChange.bind(this));
    }
  }

  // ─── アクションハンドラ ─────────────────────────────────────────────────

  /**
   * 履歴行を追加する。
   * @param {Event} _event
   * @param {HTMLElement} _target
   */
  static async _onAddHistory(_event, _target) {
    const newId = foundry.utils.randomID();
    const entry = { id: newId, date: "", title: "", exp: 0, rl: "", players: "" };
    const { history } = getUserFlagData(this.user);
    await saveUserFlagHistory(this.user, historyAdd(history, entry));
    this.render();
  }

  /**
   * 履歴行を削除する。
   * @param {Event} _event
   * @param {HTMLElement} target  data-id を持つ削除ボタン
   */
  static async _onDeleteHistory(_event, target) {
    const entryId = target.dataset.id;
    if (!entryId) return;
    const { history } = getUserFlagData(this.user);
    await saveUserFlagHistory(this.user, historyRemove(history, entryId));
    this.render();
  }

  // ─── インライン編集 ─────────────────────────────────────────────────────

  /**
   * 履歴入力欄の change イベント。flag を更新し、exp 列変更時は EXP サマリを即時更新。
   * @param {Event} event
   */
  async _onHistoryInputChange(event) {
    const input = event.currentTarget;
    const entryId = input.dataset.id;
    const field   = input.dataset.field;
    if (!entryId || !field) return;

    const value = input.type === "number" ? Number(input.value) : input.value;
    const { history } = getUserFlagData(this.user);
    const newHistory = historyUpdate(history, entryId, { [field]: value });
    await saveUserFlagHistory(this.user, newHistory);

    // exp 列変更時のみ合計表示を DOM 直接更新(フォーカスを壊さないため再描画しない)
    if (field === "exp") {
      const newTotal = calcHistoryExpTotal(newHistory);
      const totalEl = this.element.querySelector("[data-exp-field='total']");
      if (totalEl) totalEl.textContent = String(newTotal);
    }
  }
}
