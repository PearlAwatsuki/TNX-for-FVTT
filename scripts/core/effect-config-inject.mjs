/**
 * @fileoverview ActiveEffect 設定シートへの TNX 項目の注入(フェーズ9-3 v2/v3)。
 *
 * 重複可・準備先・付与先といった本システム固有の設定を、コアの詳細タブへ足す。
 * 注入フィールドは name="flags.<システムID>.*" を与えて**ネイティブ項目と同じフォーム送信で
 * 保存**する(2026-07-13 ユーザー指摘で是正: 即時 setFlag はドキュメント更新→シート再描画で
 * 未保存のフォーム状態(transfer のオン等)を巻き戻すため廃止)。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { getSessionState } from "../session/session-state.mjs";
import { TNX_DURATIONS } from "../rules/time-boundary.mjs";
import { CONDITION_KINDS, CONDITION_GROUP_LABELS, getConditionKinds } from "../rules/conditions.mjs";
import { parseEffectTargetKey, AE_FLAG_PARAMS } from "../data/item/helpers.mjs";
import { getPartSlotPreset } from "../app/part-slot-preset-app.mjs";
import { enhanceComboboxes } from "../ui/combobox.mjs";
import { OUTFIT_CATEGORIES } from "../data/item/outfit-categories.mjs";

/** AE 設定シートへの注入を登録する(init から呼ぶ)。 */
export function registerEffectConfigInjection() {
    Hooks.on("renderActiveEffectConfig", (app, element) => {
        const root = element instanceof HTMLElement ? element : element?.[0];
        if (!root) return;

        // 上書き系キーの値入力を選択式にする(2026-07-13 ユーザー確定・ベタ打ちさせない):
        // - check.cardValue: 判定に使用したカードの数字の上書き(A〜K)
        // - *.attack.damageType: ダメージ種別の上書き(S/P/I/X)
        // - 特性フラグ(フェーズ12): オン/オフ(true/false)
        // options は {value,label} 可(未指定は value=label)。
        const opt = (value, label) => ({ value, label: label ?? value });
        const flagKeyParam = (key) => {
            const p = parseEffectTargetKey(key);
            if (!p?.path) return null;
            const base = p.path.replace(/Total$/, "");
            return AE_FLAG_PARAMS.includes(base) ? base : (AE_FLAG_PARAMS.includes(p.path) ? p.path : null);
        };
        const VALUE_CHOICE_RULES = [
            { match: (k) => k === "check.cardValue",
              options: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].map(o => opt(o)) },
            { match: (k) => k.endsWith(".attack.damageType") || k === "system.baseAttack.damageType",
              options: ["S", "P", "I", "X"].map(o => opt(o)) },
            // 特性フラグのオン/オフ(フェーズ12)。キーが登録フラグを指すとき値をオン/オフの選択に
            { match: (k) => !!flagKeyParam(k), options: [opt("true", "オン"), opt("false", "オフ")] },
        ];
        const syncChangeValueInputs = () => {
            for (const keyInput of root.querySelectorAll('[name^="changes."][name$=".key"]')) {
                const valueName = keyInput.name.replace(/\.key$/, ".value");
                const valueEl = root.querySelector(`[name="${CSS.escape(valueName)}"]`);
                if (!valueEl) continue;
                const rule = VALUE_CHOICE_RULES.find(r => r.match((keyInput.value ?? "").trim()));
                if (rule) {
                    const sig = rule.options.map(o => o.value).join(",");
                    if (valueEl.tagName === "SELECT" && valueEl.dataset.tnxChoices === sig) continue;
                    const cur = valueEl.value;
                    const sel = document.createElement("select");
                    sel.name = valueEl.name;
                    sel.dataset.tnxChoices = sig;
                    sel.innerHTML = ['<option value="">──</option>',
                        ...rule.options.map(o => `<option value="${o.value}"${cur === o.value ? " selected" : ""}>${o.label}</option>`),
                    ].join("");
                    valueEl.replaceWith(sel);
                } else if (valueEl.tagName === "SELECT" && valueEl.dataset.tnxChoices) {
                    const inp = document.createElement("input");
                    inp.type = "text";
                    inp.name = valueEl.name;
                    inp.value = valueEl.value;
                    valueEl.replaceWith(inp);
                }
                // 部位行の追加(system.part.<部位キー> 等)の値は and/or[:消費数]。自由入力を保ったまま
                // datalist で補助する(消費数付き and:2 も打てるよう select にはしない・フェーズ12)
                const parsed = parseEffectTargetKey((keyInput.value ?? "").trim());
                if (parsed?.scope === "partAdd" && valueEl.tagName === "INPUT") {
                    valueEl.setAttribute("list", "tnx-ae-part-relation");
                } else if (valueEl.tagName === "INPUT" && valueEl.getAttribute("list") === "tnx-ae-part-relation") {
                    valueEl.removeAttribute("list");
                }
            }
        };
        // キー入力の補助 datalist(変更キーの全キー一覧。正本は wiki Active_Effects §2 と parseEffectTargetKey)。
        // 方針(2026-07-23 ユーザー確定): リスト形式の思想＝完全性。**有限の組合せは実キーで全列挙**
        // (分類×パラメータ・アイテム狙い×パラメータも含む)。**`<key>` プレースホルダは識別キーの指定のみ**に使う
        // (技能/スタイル/ワークス/アイテムの識別キー＝唯一の任意入力軸)。候補が多いのでコンボボックス側で
        // 表示上限＋「他N件」を出す(データは全件・絞り込みで到達)。
        if (!root.querySelector("#tnx-ae-key-suggestions")) {
            const partKeys = [...new Set(getPartSlotPreset().map(s => s?.key).filter(Boolean))];
            const abilities = ["reason", "passion", "life", "mundane"]; // 能力値4種(理性/感情/生命/外界)
            const condKinds = Object.keys(CONDITION_KINDS);             // ダメージタグ改変の元タグ候補(全数)
            const bsKinds = condKinds.filter(k => CONDITION_KINDS[k]?.group === "bs"); // 個別BSの無視ゲート
            // 分類キー(§2.4・全数): 大分類＋小分類＋疑似分類(generalSkill/styleSkill)
            const catKeys = [
                ...Object.keys(OUTFIT_CATEGORIES),
                ...Object.values(OUTFIT_CATEGORIES).flatMap(m => Object.keys(m.minors)),
                "generalSkill", "styleSkill",
            ];
            // アイテムの着地パラメータ(§2.3 型別全数)＋特性フラグ(§2.3c・AE_FLAG_PARAMS)。素のキー・
            // アイテム狙い・分類狙いで共通の「乗り先アイテムの属性」軸。
            const attrs = [
                "buy", "hide", "appearancePenalty", "hack", "preserveExp",             // 全アウトフィット共通
                "attack", "attack.damageType", "guardValue", "FAValue",                // 武器
                "defence.S", "defence.P", "defence.I", "controlMod",                    // 防具/義体/ヴィークル/IANUS
                "speedFactor", "passenger",                                            // ヴィークル
                "cycle", "combatSpeedMod",                                             // タップ
                "appearanceTarget", "cyberSecurity", "analogSecurity",                 // 住宅施設
                "level",                                                               // 技能
                ...AE_FLAG_PARAMS,                                                     // 特性フラグ(§2.3c)
            ];

            // 判定バフ(§2.7): 固定＋能力値・制御判定は全列挙、識別キー狙いは `<key>`(識別キー)雛形。
            // 社会下位区分(2026-08-26)は有限4値のため実キーで全列挙(SOCIETY_CLASSES と対応)
            const checkKeys = [
                "check.all", "check.cardValue", "check.suitChange",
                ...abilities.map(a => `check.${a}`),
                ...abilities.map(a => `controlCheck.${a}`),
                "check.<key>", "check.style.<key>", "check.works.<key>",
                "check.society.nation", "check.society.city",
                "check.society.industry", "check.society.organization",
            ];
            // 値バフ①キャラクター(§2.1): 能力値/制御値/CS/AR/生身ダメージ種別
            const charValueKeys = [
                ...abilities.map(a => `system.ability.${a}`),
                ...abilities.map(a => `system.control.${a}`),
                "system.cs.base", "system.cs.value", "system.cs.current",
                "system.ar.max",
                "system.baseAttack.damageType",
            ];
            // 値バフ②乗り先別(§2.2)。素のキー=乗っているアイテム自身 / item.<識別キー>=識別キー狙い(`<key>`) /
            // system.category.<分類>=分類狙い(実キーで全列挙)。属性軸(attrs)は全モード共通。
            const selfKeys = ["name", ...attrs.map(a => `system.${a}`)];
            const itemKeys = ["item.<key>.name", ...attrs.map(a => `item.<key>.system.${a}`)];
            const categoryKeys = catKeys.flatMap(c => attrs.map(a => `system.category.${c}.${a}`));
            // ダメージバフ(§2.8): 与える/受ける固定キー全数＋タグ改変(元タグ全数)＋識別キー狙いは `<key>` 雛形
            const damageKeys = [
                "damage.dealt", "damage.dealt.physical", "damage.dealt.mental", "damage.dealt.social",
                "damage.taken", "damage.taken.physical", "damage.taken.mental", "damage.taken.social",
                "damage.taken.S", "damage.taken.P", "damage.taken.I", "damage.taken.X",
                "damage.vsStyle.<key>", "damage.vsWorks.<key>", "damage.fromStyle.<key>", "damage.fromWorks.<key>",
                "damage.vsWet", "damage.vsWet.physical", "damage.vsWet.mental", "damage.vsWet.social",
                "damage.vsNotWet", "damage.vsNotWet.physical", "damage.vsNotWet.mental", "damage.vsNotWet.social",
                ...condKinds.map(k => `damage.replaceTag.${k}`),
                ...condKinds.map(k => `damage.addTag.${k}`),
            ];
            // 無視ゲート(§2.11): all / 全BS / 個別BS(全数) / ダメージ由来(全・系統別)
            const ignoreKeys = [
                "ignore.all", "ignore.bs", "ignore.damage",
                "ignore.damage.physical", "ignore.damage.mental", "ignore.damage.social",
                ...bsKinds.map(k => `ignore.bs.${k}`),
            ];

            const escAttr = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
            const keyList = document.createElement("datalist");
            keyList.id = "tnx-ae-key-suggestions";
            // 並びは「よく使う順」→ 分類狙い(件数の大半)を末尾に置く(表示上限の先頭が有用キーになるように)。
            keyList.innerHTML = [
                ...checkKeys,
                ...charValueKeys,
                ...selfKeys,
                ...partKeys.map(k => `system.partSlot.${k}`),
                ...partKeys.map(k => `system.part.${k}`),
                ...itemKeys,
                ...damageKeys,
                ...ignoreKeys,
                ...categoryKeys,
            ].map(v => `<option value="${escAttr(v)}"></option>`).join("");
            root.appendChild(keyList);
            const relList = document.createElement("datalist");
            relList.id = "tnx-ae-part-relation";
            relList.innerHTML = ["and", "or", "and:2", "or:2"].map(v => `<option value="${v}"></option>`).join("");
            root.appendChild(relList);
        }
        // キー入力の候補付けは毎レンダー(変更行の追加にも追従)
        for (const keyInput of root.querySelectorAll('[name^="changes."][name$=".key"]')) {
            keyInput.setAttribute("list", "tnx-ae-key-suggestions");
        }
        syncChangeValueInputs();
        // ネイティブ datalist を独自コンボボックスへ昇格(スクロール可・▼位置固定・テーマ追従)。
        // キー入力＋ partAdd 値入力(tnx-ae-part-relation)をまとめて拾う。
        enhanceComboboxes(root);
        root.addEventListener("change", (ev) => {
            if (typeof ev.target?.name === "string" && ev.target.name.endsWith(".key")) {
                syncChangeValueInputs();
                enhanceComboboxes(root); // キー変更で値入力に list が付いた分を昇格
            }
        });

        if (root.querySelector(".tnx-stackable-field")) return;
        const current = app.document?.getFlag?.(SYSTEM_ID, "stackable") === true;
        const group = document.createElement("div");
        group.classList.add("form-group", "tnx-stackable-field");
        group.innerHTML = `
            <label>重複可</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${SYSTEM_ID}.stackable" ${current ? "checked" : ""}>
            </div>`;
        const anchor = root.querySelector('[name="transfer"], [name="disabled"]')?.closest(".form-group");
        if (anchor) anchor.after(group);
        else (root.querySelector('.tab[data-tab="details"]') ?? root.querySelector("form"))?.appendChild(group);

        // 持続時間タブに TNX の持続を注入する(15-1・2026-08-29 ユーザー裁定「そもそも持続時間タブが
        // あるはずなので、そこにプルダウンを追加する。上書きでも良い」)。Foundry 標準のラウンド/秒は
        // 本システムでは機能しない——TNX は持続を実時間で測らず、本システムは worldTime に一切
        // 触れないため実時間で減る経路が無い。動かない欄を残す意味が無いので隠して置き換える。
        // 失効の実処理は time-boundary.mjs(境界の購読)。
        const durationTab = root.querySelector('.tab[data-tab="duration"]');
        if (durationTab && !durationTab.querySelector(".tnx-duration-field")) {
            // ネイティブの欄は <fieldset> でまとめられている。中の .form-group だけ隠すと**枠だけが
            // 空で残る**(隔離実機で実測)ため、タブの直接の子ごと隠してから自分の欄を先頭に挿す。
            for (const el of durationTab.children) el.style.display = "none";
            const curDuration = app.document?.getFlag?.(SYSTEM_ID, "tnxDuration") ?? "";
            const durationGroup = document.createElement("div");
            durationGroup.classList.add("form-group", "tnx-duration-field");
            const options = Object.entries(TNX_DURATIONS)
                .map(([v, l]) => `<option value="${v}"${curDuration === v ? " selected" : ""}>${l}</option>`)
                .join("");
            durationGroup.innerHTML = `
                <label>持続</label>
                <div class="form-fields">
                    <select name="flags.${SYSTEM_ID}.tnxDuration">${options}</select>
                </div>`;
            durationTab.prepend(durationGroup);
        }

        // 自動適用ゲート(2026-07-13 再設計): ネイティブ transfer を「効果を対象に自動適用」として使う。
        // 対象はキーが示すもの(キャラ値・アイテムのパラメータ・分類/識別キー該当アイテム)。
        // オンのとき=常時自動適用。オフのとき=使用時付与用ペイロード(用途の「適用される効果」でのみ付与)
        const transferInput = root.querySelector('[name="transfer"]');
        const transferGroup = transferInput?.closest(".form-group");
        if (transferGroup) {
            const label = transferGroup.querySelector("label");
            if (label) {
                label.textContent = "効果を対象に自動適用";
            }
            const hint = transferGroup.querySelector("p.hint");
            if (hint) hint.textContent = "オンなら効果がキーの示す対象へ常時自動で適用されます。";
        }

        // 準備先(親アイテム)に適用(自動適用オンのときのみ意味を持つ): 素のパラメータキーの効果を
        // このアイテムの準備先ホストに効かせる(準備で転送・解除で除去)。アイテム上の効果でのみ表示
        let parentGroup = null;
        if (app.document?.parent?.documentName === "Item") {
            const cur = app.document.getFlag?.(SYSTEM_ID, "applyToParent") === true;
            parentGroup = document.createElement("div");
            parentGroup.classList.add("form-group", "tnx-apply-parent-field");
            parentGroup.innerHTML = `
                <label>準備先（親アイテム）に適用</label>
                <div class="form-fields">
                    <input type="checkbox" name="flags.${SYSTEM_ID}.applyToParent" ${cur ? "checked" : ""}>
                </div>`;
            (transferGroup ?? anchor)?.after(parentGroup);
        }

        // 効果種別: 使用時付与でこの効果が果たす役割。通常効果(既定・値 "target")=カードの効果
        // セクションでチェック済みの対象へ付与/代償効果(値 "self")=同じ押下で同時に使用者へ付与。
        // 旧名「付与先: 対象/自分」は宛先のふりをした挙動スイッチで v3 当初(2026-07-13)からの
        // 命名不良だった(2026-08-30 是正。保存フラグ名 grantTarget は歴史的経緯で維持=データ無移行)。
        // **自動適用とは直交**(2026-07-13 ユーザー指摘で是正: 用途の適用効果は自動適用オンの効果も
        // 選択できるため、transfer で出し分けると設定に到達できない)。
        // 用途の効果はアイテム由来のみなので、アイテム上の効果で常時表示する
        if (app.document?.parent?.documentName === "Item") {
            const grantCur = app.document.getFlag?.(SYSTEM_ID, "grantTarget") === "self" ? "self" : "target";
            const grantGroup = document.createElement("div");
            grantGroup.classList.add("form-group", "tnx-grant-target-field");
            grantGroup.innerHTML = `
                <label>効果種別</label>
                <div class="form-fields">
                    <select name="flags.${SYSTEM_ID}.grantTarget">
                        <option value="target"${grantCur === "target" ? " selected" : ""}>通常効果</option>
                        <option value="self"${grantCur === "self" ? " selected" : ""}>代償効果</option>
                    </select>
                </div>`;
            (parentGroup ?? transferGroup ?? anchor)?.after(grantGroup);
            // ※適用タイミング(命中時/ダメージ時)は AE 側に持たせない(2026-07-18 ユーザー確定)——
            //   攻撃用途の「適用される効果（ダメージ時）」リスト所属で決まる(usage.damageEffects)
        }

        // 出し分け: 準備先=自動適用オンのときだけ表示する(常時自動適用の乗り先修飾のため。
        // 使用時付与ではコピー作成時に applyToParent を落とす=オフ時に意味を持つ経路が無い)
        const syncModeFields = () => {
            if (parentGroup) parentGroup.style.display = (transferInput ? !!transferInput.checked : true) ? "" : "none";
        };
        syncModeFields();
        transferInput?.addEventListener("change", syncModeFields);

        // コンディション(BS)の効果値フィールドを詳細タブの**末尾**に注入する(フェーズ9-4)。
        // - BS 種別ごとに <fieldset><legend>BS名</legend> で囲む(箇条書きの羅列を避ける)。
        // - 効果値が可変な BS のみ欄を出す(固定値=酩酊 / 効果値なし=恐慌・戦闘不能 は出さない)。
        // - 値は kind 別キー flags.tokyo-nova-axleration.conditions[<kind>] へ setFlag(condition に閉じる)。
        // - ステータス欄を変えたら statuses を即 update して再注入する(保存=シートを閉じる、を避けて
        //   未保存でも効果値欄が出るようにする)。
        const detailsTab = root.querySelector('.tab[data-tab="details"]') ?? root.querySelector("form");
        const statusCtrl = root.querySelector('[name="statuses"]');
        const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };
        const setK = (k, field, v) => app.document?.setFlag(SYSTEM_ID, `conditions.${k}.${field}`, v);

        const injectConditionFieldsets = () => {
            if (!detailsTab) return;
            detailsTab.querySelectorAll(".tnx-condition-fieldset").forEach(el => el.remove());
            const perKind = app.document?.getFlag?.(SYSTEM_ID, "conditions") ?? {};
            for (const kind of getConditionKinds(app.document)) {
                const def = CONDITION_KINDS[kind];
                if (!def) continue;
                const v = perKind[kind] ?? {};
                const fields = [];
                if (def.magnitudeField) {
                    const isStrength = def.type === "computed" || def.type === "continuous";
                    fields.push({ label: isStrength ? "強度 n" : "効果量",
                        html: `<input type="number" value="${Number(v.magnitude ?? 0) || 0}" step="1">`,
                        bind: (el) => el.addEventListener("change", (e) => setK(kind, "magnitude", Number(e.currentTarget.value) || 0)) });
                }
                if (def.abilityField) {
                    const cur = v.targetAbility ?? "";
                    const blank = `<option value="" ${cur === "" ? "selected" : ""}>${def.abilityBlankLabel ?? "全制御値"}</option>`;
                    const sel = blank + Object.entries(ABIL).map(([k, l]) =>
                        `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("");
                    fields.push({ label: "対象能力値", html: `<select>${sel}</select>`,
                        bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetAbility", e.currentTarget.value)) });
                }
                if (def.targetField) {
                    fields.push({ label: "対象(UUID)", html: `<input type="text" value="${v.targetUuid ?? ""}" placeholder="Actor UUID">`,
                        bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetUuid", e.currentTarget.value.trim())) });
                }
                if (def.weaponField) {
                    // 対象武器の指定(捕縛): 対象キャラの武器＋生身から選ぶ。空=生身(攻撃の「攻撃で使用」と同型)。
                    // 保存はアイテム ID(生身=空)。効果は対象アクター上の効果なので parent の武器を列挙する。
                    const parentActor = app.document?.parent;
                    const weapons = parentActor?.items?.filter?.(i => i.type === "weapon") ?? [];
                    const cur = v.targetWeapon ?? "";
                    const opts = `<option value="" ${cur === "" ? "selected" : ""}>生身</option>`
                        + weapons.map(i => `<option value="${i.id}" ${i.id === cur ? "selected" : ""}>${foundry.utils.escapeHTML(i.name)}</option>`).join("");
                    fields.push({ label: "対象武器", html: `<select>${opts}</select>`,
                        bind: (el) => el.addEventListener("change", (e) => setK(kind, "targetWeapon", e.currentTarget.value)) });
                }
                if (!fields.length) continue; // 効果値なし/固定値の BS は欄を出さない
                const fs = document.createElement("fieldset");
                fs.classList.add("tnx-condition-fieldset");
                const legend = document.createElement("legend");
                legend.textContent = `${def.label}（効果値）`;
                fs.appendChild(legend);
                for (const f of fields) {
                    const g = document.createElement("div");
                    g.classList.add("form-group");
                    g.innerHTML = `<label>${f.label}</label><div class="form-fields">${f.html}</div>`;
                    f.bind(g.querySelector("input, select"));
                    fs.appendChild(g);
                }
                detailsTab.appendChild(fs);
            }
        };

        injectConditionFieldsets();

        // status 選択を群(BS/戦闘不能/肉体/精神/社会)へグループ化する。
        // 描画後に option を動かすと <multi-select> が壊れる(2026-06-24 修正)。そこで Foundry の
        // ファクトリ createMultiSelectInput で optgroup 構成済みの要素を作って置換する。
        // 失敗時は既定の選択欄にフォールバック(絶対に壊さない)。変更時は statuses を即永続化(再注入で欄即出)。
        const persist = (el) => async () => {
            const v = el.value;
            const ids = Array.isArray(v) ? v : (v ? [v] : []);
            await app.document?.update({ statuses: ids });
        };
        let boundCtrl = statusCtrl;
        if (statusCtrl) {
            try {
                const groups = Object.values(CONDITION_GROUP_LABELS);
                const options = Object.entries(CONDITION_KINDS).map(([id, def]) => ({
                    value: id, label: def.label, group: CONDITION_GROUP_LABELS[def.group] ?? "",
                }));
                const grouped = foundry.applications.fields.createMultiSelectInput({
                    name: statusCtrl.getAttribute("name") || "statuses",
                    type: "multi", options, groups, value: [...(app.document?.statuses ?? [])],
                });
                statusCtrl.replaceWith(grouped);
                boundCtrl = grouped;
            } catch (e) {
                console.warn("Tokyo NOVA: status のグループ化に失敗、既定の選択欄を使用します。", e);
                boundCtrl = statusCtrl;
            }
            boundCtrl.addEventListener("change", persist(boundCtrl));
        }
    });

    // コンディション(BS)のステータスを外したら、その kind の効果値フラグを後始末する(フェーズ9-4)。
    // statuses から消えた kind の flags.tokyo-nova-axleration.conditions[<kind>] を削除する。
    // (AE 自体の削除時はフラグごと消えるため対象外。複数状態 AE から1つ外した場合などが対象。)
    Hooks.on("preUpdateActiveEffect", (effect, changes) => {
        if (!("statuses" in changes)) return;
        const perKind = effect.flags?.[SYSTEM_ID]?.conditions;
        if (!perKind) return;
        const next = new Set(changes.statuses ?? []);
        for (const kind of Object.keys(perKind)) {
            if (!next.has(kind)) changes[`flags.${SYSTEM_ID}.conditions.-=${kind}`] = null;
        }
    });

    // 状態カスケード(フェーズ9-4): inflicts を持つ状態(負傷等)が付与されたら、指定の別状態を自動付与する。
    // 付与する別状態は **状態のみ(changes なし=コンディション)** で、ダメージ/カスケード由来は
    // hideFromList=true で AE 本体をリスト非表示(状態アイコンは出る・供給元が浮かない)。
    // inflicts 先の状態は inflicts を持たないため循環しない。生成は付与した本人(userId)のみが行う。
    // 受けたシーンの刻印(17-2・神業の治癒): 状態(コンディション)は「どのアクトの何シーン目に受けたか」を
    // 持つ。《腹心》《人命救助》の「完全死亡・精神崩壊はそのシーンで受けたものしか」・《黄泉還り》の
    // 「そのシーン中に受けたダメージしか」を判定する材料。付与経路(ダメージ・カスケード・RL 任意付与・
    // 手動)を問わず生成時の一点で刻む。アクト外(actId 空)は番号だけになり、比較側は不明を通す
    Hooks.on("preCreateActiveEffect", (effect) => {
        if (!getConditionKinds(effect).length) return;
        if (effect.flags?.[SYSTEM_ID]?.receivedScene) return;
        const st = getSessionState();
        effect.updateSource({ [`flags.${SYSTEM_ID}.receivedScene`]: {
            act: st.actId || null, number: Number.isFinite(st.sceneNumber) ? st.sceneNumber : null,
        } });
    });
}
