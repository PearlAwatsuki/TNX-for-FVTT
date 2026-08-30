/**
 * @fileoverview 辞典ブラウザ(フェーズ16-2)。
 *
 * D&D の Compendium Browser 相当の**独立した汎用アプリケーション**(購入・改造の付属物では
 * ない=2026-08-30 ユーザー明示)。起動は辞典(コンペンディウム)サイドバータブ上部のボタン。
 * タブは 2026-08-31 ユーザー明示の8種(BROWSER_TABS)・各タブ内でグループ化チェックボックス＋
 * 検索の絞り込み(D&D 踏襲)。
 *
 * 表示形式(2026-08-30 裁定・正本は Phase_16_Tasks_Detail):
 * - スタイル技能: スタイル別見出し＋データカードのグリッド(ルルブ形式踏襲)
 * - アウトフィット: 大分類/小分類見出し＋略号パラメータ行カードのグリッド(同)
 * - 一般技能/オーガニゼーション: リスト行＋ホバーで共用カードのツールチップ
 * - スタイル: スタイルデータ形式の骨格 / 神業: 専用カード
 * - ライフパス: 種別ごとの表形式 / NPC: リスト
 *
 * データはすべて getIndex 由来(KI-026)・カードは dictionary-cards.mjs の共用ビルダー。
 */

import { BROWSER_TABS, loadTabEntries, buildFilterGroups, filterEntries, groupOutfitEntries, groupStyleSkillEntries, groupLifePathEntries, NPC_TYPE_LABELS } from "./dictionary-browser-data.mjs";
import { buildDictionaryCard, DICTIONARY_CARD_TEMPLATE } from "./dictionary-cards.mjs";
import { loadSkillChoices, SKILL_PACKS, STYLE_PACK } from "./skill-dictionary.mjs";
import { loadOutfitDictNames } from "./outfit-dictionary.mjs";
import { getPartSlotPreset } from "./part-slot-preset-app.mjs";
import { resolveItemNameByKey } from "./identification.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

export class TnxDictionaryBrowser extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "tnx-dictionary-browser",
        classes: ["tokyo-nova", "tnx-dictionary-browser"],
        window: { title: "辞典ブラウザ", resizable: true },
        position: { width: 980, height: 700 },
        actions: {
            dictTab:  TnxDictionaryBrowser._onTab,
            dictOpen: TnxDictionaryBrowser._onOpen,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/dictionary-browser.hbs", scrollable: [".tnx-dict__results", ".tnx-dict__sidebar"] },
    };

    /** 現在のタブキー */
    _activeTab = BROWSER_TABS[0].key;
    /** タブごとの絞り込み状態: {search, checks: {group: string[]}, buyMin, buyMax} */
    _filterState = {};
    /** タブごとのエントリキャッシュ(開いている間のみ。再表示で取り直す) */
    _entryCache = {};
    /** 名前解決マップのキャッシュ */
    _maps = null;

    /** シングルトンで開く。 */
    static open() {
        const existing = foundry.applications.instances.get("tnx-dictionary-browser");
        if (existing) return existing.render({ force: true });
        return new TnxDictionaryBrowser().render({ force: true });
    }

    /** タブの絞り込み状態(未初期化なら生成)。 */
    _stateFor(tabKey) {
        if (!this._filterState[tabKey]) {
            this._filterState[tabKey] = { search: "", checks: {}, buyMin: null, buyMax: null };
        }
        return this._filterState[tabKey];
    }

    /** 名前解決マップ(技能名・スタイル名・アウトフィット辞典名)をまとめて読む。 */
    async _loadMaps() {
        if (this._maps) return this._maps;
        const [skillNames, styleNames, outfitNames] = await Promise.all([
            loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]),
            loadSkillChoices([STYLE_PACK]),
            loadOutfitDictNames(),
        ]);
        this._maps = { skillNames, styleNames, outfitNames };
        return this._maps;
    }

    async _entriesFor(tab) {
        if (!this._entryCache[tab.key]) this._entryCache[tab.key] = await loadTabEntries(tab);
        return this._entryCache[tab.key];
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const tab = BROWSER_TABS.find((t) => t.key === this._activeTab) ?? BROWSER_TABS[0];
        const state = this._stateFor(tab.key);
        const maps = await this._loadMaps();
        const entries = await this._entriesFor(tab);
        const filtered = filterEntries(tab.key, entries, state);

        context.tabs = BROWSER_TABS.map((t) => ({ ...t, active: t.key === tab.key }));
        context.kind = tab.key;
        context.isOutfit = tab.key === "outfit";
        context.state = { search: state.search, buyMin: state.buyMin ?? "", buyMax: state.buyMax ?? "" };
        context.filterGroups = buildFilterGroups(tab.key, { styleNames: maps.styleNames }).map((g) => ({
            ...g,
            options: g.options.map((o) => ({ ...o, checked: (state.checks[g.key] ?? []).includes(o.value) })),
        }));
        context.resultCount = filtered.length;

        const cardOpts = {
            skillNames: maps.skillNames,
            styleNames: maps.styleNames,
            resolveHostName: (key) => resolveItemNameByKey(null, key, maps.outfitNames),
            partSlotsCtx: getPartSlotPreset(),
        };
        const card = (entry) => buildDictionaryCard(entry, cardOpts);

        switch (tab.key) {
            case "styleSkill": {
                const groups = groupStyleSkillEntries(filtered, maps.styleNames);
                context.cardGroups = await Promise.all(groups.map(async (g) => ({
                    label: g.styleLabel,
                    cards: await Promise.all(g.entries.map(async (e) => ({ uuid: e.uuid, docName: e.docName, card: await card(e) }))),
                })));
                break;
            }
            case "outfit": {
                const majors = groupOutfitEntries(filtered);
                context.outfitGroups = await Promise.all(majors.map(async (major) => ({
                    label: major.majorLabel,
                    minors: await Promise.all(major.minors.map(async (minor) => ({
                        label: minor.minorLabel,
                        cards: await Promise.all(minor.entries.map(async (e) => ({ uuid: e.uuid, docName: e.docName, card: await card(e) }))),
                    }))),
                })));
                break;
            }
            case "style":
            case "miracle": {
                context.cardGroups = [{
                    label: "",
                    cards: await Promise.all(filtered.map(async (e) => ({ uuid: e.uuid, docName: e.docName, card: await card(e) }))),
                }];
                break;
            }
            case "generalSkill":
            case "organization": {
                context.listRows = await Promise.all(filtered.map(async (e) => {
                    const c = await card(e);
                    return {
                        uuid: e.uuid, docName: e.docName, img: e.img,
                        name: c?.name ?? e.name,
                        meta: (c?.tags ?? []).join("・"),
                        sourceLabel: e.sourceLabel,
                        tooltipHtml: c ? await renderTemplate(DICTIONARY_CARD_TEMPLATE, { card: c }) : "",
                    };
                }));
                break;
            }
            case "lifePath": {
                context.lifePathGroups = groupLifePathEntries(filtered).map((g) => ({
                    label: g.typeLabel,
                    rows: g.entries.map((e) => ({
                        uuid: e.uuid, docName: e.docName, img: e.img, name: e.name,
                        skillName: e.system?.skillName ?? "",
                        description: e.system?.description ?? "",
                    })),
                }));
                break;
            }
            case "npc": {
                context.listRows = filtered.map((e) => ({
                    uuid: e.uuid, docName: e.docName, img: e.img, name: e.name,
                    meta: NPC_TYPE_LABELS[e.type] ?? e.type,
                    sourceLabel: e.sourceLabel,
                    tooltipHtml: "",
                }));
                break;
            }
        }
        return context;
    }

    /** @override */
    _onRender(_context, _options) {
        // 検索(入力のたび・デバウンス)
        const search = this.element.querySelector("[data-dict-search]");
        search?.addEventListener("input", (event) => {
            const value = event.currentTarget.value;
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(() => {
                this._stateFor(this._activeTab).search = value;
                this.render();
            }, 250);
        });

        // 絞り込みチェックボックス
        for (const box of this.element.querySelectorAll("[data-dict-filter]")) {
            box.addEventListener("change", (event) => {
                const group = event.currentTarget.dataset.dictFilter;
                const value = event.currentTarget.value;
                const state = this._stateFor(this._activeTab);
                const set = new Set(state.checks[group] ?? []);
                if (event.currentTarget.checked) set.add(value); else set.delete(value);
                state.checks[group] = [...set];
                this.render();
            });
        }

        // 購入値レンジ(アウトフィット)
        for (const input of this.element.querySelectorAll("[data-dict-buy]")) {
            input.addEventListener("change", (event) => {
                const which = event.currentTarget.dataset.dictBuy;
                const raw = event.currentTarget.value.trim();
                const state = this._stateFor(this._activeTab);
                state[which === "min" ? "buyMin" : "buyMax"] = raw === "" ? null : (Number(raw) || 0);
                this.render();
            });
        }

        // ドラッグ取得(カード/行のグリップ=要素全体。ドロップは Foundry 標準経路)
        for (const el of this.element.querySelectorAll("[data-dict-drag]")) {
            el.addEventListener("dragstart", (event) => {
                const { uuid, docName } = event.currentTarget.dataset;
                event.dataTransfer.setData("text/plain", JSON.stringify({ type: docName, uuid }));
            });
        }

        // カードはヘッダクリックで参照シートを開く(本文の文字選択で開かないように限定)
        for (const header of this.element.querySelectorAll(".tnx-dict__card-slot .tnx-dict-card__header")) {
            header.addEventListener("click", async (event) => {
                const uuid = event.currentTarget.closest("[data-uuid]")?.dataset.uuid;
                if (!uuid) return;
                const doc = await fromUuid(uuid).catch(() => null);
                doc?.sheet?.render(true);
            });
        }
    }

    /** タブ切替 */
    static _onTab(_event, target) {
        this._activeTab = target.dataset.tab;
        this.render();
    }

    /** 参照表示(シートを開く)。ブラウザは開いたまま。 */
    static async _onOpen(_event, target) {
        const uuid = target.closest("[data-uuid]")?.dataset.uuid;
        if (!uuid) return;
        const doc = await fromUuid(uuid).catch(() => null);
        doc?.sheet?.render(true);
    }
}

/**
 * 辞典サイドバータブの上部に「辞典ブラウザ」ボタンを差し込む(D&D と同配置・2026-08-30 ユーザー
 * 明示=当初からの指示)。renderCompendiumDirectory ごとに1つだけ挿す。
 * @param {HTMLElement} html サイドバータブのルート要素
 */
export function injectDictionaryBrowserButton(html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".tnx-dict-launcher")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tnx-dict-launcher";
    button.innerHTML = '<i class="fa-solid fa-book-open"></i> 辞典ブラウザ';
    button.addEventListener("click", () => TnxDictionaryBrowser.open());
    const header = root.querySelector(".directory-header");
    if (header) header.insertAdjacentElement("afterend", button);
    else root.prepend(button);
}
