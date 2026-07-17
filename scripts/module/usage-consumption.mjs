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
 *                   resource="uses"(使用回数=uses.spent。神業も同じ uses に一本化) / "ammo"(武器の残弾)。
 *   "actionRank"  - 実行アクターの AR(2026-07-12 ユーザー確定)。パリー等「AR を消費する」能力の
 *                   表現で、旧パリー専用の自動 AR−1 を置換=AR 消費もこの設定からのみ発生する。
 *                   **カット進行外は AR を消費できないため原則使用不可**(消費要求は進行外でも生きる・
 *                   支払えない=原則ブロック。チェックを外せば卓裁定で実行可)。
 *                   分身でも本体へ差し替えない(AR は実行アクター自身の戦闘リソース)。
 *   残弾は**負の量=回復**でリロード用途(タイミング: マイナー+残弾へのマイナス消費)を表現する。
 *
 * カウンター種別(kind): "uses"=uses.spent 加算(神業も同じ) / "ar"=actionRank.value 減算(アクター更新) /
 * "ammo"=ammo.current 増減(武器更新)。行の解決(resolveConsumeRows)は Foundry 非依存の純粋関数。
 * ダイアログ(promptConsumption)と適用(applyConsumptionPlan)のみ Foundry に依存する。
 *
 * 分身の使用回数共有(Troops.md): 分身アクターでの消費は、所有者参照から本体側の同一
 * 識別キーのアイテムへ解決を差し替える(resolveConsumeRows の getItem 差し替えで実現)。
 */

import { hasAmmoTracking, ammoRemaining, nextAmmoCurrent } from "./weapon-ammo.mjs";

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
        const resource = t.resource || "uses";
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
                type, kind: "ar", amount, itemId: "@ar", label: "AR",
                remaining: inCombat ? Math.max(0, actionRank.value ?? 0) : 0,
                maxDisplay: actionRank?.maxTotal ?? 0,
                outOfCombat: !inCombat,
            };
        }
        // type="item": itemId 空="このアイテム自身"(用途の親)・値=同アクター内アイテム
        const item = t.itemId ? (getItem?.(t.itemId) ?? null) : parentItem;
        if (!item) {
            return { type, amount, itemId: t.itemId ?? "", label: "(対象が見つかりません)", problem: "notFound" };
        }
        // 残弾: 武器の残弾を消費(正)/回復(負=リロード)。回復(負)は残量チェックの対象外
        if (resource === "ammo") {
            const ammo = item.system?.ammo;
            if (item.type !== "weapon" || !hasAmmoTracking(ammo)) {
                return { type, amount, itemId: item.id, label: item.name, problem: "noAmmo" };
            }
            return {
                type, kind: "ammo", amount, itemId: item.id, label: item.name,
                remaining: ammoRemaining(ammo),
                maxDisplay: Math.max(1, Number(ammo.value) || 0),
            };
        }
        // 使用回数(resource="uses"): 神業も汎用 uses に一本化(2026-07-18)=特例なし
        const u = item.system?.uses;
        if (u?.isLimit !== true) {
            return { type, amount, itemId: item.id, label: item.name, inert: true };
        }
        const max = u.max ?? 0;
        const remaining = Math.max(0, max - (u.spent ?? 0));
        return { type, kind: "uses", amount, itemId: item.id, label: item.name, remaining, maxDisplay: max };
    });
}

/**
 * 解決済み行から消費プラン(適用可能な平データ)を組む(Foundry 非依存)。
 * チェック済み(checkedIds に itemId が含まれる)の消費可能行のみ。残量不足はエラーを返す。
 * @param {Array<object>} rows resolveConsumeRows の結果
 * @param {Set<string>} checkedIds 消費に同意した行の itemId 集合
 * @param {string} fallbackActorId 行に targetActorId が無い場合のアクター ID
 * @returns {{plan: Array<{actorId:string,itemId:string,kind:string,amount:number}>}|{shortage: object}}
 */
export function buildConsumptionPlan(rows, checkedIds, fallbackActorId) {
    const plan = [];
    for (const row of rows) {
        if (row.inert || row.problem || !row.kind) continue;
        if (!checkedIds.has(row.itemId)) continue;
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
        noAmmo: "残弾管理のない武器です",
    };
    const htmlRows = [
        ...consumable.map(r => {
            const out = r.remaining < r.amount;
            const amountLabel = r.amount > 1 ? `×${r.amount}` : "";
            const sharedLabel = r.shared ? `（本体「${esc(r.sharedOwnerName)}」と共有）` : "";
            // AR 行は「使用回数」でなくアクターの AR を消費する文言にする。
            // カット進行外は消費不可(残量 0 扱い=原則ブロック)である旨を残量欄に示す。
            // 残弾は消費(正)/回復(負=リロード・2026-07-17)で文言を分ける
            const text = r.kind === "ar"
                ? `AR を消費${amountLabel || "×1"}`
                : r.kind === "ammo"
                    ? (r.amount < 0
                        ? `「${esc(r.label)}」の残弾を回復${r.amount < -1 ? `×${-r.amount}` : ""}`
                        : `「${esc(r.label)}」の残弾を消費${amountLabel}`)
                    : `「${esc(r.label)}」の使用回数を消費${amountLabel}${sharedLabel}`;
            const count = r.kind === "ar" && r.outOfCombat
                ? "カット進行外（消費不可）"
                : `残り ${r.remaining}/${r.maxDisplay}`;
            return `<div class="tnx-uses-row">
                <label>
                    <input type="checkbox" name="consume" value="${esc(r.itemId)}" checked>
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
            : `「${s.label}」の使用回数が足りません（残り ${s.remaining}・消費 ${s.amount}）。消費チェックを外すと実行できます。`);
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
        const updates = [];
        for (const row of rows) {
            if (row.kind === "ar") continue;
            const item = actor.items.get(row.itemId);
            if (!item) continue;
            if (row.kind === "ammo") {
                // 残弾: 正=消費・負=回復(リロード)。クランプは nextAmmoCurrent
                const next = nextAmmoCurrent(item.system?.ammo, row.amount);
                if (next !== undefined) updates.push({ _id: item.id, "system.ammo.current": next });
            } else {
                // 使用回数(神業も同じ uses・2026-07-18 一本化)。max は実効値(AE込み)でクランプ。
                // 負の消費数=回復(spent 減少)も許容するため 0〜max でクランプ
                const u = item.system.uses ?? {};
                if (u.isLimit !== true) continue;
                const nextSpent = Math.max(0, Math.min(u.max ?? 0, (u.spent ?? 0) + row.amount));
                updates.push({ _id: item.id, "system.uses.spent": nextSpent });
            }
        }
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    }
}
