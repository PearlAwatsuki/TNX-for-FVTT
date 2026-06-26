/**
 * @fileoverview 部位スロットプリセットの設定アプリ(フェーズ10)。
 *
 * 新規キャストへ流し込む「部位スロット(体部位)」の初期集合をワールド設定で定義する。
 * §4.1 境界: 部位ラベル集合は構造的最小限(機能ラベルの語彙)として許容。中身(体部位・個数)は
 * ルール由来のためユーザーが本アプリで定義・完成させる(既定は空)。
 * 設定キー: world 設定 "partSlotPreset" = [{ value, count, occupiesOther, targetPart, targetCount }]。
 * occupiesOther=「指定部位を複数占有」エイリアス(両手持ち=片手持ち×2 等。排他部位・ルール追加に対応)。
 * レイアウトはカード設定アプリ(standard-form・number-input-spinner)に準拠。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md「部位管理(フェーズ10)」。
 */

const SCOPE = "tokyo-nova-axleration";
const SETTING = "partSlotPreset";

/** 部位スロットプリセットをワールド設定から読む(配列)。流し込み・占有計算が使う。 */
export function getPartSlotPreset() {
  const stored = game.settings.get(SCOPE, SETTING);
  return Array.isArray(stored) ? stored : [];
}

/** ワールド設定 "partSlotPreset" と設定メニューを登録する(init 内で呼ぶ)。 */
export function registerPartSlotPresetSetting() {
  game.settings.register(SCOPE, SETTING, {
    scope: "world", config: false, type: Array, default: [],
  });
  game.settings.registerMenu(SCOPE, "partSlotPresetMenu", {
    name: "部位スロットプリセット",
    label: "プリセットを編集",
    hint: "新規キャストへ流し込む部位スロット(体部位)の初期集合を定義します。value=部位ラベル、count=保有数。",
    icon: "fas fa-person",
    type: PartSlotPresetApp,
    restricted: true,
  });
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** 部位スロットプリセット 編集アプリ。行リスト・追加/削除・エイリアス・一括保存。 */
export class PartSlotPresetApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tnx-part-slot-preset",
    tag: "form",
    classes: ["application", "tokyo-nova", "standard-form", "tnx-part-slot-preset"],
    position: { width: 600, height: 620 },
    window: { title: "部位スロットプリセット", icon: "fas fa-person" },
    form: { handler: PartSlotPresetApp.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: {
      addRow:    PartSlotPresetApp.#onAddRow,
      deleteRow: PartSlotPresetApp.#onDeleteRow,
      increment: PartSlotPresetApp.#onIncrement,
      decrement: PartSlotPresetApp.#onDecrement,
    },
  };

  static PARTS = {
    main: { template: "systems/tokyo-nova-axleration/templates/apps/part-slot-preset.hbs" },
  };

  /** 編集中の作業配列(add/delete/checkbox 切替の間で未保存値を保つ)。null = 未初期化 */
  _rows = null;

  /** @override */
  async _prepareContext() {
    if (!this._rows) this._rows = foundry.utils.deepClone(getPartSlotPreset());
    return { rows: this._rows };
  }

  /** @override — エイリアスチェック切替で対象欄の表示を更新する。 */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const cb of this.element.querySelectorAll('[data-field="occupiesOther"]')) {
      cb.addEventListener("change", () => { this._harvest(); this.render(); });
    }
  }

  /** DOM の現在値を作業配列へ取り込む(再描画前に呼ぶ)。 */
  _harvest() {
    if (!this.element) return;
    const rows = [];
    for (const row of this.element.querySelectorAll("[data-row]")) {
      rows.push({
        value:         row.querySelector('[data-field="value"]')?.value ?? "",
        count:         Math.max(0, Number(row.querySelector('[data-field="count"]')?.value) || 0),
        occupiesOther: row.querySelector('[data-field="occupiesOther"]')?.checked ?? false,
        targetPart:    row.querySelector('[data-field="targetPart"]')?.value ?? "",
        targetCount:   Math.max(0, Number(row.querySelector('[data-field="targetCount"]')?.value) || 0),
      });
    }
    this._rows = rows;
  }

  static #onAddRow() {
    this._harvest();
    this._rows.push({ value: "", count: 1, occupiesOther: false, targetPart: "", targetCount: 1 });
    this.render();
  }

  static #onDeleteRow(_event, target) {
    this._harvest();
    const index = Number(target.dataset.index);
    if (index >= 0 && index < this._rows.length) this._rows.splice(index, 1);
    this.render();
  }

  /** number-input-spinner の ＋(カード設定アプリと同方式)。 */
  static #onIncrement(_event, target) {
    const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
    if (!input) return;
    let v = parseInt(input.value, 10);
    if (isNaN(v)) v = parseInt(input.min, 10) || 0;
    const max = parseInt(input.max, 10);
    input.value = isNaN(max) ? v + 1 : Math.min(v + 1, max);
  }

  /** number-input-spinner の －。 */
  static #onDecrement(_event, target) {
    const input = target.closest(".number-input-spinner")?.querySelector('input[type="number"]');
    if (!input) return;
    let v = parseInt(input.value, 10);
    if (isNaN(v)) v = parseInt(input.min, 10) || 0;
    const min = parseInt(input.min, 10);
    input.value = isNaN(min) ? v - 1 : Math.max(v - 1, min);
  }

  /** 行を整形して保存(空 value 行は捨てる。非エイリアス行は target* を捨てる)。 */
  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const arr = Array.isArray(data.rows) ? data.rows : Object.values(data.rows ?? {});
    const cleaned = arr
      .map((r) => {
        const occupiesOther = r?.occupiesOther === true || r?.occupiesOther === "true";
        return {
          value:         String(r?.value ?? "").trim(),
          count:         Math.max(0, Number(r?.count) || 0),
          occupiesOther,
          targetPart:    occupiesOther ? String(r?.targetPart ?? "").trim() : "",
          targetCount:   occupiesOther ? Math.max(0, Number(r?.targetCount) || 0) : 1,
        };
      })
      .filter((r) => r.value);
    await game.settings.set(SCOPE, SETTING, cleaned);
  }
}
