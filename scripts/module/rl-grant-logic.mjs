/**
 * @fileoverview RL 任意付与の純ロジック(フェーズ12・正本 Damage_Rules.md「RL による任意のダメージ付与」)。
 *
 * 判定を経由せず RL がギミックとして与えるダメージ(罠・落下・爆発・環境ダメージ・
 * FS判定の敗北時処理)を、**既存のダメージカード以降のフローにそのまま合流**させる。
 * 軽減を通すかどうかの選択肢は持たない(2026-07-20 裁定): 防護点で軽減できないダメージは
 * **種別 X** で表現でき、軽減技能の可否は口頭ないし自由記述で伝えれば足りるため、
 * RL 専用の分岐を作らない。
 *
 * 状態(BS・戦闘不能)の任意付与は、対象アクターへ直接 AE を作る既存経路に乗る
 * (親ドキュメント＝アクター自身。供給元アイテムを持たない AE は既に正常な状態)。
 */

import { CONDITION_KINDS, CONDITION_GROUP_LABELS } from "./conditions.mjs";

const SCOPE = "tokyo-nova-axleration";

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
 * RL が任意付与できる状態の群。**負傷は含めない**——負傷はダメージチャートの出力であり、
 * 治療の目標値になる woundValue を伴う。RL が負傷を与えたいときはダメージ付与(T1)を通す。
 */
const GRANTABLE_GROUPS = Object.freeze(["bs", "incapacitation"]);

/**
 * RL が任意付与する状態の効果データを組み立てる(状態のみ・changes なし)。
 *
 * **効果値は埋めない**: 衰弱の数字・対象制御値、重圧の対象能力値は「引いて決まる」もので
 * あって選択ではない(→ Bad_Status.md)。付与後に createActiveEffect フックの
 * conditionNeedsDraw → postDrawPrompt が決定を受け付ける(付与経路を問わない既存機構)。
 * カスケード(inflicts)・制御判定による無効化・選択型負傷の技能選択も同フックが担う。
 *
 * ダメージ由来ではないため hideFromList は false(効果リストに出す=卓が見て編集・除去できる)。
 *
 * @param {string} kind CONDITION_KINDS のキー
 * @returns {?object} createEmbeddedDocuments("ActiveEffect", ...) 用のデータ(不可なら null)
 */
export function buildConditionGrantData(kind) {
    const def = CONDITION_KINDS[kind];
    if (!def || !GRANTABLE_GROUPS.includes(def.group)) return null;
    return {
        name:     def.label,
        img:      def.img ?? "icons/svg/aura.svg",
        statuses: [kind],
        changes:  [],
        flags:    { [SCOPE]: { conditionKind: kind, hideFromList: false } },
    };
}

/**
 * 付与できる状態の選択肢(グループ見出しつき)。表示は必ずラベル(内部キーの生値を出さない)。
 * @returns {Array<{group:string, label:string, kinds:Array<{kind:string,label:string}>}>}
 */
export function rlConditionChoices() {
    return GRANTABLE_GROUPS.map(group => ({
        group,
        label: CONDITION_GROUP_LABELS[group] ?? group,
        kinds: Object.entries(CONDITION_KINDS)
            .filter(([, def]) => def.group === group)
            .map(([kind, def]) => ({ kind, label: def.label })),
    }));
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
