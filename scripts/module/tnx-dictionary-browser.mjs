/**
 * @fileoverview 辞典ブラウザ(フェーズ16-2)。
 *
 * D&D の Compendium Browser 相当の**独立した汎用アプリケーション**(購入・改造の付属物では
 * ない=2026-08-30 ユーザー明示)。起動は辞典(コンペンディウム)サイドバータブ上部のボタン。
 * タブは 2026-08-31 ユーザー明示の8種(BROWSER_TABS)・各タブ内でグループ化チェックボックス＋
 * 検索の絞り込み(D&D 踏襲)。
 *
 * 表示形式(2026-08-30 裁定＋2026-08-31 是正・正本は Phase_16_Tasks_Detail):
 * - スタイル技能: スタイル別(ワークス技能は組織別)見出し＋データカードの固定幅グリッド
 * - アウトフィット: 大分類/小分類見出し＋略号行カードの固定幅グリッド(ヴィークル/全身義体/
 *   式神装備は高さ 4/3)
 * - 一般技能: 横幅広めのカードを縦積みで直接表示(リスト+ツールチップではない)・正規ソート順
 * - スタイル/神業/オーガニゼーション: 均一高さのカードグリッド・登録順(style/miracle)
 * - ライフパス: 種別ごとの表形式 / NPC: リスト(キャストは載せない)
 * - カードは大きさ固定・入りきらない解説は文字サイズを縮小して収める(ルルブ同様)
 *
 * データはすべて getIndex 由来(KI-026)・カードは dictionary-cards.mjs の共用ビルダー。
 */

import { BROWSER_TABS, loadTabEntries, buildFilterGroups, filterEntries, groupOutfitEntries, groupStyleSkillEntries, groupLifePathEntries, loadOrderedNames, NPC_TYPE_LABELS } from "./dictionary-browser-data.mjs";
import { buildDictionaryCard } from "./dictionary-cards.mjs";
import { loadSkillChoices, SKILL_PACKS, STYLE_PACK, ORGANIZATION_PACK } from "./skill-dictionary.mjs";
import { loadOutfitDictNames } from "./outfit-dictionary.mjs";
import { getPartSlotPreset } from "./part-slot-preset-app.mjs";
import { resolveItemNameByKey } from "./identification.mjs";
import { readFlag } from "../data/item/helpers.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

    /** 名前解決マップ(技能名・スタイル名・組織名・アウトフィット辞典名)をまとめて読む。
     *  スタイル・組織は**登録順**(グループ見出しと絞り込み選択肢の並びに使うため)。 */
    async _loadMaps() {
        if (this._maps) return this._maps;
        const [skillNames, styleNames, orgNames, outfitNames] = await Promise.all([
            loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]),
            loadOrderedNames(STYLE_PACK),
            loadOrderedNames(ORGANIZATION_PACK),
            loadOutfitDictNames(),
        ]);
        this._maps = { skillNames, styleNames, orgNames, outfitNames };
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
        context.filterGroups = buildFilterGroups(tab.key, { styleNames: maps.styleNames, orgNames: maps.orgNames }).map((g) => ({
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
                const groups = groupStyleSkillEntries(filtered, maps.styleNames, maps.orgNames);
                context.cardGroups = await Promise.all(groups.map(async (g) => ({
                    label: g.styleLabel,
                    cards: await Promise.all(g.entries.map(async (e) => ({ uuid: e.uuid, docName: e.docName, card: await card(e) }))),
                })));
                break;
            }
            case "outfit": {
                // ヴィークル・全身義体・式神装備はパラメータが多く解説も長いため、カード高さを
                // 他の 4/3 とする(2026-08-31 ユーザー指定・tall フラグ)
                const isTall = (e) => e.type === "vehicle" || e.type === "cyborg" || readFlag(e.system ?? {}, "isShiki");
                const majors = groupOutfitEntries(filtered);
                context.outfitGroups = await Promise.all(majors.map(async (major) => ({
                    label: major.majorLabel,
                    minors: await Promise.all(major.minors.map(async (minor) => ({
                        label: minor.minorLabel,
                        cards: await Promise.all(minor.entries.map(async (e) => ({
                            uuid: e.uuid, docName: e.docName, tall: isTall(e), card: await card(e),
                        }))),
                    }))),
                })));
                break;
            }
            case "style":
            case "miracle":
            case "organization": {
                // オーガニゼーションもスタイルと同様のカード形式(2026-08-31 ユーザー指摘)
                context.cardGroups = [{
                    label: "",
                    cards: await Promise.all(filtered.map(async (e) => ({ uuid: e.uuid, docName: e.docName, card: await card(e) }))),
                }];
                break;
            }
            case "generalSkill": {
                // 一般技能は「リスト形式に寄せた横幅広めのカード」を縦積みで**直接**並べる
                // (2026-08-31 ユーザー指摘=リスト+ツールチップではなくカード表示。
                //  シート側ツールチップはこのカードと同一部品=「ブラウザの表示を踏襲したツールチップ」)
                context.cardStack = await Promise.all(filtered.map(async (e) => ({
                    uuid: e.uuid, docName: e.docName, card: await card(e),
                })));
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

        // 固定高さカード: 入りきらない解説は文字サイズを縮小して収める(ルルブ同様・
        // 2026-08-31 ユーザー指定)。レイアウト確定後に実測するため rAF 越しに実行
        requestAnimationFrame(() => fitDictionaryCards(this.element));

        // リサイズ追従(2026-08-31 ユーザー指定): 可変幅カード(スタイル/神業/組織=2列・
        // 一般技能=縦積み)は幅が変わると収まりが変わるため、ウィンドウリサイズで再フィットする
        this._resizeObserver?.disconnect();
        this._resizeObserver = new ResizeObserver(() => {
            clearTimeout(this._refitTimer);
            this._refitTimer = setTimeout(() => fitDictionaryCards(this.element), 120);
        });
        this._resizeObserver.observe(this.element);
    }

    /** @override */
    _onClose(options) {
        super._onClose(options);
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
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
 * 固定高さのカード内で解説が入りきらない場合、解説の文字サイズを段階的に縮小して収める
 * (ルルブのカードと同じ流儀=カードの大きさは固定・文字で吸収。2026-08-31 ユーザー指定)。
 * 対象は固定高さスロット(.tnx-dict__card-slot)内のカードのみ(ツールチップ等の自動高さは対象外)。
 * @param {HTMLElement} root ブラウザのルート要素
 */
export function fitDictionaryCards(root) {
    if (!root) return;
    for (const card of root.querySelectorAll(".tnx-dict__card-slot .tnx-dict-card")) {
        // 縮小対象は本文系(解説＋条件)。パラメータ行・ヘッダは縮めない(ルルブ同様)
        const targets = [...card.querySelectorAll(".tnx-dict-card__desc, .tnx-dict-card__condition")];
        if (!targets.length) continue;
        // いったん既定サイズへ戻してから縮小判定(再レンダー・再フィットに冪等)
        for (const t of targets) t.style.fontSize = "";
        const desc = card.querySelector(".tnx-dict-card__desc");
        // あふれは2経路: ①解説枠の内側(flex 割当より内容が大きい=desc.scrollHeight)
        // ②条件等がカード下端を突き抜ける(card.scrollHeight)。両方を見る
        const overflows = () =>
            (desc && desc.scrollHeight > desc.clientHeight + 1)
            || card.scrollHeight > card.clientHeight + 1;
        let size = Number.parseFloat(getComputedStyle(targets[0]).fontSize) || 12;
        const MIN = 7.5;
        while (overflows() && size > MIN) {
            size -= 0.5;
            for (const t of targets) t.style.fontSize = `${size}px`;
        }
    }
}

/**
 * 辞典タブの「ヘッダーのボタンエリア」(コンペンディウム作成等が並ぶ action-buttons 行)に
 * 「辞典ブラウザ」ボタンを追加する(2026-08-31 ユーザー指示。前例=資料タブの
 * renderJournalDirectory で「アクトシートを作成」等を同じ行へ追加している実装・見た目も
 * 標準ボタンに合わせる)。renderCompendiumDirectory ごとに1つだけ挿す。
 * @param {HTMLElement} html サイドバータブのルート要素
 */
export function injectDictionaryBrowserButton(html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".tnx-dict-launcher")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tnx-dict-launcher";
    button.innerHTML = '<i class="fa-solid fa-book-open"></i><span>辞典ブラウザ</span>';
    button.addEventListener("click", () => TnxDictionaryBrowser.open());
    // ヘッダーのボタンエリアへ(資料タブと同じ折返し方式で幅が自動で揃う)
    const actionsRow = root.querySelector(".directory-header .action-buttons")
        ?? root.querySelector(".action-buttons");
    if (actionsRow) {
        actionsRow.style.flexWrap = "wrap";
        actionsRow.appendChild(button);
    } else {
        root.querySelector(".directory-header")?.appendChild(button);
    }
}
