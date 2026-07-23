/**
 * @fileoverview 自由入力＋候補のコンボボックス共通コンポーネント(2026-07-23)。
 *
 * HTML ネイティブの `<datalist>`(`<input list="…">`)はドロップダウンの見た目・スクロール・
 * ▼位置を一切スタイルできない(ブラウザ任せ)。候補が多いとスクロール不能で使い物にならない。
 * ここではその `<input list>` + `<datalist>` を、スタイル可能な独自コンボボックスへ「昇格」させる。
 *
 * 呼び出し側は標準の `<input list="x">` + `<datalist id="x">` を書き、描画後に
 * {@link enhanceComboboxes} を1行呼ぶだけでよい(AE設定シート・部位スロットプリセット等で共用)。
 *
 * 設計方針(要点):
 * - 元の <input> はそのまま使う(name/value/フォーム送信経路を壊さない)。候補は昇格時に datalist
 *   から読み取り、以後 JS 側で保持。`list` 属性は外してネイティブUIを無効化する。
 * - ドロップダウンは document.body 直下に position:fixed で描画し、親の overflow でクリップされない。
 *   視覚(背景/文字/フォント)はアンカー input の computed style から引き継ぐため、ネイティブシートの
 *   light/dark と TNX のダーク双方で自然に馴染む。
 * - 自由入力は常に許容(select 化しない)。候補はあくまで補助。
 */

/** 昇格済みマーカ兼「出所 datalist id」を保持する data 属性。 */
const MARK = "tnxCombo";

/** 同時に開けるドロップダウンは1つ。 */
let active = null;

/**
 * 開いているコンボボックスのドロップダウンを閉じる(あれば)。
 * 呼び出し先の再描画などでアンカーが差し替わる前に呼ぶと安全。
 */
export function closeActiveCombobox() {
    active?.close();
}

/**
 * `root` 配下の `input[list]`(紐付く datalist を持つ自由入力)を独自コンボボックスへ昇格する。
 * 冪等: 既に昇格済みの input は読み飛ばす。呼び出し頭で開いているドロップダウンを閉じる。
 *
 * @param {ParentNode} root 走査の起点(シートのルート要素など)
 */
export function enhanceComboboxes(root) {
    if (!root?.querySelectorAll) return;
    closeActiveCombobox();
    for (const input of root.querySelectorAll("input[list]")) {
        if (input.dataset[MARK]) continue;
        const list = input.list; // list 属性が指す <datalist>
        if (!list) continue;
        const options = readOptions(list);
        new Combobox(input, list.id, options);
    }
}

/** datalist から候補を取り出す。value 空は除外し、value/label を持つ配列にする。 */
function readOptions(datalist) {
    const out = [];
    for (const opt of datalist.querySelectorAll("option")) {
        const value = opt.value ?? opt.getAttribute("value") ?? "";
        if (value === "") continue;
        out.push({ value, label: opt.label || opt.textContent?.trim() || value });
    }
    return out;
}

/** 透明でない最初の祖先背景色を拾う(ドロップダウンの下地に使う)。 */
function solidBackground(el) {
    for (let e = el; e; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg && bg !== "transparent" && !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(bg)) return bg;
    }
    return getComputedStyle(document.body).backgroundColor || "#1a2230";
}

/** 1つの入力欄に紐づくコンボボックスの実体。 */
class Combobox {
    /**
     * @param {HTMLInputElement} input 昇格対象の入力欄(そのまま値の器として使う)
     * @param {string} sourceId 出所 datalist の id(冪等マーカ兼、由来の記録)
     * @param {Array<{value:string,label:string}>} options 候補
     */
    constructor(input, sourceId, options) {
        this.input = input;
        this.options = options;
        this.list = null;        // 開いている間だけ body 直下に存在するドロップダウン
        this.activeIndex = -1;   // ハイライト中の候補(-1=なし: 自由入力を守る)
        this.visible = [];       // 現在表示中の候補

        input.dataset[MARK] = sourceId || "1";
        input.removeAttribute("list");     // ネイティブUIを無効化
        input.setAttribute("autocomplete", "off");

        // レイアウト保全: 元 input を .tnx-combobox ラッパで包み、右端に ▼ トグルを1つ置く。
        const cs = getComputedStyle(input);
        const parentCs = input.parentElement ? getComputedStyle(input.parentElement) : null;
        const inFlex = parentCs ? /flex/.test(parentCs.display) : false;

        const wrapper = document.createElement("div");
        wrapper.className = "tnx-combobox";
        if (inFlex) {
            // 親が flex のときは元 input の伸縮をラッパへ引き継ぐ(行内での占有幅を保つ)
            wrapper.style.display = "inline-flex";
            wrapper.style.flexGrow = cs.flexGrow;
            wrapper.style.flexShrink = cs.flexShrink;
            wrapper.style.flexBasis = cs.flexBasis;
            if (cs.alignSelf && cs.alignSelf !== "auto") wrapper.style.alignSelf = cs.alignSelf;
        } else {
            // ブロック/セル文脈では幅いっぱいに満たす
            wrapper.style.display = "flex";
            wrapper.style.width = "100%";
        }
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        input.style.flex = "1 1 auto";
        input.style.minWidth = "0";
        input.style.width = "100%";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "tnx-combobox__toggle";
        toggle.tabIndex = -1;
        toggle.setAttribute("aria-label", "候補を表示");
        toggle.innerHTML = '<i class="fas fa-caret-down"></i>';
        wrapper.appendChild(toggle);

        this.wrapper = wrapper;
        this.toggle = toggle;

        // ハンドラ(this 束縛は close 時の removeEventListener 用に保持)
        this._onDocPointerDown = (ev) => {
            if (!this.wrapper.contains(ev.target) && !this.list?.contains(ev.target)) this.close();
        };
        this._onReposition = () => this.reposition();

        input.addEventListener("click", () => this.open(false));
        input.addEventListener("input", () => this.open(false));
        input.addEventListener("keydown", (ev) => this.onKeyDown(ev));
        input.addEventListener("blur", () => { this._blurTimer = setTimeout(() => this.close(), 120); });
        toggle.addEventListener("click", (ev) => {
            ev.preventDefault();
            if (this.list) this.close();
            else { this.input.focus(); this.open(true); }
        });
    }

    /** ドロップダウンを開く(または内容を更新する)。 @param {boolean} showAll ▼由来=全件表示 */
    open(showAll) {
        clearTimeout(this._blurTimer);
        if (active && active !== this) active.close();
        active = this;
        if (!this.list) {
            const el = document.createElement("ul");
            el.className = "tnx-combobox__list";
            el.setAttribute("role", "listbox");
            el.addEventListener("mousedown", (ev) => ev.preventDefault()); // 選択前の blur を防ぐ
            el.addEventListener("click", (ev) => {
                const opt = ev.target.closest(".tnx-combobox__option");
                if (opt) this.select(opt.dataset.value);
            });
            el.addEventListener("mousemove", (ev) => {
                const opt = ev.target.closest(".tnx-combobox__option");
                if (opt) this.setActive(Number(opt.dataset.index));
            });
            document.body.appendChild(el);
            this.list = el;
            // 視覚コンテキストをアンカー input から引き継ぐ(枠色は CSS の currentColor 混色)
            const cs = getComputedStyle(this.input);
            el.style.background = solidBackground(this.input);
            el.style.color = cs.color;
            el.style.fontFamily = cs.fontFamily;
            el.style.fontSize = cs.fontSize;
            window.addEventListener("scroll", this._onReposition, true);
            window.addEventListener("resize", this._onReposition);
            document.addEventListener("pointerdown", this._onDocPointerDown, true);
        }
        this.render(showAll ? "" : this.input.value);
    }

    /** 候補を絞り込んで描画する(一致は全件描画・上限なし)。@param {string} query 絞り込み文字列(空=全件) */
    render(query) {
        const q = (query ?? "").trim().toLowerCase();
        this.visible = q
            ? this.options.filter(o => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
            : this.options.slice();
        this.activeIndex = -1;
        if (this.visible.length === 0) {
            this.list.innerHTML = '<li class="tnx-combobox__empty">候補なし</li>';
        } else {
            this.list.innerHTML = this.visible.map((o, i) => {
                const label = escapeHtml(o.label);
                const sub = o.label !== o.value ? `<span class="tnx-combobox__sub">${escapeHtml(o.value)}</span>` : "";
                return `<li class="tnx-combobox__option" role="option" data-index="${i}" data-value="${escapeHtml(o.value)}">${label}${sub}</li>`;
            }).join("");
        }
        this.reposition();
    }

    /** ハイライトを移す(キーボード/ホバー)。 */
    setActive(index) {
        const opts = this.list?.querySelectorAll(".tnx-combobox__option");
        if (!opts?.length) return;
        this.activeIndex = Math.max(-1, Math.min(index, opts.length - 1));
        opts.forEach((el, i) => el.classList.toggle("is-active", i === this.activeIndex));
        if (this.activeIndex >= 0) opts[this.activeIndex].scrollIntoView({ block: "nearest" });
    }

    /** キーボード操作。矢印/Enter/Esc。 */
    onKeyDown(ev) {
        if (ev.key === "ArrowDown") {
            ev.preventDefault();
            if (!this.list) this.open(false);
            else this.setActive(this.activeIndex + 1);
        } else if (ev.key === "ArrowUp") {
            if (!this.list) return;
            ev.preventDefault();
            this.setActive(this.activeIndex - 1);
        } else if (ev.key === "Enter") {
            if (this.list && this.activeIndex >= 0 && this.visible[this.activeIndex]) {
                ev.preventDefault(); // 確定(フォーム送信させない)
                this.select(this.visible[this.activeIndex].value);
            } else if (this.list) {
                this.close(); // ハイライト無し=打った文字を保持して閉じる
            }
        } else if (ev.key === "Escape") {
            if (this.list) { ev.stopPropagation(); this.close(); }
        }
    }

    /** 候補を確定して input へ反映する。 */
    select(value) {
        this.input.value = value;
        this.input.dispatchEvent(new Event("input", { bubbles: true }));
        this.input.dispatchEvent(new Event("change", { bubbles: true }));
        this.close();
        this.input.focus();
    }

    /** ドロップダウンを画面座標に合わせる(下に入らなければ上へ)。 */
    reposition() {
        if (!this.list) return;
        if (!this.wrapper.isConnected) { this.close(); return; }
        const rect = this.wrapper.getBoundingClientRect();
        const gap = 2;
        const cap = 260;
        const spaceBelow = window.innerHeight - rect.bottom - gap - 4;
        const spaceAbove = rect.top - gap - 4;
        const placeAbove = spaceBelow < 140 && spaceAbove > spaceBelow;
        const maxH = Math.max(80, Math.min(cap, placeAbove ? spaceAbove : spaceBelow));
        this.list.style.maxHeight = `${maxH}px`;
        this.list.style.left = `${Math.round(rect.left)}px`;
        this.list.style.width = `${Math.round(rect.width)}px`;
        const h = this.list.offsetHeight;
        this.list.style.top = placeAbove
            ? `${Math.round(rect.top - gap - h)}px`
            : `${Math.round(rect.bottom + gap)}px`;
    }

    /** ドロップダウンを閉じて後始末する。 */
    close() {
        clearTimeout(this._blurTimer);
        if (this.list) {
            this.list.remove();
            this.list = null;
            window.removeEventListener("scroll", this._onReposition, true);
            window.removeEventListener("resize", this._onReposition);
            document.removeEventListener("pointerdown", this._onDocPointerDown, true);
        }
        if (active === this) active = null;
    }
}

/** 属性値/テキストノードへ差し込むための最小限のエスケープ。 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
