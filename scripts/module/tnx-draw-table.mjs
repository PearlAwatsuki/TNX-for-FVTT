/**
 * @fileoverview ドロー表 - コア RollTable のカードドロー拡張
 *
 * コアの RollTable / TableResult / RollTableSheet は一切置き換えない。
 * renderRollTableSheet フックで DOM に最小限の UI を注入し、
 * ドロー手段だけをダイスからカードに差し替える。
 *
 * - トランプモード（デフォルト、DECK_FLAG=""）:
 *   フッターのドローボタンで 54 枚分布の仮想ドロー。
 *   range は 1〜54 の連続空間（ジョーカー 2 枠・その他各 4 枠）。
 *   getResultsForRoll が正しい weight を認識できるため、
 *   編集モードの割合欄に ジョーカー×2・その他×4 が表示される。
 *   ドロー時はランダムスート（♠♥♦♣ 各 1/4）も表示する。
 * - ニューロデッキモード（DECK_FLAG="neuro"）:
 *   システム設定の neuroDeckId を自動参照し、
 *   HUD のニューロカードドローを発火点として結果を照合する。
 *
 * flag 構造:
 *   RollTable.flags.tokyo-nova-axleration.drawTableDeckId
 *     ""      = トランプ
 *     "neuro" = ニューロデッキ
 *   TableResult.flags.tokyo-nova-axleration.cardName  照合キー（ニューロモード用）
 */

const SCOPE = "tokyo-nova-axleration";
const DECK_FLAG = "drawTableDeckId";
const CARD_FLAG = "cardName";
const NEURO_SENTINEL = "neuro";

/**
 * トランプ 54 枚のカード定義（生成順）。
 * range は 1〜54 の連続空間 — ジョーカー 2 枠、その他各 4 枠。
 * getResultsForRoll(roll) で結果が正確に引けるよう連続かつ重複なし。
 */
const TRUMP_CARDS = [
    { label: "joker", value: 99, range: [1,  2]  },
    { label: "2",     value: 2,  range: [3,  6]  },
    { label: "3",     value: 3,  range: [7,  10] },
    { label: "4",     value: 4,  range: [11, 14] },
    { label: "5",     value: 5,  range: [15, 18] },
    { label: "6",     value: 6,  range: [19, 22] },
    { label: "7",     value: 7,  range: [23, 26] },
    { label: "8",     value: 8,  range: [27, 30] },
    { label: "9",     value: 9,  range: [31, 34] },
    { label: "10",    value: 10, range: [35, 38] },
    { label: "J",     value: 11, range: [39, 42] },
    { label: "Q",     value: 12, range: [43, 46] },
    { label: "K",     value: 13, range: [47, 50] },
    { label: "A",     value: 1,  range: [51, 54] },
];

const TRUMP_SUITS = ["♠", "♥", "♦", "♣"];

/** range[0] を含む TRUMP_CARDS エントリを逆引きする */
function findCardByRange(r0) {
    if (r0 === null || r0 === undefined) return null;
    return TRUMP_CARDS.find(tc => r0 >= tc.range[0] && r0 <= tc.range[1]) ?? null;
}

/** ロール値（1〜54）から TRUMP_CARDS エントリを引く */
function findCardByRoll(roll) {
    return TRUMP_CARDS.find(tc => roll >= tc.range[0] && roll <= tc.range[1]) ?? null;
}

/**
 * カード名から照合用ラベルを抽出する（切り札配布ダイアログと同じ規則）。
 * @param {Card} card
 * @returns {string}
 */
export function extractCardLabel(card) {
    const raw = card.faces?.[0]?.name ?? card.name ?? "";
    return raw.replace(/<[^>]+>/g, "").match(/：(.+?)\s*\//)?.[1] ?? raw;
}

/**
 * 仮想 54 枚デッキからドロー。
 * roll: 1〜54（getResultsForRoll に渡す）、suit: ジョーカー以外はランダムスート。
 */
export function drawVirtualTrump() {
    const roll = Math.floor(Math.random() * 54) + 1;
    const tc   = findCardByRoll(roll) ?? TRUMP_CARDS[0];
    const suit = tc.label === "joker" ? null : TRUMP_SUITS[Math.floor(Math.random() * 4)];
    return { roll, value: tc.value, label: tc.label, suit };
}

/** @deprecated drawVirtualTrump を使用すること */
export function drawVirtualDocValue() {
    return drawVirtualTrump().value;
}

/**
 * ドロー表専用チャットメッセージを投稿する。
 * コアの「ロール表」メッセージを抑制し代わりに投稿する。ダイス音なし。
 * @param {RollTable} table
 * @param {TableResult[]} results
 * @param {{ drawnCard?: {value:number, label:string, suit:string|null} }} [options]
 */
async function postDrawTableChat(table, results, { drawnCard = null } = {}) {
    const escapedName = foundry.utils.escapeHTML(table.name);

    let cardLine = "";
    if (drawnCard) {
        const display = drawnCard.suit ? `${drawnCard.suit}${drawnCard.label}` : drawnCard.label;
        cardLine = `<p class="tnx-draw-card">${display}</p>`;
    }

    const resultLines = results.map(r => {
        const img  = r.img  ? `<img class="tnx-draw-result-img" src="${r.img}" alt="">` : "";
        const text = r.text ? `<span>${r.text}</span>` : "";
        return `<li class="tnx-draw-result">${img}${text}</li>`;
    }).join("");

    const content = `<div class="tnx-draw-table-chat">
<p class="tnx-draw-header"><i class="fa-solid fa-cards"></i> ドロー表「${escapedName}」の結果</p>
${cardLine}<ul class="tnx-draw-results">${resultLines}</ul>
</div>`;

    await ChatMessage.create({ content });
    foundry.audio.AudioHelper.play({ src: "systems/tokyo-nova-axleration/assets/sounds/カードをめくる.mp3", volume: 1.0 });
}

/**
 * トランプ仮想ドローを実行しチャットに出力する。
 * @param {RollTable} table
 */
export async function drawVirtualDoc(table) {
    const drawn = drawVirtualTrump();
    const results = table.getResultsForRoll(drawn.roll);
    if (results.length === 0) {
        return ui.notifications.warn(`ドロー結果「${drawn.label}」に対応する結果がありません。`);
    }
    await postDrawTableChat(table, results, { drawnCard: drawn });
}

/**
 * HUD のカードドロー後、開いているドロー表シートから該当テーブルを探し、
 * カードラベルが一致する結果をチャットに出力する。
 * @param {Card}   card
 * @param {string} sourceDeckUuid
 */
export async function lookupDrawTables(card, sourceDeckUuid) {
    const label = extractCardLabel(card);
    const RollTableSheet = foundry.applications.sheets.RollTableSheet;
    for (const app of foundry.applications.instances.values()) {
        if (!(app instanceof RollTableSheet) || !app.rendered) continue;
        const table = app.document;
        const flagValue = table.getFlag(SCOPE, DECK_FLAG) ?? "";

        let isMatch = false;
        if (flagValue === NEURO_SENTINEL) {
            const neuroId  = game.settings.get(SCOPE, "neuroDeckId");
            const neuroDeck = neuroId ? foundry.utils.fromUuidSync(neuroId) : null;
            isMatch = !!neuroDeck && neuroDeck.uuid === sourceDeckUuid;
        } else {
            isMatch = flagValue === sourceDeckUuid;
        }
        if (!isMatch) continue;

        const result = table.results.find(r => r.getFlag(SCOPE, CARD_FLAG) === label);
        if (!result) continue;
        await postDrawTableChat(table, [result]);
    }
}

/** ドロー表関連のフックを登録する（init から呼ぶ） */
export function registerDrawTableHooks() {

    CONFIG.RollTable.resultIcon = "icons/svg/card-hand.svg";

    // table.draw() を全面的に差し替え: コンテキストメニュー・シートボタン等
    // あらゆる経路からの draw() 呼び出しをカードドローへリダイレクトする
    foundry.documents.RollTable.prototype.draw = async function(_options = {}) {
        const flagValue = this.getFlag(SCOPE, DECK_FLAG) ?? "";
        if (flagValue === NEURO_SENTINEL) {
            ui.notifications.info("ニューロデッキからのカードドローで結果が出力されます。");
            return;
        }
        return drawVirtualDoc(this);
    };

    // 日本語化モジュールが i18nInit を後勝ちで上書きする場合があるため、
    // i18nInit と ready の両方で適用し、ready でサイドバーも再描画する。
    const TABLE_TRANSLATIONS = {
        DOCUMENT: { RollTable: "ドロー表", RollTables: "ドロー表" },
        SIDEBAR: {
            ACTIONS: { CREATE: { RollTable: "ドロー表を作成" } },
            TABS: { tables: "ドロー表" },
        },
        FOLDER: { CreateTable: "ドロー表を作成" },
        TABLE: {
            ACTIONS: {
                Submit:        "ドロー表を更新",
                ResetResults:  "結果をリセット",
                DrawResult:    "ドロー",
                DrawResultHint: "ドロー結果をチャットに送信する",
            },
            FIELDS: { displayRoll: { label: "ドロー結果をチャットに表示" } },
        },
    };

    Hooks.once("i18nInit", () => {
        foundry.utils.mergeObject(game.i18n.translations, TABLE_TRANSLATIONS);
    });

    // ready で再適用してモジュールの後勝ちを打ち消し、サイドバーを再描画
    Hooks.once("ready", () => {
        foundry.utils.mergeObject(game.i18n.translations, TABLE_TRANSLATIONS);
        // サイドバータブのツールチップを DOM 直接書き換え（属性値が文字列で確定している場合）
        for (const el of document.querySelectorAll('[data-tab="tables"]')) {
            el.dataset.tooltip = "ドロー表";
            el.setAttribute("aria-label", "ドロー表");
        }
        if (ui.tables?.rendered) ui.tables.render();

        // プロトタイプパッチ: コンテキストメニューのアイコン・コールバックを書き換え
        // hook 名が Foundry バージョンで異なるため、インスタンスから辿って動的に特定する
        const RollTableDirProto = ui.tables?.constructor?.prototype;
        if (RollTableDirProto) {
            const methodName = ["_getEntryContextOptions", "_getContextMenuOptions", "getContextMenuOptions"]
                .find(n => typeof RollTableDirProto[n] === "function");
            if (methodName) {
                const origFn = RollTableDirProto[methodName];
                RollTableDirProto[methodName] = function(...args) {
                    const options = origFn.call(this, ...args);
                    for (const opt of options) {
                        const icon = typeof opt.icon === "string" ? opt.icon : "";
                        if (!icon.includes("dice")) continue;
                        // アイコンを差し替え（HTML 形式・クラス名形式の両方に対応）
                        opt.icon = icon.startsWith("<")
                            ? '<i class="fa-solid fa-cards"></i>'
                            : "fa-solid fa-cards";
                        // コールバックを差し替え: ダイスロールではなく仮想ドロー
                        const origCb = opt.callback;
                        opt.callback = (li) => {
                            const el = li instanceof HTMLElement ? li : li?.[0];
                            const tableId = el?.dataset?.documentId ?? li?.data?.("documentId");
                            const table = game.tables?.get(tableId);
                            if (table && (table.getFlag(SCOPE, DECK_FLAG) ?? "") === "") {
                                return drawVirtualDoc(table);
                            }
                            return origCb?.call(this, li);
                        };
                    }
                    return options;
                };
            }
        }

        // DOM フォールバック: MutationObserver でコンテキストメニュー追加を即時捕捉し
        // プロトタイプパッチが効かなかった場合でもアイコンを差し替える
        new MutationObserver((mutations) => {
            for (const { addedNodes } of mutations) {
                for (const node of addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    for (const icon of node.querySelectorAll("i[class*='fa-dice']")) {
                        icon.className = "fa-solid fa-cards";
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    });

    // コンテキストメニューのラベル・アイコンを書き換える（フックベース）
    // Foundry バージョンによって hook 名・icon フォーマットが異なるため複数登録
    const patchContextMenu = (_el, options) => {
        for (const opt of options) {
            const icon = typeof opt.icon === "string" ? opt.icon : "";
            if (!icon.includes("dice")) continue;
            // '<i class="...">' 形式か "fa-solid fa-*" クラス名形式かを自動判定
            opt.icon = icon.startsWith("<")
                ? '<i class="fa-solid fa-cards"></i>'
                : "fa-solid fa-cards";
        }
    };
    Hooks.on("getRollTableDirectoryEntryContext", patchContextMenu);
    Hooks.on("getRollTableEntryContext",          patchContextMenu);

    Hooks.on("preCreateRollTable", (table, data) => {
        const update = {};
        const defaultIcon = foundry.documents.BaseRollTable.DEFAULT_ICON;
        if (!data.img || data.img === defaultIcon) update.img = "icons/svg/card-hand.svg";
        const coreLabel = game.i18n.localize(foundry.documents.BaseRollTable.metadata.label);
        if (!data.name) {
            update.name = "ドロー表";
        } else if (data.name.startsWith(coreLabel)) {
            update.name = data.name.replace(coreLabel, "ドロー表");
        }
        if (!foundry.utils.isEmpty(update)) table.updateSource(update);
    });

    // 結果行の追加時（トランプモードのみ）:
    // joker → 2〜K → A の順で未使用カードの連続 range を自動割り当て。
    Hooks.on("preCreateTableResult", (result, _data) => {
        const table = result.parent;
        if (!table || table.pack) return;
        if (table.getFlag(SCOPE, DECK_FLAG)) return;

        const usedLabels = new Set(
            table.results.map(r => findCardByRange(r.range?.[0])?.label).filter(Boolean)
        );
        const next = TRUMP_CARDS.find(tc => !usedLabels.has(tc.label));
        if (!next) {
            ui.notifications.warn("ドロー表の値（joker・2〜10・J・Q・K・A）はすべて登録済みです。");
            return false;
        }
        result.updateSource({ range: [...next.range] });
    });

    Hooks.on("renderRollTableSheet", onRenderRollTableSheet);
}

/* -------------------------------------------------------------------------- */
/*  シート DOM 注入                                                            */
/* -------------------------------------------------------------------------- */

function onRenderRollTableSheet(app, element) {
    const table     = app.document;
    if (table.pack) return;

    const flagValue  = table.getFlag(SCOPE, DECK_FLAG) ?? "";
    const isTrump    = flagValue === "";
    const isNeuro    = flagValue === NEURO_SENTINEL;
    const isConfigured = !isTrump;

    let deckForSelector = null;
    if (isNeuro) {
        const neuroId = game.settings.get(SCOPE, "neuroDeckId");
        deckForSelector = neuroId ? foundry.utils.fromUuidSync(neuroId) : null;
    } else if (!isTrump) {
        deckForSelector = foundry.utils.fromUuidSync(flagValue);
    }

    if (app.isEditMode) {
        injectDeckSelector(element, table, flagValue);
        injectResultSelectors(element, table, deckForSelector, isConfigured, isTrump);
    } else {
        const formulaEl = element.querySelector("header.sheet-header h4");
        if (formulaEl) {
            if (isNeuro)       formulaEl.textContent = "ニューロデッキ";
            else if (isTrump)  formulaEl.textContent = "トランプ";
            else               formulaEl.textContent = deckForSelector ? `デッキ: ${deckForSelector.name}` : "トランプ";
        }

        // ビューモード（トランプ）: range 列をカードラベルで表示
        if (isTrump) {
            for (const row of element.querySelectorAll("tr[data-result-id]")) {
                const rangeTd = row.querySelector("td.range");
                const r0      = table.results.get(row.dataset.resultId)?.range?.[0];
                const tc      = findCardByRange(r0);
                if (rangeTd && tc) rangeTd.textContent = tc.label;
            }
        }
    }

    if (isTrump) sortDocResultRows(element, table);
    overrideDrawButton(element, table, flagValue, isConfigured);

    // i18n 翻訳が日本語モジュールに負けた場合の保険: シート内ラベルを直接書き換え
    // 「ロール表の説明」→「ドロー表の説明」など "ロール表" を含む全ラベルを置換
    for (const label of element.querySelectorAll("label")) {
        if (label.textContent.includes("ロール表")) {
            label.textContent = label.textContent.replace(/ロール表/g, "ドロー表");
        }
    }
    // displayRoll チェックボックス: "ダイスロール" は上記に引っかからないため個別対応
    const displayRollInput = element.querySelector('input[name="displayRoll"]');
    if (displayRollInput) {
        const label = displayRollInput.closest(".form-group")?.querySelector("label")
                   ?? element.querySelector(`label[for="${displayRollInput.id}"]`);
        if (label) label.textContent = "ドロー結果をチャットに表示";
    }
}

/** トランプモードの結果行を range[0] 昇順に DOM 上で並べ替える */
function sortDocResultRows(element, table) {
    const tbody = element.querySelector("table[data-results] tbody");
    if (!tbody) return;
    const orderOf = (row) => table.results.get(row.dataset.resultId)?.range?.[0] ?? Infinity;
    [...tbody.querySelectorAll("tr[data-result-id]")]
        .sort((a, b) => orderOf(a) - orderOf(b))
        .forEach(row => tbody.appendChild(row));
}

/** 概要タブ: ロール式欄を隠し、デッキ種別ドロップダウンを設置する */
function injectDeckSelector(element, table, flagValue) {
    const formulaInput = element.querySelector('input[name="formula"]');
    const formulaGroup = formulaInput?.closest(".form-group");
    if (!formulaGroup) return;
    formulaGroup.style.display = "none";

    const group = document.createElement("div");
    group.className = "form-group tnx-draw-table-deck";
    group.innerHTML = `
        <label>デッキ種別</label>
        <div class="form-fields">
            <select>
                <option value="" ${flagValue === "" ? "selected" : ""}>トランプ</option>
                <option value="${NEURO_SENTINEL}" ${flagValue === NEURO_SENTINEL ? "selected" : ""}>ニューロデッキ</option>
            </select>
        </div>
        <p class="hint">トランプ: 54 枚仮想ドロー（ジョーカー 2 枚・その他各 4 枚）、ランダムスート付き。ニューロデッキ: シーン設定のニューロデッキからのカードドローで結果を出力します。</p>
    `;
    formulaGroup.after(group);

    group.querySelector("select").addEventListener("change", async (ev) => {
        await table.setFlag(SCOPE, DECK_FLAG, ev.currentTarget.value);
    });
}

/** 結果タブ: 各結果行の範囲欄にカード選択 UI を注入する */
function injectResultSelectors(element, table, deck, isConfigured, isTrump) {
    // ニューロ・旧 UUID モード用カードラベル一覧
    const cardLabels = [];
    if (isConfigured && deck) {
        const seen = new Set();
        for (const card of deck.cards) {
            const label = extractCardLabel(card);
            if (label && !seen.has(label)) { seen.add(label); cardLabels.push(label); }
        }
    }

    for (const row of element.querySelectorAll("tr[data-result-id]")) {
        const resultId = row.dataset.resultId;
        const result   = table.results.get(resultId);
        const rangeTd  = row.querySelector("td.range");
        if (!result || !rangeTd) continue;

        const indexMatch = rangeTd.querySelector("input[name^='results.']")?.name.match(/^results\.(\d+)\./);
        if (!indexMatch) continue;
        const i = indexMatch[1];

        if (isTrump) {
            // トランプモード: ラベル選択ドロップダウン + hidden range inputs + ×N 表示
            const input0 = rangeTd.querySelector(`input[name="results.${i}.range.0"]`);
            const input1 = rangeTd.querySelector(`input[name="results.${i}.range.1"]`);
            if (!input0 || !input1) continue;

            const r0          = result.range?.[0] ?? TRUMP_CARDS[0].range[0];
            const currentCard = findCardByRange(r0) ?? TRUMP_CARDS[0];

            const hidden0 = document.createElement("input");
            hidden0.type  = "hidden";
            hidden0.name  = input0.name;
            hidden0.value = String(currentCard.range[0]);

            const hidden1 = document.createElement("input");
            hidden1.type  = "hidden";
            hidden1.name  = input1.name;
            hidden1.value = String(currentCard.range[1]);

            const options = TRUMP_CARDS.map(tc =>
                `<option value="${tc.label}" ${tc.label === currentCard.label ? "selected" : ""}>${tc.label}</option>`
            ).join("");
            const select = document.createElement("select");
            select.className = "tnx-card-select";
            select.innerHTML = options;

            const weightSpan = document.createElement("span");
            weightSpan.className = "tnx-draw-weight";
            weightSpan.textContent = currentCard.label === "joker" ? "×2" : "×4";

            select.addEventListener("change", () => {
                const tc = TRUMP_CARDS.find(t => t.label === select.value);
                if (tc) {
                    hidden0.value = String(tc.range[0]);
                    hidden1.value = String(tc.range[1]);
                    weightSpan.textContent = tc.label === "joker" ? "×2" : "×4";
                }
            });

            input0.replaceWith(hidden0);
            input1.replaceWith(hidden1);
            rangeTd.appendChild(select);
            rangeTd.appendChild(weightSpan);

        } else if (isConfigured) {
            // ニューロ・旧 UUID モード: カードラベル選択ドロップダウン
            for (const el of rangeTd.children) el.style.display = "none";
            const current = result.getFlag(SCOPE, CARD_FLAG) ?? "";
            const options = [
                `<option value="">（未設定）</option>`,
                ...cardLabels.map(l => `<option value="${foundry.utils.escapeHTML(l)}" ${l === current ? "selected" : ""}>${foundry.utils.escapeHTML(l)}</option>`),
            ].join("");
            const select = document.createElement("select");
            select.className = "tnx-card-select";
            select.name = `results.${i}.flags.${SCOPE}.${CARD_FLAG}`;
            select.innerHTML = options;
            rangeTd.appendChild(select);
        }
    }
}

/** フッターのドローボタンをカードドローに差し替える */
function overrideDrawButton(element, table, flagValue, isConfigured) {
    const button = element.querySelector("button[data-action='drawResult']");
    if (!button) return;

    // innerHTML で完全置換（空白テキストノードへの誤書き込みを防ぐ）
    button.innerHTML = '<i class="fa-solid fa-cards"></i> ドロー';

    if (isConfigured) {
        button.disabled = true;
        button.dataset.tooltip = flagValue === NEURO_SENTINEL
            ? "シーン設定のニューロデッキからのカードドローで結果が出力されます"
            : "設定デッキからのカードドローで結果が出力されます";
        return;
    }

    button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        drawVirtualDoc(table);
    }, true);
}
