/**
 * @fileoverview RL 任意付与の純ロジック(フェーズ12・正本 Damage_Rules.md「RL による任意のダメージ付与」)。
 *
 * 判定を経由せず RL がギミックとして与えるダメージ(罠・落下・爆発・環境ダメージ・
 * FS判定の敗北時処理)を、**既存のダメージカード以降のフローにそのまま合流**させる。
 * 軽減を通すかどうかの選択肢は持たない(2026-07-20 裁定): 防護点で軽減できないダメージは
 * **種別 X** で表現でき、軽減技能の可否は口頭ないし自由記述で伝えれば足りるため、
 * RL 専用の分岐を作らない。
 */

/**
 * RL 任意ダメージの damageRoll フラグを組み立てる。
 * 攻撃由来のダメージカードと同じ形にすることで、描画・軽減ダイアログ・適用・権限委譲を
 * すべて既存の経路が担う。攻撃固有の要素(出したカード・攻撃力・攻撃元・スタン宣言・
 * 用途のダメージ修正)は持たない。
 *
 * リアクションが存在しないため受け値は 0・リアクション成立は false になる
 * (社会ダメージの報酬点軽減はリアクション成立がゲートのため起動しない=既存規約どおり)。
 *
 * @param {object}   opts
 * @param {Array<{uuid:string,name:string}>} opts.targets 対象(0 体でも成立)
 * @param {string}   opts.category physical / mental / social
 * @param {number}   opts.value    RL が指定するダメージ(負値・非数は 0)
 * @param {string}   [opts.note]   自由記述(軽減技能の可否などを伝える)
 * @returns {object} damageRoll フラグ
 */
export function buildRlDamageRollFlag({ targets = [], category, value, note = "" } = {}) {
    const amount = Math.max(0, Number(value) || 0);
    return {
        attackMessageId:  null,
        attackerUuid:     null,
        targets: (targets ?? []).map(t => ({
            uuid: t.uuid,
            name: t.name,
            parryGuard: 0,
            reactionEstablished: false,
        })),
        category,
        damageType:       "",
        attackPower:      0,
        damageBonuses:    [],
        mods:             [],
        attackSourceName: "",
        diff:             null,
        achievement:      null,
        cardValue:        null,
        cards:            [],
        manualMod:        0,
        stun:             false,
        rlGrant:          { value: amount, note: note ?? "" },
        applied:          false,
        appliedResult:    null,
    };
}

/**
 * RL 付与の値(攻撃側合計への寄与)。攻撃由来のダメージカードでは 0。
 * @param {?object} f damageRoll フラグ
 * @returns {number}
 */
export function rlGrantAmount(f) {
    return Math.max(0, Number(f?.rlGrant?.value) || 0);
}

/**
 * 台帳に出す RL 付与の行。攻撃由来のダメージカードでは行を作らない(null)。
 * ラベルには RL の自由記述を使う(空なら素の「ダメージ」)。
 * @param {?object} f damageRoll フラグ
 * @returns {?{label:string, value:number}}
 */
export function rlGrantLedgerRow(f) {
    if (!f?.rlGrant) return null;
    const note = String(f.rlGrant.note ?? "").trim();
    return { label: note ? `ダメージ（${note}）` : "ダメージ", value: rlGrantAmount(f) };
}
