/**
 * @fileoverview ダメージ算出の純ロジック(Foundry 非依存・テスト対象。フェーズ12-3)。
 * 正本: Damage_Rules.md「ダメージ算出の共通構造」「算出の適用順序」。
 *
 * 順序(Damage_Rules「算出の適用順序」1〜6・2026-07-16 ユーザー裁定=KI-024):
 *   攻撃側合計 = ダメージカード + 攻撃力 + ダメージ修正（攻撃側の加算=手順2〜3）
 *   → 恒久軽減 = 防御力・受け値を減算（手順4。防御側の減算も「ダメージ算出」の内）
 *   → スタン/説得なら 10 上限（＝**ダメージ算出の一番最後**・恒久軽減の後）
 *   → 事後修正（modifyDamage・算出後〜適用前=キャップ後の値に効く）
 *   → 適用時の軽減（手動の状況軽減・社会の報酬点） → 最終ダメージ(下限0)
 *   チャート参照値 = min(最終ダメージ, 21)
 * - 攻撃力は物理のみ(精神・社会は攻撃力を持たない)。
 * - 防御力・受け値は AE を介さず直接引く。21 の頭打ちはチャート参照値のみ。
 * - スタン/説得の10上限は**恒久軽減を引いた後**(2026-07-16 裁定・KI-024 是正)。旧実装の
 *   「攻撃側合計を先に10上限→軽減」は防御力ぶんだけ過小になっていた(例: 合計18・防御5 →
 *   旧 5／正 10)。防御力が対象ごとに違うため、上限は対象ごとの算出に掛かる。
 * - 事後修正(modifyDamage)は「ダメージ算出後〜ダメージ適用前」＝10上限に含まれない
 *   (2026-07-16 ユーザー裁定。上限前に合算していた旧実装はバグ)。
 * ※「段」「参照段」は公式に無い Code の造語のため撤廃(2026-07-08 ユーザー指示)。UI 使用禁止。
 */

import { readFlag } from "../data/item/helpers.mjs";

/**
 * 種別ごとの防御力を集計する(戦闘タブの合計 combatDefenceTotal と同一・Foundry 非依存)。
 * 準備済み(または準備不要)の **armor/cyborg/vehicle** の defence(mode=value)を S/P/I 別に合算する。
 * 搭乗中(準備済み)ヴィークルの防御力も含む(2026-07-09 ユーザー確定)。戦闘タブと同じ値を
 * ダメージ算出でも使うため、装備防具から直接ではなくこの合計を用いる(2026-07-16 ユーザー指摘)。
 * @param {Iterable<{type:string, system:object}>} items アクターのアイテム(配列/Collection)
 * @returns {{S:number, P:number, I:number}}
 */
export function aggregateDefence(items) {
    const out = { S: 0, P: 0, I: 0 };
    for (const i of (items ?? [])) {
        if (i.type !== "armor" && i.type !== "cyborg" && i.type !== "vehicle") continue;
        const s = i.system ?? {};
        if (!(s.isPrepared || readFlag(s, "noPrepareRequired"))) continue;
        if (s.defence?.mode !== "value") continue;
        const d = s.defence;
        out.S += d.S_total ?? d.S_defence ?? 0;
        out.P += d.P_total ?? d.P_defence ?? 0;
        out.I += d.I_total ?? d.I_defence ?? 0;
    }
    return out;
}

/**
 * ダメージ種別に対応する防御力を返す(X=装甲無視は軽減なし=0・Damage_Rules)。
 * @param {{S:number,P:number,I:number}} defence
 * @param {string} damageType "S"|"P"|"I"|"X"|""
 * @returns {number}
 */
export function defenceForType(defence, damageType) {
    if (damageType === "S") return defence?.S ?? 0;
    if (damageType === "P") return defence?.P ?? 0;
    if (damageType === "I") return defence?.I ?? 0;
    return 0; // X(装甲無視)・未指定は対応防御力なし
}

/**
 * 最終ダメージとチャート参照値を算出する(Foundry 非依存)。
 * @param {object} p
 * @param {number} p.damageCard  ダメージカード(命中判定のカード数字)
 * @param {number} p.attackPower 攻撃力(物理のみ・精神/社会は0)
 * @param {number} p.modifier    ダメージ修正の合計(攻撃側の加算=手順2〜3)
 * @param {number} [p.mitigation] 恒久軽減の合計(防御力・受け値=手順4。10上限の**前**に引く)
 * @param {number} [p.postModifier] 事後修正の合計(modifyDamage・算出後〜適用前=10上限の後に乗る)
 * @param {number} [p.applyMitigation] 適用時の軽減の合計(手動の状況軽減・社会の報酬点=最後に引く)
 * @param {boolean} [p.stun]     スタン/説得(算出の一番最後=恒久軽減の後に10上限・2026-07-16 裁定)
 * @returns {{raw:number, calc:number, attack:number, final:number, stage:number, capped:boolean}}
 *   raw=攻撃側合計(カード+攻撃力+修正)、calc=恒久軽減＋10上限後(=算出の確定値)、
 *   attack=事後修正後、final=適用時軽減後(下限0)、stage=チャート参照値(min(final,21))、
 *   capped=10上限が効いたか(表示用)
 */
export function computeDamage({ damageCard = 0, attackPower = 0, modifier = 0, mitigation = 0, postModifier = 0, applyMitigation = 0, stun = false }) {
    const raw = (Number(damageCard) || 0) + (Number(attackPower) || 0) + (Number(modifier) || 0);
    // 恒久軽減(防御力・受け値)は算出の内(手順4)。スタン/説得の10上限はその後=算出の一番最後
    // (2026-07-16 ユーザー裁定・KI-024)。事後修正(算出後〜適用前)・適用時軽減はさらに後
    const afterMitigation = raw - (Number(mitigation) || 0);
    const capped = stun === true && afterMitigation > 10;
    const calc = capped ? 10 : afterMitigation;
    const attack = calc + (Number(postModifier) || 0);
    const final = Math.max(0, attack - (Number(applyMitigation) || 0));
    return { raw, calc, attack, final, stage: Math.min(final, 21), capped };
}
