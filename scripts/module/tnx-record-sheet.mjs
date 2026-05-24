/**
 * @fileoverview TnxRecordSheet — レコードシート(User flag ビューア)
 *
 * 対象 User の EXP・履歴を表示する ApplicationV2 ベースのシート。
 * フェーズ2-0 では表示のみ。編集機能はフェーズ2-2 で追加する。
 *
 * DocumentSheetV2 ではなく素の ApplicationV2 を使う理由:
 * User ドキュメントのシートとしてではなく、User を引数に開く独自 Application であるため。
 */

import { getUserFlagData, getUserFlagHistorySorted } from "./user-flag-schema.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class TnxRecordSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {User} user  表示対象の User
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

  /** @override */
  async _prepareContext(_options) {
    const flagData = getUserFlagData(this.user);
    const history = getUserFlagHistorySorted(this.user);
    return {
      user: this.user,
      exp: flagData.exp,
      history,
      isEditMode: false, // フェーズ2-0 は表示のみ。編集は 2-2 で追加。
    };
  }
}
