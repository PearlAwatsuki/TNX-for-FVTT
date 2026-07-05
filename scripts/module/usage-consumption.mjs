/**
 * @fileoverview 用途の消費先設定(consumeTargets)の解決・確認・適用(フェーズ11-6)。
 *
 * 消費の原則(2026-07-04 確定): 全ての使用回数消費は用途の消費先設定からのみ発生する。
 * 旧来の「親アイテムの自動消費」「コンボ参加技能の遠隔消費」(自動スキャン)は全廃——
 * 使用回数制限のある技能を組み合わせに参加させる場合は、その消費を用途に手動で設定する。
 * UI は D&D 5e の消費先(Consumption)設定を踏襲(行の追加/削除・消費量可変)。
 *
 * 消費先の種別(consumeTargets[].type):
 *   "parent"      - 親アイテム(用途を持つアイテム自身)の使用回数。親が神業なら usageCount を消費
 *   "itemUses"    - 同アクターの特定アイテムの使用回数(uses.isLimit のもの)
 *   "miracleUses" - 神業の使用回数(usageCount.value)
 *
 * カウンター種別(kind): "uses"=uses.spent 加算 / "miracleUses"=usageCount.value 減算。
 * 行の解決(resolveConsumeRows)は Foundry 非依存の純粋関数(テスト対象)。
 * ダイアログ(promptConsumption)と適用(applyConsumptionPlan)のみ Foundry に依存する。
 *
 * 分身の使用回数共有(Troops.md): 分身アクターでの消費は、所有者参照から本体側の同一
 * 識別キーのアイテムへ解決を差し替える(resolveConsumeRows の getItem 差し替えで実現)。
 */

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
    const owner = resolveBunshinOwner(actor);
    if (!owner) {
        return resolveConsumeRows(targets, {
            parentItem,
            getItem: (id) => actor?.items.get(id) ?? null,
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
export function resolveConsumeRows(targets, { parentItem, getItem }) {
    return (targets ?? []).map((t) => {
        const type = t.type || "parent";
        const amount = Math.max(1, Number(t.amount) || 1);
        const item = type === "parent" ? parentItem : (getItem?.(t.itemId ?? "") ?? null);
        if (!item) {
            return { type, amount, itemId: t.itemId ?? "", label: "(対象が見つかりません)", problem: "notFound" };
        }
        const isMiracle = item.type === "miracle";
        if (type === "miracleUses" && !isMiracle) {
            return { type, amount, itemId: item.id, label: item.name, problem: "notMiracle" };
        }
        const kind = (type === "miracleUses" || (type === "parent" && isMiracle)) ? "miracleUses" : "uses";

        if (kind === "uses") {
            const u = item.system?.uses;
            // 制限なしは no-op(親×1 の互換行が親に isLimit 無しでも従来同一=無消費になる要)
            if (u?.isLimit !== true) {
                return { type, amount, itemId: item.id, label: item.name, inert: true };
            }
            const max = u.max ?? 0;
            const remaining = Math.max(0, max - (u.spent ?? 0));
            return { type, kind, amount, itemId: item.id, label: item.name, remaining, maxDisplay: max };
        }

        const c = item.system?.usageCount ?? {};
        const remaining = Math.max(0, c.value ?? 0);
        const maxDisplay = (c.total ?? 0) + (c.mod ?? 0);
        return { type, kind, amount, itemId: item.id, label: item.name, remaining, maxDisplay };
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
    const PROBLEM_LABEL = { notFound: "対象が見つかりません", notMiracle: "対象が神業ではありません" };
    const htmlRows = [
        ...consumable.map(r => {
            const out = r.remaining < r.amount;
            const amountLabel = r.amount > 1 ? `×${r.amount}` : "";
            const sharedLabel = r.shared ? `（本体「${esc(r.sharedOwnerName)}」と共有）` : "";
            return `<div class="tnx-uses-row">
                <label>
                    <input type="checkbox" name="consume" value="${esc(r.itemId)}" checked>
                    <span>「${esc(r.label)}」の使用回数を消費${amountLabel}${sharedLabel}</span>
                </label>
                <span class="tnx-uses-count${out ? " tnx-uses-out" : ""}">残り ${r.remaining}/${r.maxDisplay}</span>
            </div>`;
        }),
        ...problems.map(r => `<div class="tnx-uses-row tnx-uses-problem">
            <span>「${esc(r.label)}」: ${PROBLEM_LABEL[r.problem] ?? "消費先を解決できません"}（消費されません）</span>
        </div>`),
    ].join("");

    const content = `<div class="tnx-uses-consume">
        <p class="tnx-uses-note">用途に設定された消費先です。チェックを外すと消費せずに実行します。</p>
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
        ui.notifications.warn(`「${built.shortage.label}」の使用回数が足りません（残り ${built.shortage.remaining}・消費 ${built.shortage.amount}）。消費チェックを外すと実行できます。`);
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
        const updates = [];
        for (const row of rows) {
            const item = actor.items.get(row.itemId);
            if (!item) continue;
            if (row.kind === "miracleUses") {
                const c = item.system.usageCount ?? {};
                updates.push({ _id: item.id, "system.usageCount.value": Math.max(0, (c.value ?? 0) - row.amount) });
            } else {
                const u = item.system.uses ?? {};
                if (u.isLimit !== true) continue;
                updates.push({ _id: item.id, "system.uses.spent": Math.min(u.max ?? 0, (u.spent ?? 0) + row.amount) });
            }
        }
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    }
}
