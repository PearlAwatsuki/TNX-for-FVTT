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
const SETTING_INIT = "partSlotPresetInitialized";

/**
 * デフォルト体部位プリセット(頭→足順。フェーズ10・ユーザー確定 2026-06-27)。
 * §4.1: 部位ラベルの語彙集（構造的最小限）として同梱。ホスト種別（武器/IANUS 等）は
 * オプション側で指定するため非掲載。両X はエイリアス(片X×2)。ワールド初回ロードで自動設定し、
 * 以降はユーザー編集を保持する。
 * @type {ReadonlyArray<{value:string,count:number,occupiesOther:boolean,targetPart:string,targetCount:number}>}
 */
export const DEFAULT_PART_SLOT_PRESET = Object.freeze((() => {
  const s = (value, count = 1) => ({ value, count, occupiesOther: false, targetPart: "", targetCount: 1 });
  const a = (value, targetPart, targetCount = 2) => ({ value, count: 1, occupiesOther: true, targetPart, targetCount });
  return [
    // 頭・顔・五感(装着は群末尾)
    s("頭部"), s("頭"), s("後頭部"), s("頭上"), s("頭髪"), s("髪"), s("顔"), s("頬"),
    s("眼部"), s("眼球"), s("涙腺"), s("鼻"),
    s("耳"), s("両耳"), s("内耳"), s("口腔"), s("唇"), s("唇の皮膚"), s("舌"),
    s("ゴーグル"), s("コンタクトレンズ"), s("マスク"), s("ヘルメット"),
    // 脳・神経
    s("脳"), s("大脳"), s("小脳"), s("脳皮質"), s("脳下垂体"), s("神経"),
    // 首・肩
    s("首"), s("喉"), s("肩"), s("肩胛骨"),
    // 胴
    s("胴体"), s("背中"), s("脇腹"), s("腰"), s("下半身"),
    // 内臓
    s("心臓"), s("肺"), s("血液"), s("血管"), s("内臓"), s("消化器官"), s("消化器"), s("骨髄"),
    // 腕・手
    s("片手持ち", 2), a("両手持ち", "片手持ち", 2), s("籠手"), s("手"), s("指", 2), s("爪"),
    s("片腕", 2), a("両腕", "片腕", 2), s("腕"), s("腕部"),
    // 脚・足(靴=足の装着)
    s("片脚", 2), a("両脚", "片脚", 2), s("脚"), s("脚部"), s("靴"),
    // 全身・組織
    s("全身"), s("皮膚"), s("肌"), s("筋肉"), s("骨格"), s("細胞"), s("全身の細胞"), s("生身"), s("義体"),
    // 装着(装着先が不定: 衣類・携帯・装飾・外付け)
    s("アンダーウェア"), s("スーツ"), s("コート"), s("アーマー"), s("鞄"), s("装飾品"), s("護符"), s("結界"), s("操縦"),
    // 内的(心・電脳・霊)
    s("電脳"), s("精神"), s("魂"), s("血統"),
    // スコープ(最も非局所)
    s("各部"), s("独立"),
  ];
})());

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
  // 初回初期化済みフラグ(ワールド初回ロードでデフォルトを流し込んだら true。以降は再設定しない)
  game.settings.register(SCOPE, SETTING_INIT, {
    scope: "world", config: false, type: Boolean, default: false,
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

/**
 * ワールド初回ロード時に部位スロットプリセットをデフォルト体部位で初期化する(GM のみ・1回だけ)。
 * 以降はユーザー編集をそのまま保持する(空にしても復活しない)。ready フックから呼ぶ。
 * 「こちらが先に設定を用意してある」体裁で、ボタン操作なしに既定が入る。
 */
export async function initializeDefaultPartSlotPreset() {
  if (!game.user.isGM) return;
  if (game.settings.get(SCOPE, SETTING_INIT)) return;
  // 既にプリセットが入っている(手入力済み)なら上書きしない。空のときだけデフォルトを流し込む。
  if (!getPartSlotPreset().length) {
    await game.settings.set(SCOPE, SETTING, foundry.utils.deepClone(DEFAULT_PART_SLOT_PRESET));
  }
  await game.settings.set(SCOPE, SETTING_INIT, true);
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

  /** 編集対象アクター(指定時は actor.system.partSlots を編集。null = ゲーム設定プリセット)。 */
  _actor = null;
  /** 編集中の作業配列(add/delete/checkbox 切替の間で未保存値を保つ)。null = 未初期化 */
  _rows = null;

  constructor(options = {}) {
    // アクター指定時は一意な id にして、プリセット編集と同時に開けるようにする
    if (options.actor) options.id = `tnx-part-slots-${options.actor.id}`;
    super(options);
    this._actor = options.actor ?? null;
  }

  /** @override — ウィンドウタイトル(アクター編集時はアクター名) */
  get title() {
    return this._actor ? `部位スロット：${this._actor.name}` : "部位スロットプリセット";
  }

  /** @override */
  async _prepareContext() {
    if (!this._rows) {
      const source = this._actor ? (this._actor.system.partSlots ?? []) : getPartSlotPreset();
      this._rows = foundry.utils.deepClone(source);
    }
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
    if (this._actor) await this._actor.update({ "system.partSlots": cleaned });
    else await game.settings.set(SCOPE, SETTING, cleaned);
  }
}
