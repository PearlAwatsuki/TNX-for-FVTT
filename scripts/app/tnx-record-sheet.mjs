import { syncViewModeCheckboxes } from "../ui/sheet-input-state.mjs";
/**
 * @fileoverview TnxRecordSheet — レコードシート(User flag ビューア・エディタ)
 *
 * 対象 User の EXP・履歴を表示・編集する ApplicationV2 ベースのシート。
 * 書き込み権限: 本人 または GM。
 *
 * DocumentSheetV2 ではなく素の ApplicationV2 を使う理由:
 * User ドキュメントのシートとしてではなく、User を引数に開く独自 Application であるため。
 */

import { HistoryInputStateMixin } from "../ui/history-input-state.mjs";
import { captureScrollTop, restoreScrollTop } from "../ui/scroll-preserve.mjs";

import {
  getUserFlagData,
  getUserFlagHistorySorted,
  calcHistoryExpTotal,
  historyAdd,
  historyUpdate,
  saveUserFlagHistory,
  deleteUserFlagHistoryEntry,
} from "../core/user-flag-schema.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxRecordSheet extends HistoryInputStateMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /**
   * @param {User} user  表示・編集対象の User
   * @param {object} [options]
   */
  constructor(user, options = {}) {
    super({ id: `tnx-record-sheet-${user.id}`, ...options });
    this.user = user;
    this._isEditMode = false;
  }

  static DEFAULT_OPTIONS = {
    // `sheet` は既存の編集トグルとヘッダー意匠を流用するために付ける。
    classes: ["tokyo-nova", "sheet", "record-sheet"],
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
      scrollable: [".history-list"],
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
      isEditMode: this._canEdit() && this._isEditMode,
    };
  }

  /** @override */
  async _preRender(context, options) {
    await super._preRender?.(context, options);
    this._scrollTop = captureScrollTop(this.element, ".record-sheet-body");
  }

  /** @override */
  _onRender(context, _options) {
    restoreScrollTop(this.element, ".record-sheet-body", this._scrollTop);
    const el = this.element;
    el.classList.toggle("edit-mode", !!context.isEditMode);
    el.classList.toggle("view-mode", !context.isEditMode);
    syncViewModeCheckboxes(el, context.isEditMode);
    this._renderHeaderControls();

    if (!context.isEditMode) return;
    for (const input of el.querySelectorAll(".history-input")) {
      input.addEventListener("change", this._onHistoryInputChange.bind(this));
    }
  }

  /** 既存シートと同じヘッダー構造へ、レコード固有の操作だけを追加する。 */
  _renderHeaderControls() {
    const header = this.element.querySelector(".window-header");
    if (!header) return;

    // 再描画時や旧試作版から残った操作を先に除去し、入口を一組だけにする。
    header.querySelectorAll(".record-header-control, .edit-mode-toggle").forEach(element => element.remove());

    const title = header.querySelector(".window-title");
    if (title) {
      // `.tokyo-nova.sheet` の一般則は本文に名前を持つシートのタイトルを隠すが、
      // レコードシートはヘッダーのタイトルが正本なので元どおり表示する。
      title.style.display = "flex";
      title.style.flex = "1 1 auto";
      title.style.minWidth = "0";
    }

    // 左端: 既存の編集／閲覧トグル。その直後にはコア生成のアイコンとタイトルが残る。
    if (this._canEdit()) {
      const toggle = document.createElement("a");
      toggle.className = "edit-mode-toggle";
      toggle.title = "編集モード切替";
      toggle.setAttribute("aria-label", "編集モード切替");
      toggle.innerHTML = '<i class="fa-solid fa-eye tnx-view-icon"></i><i class="fa-solid fa-pen tnx-edit-icon"></i>';
      toggle.addEventListener("click", event => {
        event.preventDefault();
        this._isEditMode = !this._isEditMode;
        this.render();
      });
      header.prepend(toggle);
    }

    const close = header.querySelector('[data-action="close"]') ?? header.lastElementChild;
    const addControl = (action, titleText, icon, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      // Foundry ApplicationV2 の既存ヘッダーコントロールと同じ構造を使う。
      button.className = `header-control icon fa-solid ${icon} record-header-control`;
      button.dataset.action = action;
      button.title = titleText;
      button.setAttribute("aria-label", titleText);
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await handler.call(this);
      });
      if (close?.parentNode === header) header.insertBefore(button, close);
      else header.append(button);
    };

    // 下向き=外部ファイルから取り込み、上向き=外部ファイルへ書き出し、の対称な組。
    if (this._canEdit()) addControl("importRecord", "レコードをインポート", "fa-download", this._importRecord);
    addControl("exportRecord", "レコードをエクスポート", "fa-upload", this._exportRecord);
  }

  /** User flag のレコードを JSON として書き出す。 */
  async _exportRecord() {
    try {
      const flag = getUserFlagData(this.user);
      const payload = {
        format: "tokyo-nova-axleration.record",
        version: 1,
        userName: this.user.name,
        exportedAt: new Date().toISOString(),
        record: { history: flag.history, exp: flag.exp },
      };
      const safeName = String(this.user.name || "record").replace(/[\/:*?"<>|]/g, "_");
      const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
      if (typeof save !== "function") throw new Error("ファイル保存機能を利用できません。");
      save(JSON.stringify(payload, null, 2), "application/json", `tnx-record-${safeName}.json`);
    } catch (error) {
      console.error("TNX | レコードのエクスポートに失敗しました", error);
      ui.notifications.error(`レコードをエクスポートできませんでした: ${error.message}`);
    }
  }

  /** JSON を選択して対象 User のレコードへ読み込む。 */
  async _importRecord() {
    if (!this._canEdit()) return;
    const file = await foundry.applications.api.DialogV2.prompt({
      window: { title: "レコードのインポート" },
      classes: ["tokyo-nova", "tnx-dialog"],
      content: '<div class="form-group"><label>JSONファイル</label><div class="form-fields"><input type="file" name="recordFile" accept="application/json,.json"></div></div>',
      ok: {
        label: "インポート",
        icon: "fas fa-download",
        callback: (_event, button) => button.form.elements.recordFile.files?.[0] ?? null,
      },
      modal: true,
      rejectClose: false,
    });
    if (!file) return;

    try {
      const read = foundry.utils.readTextFromFile ?? globalThis.readTextFromFile;
      if (typeof read !== "function") throw new Error("ファイル読込機能を利用できません。");
      const parsed = JSON.parse(await read(file));
      const record = parsed?.format === "tokyo-nova-axleration.record" ? parsed.record : parsed;
      if (!record || typeof record.history !== "object" || Array.isArray(record.history)
          || !record.exp || typeof record.exp !== "object") throw new Error("レコード形式ではありません。");

      const history = {};
      for (const [id, entry] of Object.entries(record.history)) {
        if (!entry || typeof entry !== "object") continue;
        const key = String(entry.id || id || foundry.utils.randomID());
        history[key] = {
          id: key,
          date: String(entry.date ?? ""),
          title: String(entry.title ?? ""),
          exp: Number(entry.exp) || 0,
          rl: String(entry.rl ?? ""),
          players: String(entry.players ?? ""),
          origin: String(entry.origin ?? this.user.id),
          castUuid: String(entry.castUuid ?? ""),
        };
      }
      await this.user.update({
        [`flags.${game.system.id}.history`]: history,
        [`flags.${game.system.id}.exp.total`]: calcHistoryExpTotal(history),
        [`flags.${game.system.id}.exp.value`]: Number(record.exp.value) || 0,
        [`flags.${game.system.id}.exp.spent`]: Number(record.exp.spent) || 0,
      });
      ui.notifications.info("レコードをインポートしました。");
      this.render();
    } catch (error) {
      console.error("TNX | レコードのインポートに失敗しました", error);
      ui.notifications.error(`レコードをインポートできませんでした: ${error.message}`);
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
    // castUuid は空＝どのキャストにも紐づかない。レコードシートはプレイヤーの記録全体の正本であり、
    // ここで足した行はキャストシートには出ない(キャストに紐づけたい行はキャストシートの
    // 「行を追加」から作る＝そちらが自動でそのキャストを焼く)
    const entry = { id: newId, date: "", title: "", exp: 0, rl: "", players: "", origin: this.user.id, castUuid: "" };
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
    await deleteUserFlagHistoryEntry(this.user, entryId);
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
