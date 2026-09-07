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

import { SYSTEM_ID } from "../constants.mjs";
import { enhanceComboboxes } from "../ui/combobox.mjs";

const SETTING = "partSlotPreset";
const SETTING_INIT = "partSlotPresetInitialized";
// 部位キーのスキーマ版(フェーズ12)。付与済みでも版が上がれば再移行する=キー命名の変更を
// 既存ワールドへ波及させる。1=英語キー(2026-07-15・旧ローマ字キーからの差し替えを含む)。
const SETTING_KEY_SCHEME = "partSlotKeyScheme";
const PART_KEY_SCHEME = 1;

/**
 * デフォルト体部位プリセット(頭→足順。フェーズ10・ユーザー確定 2026-06-27)。
 * §4.1: 部位ラベルの語彙集（構造的最小限）として同梱。ホスト種別（武器/IANUS 等）は
 * オプション側で指定するため非掲載。両X はエイリアス(片X×2)。ワールド初回ロードで自動設定し、
 * 以降はユーザー編集を保持する。
 *
 * key=部位キー(フェーズ12・AE/コードからの安定参照)。ラベルはユーザーが自由にリネームできるため、
 * 参照は常にキーで持ち、表示時にラベルへ逆引きする(識別キー・分類コードキーと同じ原則)。
 * 既定ラベルのキーは英語(2026-07-15 ユーザー確定)。近縁ラベルは接頭/接尾で 1:1 を保つ
 * (頭髪=head-hair / 髪=hair、皮膚=skin / 肌=complexion 等)。「〜部」は "-part"
 * (頭部=head-part・眼部=eye-part・腕部=arm-part・脚部=leg-part。後頭部のみ occiput)。
 * 両X はエイリアス(片X×2)。キーに "." は使えない(AE キー文法のセグメント区切りのため)。
 * @type {ReadonlyArray<{key:string,value:string,count:number,occupiesOther:boolean,targetPart:string,targetKey:string,targetCount:number}>}
 */
export const DEFAULT_PART_SLOT_PRESET = Object.freeze((() => {
  const s = (key, value, count = 1) =>
    ({ key, value, count, occupiesOther: false, targetPart: "", targetKey: "", targetCount: 1 });
  const a = (key, value, targetKey, targetPart, targetCount = 2) =>
    ({ key, value, count: 1, occupiesOther: true, targetPart, targetKey, targetCount });
  return [
    // 頭・顔・五感(装着は群末尾)
    s("head-part", "頭部"), s("head", "頭"), s("occiput", "後頭部"), s("overhead", "頭上"),
    s("head-hair", "頭髪"), s("hair", "髪"), s("face", "顔"), s("cheek", "頬"),
    s("eye-part", "眼部"), s("eyeball", "眼球"), s("tear-gland", "涙腺"), s("nose", "鼻"),
    s("ear", "耳"), s("both-ears", "両耳"), s("inner-ear", "内耳"), s("mouth", "口腔"),
    s("lips", "唇"), s("lip-skin", "唇の皮膚"), s("tongue", "舌"),
    s("goggles", "ゴーグル"), s("contact-lens", "コンタクトレンズ"), s("mask", "マスク"), s("helmet", "ヘルメット"),
    // 脳・神経
    s("brain", "脳"), s("cerebrum", "大脳"), s("cerebellum", "小脳"), s("cortex", "脳皮質"),
    s("pituitary", "脳下垂体"), s("nerve", "神経"),
    // 首・肩
    s("neck", "首"), s("throat", "喉"), s("shoulder", "肩"), s("scapula", "肩胛骨"),
    // 胴
    s("torso", "胴体"), s("back", "背中"), s("flank", "脇腹"), s("waist", "腰"), s("lower-body", "下半身"),
    // 内臓
    s("heart", "心臓"), s("lungs", "肺"), s("blood", "血液"), s("blood-vessels", "血管"),
    s("viscera", "内臓"), s("digestive-organs", "消化器官"), s("digestive-tract", "消化器"), s("marrow", "骨髄"),
    // 腕・手
    s("one-hand", "片手持ち", 2), a("two-hands", "両手持ち", "one-hand", "片手持ち", 2),
    s("gauntlet", "籠手"), s("hand", "手"), s("finger", "指", 2), s("nail", "爪"),
    s("one-arm", "片腕", 2), a("two-arms", "両腕", "one-arm", "片腕", 2), s("arm", "腕"), s("arm-part", "腕部"),
    // 脚・足(靴=足の装着)
    s("one-leg", "片脚", 2), a("two-legs", "両脚", "one-leg", "片脚", 2),
    s("leg", "脚"), s("leg-part", "脚部"), s("shoes", "靴"),
    // 全身・組織
    s("full-body", "全身"), s("skin", "皮膚"), s("complexion", "肌"), s("muscle", "筋肉"), s("skeleton", "骨格"),
    s("cells", "細胞"), s("all-cells", "全身の細胞"), s("flesh", "生身"), s("cyber-body", "義体"),
    // 装着(装着先が不定: 衣類・携帯・装飾・外付け)。住宅もここ(外付け系と同じ扱い)。
    s("underwear", "アンダーウェア"), s("suit", "スーツ"), s("coat", "コート"), s("armor", "アーマー"),
    s("bag", "鞄"), s("accessory", "装飾品"), s("amulet", "護符"), s("ward", "結界"),
    s("piloting", "操縦"), s("housing", "住宅"),
    // 内的(心・電脳・霊)
    s("cyberbrain", "電脳"), s("mind", "精神"), s("soul", "魂"), s("bloodline", "血統"),
    // スコープ(最も非局所)
    s("each-part", "各部"), s("independent", "独立"),
  ];
})());

/** 既定ラベル → 既定キーの対応表(既存データへの自動キー付与に使う)。 */
export const DEFAULT_PART_LABEL_TO_KEY = Object.freeze(
  Object.fromEntries(DEFAULT_PART_SLOT_PRESET.map((r) => [r.value, r.key]))
);

/** カスタム部位のキーを生成する(既定ラベル対応表に無いラベル用。永続化前提で一度だけ振る)。 */
function generatePartKey() {
  return `part-${foundry.utils.randomID(8)}`;
}

/**
 * 部位スロット行配列へキーを付与する(無キー行のみ)。既定ラベルは対応表・カスタムは生成キー。
 * エイリアス行の targetKey も targetPart ラベルから解決する。
 * @param {Array<object>} rows
 * @returns {Array<object>|null} 変更があれば新配列、無ければ null
 */
export function assignPartSlotKeys(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let changed = false;
  const out = rows.map((r) => ({ ...r }));
  const seen = new Set(out.map((r) => r?.key).filter(Boolean));
  for (const r of out) {
    if (!r.key) {
      let k = DEFAULT_PART_LABEL_TO_KEY[String(r.value ?? "").trim()] ?? generatePartKey();
      while (seen.has(k)) k = generatePartKey(); // 同ラベルの重複行は生成キーで一意化
      r.key = k;
      seen.add(k);
      changed = true;
    }
  }
  for (const r of out) {
    if (r.occupiesOther && !r.targetKey && r.targetPart) {
      const label = String(r.targetPart).trim();
      const t = out.find((x) => x !== r && String(x.value ?? "").trim() === label)?.key
        ?? DEFAULT_PART_LABEL_TO_KEY[label] ?? "";
      if (t) { r.targetKey = t; changed = true; }
    }
  }
  return changed ? out : null;
}

/**
 * 部位スロット行配列を**既定キー体系へ揃える**(移行用・フェーズ12)。
 * `assignPartSlotKeys`(空キーだけ埋める)と異なり、**既定ラベルに一致する行はキーを既定
 * (英語)キーへ上書き**する——旧ローマ字キーで焼き込まれた既存ワールドを英語キーへ自己修復する。
 * カスタムラベル(既定に無い)の行はキーを尊重(無ければ生成)。
 * @param {Array<object>} rows
 * @returns {Array<object>|null} 変更があれば新配列、無ければ null
 */
export function reconcilePartSlotKeys(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let changed = false;
  const out = rows.map((r) => ({ ...r }));
  const seen = new Set();
  for (const r of out) {
    const def = DEFAULT_PART_LABEL_TO_KEY[String(r.value ?? "").trim()];
    let k = def ?? (r.key || generatePartKey()); // 既定ラベル=英語キーへ上書き / カスタムは尊重
    while (seen.has(k)) k = generatePartKey();    // 万一の重複は生成キーで一意化
    if (k !== r.key) { r.key = k; changed = true; }
    seen.add(k);
  }
  for (const r of out) {
    if (!r.occupiesOther) continue;
    const label = String(r.targetPart ?? "").trim();
    const t = DEFAULT_PART_LABEL_TO_KEY[label]
      ?? out.find((x) => x !== r && String(x.value ?? "").trim() === label)?.key ?? "";
    if (t && t !== r.targetKey) { r.targetKey = t; changed = true; }
  }
  return changed ? out : null;
}

/**
 * 既存データへの部位キー移行(ready・GM・スキーマ版でゲート。フェーズ12)。
 * プリセット設定と全アクターの partSlots を既定キー体系へ揃える(reconcilePartSlotKeys)。
 * **版番号ゲート**のため、キー命名を変えて `PART_KEY_SCHEME` を上げれば既存ワールドにも波及する
 * (旧ローマ字→英語の差し替えもこれで自己修復。旧 boolean フラグ方式では再移行できなかった)。
 * migrateData(in-memory)ではカスタムラベルの生成キーがロードごとに変わり参照が不安定になるため、
 * 一回きりの書き込みで確定させる。アイテムの part 行(部位参照)は書き換えない=照合のラベル後方互換で吸収する。
 */
export async function migratePartSlotKeys() {
  if (!game.user.isGM) return;
  if ((Number(game.settings.get(SYSTEM_ID, SETTING_KEY_SCHEME)) || 0) >= PART_KEY_SCHEME) return;
  const preset = reconcilePartSlotKeys(getPartSlotPreset());
  if (preset) await game.settings.set(SYSTEM_ID, SETTING, preset);
  for (const actor of game.actors) {
    const rows = actor.system?.partSlots;
    if (!Array.isArray(rows) || !rows.length) continue;
    const updated = reconcilePartSlotKeys(rows.map((r) => foundry.utils.deepClone(r)));
    if (updated) await actor.update({ "system.partSlots": updated });
  }
  await game.settings.set(SYSTEM_ID, SETTING_KEY_SCHEME, PART_KEY_SCHEME);
}

/** 部位スロットプリセットをワールド設定から読む(配列)。流し込み・占有計算が使う。 */
export function getPartSlotPreset() {
  const stored = game.settings.get(SYSTEM_ID, SETTING);
  return Array.isArray(stored) ? stored : [];
}

/** ワールド設定 "partSlotPreset" と設定メニューを登録する(init 内で呼ぶ)。 */
export function registerPartSlotPresetSetting() {
  game.settings.register(SYSTEM_ID, SETTING, {
    scope: "world", config: false, type: Array, default: [],
  });
  // 初回初期化済みフラグ(ワールド初回ロードでデフォルトを流し込んだら true。以降は再設定しない)
  game.settings.register(SYSTEM_ID, SETTING_INIT, {
    scope: "world", config: false, type: Boolean, default: false,
  });
  // 部位キーのスキーマ版(フェーズ12。migratePartSlotKeys のゲート。旧 boolean フラグ
  // partSlotKeysMigrated は廃止＝未登録の残存値は無害に無視される)
  game.settings.register(SYSTEM_ID, SETTING_KEY_SCHEME, {
    scope: "world", config: false, type: Number, default: 0,
  });
  game.settings.registerMenu(SYSTEM_ID, "partSlotPresetMenu", {
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
  if (game.settings.get(SYSTEM_ID, SETTING_INIT)) return;
  // 既にプリセットが入っている(手入力済み)なら上書きしない。空のときだけデフォルトを流し込む。
  if (!getPartSlotPreset().length) {
    await game.settings.set(SYSTEM_ID, SETTING, foundry.utils.deepClone(DEFAULT_PART_SLOT_PRESET));
  }
  await game.settings.set(SYSTEM_ID, SETTING_INIT, true);
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** 部位スロットプリセット 編集アプリ。行リスト・追加/削除・エイリアス・一括保存。 */
export class PartSlotPresetApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tnx-part-slot-preset",
    tag: "form",
    classes: ["application", "tokyo-nova", "standard-form", "tnx-part-slot-preset"],
    // フェーズ12: 部位キー列の追加に合わせて拡幅(現行幅に詰め込まず、キー列ぶんを広げる)
    position: { width: 780, height: 620 },
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
    main: { template: "systems/tokyo-nova-axleration/templates/app/part-slot-preset.hbs" },
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

  /** @override — エイリアスチェック切替で対象欄の表示を更新する＋行のドラッグ並び替え。 */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const cb of this.element.querySelectorAll('[data-field="occupiesOther"]')) {
      cb.addEventListener("change", () => { this._harvest(); this.render(); });
    }
    this._setupRowDrag();
    // 複数占有の「占有する部位」入力(list="tnx-psp-parts")を独自コンボボックスへ昇格。
    enhanceComboboxes(this.element);
  }

  /**
   * 行の手動並び替え(グリップのドラッグ＆ドロップ)。専用グリップのみ draggable にして
   * テキスト入力の選択を奪わない。ドロップ時に未保存の編集値を _harvest で保ってから並べ替える。
   */
  _setupRowDrag() {
    for (const row of this.element.querySelectorAll(".tnx-psp-row")) {
      const grip = row.querySelector(".tnx-psp-grip");
      grip?.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.dataset.index ?? "");
        row.classList.add("dragging");
      });
      grip?.addEventListener("dragend", () => row.classList.remove("dragging"));
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData("text/plain"));
        const to = Number(row.dataset.index);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
        this._harvest(); // 未保存の編集値を作業配列へ取り込んでから並べ替える
        const [moved] = this._rows.splice(from, 1);
        this._rows.splice(to, 0, moved);
        this.render();
      });
    }
  }

  /** DOM の現在値を作業配列へ取り込む(再描画前に呼ぶ)。 */
  _harvest() {
    if (!this.element) return;
    const rows = [];
    for (const row of this.element.querySelectorAll("[data-row]")) {
      rows.push({
        key:           (row.querySelector('[data-field="key"]')?.value ?? "").trim(),
        value:         row.querySelector('[data-field="value"]')?.value ?? "",
        count:         Math.max(0, Number(row.querySelector('[data-field="count"]')?.value) || 0),
        occupiesOther: row.querySelector('[data-field="occupiesOther"]')?.checked ?? false,
        targetPart:    row.querySelector('[data-field="targetPart"]')?.value ?? "",
        targetKey:     row.querySelector('[data-field="targetKey"]')?.value ?? "",
        targetCount:   Math.max(0, Number(row.querySelector('[data-field="targetCount"]')?.value) || 0),
      });
    }
    this._rows = rows;
  }

  static #onAddRow() {
    this._harvest();
    this._rows.push({ key: "", value: "", count: 1, occupiesOther: false, targetPart: "", targetKey: "", targetCount: 1 });
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

  /**
   * 行を整形して保存(空 value 行は捨てる。非エイリアス行は target* を捨てる)。
   * 部位キー: 空キーは自動付与(既定ラベル=対応表・カスタム=生成)。重複キーは後行を自動で振り直して警告。
   * キーに "." は使えない(AE キー文法のセグメント区切り)ため除去する。
   */
  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const arr = Array.isArray(data.rows) ? data.rows : Object.values(data.rows ?? {});
    let cleaned = arr
      .map((r) => {
        const occupiesOther = r?.occupiesOther === true || r?.occupiesOther === "true";
        return {
          key:           String(r?.key ?? "").trim().replaceAll(".", ""),
          value:         String(r?.value ?? "").trim(),
          count:         Math.max(0, Number(r?.count) || 0),
          occupiesOther,
          targetPart:    occupiesOther ? String(r?.targetPart ?? "").trim() : "",
          targetKey:     occupiesOther ? String(r?.targetKey ?? "").trim() : "",
          targetCount:   occupiesOther ? Math.max(0, Number(r?.targetCount) || 0) : 1,
        };
      })
      .filter((r) => r.value);
    // 重複キーは後行を空へ戻して自動付与に回す(参照はキーで持つため一意が前提)
    const seen = new Set();
    let hadDup = false;
    for (const r of cleaned) {
      if (!r.key) continue;
      if (seen.has(r.key)) { r.key = ""; hadDup = true; }
      else seen.add(r.key);
    }
    if (hadDup) ui.notifications.warn("部位キーが重複していたため、後の行に別のキーを自動付与しました。");
    cleaned = assignPartSlotKeys(cleaned) ?? cleaned;
    // エイリアスの占有先キーをラベルから解決し直す(ラベル編集への追従)
    for (const r of cleaned) {
      if (!r.occupiesOther || !r.targetPart) continue;
      const t = cleaned.find((x) => x !== r && x.value === r.targetPart);
      if (t) r.targetKey = t.key;
    }
    if (this._actor) await this._actor.update({ "system.partSlots": cleaned });
    else await game.settings.set(SYSTEM_ID, SETTING, cleaned);
  }
}
