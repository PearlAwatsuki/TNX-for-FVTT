/**
 * @fileoverview 攻撃フローの純ロジック(Foundry 非依存・テスト対象。フェーズ12-2)。
 * 正本: Damage_Rules.md(命中判定・目標値)・Combat_Flow.md(対決の比べ合い)・
 * Check_Rules.md「差分値」(達成値≥目標値で成功・差分値=達成値−目標値)。
 */

/**
 * 攻撃力の表記(アウトフィットの攻撃力表示 `_attackLabel` を踏襲: 種別+符号つき数値。
 * 例 "I+4"・種別なしは "+3")。「I0」「S5」のような連結表記にしない(2026-07-09 ユーザー指示)。
 * @param {string} damageType "S"|"P"|"I"|"X"|""
 * @param {number} value 攻撃力
 * @returns {string}
 */
export function formatAttackLabel(damageType, value) {
    const n = Number(value) || 0;
    const sign = n >= 0 ? `+${n}` : String(n);
    return `${damageType || ""}${sign}`;
}

/**
 * 複数武器の攻撃力合算とダメージ種別・FA 候補・表示名の解決(2026-07-09)。
 * 複数武器の攻撃力を合算する能力を表現する。攻撃力は全参照武器の合計。ダメージ種別は
 * override(usage.damageType)優先→単一/同一ならその種別→**別々なら先頭**(編集時に damageType で選択)。
 * **FA(フルオート)は自動加算せず**、FA 可能武器を faOptions として返す(ダメージ算出ダイアログで
 * 武器ごとに選択・選んだものの FA 値を合算=2026-07-09 ユーザー確定)。武器が無ければ生身(baseAttack)。
 * @param {Array<{itemId?:string, name:string, attackValue:number, damageType:string, isFullAuto:boolean, faValue:number, consumesAmmo?:boolean}>} weapons
 * @param {string} damageTypeOverride usage.damageType(空なら自動)
 * @param {{value?:number, damageType?:string}} baseAttack 生身攻撃(武器なし時)
 * @returns {{weaponAttack:number, damageType:string, attackSourceName:string, faOptions:Array<{itemId:string, name:string, faValue:number, consumesAmmo:boolean}>}}
 */
export function combineWeaponAttack(weapons, damageTypeOverride = "", baseAttack = {}) {
    const list = (weapons ?? []).filter(Boolean);
    if (!list.length) {
        return {
            weaponAttack:     Number(baseAttack.value) || 0,
            damageType:       damageTypeOverride || baseAttack.damageType || "I",
            attackSourceName: "生身",
            faOptions:        [],
        };
    }
    const weaponAttack = list.reduce((s, w) => s + (Number(w.attackValue) || 0), 0);
    const types = [...new Set(list.map(w => w.damageType).filter(Boolean))];
    const damageType = damageTypeOverride || (types.length === 1 ? types[0] : (types[0] || ""));
    const attackSourceName = list.map(w => w.name).join("＋");
    const faOptions = list
        .filter(w => w.isFullAuto)
        .map(w => ({ itemId: w.itemId ?? "", name: w.name, faValue: Number(w.faValue) || 0, consumesAmmo: w.consumesAmmo === true }));
    return { weaponAttack, damageType, attackSourceName, faOptions };
}

/**
 * リアクションなしの命中確定: 目標値=対象の制御値(出したスートに対応)。
 * 差分値は**命中(勝利)した場合にのみ**算出される(Check_Rules 2026-07-09 訂正・失敗時は null)。
 * @param {number} achievement 攻撃の達成値
 * @param {number} control     対象の対応制御値(実効値)
 * @returns {{hit: boolean, diff: number|null, targetValue: number}}
 */
export function resolveNoReaction(achievement, control) {
    const targetValue = Number(control) || 0;
    const margin = (Number(achievement) || 0) - targetValue;
    const hit = margin >= 0;
    return { hit, diff: hit ? margin : null, targetValue };
}

/**
 * 対決の命中確定: 相手のリアクション判定の達成値と比べる(Check_Rules 確定)。
 * **受動有利**: 攻撃(能動)側はリアクション(受動)側を**上回れば**命中し、**同値はリアクション側の勝利**
 * =攻撃側敗北(トーキョーN◎VA の対決は受動有利の原則。「目標値≥」の一般規約とは別＝相手の達成値は
 * 固定目標値でなく対決相手の値)。未満/同値は攻撃側敗北=その時点で攻撃終了(Combat_Flow)。
 * 差分値は勝利時のみ(敗北時は null)。
 * @param {number} attackAchievement
 * @param {number} reactionAchievement リアクション不成立(ファンブル/スート不一致)は 0 を渡す
 * @returns {{hit: boolean, diff: number|null, targetValue: number}}
 */
export function resolveOpposed(attackAchievement, reactionAchievement) {
    const targetValue = Number(reactionAchievement) || 0;
    const margin = (Number(attackAchievement) || 0) - targetValue;
    const hit = margin > 0;   // 受動有利: 同値(margin=0)はリアクション側の勝利=攻撃側敗北
    return { hit, diff: hit ? margin : null, targetValue };
}

// 旧 attackReactionModes(系統別のリアクション導線・2026-07-08)は廃止(2026-07-17 ユーザー確定):
// リアクション導線は役割検出でなく**対決欄**(手段行=リアクション用途タイプ・技能名行)から導出する。

/**
 * 再判定(置き換え着地・2026-07-14 ユーザー確定)後の攻撃カード状態を導く。
 * リアクションのやり直しはしない——解決済み(リアクション/制御値受けが済んでいる)なら
 * **保存済みの相手値**で成否・差分を再解決する。元がリアクション未実施の失敗(スート不一致/
 * ファンブル)や未解決(pending/open)なら、新しい結果から状態を導き直す(初回のリアクション機会は生きる)。
 * @param {{state:string, resolution:string|null, targetValue:number|null, reactionAchievement:number|null, targetUuid:string|null}} prev 元の攻撃フラグ
 * @param {{achievement:number, fumble:boolean, suitMismatch:boolean}} next 再判定の結果
 * @returns {{state:string, resolution:string|null, diff:number|null, targetValue?:number|null, reactionAchievement?:number|null, parryGuard?:number}}
 *   置き換え後の状態(仕切り直し時は targetValue/reactionAchievement/parryGuard も初期化して返す)
 */
export function resolveAttackRecheckState(prev, next) {
    // 新しい判定自体の失敗はリアクション以前に確定する
    if (next.fumble) return { state: "fumble", resolution: "fumble", diff: null };
    if (next.suitMismatch) return { state: "miss", resolution: "mismatch", diff: null };
    // 解決済み: 保存済みの相手値で再解決(リアクションはやり直さない)
    if (prev.state === "hit" || prev.state === "miss") {
        if (prev.resolution === "none") {
            const r = resolveNoReaction(next.achievement, prev.targetValue ?? 0);
            return { state: r.hit ? "hit" : "miss", resolution: "none", diff: r.diff };
        }
        if (prev.resolution === "dodge" || prev.resolution === "parry" || prev.resolution === "reaction") {
            const r = resolveOpposed(next.achievement, prev.reactionAchievement ?? 0);
            return { state: r.hit ? "hit" : "miss", resolution: prev.resolution, diff: r.diff };
        }
        // 元が mismatch/fumble 由来の失敗=リアクション未実施 → 下の仕切り直しへ
    }
    // 未解決(pending/open)・リアクション未実施の失敗: 新しい結果で仕切り直す
    return {
        state: prev.targetUuid ? "pending" : "open",
        resolution: null, diff: null,
        targetValue: null, reactionAchievement: null, parryGuard: 0,
    };
}
