/**
 * @fileoverview ダメージチャート効果文の設定アプリ(フェーズ9-4)。
 *
 * §4.1 境界: 負傷名・段→効果の対応・付与条件はコード同梱。**効果文(プロセ)のみユーザー入力**で、
 * 本アプリ(ワールド設定)に保存する。カード設定と同形=系統ごとにタブ、各 1〜21 のテキストエリア。
 * 設定キー: world 設定 "damageChartText" = { physical:{1..21}, mental:{...}, social:{...} }。
 */

import { CONDITION_KINDS } from "./conditions.mjs";

const SCOPE = "tokyo-nova-axleration";
const SETTING = "damageChartText";

const CATEGORIES = [
  { key: "physical", label: "肉体", prefix: "phys" },
  { key: "mental",   label: "精神", prefix: "ment" },
  { key: "social",   label: "社会", prefix: "soc"  },
];

/** ダメージチャート効果文をワールド設定から読む(系統・段)。表示・ダメージ適用側が使う。 */
export function getDamageChartText(category, tier) {
  const stored = game.settings.get(SCOPE, SETTING) ?? {};
  return stored?.[category]?.[tier] ?? "";
}

/** ワールド設定 "damageChartText" と設定メニューを登録する(init 内で呼ぶ)。 */
export function registerDamageChartTextSetting() {
  game.settings.register(SCOPE, SETTING, {
    scope: "world", config: false, type: Object, default: {},
  });
  game.settings.registerMenu(SCOPE, "damageChartTextMenu", {
    name: "ダメージチャート効果文",
    label: "効果文を編集",
    hint: "ダメージチャート各段の効果文（プロセ）を入力します。負傷名・効果は同梱、効果文のみ入力。",
    icon: "fas fa-file-lines",
    type: DamageChartTextApp,
    restricted: true,
  });
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** ダメージチャート効果文 編集アプリ。3系統タブ・各 1〜21 のテキストエリア。 */
export class DamageChartTextApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tnx-damage-chart-text",
    classes: ["tokyo-nova", "tnx-dialog", "tnx-damage-chart-text"],
    tag: "form",
    window: { title: "ダメージチャート効果文", resizable: true },
    position: { width: 640, height: 720 },
    form: { handler: DamageChartTextApp.#onSubmit, closeOnSubmit: true },
    actions: { switchTab: DamageChartTextApp.#onSwitchTab },
  };

  static PARTS = {
    body: { template: "systems/tokyo-nova-axleration/templates/apps/damage-chart-text.hbs" },
  };

  /** @override */
  async _prepareContext() {
    const stored = game.settings.get(SCOPE, SETTING) ?? {};
    const categories = CATEGORIES.map((c, i) => ({
      key: c.key,
      label: c.label,
      active: i === 0,
      rows: Array.from({ length: 21 }, (_, n) => {
        const tier = n + 1;
        return {
          tier,
          name: CONDITION_KINDS[`${c.prefix}-${tier}`]?.label ?? "",
          text: stored?.[c.key]?.[tier] ?? "",
        };
      }),
    }));
    return { categories };
  }

  /** タブ切替(再描画せず hidden を切り替え＝編集中の他タブの未保存値を保持)。 */
  static #onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    for (const el of this.element.querySelectorAll("[data-tab-content]")) {
      el.hidden = el.dataset.tabContent !== tab;
    }
    for (const el of this.element.querySelectorAll(".tnx-dct-tab")) {
      el.classList.toggle("active", el.dataset.tab === tab);
    }
  }

  /** 全タブ分のテキストエリアを一括保存(field 名 = "<category>.<tier>")。 */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    await game.settings.set(SCOPE, SETTING, data);
  }
}
