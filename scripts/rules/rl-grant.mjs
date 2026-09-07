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

import { SYSTEM_ID } from "../constants.mjs";
import { CONDITION_KINDS, CONDITION_GROUP_LABELS } from "../module/conditions.mjs";
import { ATTACK_DAMAGE_TYPES } from "../data/item/helpers.mjs";

/** RL 任意ダメージで選べる種別(物理のみ)。表記は S/P/I/X そのものが正式。 */
export const RL_DAMAGE_TYPES = Object.freeze(
    Object.entries(ATTACK_DAMAGE_TYPES).map(([value, label]) => ({ value, label }))
);

/** ダメージの系統。付与ダイアログとアクトシートのプリセットで同じものを使う。 */
export const RL_DAMAGE_CATEGORIES = Object.freeze([
    { value: "physical", label: "肉体" },
    { value: "mental",   label: "精神" },
    { value: "social",   label: "社会" },
]);

/**
 * ダメージの決め方(2026-07-24 ユーザー確定)。RL 任意ダメージも命中確定後の「ダメージ算出前」
 * フェーズ(カバー等が使える)を挟み、そこから固定値かカードを出す通常算出かを選ぶ。
 */
export const RL_DAMAGE_MODES = Object.freeze([
    { value: "fixed", label: "固定ダメージ" },
    { value: "card",  label: "カードを出す（通常算出）" },
]);


/** ダメージ種別を解決する(物理のみ・既定 I・X 可・不正は I・非物理は空)。 */
function resolveDamageType(category, damageType) {
    return category === "physical"
        ? (RL_DAMAGE_TYPES.some(t => t.value === damageType) ? damageType : "I")
        : "";
}

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
 * @param {string}   [opts.damageType] ダメージ種別(物理のみ・S/P/I/X。既定は生身と同じ I)
 * @param {string}   [opts.note]   自由記述(軽減技能の可否などを伝える)
 * @returns {object} damageRoll フラグ
 */
export function buildRlDamageRollFlag({ targets = [], category, value, damageType = "", note = "" } = {}) {
    const amount = Math.max(0, Number(value) || 0);
    // 種別は対応防御力の引き先(defenceForType)。X は対応防御力が無く軽減なし＝「防護点で軽減できない
    // ダメージ」を表す手段(2026-07-20 裁定)。精神・社会に対応防御力の概念は無いので持たせない
    const type = resolveDamageType(category, damageType);
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
        damageType:       type,
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
 * RL 任意ダメージの「ダメージ算出前」中間カードのフラグを組み立てる(2026-07-24 ユーザー確定)。
 *
 * 攻撃カード(`attackCheck`)の器を流用する——命中確定後〜ダメージ算出前のフェーズ(カバー等の
 * 「算出直前」効果が使えるタイミング)を、RL 任意ダメージにも与えるため。判定は経由しないので
 * 対象は全員が命中確定(`state:"hit"`・`resolution:"none"`)で、判定に属する値(達成値・差分・
 * カード値・スート)は持たず、リアクション導線(`confrontation`)も出さない。RL 由来は `rlGrant`
 * マーカーで識別し、`renderAttackCard` は対象リスト・カバー導線・「ダメージカードを出す」ボタンを
 * そのまま描画する(非カバーの対象行クリックは confrontation 空で無操作)。
 *
 * カードモード×物理は基準値を攻撃力に載せる(＝攻撃力＋カードの通常算出)。精神・社会に攻撃力の
 * 概念は無いのでカードのみ(基準値は載せない)。固定モードは攻撃力を載せない(値はダメージ算出時に
 * `rlGrant.value` として素の値で乗る)。
 *
 * @param {object}   opts
 * @param {Array<{uuid:string,name:string}>} opts.targets 対象(0 体でも成立)
 * @param {string}   opts.category physical / mental / social
 * @param {number}   opts.value    固定モード=ダメージ値／カードモード×物理=基準値(攻撃力相当)
 * @param {string}   [opts.damageType] ダメージ種別(物理のみ・S/P/I/X。既定 I)
 * @param {string}   [opts.note]   自由記述(軽減技能の可否などを伝える・攻撃元名にも載る)
 * @param {string}   [opts.mode]   fixed / card(不正・未指定は fixed)
 * @returns {object} attackCheck フラグ
 */
export function buildRlDamageStagingFlag({ targets = [], category, value, damageType = "", note = "", mode = "fixed" } = {}) {
    const amount = Math.max(0, Number(value) || 0);
    const type = resolveDamageType(category, damageType);
    const resolvedMode = RL_DAMAGE_MODES.some(m => m.value === mode) ? mode : "fixed";
    // 攻撃力(基準値)はカードモード×物理のみ。固定・非物理は 0(固定値は算出時に rlGrant.value で乗る)
    const weaponAttack = resolvedMode === "card" && category === "physical" ? amount : 0;
    const noteText = String(note ?? "");
    return {
        isAttack:         true,
        attackerUuid:     null,           // RL(攻撃者を持たない)
        confrontation:    [],             // リアクション導線を出さない(命中確定)
        category,
        damageType:       type,
        weaponAttack,
        attackSourceName: noteText,       // カードモードの台帳「攻撃力(◯)」行のラベルに使う
        // 対象は全員が命中確定。フィールドは攻撃カードの対象行と同形(カバー付与・ダメージ対象展開の前提)
        targets: (targets ?? []).map(t => ({
            uuid: t.uuid, name: t.name,
            state: "hit", controlValue: 0, resolution: "none",
            reactionAchievement: null, diff: null, parryGuard: 0,
            reactionEstablished: false, selfDecision: null, reactions: [],
        })),
        state:            "resolved",     // fumble/miss/failed 以外＝カバー導線・ダメージボタンが出る
        damageRolled:     false,
        // 判定に属する値は持たない(判定表示なし・式の @diff/@achievement/@card も無い)
        achievement:      null,
        diff:             null,
        cardValue:        null,
        suit:             null,
        rlGrant:          { mode: resolvedMode, value: amount, damageType: type, note: noteText },
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
        flags:    { [SYSTEM_ID]: { conditionKind: kind, hideFromList: false } },
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

/**
 * 台帳に出す種別の表示(物理のみ)。どの防御力で軽減されるか(X なら軽減なし)が読めるようにする。
 * 攻撃由来のダメージカードでは攻撃力の行が種別を示すため、ここでは作らない(null)。
 * @param {?object} f damageRoll フラグ
 * @returns {?string}
 */
export function rlGrantTypeLabel(f) {
    if (!f?.rlGrant || f.category !== "physical") return null;
    return ATTACK_DAMAGE_TYPES[f.damageType] ?? null;
}
