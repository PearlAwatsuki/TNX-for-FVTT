/**
 * @fileoverview 報酬点の配布カードの純ロジック(フェーズ12・2026-07-20)。
 *
 * ルール上の「**前金**」(RL から依頼の対価として付与される)の実装
 * → [Bounty_Points.md]「RL による配布」。
 *
 * 着地は `system.bounty`(アクト中の増減分)で、`bountyBase`(外界点由来の基礎点)は変えない。
 * シートの ±1 ボタン・判定での消費・社会ダメージの報酬点軽減と同じ着地。
 * **負数も受け付ける**ので、没収を別の仕組みを作らずに同じ機構で表せる。
 */

/**
 * 配布カードのフラグデータを組み立てる。
 * @param {object} opts
 * @param {Array<{uuid:string,name:string}>} opts.targets
 * @param {number} opts.amount 点数(負数=没収)
 * @param {string} [opts.note] 記述(何の対価か)
 * @returns {{targets:Array, amount:number, note:string, received:object}}
 */
export function buildBountyGrantData({ targets = [], amount, note = "" } = {}) {
    return {
        targets: (targets ?? []).map(t => ({ uuid: t.uuid, name: t.name })),
        amount:  Math.trunc(Number(amount) || 0),
        note:    note ?? "",
        received: {},
    };
}

/**
 * 配布後の `system.bounty` を返す。
 *
 * 有効報酬点は `bountyBase + bounty` なので、没収は**有効報酬点が0を下回らないところで止まる**
 * (持っている以上は没収できない)。判定での消費が所持数を上限にしているのと同じ考え方。
 *
 * @param {{bountyBase?:number, bounty?:number, amount:number}} opts
 * @returns {number} 新しい system.bounty
 */
export function nextBountyValue({ bountyBase = 0, bounty = 0, amount = 0 } = {}) {
    const base    = Number(bountyBase) || 0;
    const current = Number(bounty) || 0;
    const delta   = Math.trunc(Number(amount) || 0);
    const next    = current + delta;
    return Math.max(next, -base);
}

/**
 * 受け取り済みとして記録した新しいフラグデータを返す(元のデータは書き換えない)。
 * @param {object} f 配布カードのフラグ
 * @param {string} uuid 対象アクターの uuid
 */
export function markBountyReceived(f, uuid) {
    return { ...f, received: { ...(f?.received ?? {}), [uuid]: true } };
}

/**
 * その対象が受け取り済みか(二重受け取りの防止)。
 * @param {object} f 配布カードのフラグ
 * @param {string} uuid 対象アクターの uuid
 */
export function isBountyReceived(f, uuid) {
    return (f?.received ?? {})[uuid] === true;
}
