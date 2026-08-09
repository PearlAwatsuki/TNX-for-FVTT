/**
 * @fileoverview 用途の消費先設定(consumeTargets)の解決・確認・適用(フェーズ11-6)。
 *
 * 消費の原則(2026-07-04 確定): 全ての使用回数消費は用途の消費先設定からのみ発生する。
 * 旧来の「親アイテムの自動消費」「コンボ参加技能の遠隔消費」(自動スキャン)は全廃——
 * 使用回数制限のある技能を組み合わせに参加させる場合は、その消費を用途に手動で設定する。
 * UI は D&D 5e の消費先(Consumption)設定を踏襲(行の追加/削除・消費量可変)。
 *
 * 消費先の種別(consumeTargets[].type・2026-07-18 再編):
 *   "item"        - アイテムの資源を消費。itemId 空="このアイテム自身"(用途の親)・値=同アクター内 Item ID。
 *                   resource="uses"(使用回数。神業も同じ) / "ammo"(残弾=射撃武器の弾数) /
 *                   "quantity"(個数=消費アイテム)。
 *   "actionRank"  - 実行アクターの AR(2026-07-12 ユーザー確定)。パリー等「AR を消費する」能力の
 *                   表現で、旧パリー専用の自動 AR−1 を置換=AR 消費もこの設定からのみ発生する。
 *                   **カット進行外は AR を消費できないため原則使用不可**(消費要求は進行外でも生きる・
 *                   支払えない=原則ブロック。チェックを外せば卓裁定で実行可)。
 *                   分身でも本体へ差し替えない(AR は実行アクター自身の戦闘リソース)。
 *   **負の量=回復**。リロード用途(タイミング: マイナー+残弾へのマイナス消費)はこれで表現する。
 *
 * アイテムの資源は**使用回数・残弾・個数の3つ**(2026-07-19 ユーザー裁定)。「武器を使用して攻撃する」で
 * 減る弾数と「アウトフィットを使用する」で減る使用回数はルール上まったく別の行為のため、
 * 1つの武器が両方の制限を同時に持ちうる(一度 uses へ一本化したが、この共存を落としていたため撤回)。
 * 個数(消費アイテム)も同じ枠組みで消費する(**自動消費は無い**——元々どこも減らしておらず、
 * 2026-07-19 に消費先として選べるようにした)。保持の形の違い(spent が増える/value が減る)は
 * ITEM_RESOURCES のアダプタに閉じ込め、解決も適用も一本の経路で扱う(分岐を二重に持たない)。
 *
 * カウンター種別(kind): "uses"/"ammo"/"quantity"=当該資源の増減 / "ar"=actionRank.value 減算。
 * 行の識別子(key)は `itemId:resource`——**同じアイテムの別資源が並びうる**ため itemId では
 * 一意にならない(チェックボックスの照合・適用の合流はすべて key 基準)。
 * 行の解決(resolveConsumeRows)は Foundry 非依存の純粋関数。
 * ダイアログ(promptConsumption)と適用(applyConsumptionPlan)のみ Foundry に依存する。
 *
 * 分身の使用回数共有(Troops.md): 分身アクターでの消費は、所有者参照から本体側の同一
 * 識別キーのアイテムへ解決を差し替える(resolveConsumeRows の getItem 差し替えで実現)。
 */

import { usesMaxTotalOf } from "../data/item/uses.mjs";

/**
 * 消費できるアイテム資源(2026-07-19)。使用回数・残弾・個数の3つ。
 * 資源ごとに保持の形が違う(使用回数/残弾は消費済み spent が増える・個数は残数 value が減る)ため、
 * **差分を読み書きのアダプタに閉じ込め**、解決も適用も一本の経路で扱う(分岐を二重に持たない)。
 *   enabled   … その資源を管理しているか(オフのアイテムへの消費行は無害な no-op)
 *   remaining … 現在の残量 / max … 表示上の最大値
 *   update    … 消費量 amount(正=消費・負=回復)を適用した後の更新オブジェクト(0〜max でクランプ)
 * @type {Record<string, {label: string, enabled: Function, remaining: Function, max: Function, update: Function}>}
 */
const ITEM_RESOURCES = {
    // 最大値は**数値も式も受ける**ため、素値でなく実効値(usesMaxTotalOf)を読む(2026-08-09)
    uses: {
        label:     "使用回数",
        enabled:   (sys) => sys?.uses?.isLimit === true,
        remaining: (sys) => Math.max(0, usesMaxTotalOf(sys) - (sys?.uses?.spent ?? 0)),
        max:       (sys) => usesMaxTotalOf(sys),
        update:    (sys, amount) => ({
            "system.uses.spent": clampCounter((sys?.uses?.spent ?? 0) + amount, usesMaxTotalOf(sys)),
        }),
    },
    ammo: {
        label:     "残弾",
        enabled:   (sys) => sys?.ammo?.isLimit === true,
        remaining: (sys) => Math.max(0, (sys?.ammo?.max ?? 0) - (sys?.ammo?.spent ?? 0)),
        max:       (sys) => sys?.ammo?.max ?? 0,
        update:    (sys, amount) => ({
            "system.ammo.spent": clampCounter((sys?.ammo?.spent ?? 0) + amount, sys?.ammo?.max ?? 0),
        }),
    },
    // 個数(消費アイテム・2026-07-19 ユーザー指示で消費先に追加)。使用回数/残弾と違い
    // **残数 value が直接減る**(常備化個数 max が上限)。自動消費は無く、増減はこの設定か手入力のみ。
    quantity: {
        label:     "個数",
        enabled:   (sys) => sys?.isConsumption === true,
        remaining: (sys) => Math.max(0, sys?.quantity?.value ?? 0),
        max:       (sys) => sys?.quantity?.max ?? 0,
        update:    (sys, amount) => ({
            "system.quantity.value": clampCounter((sys?.quantity?.value ?? 0) - amount, sys?.quantity?.max ?? 0),
        }),
    },
};

/** カウンターを 0〜max に収める(負の消費数=回復で max を超えないように)。 */
function clampCounter(next, max) {
    return Math.max(0, Math.min(max, next));
}

/** 消費先行の資源キー(未知の値は使用回数へ倒す)。 */
function resourceKeyOf(resource) {
    return ITEM_RESOURCES[resource] ? resource : "uses";
}

/**
 * 参加技能から消費行を導出する(Foundry 非依存・11-6 追補・2026-07-06 承認)。
 * 規則: 使用回数制限(isLimit)つきの参加技能それぞれ×1(親は type="parent")。
 * 旧・無条件の「親×1」既定行は全廃(2026-07-17 ユーザー指示「そもそもいらない」)——
 * 制限の無い親の行は実行時 no-op の飾りでしかなかった。
 * これは**設定欄への可視の入力補助**であり、実行時の消費の権威は consumeTargets のまま
 * (全廃した「実行時の隠れた自動スキャン」とは別物)。設定失念による消費漏れを防ぐ。
 * @param {string} parentItemId 親アイテムの ID
 * @param {Array<{id:string, system:object}>} skills 参加技能(親を含んでよい)
 * @returns {Array<{type:string, itemId:string, amount:number}>}
 */
export function deriveConsumeTargets(parentItemId, skills) {
    return (skills ?? [])
        .filter(s => s.system?.uses?.isLimit === true)
        .map(s => ({
            type: "item",
            itemId: s.id === parentItemId ? "" : s.id,  // 空="このアイテム自身"
            resource: "uses",
            amount: 1,
        }));
}

/**
 * 本体側の同一能力を照合する(Foundry 非依存)。
 * 識別キー一致(同タイプ)を優先し、キーが無い/一致しない場合は名前一致にフォールバックする
 * (分身は本体とほぼ同一データ＝同じ辞典由来のコピー同士が識別キーで結ばれる規約)。
 * @param {Array<{id:string,type:string,name:string,system:object}>} candidates 本体側アイテム
 * @param {{type:string,name:string,system:object}} item 分身側アイテム
 * @returns {object|null} 一致した本体側アイテム。無ければ null
 */
export function matchSharedItem(candidates, item) {
    const key = item?.system?.identificationKey ?? "";
    if (key) {
        const byKey = (candidates ?? []).find(c => c.type === item.type && (c.system?.identificationKey ?? "") === key);
        if (byKey) return byKey;
    }
    return (candidates ?? []).find(c => c.type === item?.type && c.name === item?.name) ?? null;
}

/**
 * 分身(所有者参照つき)なら本体アクターを返す。それ以外は null(Foundry 依存)。
 * @param {Actor|null} actor
 * @returns {Actor|null}
 */
export function resolveBunshinOwner(actor) {
    if (actor?.type !== "troop" || actor.system?.troopMode !== "bunshin") return null;
    const uuid = actor.system?.ownerActorRef?.uuid ?? "";
    if (!uuid) return null;
    try { return fromUuidSync(uuid) ?? null; } catch { return null; }
}

/**
 * 実行アクターに応じて消費先行を解決する(Foundry 依存)。
 * 分身は使用回数を自分で管理せず**本体側カウンターを唯一の正本として共有**する(Troops.md)——
 * 消費・残数表示とも本体側の同一能力(matchSharedItem)へ差し替え、行に targetActorId=本体を
 * 付与する(適用は buildConsumptionPlan が targetActorId を優先)。照合できない行は
 * 分身ローカルの消費にフォールバックする(共有が成立しない旨はダイアログ表示で分かる)。
 * @param {Actor} actor 実行アクター
 * @param {Item} parentItem 用途を持つアイテム
 * @param {Array<object>} targets 用途の consumeTargets
 * @returns {Array<object>} resolveConsumeRows と同形の行(共有行は shared/targetActorId 付き)
 */
export function resolveConsumeRowsForActor(actor, parentItem, targets) {
    // AR は実行アクター自身の戦闘リソース(分身でも本体へ差し替えない)
    const actionRank = actor?.system?.actionRank ?? null;
    const owner = resolveBunshinOwner(actor);
    if (!owner) {
        return resolveConsumeRows(targets, {
            parentItem,
            getItem: (id) => actor?.items.get(id) ?? null,
            actionRank,
        });
    }
    const ownerItems = owner.items.contents ?? [];
    const redirectedIds = new Set();
    const redirect = (localItem) => {
        if (!localItem) return null;
        const counterpart = matchSharedItem(ownerItems, localItem);
        if (counterpart) {
            redirectedIds.add(counterpart.id);
            return counterpart;
        }
        return localItem; // 本体に同一能力が無い場合はローカル消費にフォールバック
    };
    const rows = resolveConsumeRows(targets, {
        parentItem: redirect(parentItem),
        getItem: (id) => redirect(actor?.items.get(id) ?? null),
        actionRank,
    });
    for (const row of rows) {
        if (row.itemId && redirectedIds.has(row.itemId)) {
            row.targetActorId = owner.id;
            row.shared = true;
            row.sharedOwnerName = owner.name;
        }
    }
    return rows;
}

/**
 * 消費先設定の行を解決する(Foundry 非依存)。
 * @param {Array<{type?:string, itemId?:string, amount?:number}>} targets 用途の consumeTargets
 * @param {object} ctx
 * @param {{id:string, type:string, name:string, system:object}|null} ctx.parentItem 用途を持つアイテム
 * @param {(itemId:string) => ({id:string, type:string, name:string, system:object}|null|undefined)} ctx.getItem
 *        同アクター内のアイテム解決(分身共有ではここが本体側へ差し替わる)
 * @returns {Array<object>} 解決済み行。消費可能行は kind/remaining/maxDisplay を持つ。
 *          inert=true は無害な no-op(親に制限なし等)、problem は設定不備(消費されない)
 */
export function resolveConsumeRows(targets, { parentItem, getItem, actionRank = null }) {
    return (targets ?? []).map((t) => {
        const type = t.type || "item";
        const rawAmount = Number(t.amount);
        // 消費数はロックしない(2026-07-18 ユーザー確定): 0/負値(=回復・使用回数の回復も可)を許容。
        // 未設定(NaN)のみ 1。0 は実行時 no-op(適用で何も起きない)
        const amount = Number.isFinite(rawAmount) ? rawAmount : 1;
        // AR の消費(2026-07-12): 対象アイテムを持たない=実行アクターの actionRank.value を減らす。
        // カット進行外(inCombat でない)は AR を消費できない=残量 0 扱いで原則ブロック。
        // itemId はチェックボックス識別用のセンチネル(実アイテム ID と衝突しない)
        if (type === "actionRank") {
            const inCombat = actionRank?.inCombat === true;
            return {
                type, kind: "ar", amount, key: "@ar", itemId: "@ar", label: "AR",
                remaining: inCombat ? Math.max(0, actionRank.value ?? 0) : 0,
                maxDisplay: actionRank?.maxTotal ?? 0,
                outOfCombat: !inCombat,
            };
        }
        // 資源(2026-07-19): 使用回数(神業も同じ)/残弾。同型のため field 差し替えで解決する。
        // key は行の識別子——**同じアイテムの別資源が並びうる**ため itemId では一意にならない
        // (例: 射撃武器の攻撃用途が「残弾×1」と「使用回数×1」を同時に消費する)
        const resource = resourceKeyOf(t.resource);
        const res = ITEM_RESOURCES[resource];
        // type="item": itemId 空="このアイテム自身"(用途の親)・値=同アクター内アイテム
        const item = t.itemId ? (getItem?.(t.itemId) ?? null) : parentItem;
        if (!item) {
            return {
                type, amount, resource, key: `${t.itemId ?? ""}:${resource}`, itemId: t.itemId ?? "",
                label: "(対象が見つかりません)", problem: "notFound",
            };
        }
        const key = `${item.id}:${resource}`;
        // その資源を管理していないアイテム(使用回数制限なし・自動給弾・非消費アイテム)への
        // 消費行は無害な no-op として扱う(設定不備の警告は出さない=従来の inert と同じ)
        if (!res.enabled(item.system)) {
            return { type, amount, resource, key, itemId: item.id, label: item.name, inert: true };
        }
        return {
            type, kind: resource, amount, resource, key, itemId: item.id, label: item.name,
            resourceLabel: res.label,
            remaining: res.remaining(item.system),
            maxDisplay: res.max(item.system),
        };
    });
}

/**
 * 用途の消費リソースが枯渇して**使えない**かを判定する(Foundry 非依存・フェーズ13-6)。
 * カット進行トラッカーの自動スキップ判定で使う——「そのプロセスに使える用途があるか」の
 * 「使える」を、消費が払えるかで絞るため。
 *
 * 枯渇＝**限度のある資源**(kind を持つ消費可能行)で、正の消費量に対し残量が足りない行が一つでもある。
 * - 消費設定が無い(行が無い)＝枯渇でない(ユーザー厳命: リソース未設定の用途は含めない)。
 * - `inert`(使用回数制限なし)・`problem`(対象不明の設定不備)＝限度のある資源でないので含めない。
 * - 消費量 0/負値(no-op・回復)＝残量に関係なく枯渇でない。
 * @param {Array<object>|null|undefined} rows resolveConsumeRows(ForActor) の結果
 * @returns {boolean}
 */
export function isConsumptionDepleted(rows) {
    return (rows ?? []).some(r =>
        r && !r.inert && !r.problem && r.kind
        && (r.amount ?? 0) > 0 && (r.remaining ?? 0) < r.amount);
}

/**
 * 解決済み行から消費プラン(適用可能な平データ)を組む(Foundry 非依存)。
 * チェック済み(checkedKeys に行の key が含まれる)の消費可能行のみ。残量不足はエラーを返す。
 * **照合は key**(=`itemId:resource`)——同じアイテムの使用回数と残弾が並ぶ場合があり、
 * itemId で照合すると両方まとめてオン/オフされてしまう(2026-07-19 残弾の再導入で顕在化)。
 * @param {Array<object>} rows resolveConsumeRows の結果
 * @param {Set<string>} checkedKeys 消費に同意した行の key 集合
 * @param {string} fallbackActorId 行に targetActorId が無い場合のアクター ID
 * @returns {{plan: Array<{actorId:string,itemId:string,kind:string,amount:number}>}|{shortage: object}}
 */
export function buildConsumptionPlan(rows, checkedKeys, fallbackActorId) {
    const plan = [];
    for (const row of rows) {
        if (row.inert || row.problem || !row.kind) continue;
        if (!checkedKeys.has(row.key ?? row.itemId)) continue;
        if ((row.remaining ?? 0) < row.amount) return { shortage: row };
        plan.push({
            actorId: row.targetActorId ?? fallbackActorId,
            itemId:  row.itemId,
            kind:    row.kind,
            amount:  row.amount,
        });
    }
    return { plan };
}

/**
 * 消費確認ダイアログ(D&D 方式)。消費可能行が無ければダイアログを出さず空プランを返す。
 * 原則ブロック: チェック済みで残量不足の行があれば起動不可(チェックを外せば消費せず実行可)。
 * @param {Actor} actor 実行アクター
 * @param {Array<object>} rows resolveConsumeRows の結果
 * @param {{title?: string}} options
 * @returns {Promise<Array<object>|null>} 消費プラン(空=消費なし)。null=キャンセル/ブロック
 */
export async function promptConsumption(actor, rows, { title = "使用回数の消費" } = {}) {
    const consumable = (rows ?? []).filter(r => !r.inert && !r.problem && r.kind);
    const problems   = (rows ?? []).filter(r => r.problem);
    if (!consumable.length && !problems.length) return [];

    const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
    const PROBLEM_LABEL = {
        notFound: "対象が見つかりません",
    };
    const htmlRows = [
        ...consumable.map(r => {
            const out = r.remaining < r.amount;
            const amountLabel = r.amount > 1 ? `×${r.amount}` : "";
            const sharedLabel = r.shared ? `（本体「${esc(r.sharedOwnerName)}」と共有）` : "";
            // AR 行は資源名でなくアクターの AR を消費する文言にする。
            // カット進行外は消費不可(残量 0 扱い=原則ブロック)である旨を残量欄に示す。
            // 資源名は行が持つ(使用回数/残弾)。消費(正)/回復(負=リロード等)で文言を分ける
            const resLabel = esc(r.resourceLabel ?? "使用回数");
            const text = r.kind === "ar"
                ? `AR を消費${amountLabel || "×1"}`
                : r.amount < 0
                    ? `「${esc(r.label)}」の${resLabel}を回復${r.amount < -1 ? `×${-r.amount}` : ""}${sharedLabel}`
                    : `「${esc(r.label)}」の${resLabel}を消費${amountLabel}${sharedLabel}`;
            const count = r.kind === "ar" && r.outOfCombat
                ? "カット進行外（消費不可）"
                : `残り ${r.remaining}/${r.maxDisplay}`;
            return `<div class="tnx-uses-row">
                <label>
                    <input type="checkbox" name="consume" value="${esc(r.key ?? r.itemId)}" checked>
                    <span>${text}</span>
                </label>
                <span class="tnx-uses-count${out ? " tnx-uses-out" : ""}">${count}</span>
            </div>`;
        }),
        ...problems.map(r => `<div class="tnx-uses-row tnx-uses-problem">
            <span>「${esc(r.label)}」: ${PROBLEM_LABEL[r.problem] ?? "消費先を解決できません"}（消費されません）</span>
        </div>`),
    ].join("");

    const content = `<div class="tnx-uses-consume">
        <p class="tnx-uses-note">チェックを外すと消費せずに実行します。</p>
        ${htmlRows}
    </div>`;

    const result = await foundry.applications.api.DialogV2.wait({
        window:   { title },
        classes:  ["tokyo-nova", "tnx-dialog", "tnx-uses-dialog"],
        position: { width: 400 },
        content,
        buttons: [
            {
                action: "ok", icon: "fas fa-check", label: "実行する", default: true,
                callback: (_event, _button, dialog) =>
                    [...dialog.element.querySelectorAll('input[name="consume"]:checked')].map(cb => cb.value),
            },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    if (!result) return null;

    const built = buildConsumptionPlan(rows, new Set(result), actor?.id ?? "");
    if (built.shortage) {
        const s = built.shortage;
        ui.notifications.warn(s.kind === "ar"
            ? (s.outOfCombat
                ? "カット進行外のため AR を消費できません（AR を消費する能力はカット進行中にのみ使用できます）。消費チェックを外すと実行できます。"
                : `AR が足りません（残り ${s.remaining}・消費 ${s.amount}）。消費チェックを外すと実行できます。`)
            : `「${s.label}」の${s.resourceLabel ?? "使用回数"}が足りません（残り ${s.remaining}・消費 ${s.amount}）。消費チェックを外すと実行できます。`);
        return null;
    }
    return built.plan;
}

/**
 * 消費プランを適用する(残量は適用時点の値で再計算・クランプ)。
 * @param {Array<{actorId:string,itemId:string,kind:string,amount:number}>} plan
 */
export async function applyConsumptionPlan(plan) {
    if (!plan?.length) return;
    const byActor = new Map();
    for (const row of plan) {
        if (!byActor.has(row.actorId)) byActor.set(row.actorId, []);
        byActor.get(row.actorId).push(row);
    }
    for (const [actorId, rows] of byActor) {
        const actor = game.actors.get(actorId);
        if (!actor) continue;
        // AR の消費(kind="ar"・アクター更新。0 clamp=適用時点の値で再計算)
        const arAmount = rows.filter(r => r.kind === "ar").reduce((s, r) => s + (Number(r.amount) || 0), 0);
        if (arAmount > 0) {
            const v = actor.system.actionRank?.value ?? 0;
            await actor.update({ "system.actionRank.value": Math.max(0, v - arAmount) });
        }
        // 資源(使用回数/残弾/個数)は**アイテム×資源ごとに消費量を合算してから**一度だけ適用する。
        // 1アイテムに複数行が並びうる(同アイテムの残弾と使用回数・同じ資源の複数行)ため、
        // 行ごとに現在値から算出して push すると、後の行が前の行の結果を上書きしてしまう。
        const amountByItemResource = new Map();
        for (const row of rows) {
            if (row.kind === "ar") continue;
            const mapKey = `${row.itemId}:${resourceKeyOf(row.kind)}`;
            amountByItemResource.set(mapKey, (amountByItemResource.get(mapKey) ?? 0) + (Number(row.amount) || 0));
        }
        // 1アイテムの複数資源は1件の更新に合流させる(同一 _id を並べない)
        const updateById = new Map();
        for (const [mapKey, amount] of amountByItemResource) {
            const sep = mapKey.lastIndexOf(":");
            const item = actor.items.get(mapKey.slice(0, sep));
            if (!item) continue;
            const res = ITEM_RESOURCES[mapKey.slice(sep + 1)];
            // 管理していない資源は適用しない。max は実効値(AE込み)でクランプし、
            // 負の消費数=回復(リロード・個数の補充等)も 0〜max の範囲で許容する
            if (!res.enabled(item.system)) continue;
            const update = updateById.get(item.id) ?? { _id: item.id };
            Object.assign(update, res.update(item.system, amount));
            updateById.set(item.id, update);
        }
        if (updateById.size) await actor.updateEmbeddedDocuments("Item", [...updateById.values()]);
    }
}
