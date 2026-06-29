import { TokyoNovaItemSheet } from "./tnx-item-sheet.mjs";
import { TnxSkillUtils } from "../module/tnx-skill-utils.mjs";
import { loadSkillChoices, loadCascadeData, buildSkillCascadeSteps, SKILL_PACKS, STYLE_PACK, ORGANIZATION_PACK } from "../module/skill-dictionary.mjs";

export class TokyoNovaStyleSkillSheet extends TokyoNovaItemSheet {

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "sheet", "item", "skill"],
        position: { width: 600, height: 650 },
        actions: {
            incrementMaxLevel:    TokyoNovaStyleSkillSheet._onIncrementMaxLevel,
            decrementMaxLevel:    TokyoNovaStyleSkillSheet._onDecrementMaxLevel,
            incrementTargetValue: TokyoNovaStyleSkillSheet._onIncrementTargetValue,
            decrementTargetValue: TokyoNovaStyleSkillSheet._onDecrementTargetValue,
            viewAcquireRef:       TokyoNovaStyleSkillSheet._onViewAcquireRef,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/item/style-skill-sheet.hbs" },
    };

    static TABS = {
        primary: {
            tabs: [{ id: "description" }, { id: "setting" }, { id: "usage" }, { id: "effects" }],
            initial: "description",
        },
    };

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.options = TnxSkillUtils.getSkillOptions();
        const system = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);
        context.system = system;
        context.TNX = {
            SUITS: {
                spade:   { label: "スペード", disabled: false },
                club:    { label: "クラブ",   disabled: false },
                heart:   { label: "ハート",   disabled: false },
                diamond: { label: "ダイヤ",   disabled: false },
            },
        };
        // 「技能」(comboSkill)の識別キー→技能名の逆引き用に全技能辞典を読み込み、view へ渡す
        const comboSkillNames = await loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
        context.view = TnxSkillUtils.prepareStyleSkillView(system, context.options, comboSkillNames);

        // 代用対象の選択肢: 一般技能辞典(compendium)を identificationKey→名前 で読み込む(辞典内/直下でも選択可)
        context.substituteSkillChoices = await loadSkillChoices([SKILL_PACKS.general]);
        // スタイル欄・ワークス(組織名)欄の選択肢: スタイル辞典 / オーガニゼーション辞典(identificationKey 保存)
        context.styleChoices        = await loadSkillChoices([STYLE_PACK]);
        context.organizationChoices = await loadSkillChoices([ORGANIZATION_PACK]);

        // 技能名カスケード(10-3): value=技能名 の各 comboSkill 行に依存プルダウンの段(steps)を算出。
        // 2列グリッドに種別＋各段を流し込む。種別(1)＋段数 が奇数なら最後の段を全幅(最後が単独列にならないように)。
        const cascadeData = await loadCascadeData();
        for (const e of system.comboSkill) {
            if (e?.value === "skillName") {
                e.cascadeSteps = buildSkillCascadeSteps(cascadeData,
                    { dict: e.skillDict, group: e.skillGroup, sub: e.skillSub, skill: e.name });
                e.typeFull = false;
                if (e.cascadeSteps.length && (1 + e.cascadeSteps.length) % 2 === 1) {
                    e.cascadeSteps[e.cascadeSteps.length - 1].full = true;
                }
            } else {
                e.typeFull = e.value !== "other"; // その他=種別|内容、それ以外(なし/単独/任意)=種別のみ全幅
            }
        }

        // 対決も技能と同形: 「技能名」「技能名※」で辞典カスケードを表示する
        for (const e of system.confrontation) {
            if (e?.value === "skillName" || e?.value === "skillNameAsterisk") {
                e.cascadeSteps = buildSkillCascadeSteps(cascadeData,
                    { dict: e.skillDict, group: e.skillGroup, sub: e.skillSub, skill: e.name });
                e.typeFull = false;
                if (e.cascadeSteps.length && (1 + e.cascadeSteps.length) % 2 === 1) {
                    e.cascadeSteps[e.cascadeSteps.length - 1].full = true;
                }
            } else {
                e.typeFull = e.value !== "other";
            }
        }

        // 自動取得対象(10-2): 名前は fromUuid でライブ解決(削除済みは name キャッシュをフォールバック表示)
        context.autoAcquireItems  = await TokyoNovaStyleSkillSheet._resolveAcquireRefs(system.autoAcquireItems);
        context.autoAcquireActors = await TokyoNovaStyleSkillSheet._resolveAcquireRefs(system.autoAcquireActors);
        // 自動取得セクションは「アウトフィット取得」ON か 特別なスタイル技能=トループ取得技能 のときのみ表示
        context.showAutoAcquire = !!system.acquiresOutfit || system.unique === "troopAcquire";
        return context;
    }

    /** 自動取得参照 {uuid,name} をライブ解決して表示用に整える(UUID 解決失敗は missing)。 */
    static async _resolveAcquireRefs(refs) {
        const out = [];
        for (const r of (Array.isArray(refs) ? refs : [])) {
            const doc = r?.uuid ? await fromUuid(r.uuid) : null;
            out.push({
                uuid: r?.uuid ?? "",
                name: doc?.name ?? r?.name ?? "(不明)",
                img:  doc?.img ?? null,
                missing: !doc,
            });
        }
        return out;
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);

        // 自動取得ボタンの閲覧/編集/削除コンテキストメニュー(editable に関わらず閲覧可)
        if (this.element.querySelector('[data-context-menu="acquire-ref"]')) this._setupAcquireMenu();

        if (!context.editable) return;

        for (const input of this.element.querySelectorAll('.suit-selection input[type="checkbox"]')) {
            input.addEventListener("change", (event) => {
                TnxSkillUtils.onSuitChange(event, this);
            });
        }

        for (const select of this.element.querySelectorAll("select")) {
            select.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onSelectChange(event);
            });
        }

        // isLimit チェックボックス: 解除時に uses フィールドをリセット
        this.element.querySelector('input[name="system.uses.isLimit"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onUsesLimitChange(event);
            });

        // isSubstitute チェックボックス: 解除時に substituteTarget をリセット
        this.element.querySelector('input[name="system.isSubstitute"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onIsSubstituteChange(event);
            });

        // works.value チェックボックス: 解除時に organization をリセット
        this.element.querySelector('input[name="system.special.works.value"]')
            ?.addEventListener("change", (event) => {
                event.stopPropagation();
                this._onWorksChange(event);
            });

        for (const btn of this.element.querySelectorAll(".tnx-row-btn")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onAddArrayItem(event);
            });
        }

        for (const btn of this.element.querySelectorAll(".tnx-row-btn--delete")) {
            btn.addEventListener("click", (event) => {
                event.preventDefault();
                this._onDeleteArrayItem(event);
            });
        }

        // 技能(comboSkill)の追加(legend の＋)・削除(カードの🗑): 部位流の控えめアイコン。専用リスナで配線
        for (const btn of this.element.querySelectorAll(".tnx-combo-add")) {
            btn.addEventListener("click", (event) => { event.preventDefault(); this._onAddArrayItem(event); });
        }
        for (const btn of this.element.querySelectorAll(".tnx-combo-del")) {
            btn.addEventListener("click", (event) => { event.preventDefault(); this._onDeleteArrayItem(event); });
        }

        // 閲覧モードでは技能(combo)のプルダウンも読み取り専用にする(部位エディタと同様。追加/削除は CSS で非表示)
        if (!context.isEditMode) {
            for (const el of this.element.querySelectorAll(".tnx-combo-card select, .tnx-combo-card input")) {
                el.disabled = true;
            }
        }

        // 自動取得(10-2): インポートボックスにドロップで追加(rewriting-miracle 等と衝突しないよう acquire- に限定)
        for (const zone of this.element.querySelectorAll('.tnx-import-box--dropzone[data-drop-area^="acquire-"]')) {
            zone.addEventListener("dragover", (event) => event.preventDefault());
            zone.addEventListener("drop", (event) => this._onDropAcquireZone(event));
        }
    }

    // ─── 自動取得(10-2) ────────────────────────────────────────────────────────

    /** インポートボックス(data-drop-area=acquire-items|acquire-actors)へのドロップを処理。配列に追加。 */
    async _onDropAcquireZone(event) {
        event.preventDefault();
        const area = event.currentTarget?.dataset.dropArea; // "acquire-items" | "acquire-actors"
        const wantItem = area === "acquire-items";
        if (!wantItem && area !== "acquire-actors") return;
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc) return;
        if ((wantItem && doc.documentName !== "Item") || (!wantItem && doc.documentName !== "Actor")) {
            ui.notifications?.warn(wantItem ? "ここにはアイテムをドロップしてください。" : "ここにはアクターをドロップしてください。");
            return;
        }
        // トループ(acquire-actors)は1つのみ＝新しいドロップで置き換える。武器(acquire-items)は複数追加可。
        if (!wantItem) {
            await this.item.update({ "system.autoAcquireActors": [{ uuid: doc.uuid, name: doc.name }] });
            return;
        }
        const cur = [...(this.item.system.autoAcquireItems ?? [])];
        if (cur.some((r) => r.uuid === doc.uuid)) return; // 同じものは重複追加しない
        cur.push({ uuid: doc.uuid, name: doc.name });
        await this.item.update({ "system.autoAcquireItems": cur });
    }

    /** data-acquire(items|actors)+data-index から取得対象の配列・参照を解決する。 */
    _resolveAcquireTarget(el) {
        const kind = el?.dataset.acquire; // "items" | "actors"
        const index = Number(el?.dataset.index);
        const list = kind === "items" ? (this.item.system.autoAcquireItems ?? [])
            : kind === "actors" ? (this.item.system.autoAcquireActors ?? []) : null;
        const ref = (list && index >= 0 && index < list.length) ? list[index] : null;
        return { kind, index, list, ref };
    }

    /** 取得対象を開く(閲覧=editable:false / 編集)。 */
    async _openAcquireRef(el, { edit = false } = {}) {
        const { ref } = this._resolveAcquireTarget(el);
        const doc = ref?.uuid ? await fromUuid(ref.uuid).catch(() => null) : null;
        if (doc) doc.sheet.render(true, edit ? {} : { editable: false });
    }

    /** 取得対象を配列から削除する。 */
    async _removeAcquireRef(el) {
        const { kind, index, list } = this._resolveAcquireTarget(el);
        if (!list || index < 0 || index >= list.length) return;
        const field = kind === "items" ? "system.autoAcquireItems" : "system.autoAcquireActors";
        const cur = [...list];
        cur.splice(index, 1);
        await this.item.update({ [field]: cur });
    }

    /** 取得対象ボタンの左クリック: 閲覧。 */
    static async _onViewAcquireRef(_event, target) {
        await this._openAcquireRef(target);
    }

    /** 取得対象ボタンの右クリックコンテキストメニュー(閲覧/編集/削除)を設置する。 */
    _setupAcquireMenu() {
        const CM = foundry.applications.ux.ContextMenu.implementation;
        new CM(this.element, '[data-context-menu="acquire-ref"]', [
            { name: "閲覧", icon: '<i class="fas fa-eye"></i>',
              callback: (el) => this._openAcquireRef(el) },
            { name: "編集", icon: '<i class="fas fa-edit"></i>',
              callback: (el) => this._openAcquireRef(el, { edit: true }) },
            { name: "削除", icon: '<i class="fas fa-trash"></i>',
              condition: () => this.isEditable,
              callback: (el) => this._removeAcquireRef(el) },
        ], { jQuery: false, fixed: true });
    }

    // ─── スピナーハンドラ ──────────────────────────────────────────────────────

    static async _onIncrementMaxLevel(_event, _target) {
        await this.item.update({ "system.maxLevelNumber": (this.item.system.maxLevelNumber || 0) + 1 });
    }

    static async _onDecrementMaxLevel(_event, _target) {
        await this.item.update({ "system.maxLevelNumber": (this.item.system.maxLevelNumber || 0) - 1 });
    }

    static async _onIncrementTargetValue(_event, _target) {
        await this.item.update({ "system.targetValueNumber": (this.item.system.targetValueNumber || 0) + 1 });
    }

    static async _onDecrementTargetValue(_event, _target) {
        await this.item.update({ "system.targetValueNumber": (this.item.system.targetValueNumber || 0) - 1 });
    }

    // ─── 配列操作ハンドラ ──────────────────────────────────────────────────────

    async _onAddArrayItem(event) {
        const target = event.currentTarget.dataset.target;
        const normalizedSs = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);
        const updateData = {};

        if (target === "combo") {
            const list = [...normalizedSs.comboSkill];
            list.push({ value: "blank", name: "", isMandatory: false });
            updateData["system.comboSkill"] = list;
        } else if (target === "confrontation") {
            const list = [...normalizedSs.confrontation];
            list.push({ value: "blank", name: "" });
            updateData["system.confrontation"] = list;
        } else if (target === "timing") {
            const list = [...normalizedSs.timing];
            list.push({ value: "blank", actionName: "blank", processName: "blank", timingOther: "" });
            updateData["system.timing"] = list;
        } else if (target === "substitute") {
            const list = [...normalizedSs.substituteTarget];
            list.push("");
            updateData["system.substituteTarget"] = list;
        }

        if (Object.keys(updateData).length) await this.item.update(updateData);
    }

    async _onDeleteArrayItem(event) {
        const target = event.currentTarget.dataset.target;
        const index = Number(event.currentTarget.dataset.index);
        const normalizedSs = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);
        const updateData = {};

        const spliceList = (list, key) => {
            if (index >= 0 && index < list.length) {
                list.splice(index, 1);
                updateData[key] = list;
            }
        };

        if (target === "combo")          spliceList([...normalizedSs.comboSkill],       "system.comboSkill");
        else if (target === "confrontation") spliceList([...normalizedSs.confrontation], "system.confrontation");
        else if (target === "timing")    spliceList([...normalizedSs.timing],            "system.timing");
        else if (target === "substitute") spliceList([...normalizedSs.substituteTarget], "system.substituteTarget");

        if (Object.keys(updateData).length) await this.item.update(updateData);
    }

    async _onUsesLimitChange(event) {
        const isChecked = event.currentTarget.checked;
        const update = { "system.uses.isLimit": isChecked };
        if (!isChecked) {
            update["system.uses.spent"] = 0;
            update["system.uses.max"]   = 0;
            update["system.uses.type"]  = "";
        }
        await this.item.update(update);
    }

    async _onIsSubstituteChange(event) {
        const isChecked = event.currentTarget.checked;
        const update = { "system.isSubstitute": isChecked };
        if (!isChecked) update["system.substituteTarget"] = [];
        await this.item.update(update);
    }

    async _onWorksChange(event) {
        const isChecked = event.currentTarget.checked;
        const update = { "system.special.works.value": isChecked };
        if (!isChecked) update["system.special.works.organization"] = ""; // 組織名プルダウンの空(—)に合わせる
        await this.item.update(update);
    }

    async _onSelectChange(event) {
        const select = event.currentTarget;
        const fieldName = select.name;
        const value = select.value;

        // ── スカラーフィールド ────────────────────────────────────────────
        if (fieldName === "system.maxLevel") {
            const d = { [fieldName]: value };
            if (value !== "number") d["system.maxLevelNumber"] = 0;
            if (value !== "other")  d["system.maxLevelOther"]  = "";
            await this.item.update(d);
            return;
        }
        if (fieldName === "system.targetValue") {
            const d = { [fieldName]: value };
            if (value !== "number") d["system.targetValueNumber"] = 0;
            if (value !== "other")  d["system.targetValueOther"]  = "";
            await this.item.update(d);
            return;
        }
        if (fieldName === "system.target") {
            const d = { [fieldName]: value };
            if (value !== "other") d["system.targetOther"] = "";
            await this.item.update(d);
            return;
        }
        if (fieldName === "system.range") {
            const d = { [fieldName]: value };
            if (value !== "other") d["system.rangeOther"] = "";
            await this.item.update(d);
            return;
        }

        // ── 配列フィールド（配列全体を送って index 消失を防ぐ） ──────────
        const ns = TokyoNovaStyleSkillSheet._normalizeSystem(this.item);

        const comboMatch    = fieldName.match(/^system\.comboSkill\.(\d+)\.value$/);
        const cascadeMatch  = fieldName.match(/^system\.comboSkill\.(\d+)\.(skillDict|skillGroup|skillSub|name)$/);
        const confrontMatch = fieldName.match(/^system\.confrontation\.(\d+)\.value$/);
        const confrontCascadeMatch = fieldName.match(/^system\.confrontation\.(\d+)\.(skillDict|skillGroup|skillSub|name)$/);
        const timingMatch   = fieldName.match(/^system\.timing\.(\d+)\.value$/);
        const timingSubMatch = fieldName.match(/^system\.timing\.(\d+)\.(actionName|processName)$/);

        if (comboMatch) {
            const idx = Number(comboMatch[1]);
            const list = foundry.utils.deepClone(ns.comboSkill);
            if (list[idx]) {
                list[idx].value = value;
                if (value !== "skillName" && value !== "other") list[idx].name = "";
                // 技能名以外はカスケードのパスもクリア
                if (value !== "skillName") { list[idx].skillDict = ""; list[idx].skillGroup = ""; list[idx].skillSub = ""; }
            }
            await this.item.update({ "system.comboSkill": list });
            return;
        }
        if (cascadeMatch) {
            // 技能名カスケード: 上流を変えたら下流をリセット(部位の hostMajor→hostMinor と同方式)
            const idx = Number(cascadeMatch[1]);
            const field = cascadeMatch[2];
            const list = foundry.utils.deepClone(ns.comboSkill);
            if (list[idx]) {
                list[idx][field] = value;
                if (field === "skillDict")  { list[idx].skillGroup = ""; list[idx].skillSub = ""; list[idx].name = ""; }
                if (field === "skillGroup") { list[idx].skillSub = ""; list[idx].name = ""; }
                if (field === "skillSub")   { list[idx].name = ""; }
            }
            await this.item.update({ "system.comboSkill": list });
            return;
        }
        if (confrontMatch) {
            const idx = Number(confrontMatch[1]);
            const list = foundry.utils.deepClone(ns.confrontation);
            if (list[idx]) {
                list[idx].value = value;
                // 値を変えたら技能名・カスケードのパスを全てリセットする(技能名↔技能名※ の切替も含む)
                list[idx].name = "";
                list[idx].skillDict = "";
                list[idx].skillGroup = "";
                list[idx].skillSub = "";
            }
            await this.item.update({ "system.confrontation": list });
            return;
        }
        if (confrontCascadeMatch) {
            // 対決の技能名カスケード: 上流を変えたら下流をリセット(comboSkill と同方式)
            const idx = Number(confrontCascadeMatch[1]);
            const field = confrontCascadeMatch[2];
            const list = foundry.utils.deepClone(ns.confrontation);
            if (list[idx]) {
                list[idx][field] = value;
                if (field === "skillDict")  { list[idx].skillGroup = ""; list[idx].skillSub = ""; list[idx].name = ""; }
                if (field === "skillGroup") { list[idx].skillSub = ""; list[idx].name = ""; }
                if (field === "skillSub")   { list[idx].name = ""; }
            }
            await this.item.update({ "system.confrontation": list });
            return;
        }
        if (timingMatch) {
            const idx = Number(timingMatch[1]);
            const list = foundry.utils.deepClone(ns.timing);
            if (list[idx]) {
                list[idx].value = value;
                if (value === "action")        { list[idx].processName = "blank"; list[idx].timingOther = ""; }
                else if (value === "process")  { list[idx].actionName  = "blank"; list[idx].timingOther = ""; }
                else if (value === "other")    { list[idx].actionName  = "blank"; list[idx].processName = "blank"; }
                else                           { list[idx].actionName  = "blank"; list[idx].processName = "blank"; list[idx].timingOther = ""; }
            }
            await this.item.update({ "system.timing": list });
            return;
        }
        if (timingSubMatch) {
            const idx = Number(timingSubMatch[1]);
            const list = foundry.utils.deepClone(ns.timing);
            if (list[idx]) list[idx][timingSubMatch[2]] = value;
            await this.item.update({ "system.timing": list });
            return;
        }

        // ── その他（styleSkillCategory / unique 等） ─────────────────────
        await this.item.update({ [fieldName]: value });
    }

    // ─── 静的ヘルパー ──────────────────────────────────────────────────────────

    /** system データの配列フィールドを正規化して返す */
    static _normalizeSystem(item) {
        const system = foundry.utils.deepClone(item.system);

        const ensureArray = (val) => {
            if (Array.isArray(val)) return val;
            if (typeof val === "object" && val !== null && Object.keys(val).length > 0) return Object.values(val);
            if (typeof val === "string" && val !== "" && val !== "-") return [{ value: val }];
            return [];
        };

        system.comboSkill = ensureArray(system.comboSkill);
        if (!system.comboSkill.length) system.comboSkill = [{ value: "blank", name: "", isMandatory: false }];

        system.confrontation = ensureArray(system.confrontation);
        if (!system.confrontation.length) system.confrontation = [{ value: "blank", name: "" }];

        system.timing = ensureArray(system.timing);
        if (!system.timing.length) system.timing = [{ value: "blank", actionName: "blank", processName: "blank", timingOther: "" }];

        if (!Array.isArray(system.substituteTarget)) {
            if (typeof system.substituteTarget === "object" && system.substituteTarget !== null) {
                system.substituteTarget = Object.values(system.substituteTarget);
            } else if (typeof system.substituteTarget === "string" && system.substituteTarget !== "") {
                system.substituteTarget = [system.substituteTarget];
            } else {
                system.substituteTarget = [];
            }
        }
        if (!system.substituteTarget.length) system.substituteTarget = [""];

        return system;
    }
}
