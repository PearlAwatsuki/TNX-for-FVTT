/**
 * @fileoverview ドロー表 - コア RollTable のカードドロー拡張
 *
 * コアの RollTable / TableResult / RollTableSheet は一切置き換えない。
 * renderRollTableSheet フックで DOM に最小限の UI を注入し、
 * ドロー手段だけをダイスからカードに差し替える。
 *
 * - 仮想 DoC モード（デフォルト）: フッターのドローボタンで 54 枚分布
 *   （各値 4 枚 + ジョーカー 2 枚）の仮想ドロー。結果行の範囲値は
 *   A〜K = 1〜13、ジョーカー = 99（tnx-playing-cards.mjs の value と一致）。
 * - 設定デッキモード: 概要タブのロール式欄をデッキ選択に差し替え。
 *   デッキを選ぶと、HUD のニューロカードドローを発火点として、
 *   カード名から抽出したラベル（切り札配布と同じ抽出規則）で結果を照合する。
 *
 * flag 構造:
 *   RollTable.flags.tokyo-nova-axleration.drawTableDeckId  紐付けデッキ UUID（"" = 仮想 DoC）
 *   TableResult.flags.tokyo-nova-axleration.cardName       照合キー（抽出済みカードラベル）
 */

const SCOPE = "tokyo-nova-axleration";
const DECK_FLAG = "drawTableDeckId";
const CARD_FLAG = "cardName";

/** 仮想 DoC の値とラベル（A〜K = 1〜13、ジョーカー = 99） */
const DOC_VALUES = [
    { value: 1,  label: "A" },
    { value: 2,  label: "2" },
    { value: 3,  label: "3" },
    { value: 4,  label: "4" },
    { value: 5,  label: "5" },
    { value: 6,  label: "6" },
    { value: 7,  label: "7" },
    { value: 8,  label: "8" },
    { value: 9,  label: "9" },
    { value: 10, label: "10" },
    { value: 11, label: "J" },
    { value: 12, label: "Q" },
    { value: 13, label: "K" },
    { value: 99, label: "ジョーカー" },
];

/**
 * カード名から照合用ラベルを抽出する（切り札配布ダイアログと同じ規則）。
 * 例: "魔剣：カタナ / The Sword" → "カタナ"。パターン外はカード名そのまま。
 * @param {Card} card
 * @returns {string}
 */
export function extractCardLabel(card) {
    const raw = card.faces?.[0]?.name ?? card.name ?? "";
    return raw.replace(/<[^>]+>/g, "").match(/：(.+?)\s*\//)?.[1] ?? raw;
}

/** 54 枚フルデッキ（各値 4 枚 + ジョーカー 2 枚）から仮想ドローした値を返す */
export function drawVirtualDocValue() {
    const idx = Math.floor(Math.random() * 54);
    if (idx < 2) return 99;
    return 1 + Math.floor((idx - 2) / 4);
}

/**
 * 仮想 DoC ドローを実行し、コアの draw でチャットに出力する。
 * @param {RollTable} table
 */
export async function drawVirtualDoc(table) {
    const value = drawVirtualDocValue();
    const label = DOC_VALUES.find(v => v.value === value)?.label ?? String(value);
    const results = table.getResultsForRoll(value);
    if (results.length === 0) {
        return ui.notifications.warn(`ドロー結果「${label}」に対応する結果がありません。`);
    }
    const roll = await new Roll(String(value)).evaluate();
    await table.draw({ roll, results });
}

/**
 * HUD のカードドロー後、開いているドロー表シートから該当テーブルを探し、
 * カードラベルが一致する結果をコアの draw でチャットに出力する。
 * @param {Card}   card           ドローされた Card ドキュメント
 * @param {string} sourceDeckUuid ドロー元デッキの UUID
 */
export async function lookupDrawTables(card, sourceDeckUuid) {
    const label = extractCardLabel(card);
    const RollTableSheet = foundry.applications.sheets.RollTableSheet;
    for (const app of foundry.applications.instances.values()) {
        if (!(app instanceof RollTableSheet) || !app.rendered) continue;
        const table = app.document;
        if ((table.getFlag(SCOPE, DECK_FLAG) ?? "") !== sourceDeckUuid) continue;

        const result = table.results.find(r => r.getFlag(SCOPE, CARD_FLAG) === label);
        if (!result) continue;
        await table.draw({ results: [result], roll: null });
    }
}

/** ドロー表関連のフックを登録する（init から呼ぶ） */
export function registerDrawTableHooks() {

    // 新規作成時: デフォルト名「ドロー表」・アイコン card-hands.svg
    Hooks.on("preCreateRollTable", (table, data) => {
        const update = {};
        const defaultIcon = foundry.documents.BaseRollTable.DEFAULT_ICON;
        if (!data.img || data.img === defaultIcon) {
            update.img = "icons/svg/card-hands.svg";
        }
        const coreLabel = game.i18n.localize(foundry.documents.BaseRollTable.metadata.label);
        if (!data.name) {
            update.name = "ドロー表";
        } else if (data.name.startsWith(coreLabel)) {
            update.name = data.name.replace(coreLabel, "ドロー表");
        }
        if (!foundry.utils.isEmpty(update)) table.updateSource(update);
    });

    Hooks.on("renderRollTableSheet", onRenderRollTableSheet);
}

/* -------------------------------------------------------------------------- */
/*  シート DOM 注入                                                            */
/* -------------------------------------------------------------------------- */

/**
 * @param {foundry.applications.sheets.RollTableSheet} app
 * @param {HTMLElement} element
 */
function onRenderRollTableSheet(app, element) {
    const table = app.document;
    if (table.pack) return; // コンペンディウム内のテーブルは対象外

    const deckId = table.getFlag(SCOPE, DECK_FLAG) ?? "";
    const deck = deckId ? foundry.utils.fromUuidSync(deckId) : null;
    const isConfigured = !!deck;

    if (app.isEditMode) {
        injectDeckSelector(element, table, deckId);
        injectResultSelectors(element, table, deck, isConfigured);
    } else {
        // ビューモード: ヘッダーのロール式表示をモード表示に差し替え
        const formulaEl = element.querySelector("header.sheet-header h4");
        if (formulaEl) formulaEl.textContent = isConfigured ? `デッキ: ${deck.name}` : "仮想DoC";
    }

    overrideDrawButton(element, table, isConfigured);
}

/** 概要タブ: ロール式欄を隠し、デッキ選択ドロップダウンを設置する */
function injectDeckSelector(element, table, deckId) {
    const formulaInput = element.querySelector('input[name="formula"]');
    const formulaGroup = formulaInput?.closest(".form-group");
    if (!formulaGroup) return;
    formulaGroup.style.display = "none";

    const decks = (game.cards?.filter(c => c.type === "deck") ?? []);
    const options = [
        `<option value="">仮想DoC（デッキ未使用）</option>`,
        ...decks.map(d => `<option value="${d.uuid}" ${d.uuid === deckId ? "selected" : ""}>${foundry.utils.escapeHTML(d.name)}</option>`),
    ].join("");

    const group = document.createElement("div");
    group.className = "form-group tnx-draw-table-deck";
    group.innerHTML = `
        <label>使用デッキ</label>
        <div class="form-fields"><select>${options}</select></div>
        <p class="hint">未選択の場合は仮想DoC（A〜K=1〜13、ジョーカー=99）でドローします。デッキを選択すると、そのデッキからのカードドローを発火点として結果を出力します。</p>
    `;
    formulaGroup.after(group);

    group.querySelector("select").addEventListener("change", async (ev) => {
        await table.setFlag(SCOPE, DECK_FLAG, ev.currentTarget.value);
    });
}

/** 結果タブ: 各結果行の範囲欄にドロップダウンを追加する */
function injectResultSelectors(element, table, deck, isConfigured) {
    // 設定デッキモード: デッキ内カードのラベル一覧（重複除去・出現順）
    const cardLabels = [];
    if (isConfigured) {
        const seen = new Set();
        for (const card of deck.cards) {
            const label = extractCardLabel(card);
            if (label && !seen.has(label)) { seen.add(label); cardLabels.push(label); }
        }
    }

    for (const row of element.querySelectorAll("tr[data-result-id]")) {
        const resultId = row.dataset.resultId;
        const result = table.results.get(resultId);
        const rangeTd = row.querySelector("td.range");
        if (!result || !rangeTd) continue;

        const indexMatch = rangeTd.querySelector("input[name^='results.']")?.name.match(/^results\.(\d+)\./);
        if (!indexMatch) continue;
        const i = indexMatch[1];

        if (isConfigured) {
            // 範囲入力を隠してカード選択ドロップダウンに差し替え
            // （name 付きなので保存ボタンで他フィールドと一緒に永続化される）
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
        } else {
            // 仮想 DoC モード: 値選択ドロップダウンを併設（手動入力も可）
            const low = result.range?.[0];
            const high = result.range?.[1];
            const matched = DOC_VALUES.find(v => v.value === low && v.value === high);
            const options = [
                `<option value="">（手動）</option>`,
                ...DOC_VALUES.map(v => `<option value="${v.value}" ${matched?.value === v.value ? "selected" : ""}>${v.label}</option>`),
            ].join("");
            const select = document.createElement("select");
            select.className = "tnx-card-select";
            select.innerHTML = options;
            select.addEventListener("change", (ev) => {
                const value = ev.currentTarget.value;
                if (value === "") return;
                const lowInput  = rangeTd.querySelector(`input[name="results.${i}.range.0"]`);
                const highInput = rangeTd.querySelector(`input[name="results.${i}.range.1"]`);
                if (lowInput)  lowInput.value  = value;
                if (highInput) highInput.value = value;
            });
            rangeTd.appendChild(select);
        }
    }
}

/** フッターのドローボタンをカードドローに差し替える */
function overrideDrawButton(element, table, isConfigured) {
    const button = element.querySelector("button[data-action='drawResult']");
    if (!button) return;

    if (isConfigured) {
        // 設定デッキモードはデッキのドローが発火点（ボタンからは引かない）
        button.disabled = true;
        button.dataset.tooltip = "設定デッキからのカードドローで結果が出力されます";
        return;
    }

    const icon = button.querySelector("i");
    if (icon) icon.className = "fa-solid fa-cards";
    button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        drawVirtualDoc(table);
    }, true);
}
