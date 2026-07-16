/**
 * @fileoverview 攻撃の使用武器解決(2026-07-13 ユーザー確定)。
 *
 * **一本目の武器はアクターシート戦闘タブの「攻撃で使用」**(system.weaponRefs.attackItemId・
 * 空欄=生身)。**用途の weaponRefs(「使用武器の追加」)は2本目以降**(複数武器合算能力)の追加分。
 * 旧設計のスキーマコメント「シート設定は表示のみ・通常武器は用途に移管済み」は本裁定で上書き
 * された——攻撃フロー・用途シートの表示・射程「武器」の解決はすべてこの解決結果を使う。
 *
 * 生身書き換え(全身義体・生身変更装備)が「攻撃で使用」に選ばれている場合はそれを一本目として
 * 扱い、表記は戦闘タブと同じ「生身（名前）」。
 *
 * 射程: 武器の実効射程=最長(max 優先・max="none" の単一射程は min)。複数武器は最短を採用
 * (「※複数は最短」の既定)。**武器が無い(生身)・射程を持たない場合は至近(close)**
 * (「生身であったとしても生身の射程（当然至近）が読み取られてしかるべき」=ユーザー確定)。
 * 2026-07-16: 「近〜遠」等の幅が単一値に潰れて読めない問題への対応として幅解決
 * (resolveAttackRangeSpan)を追加。単一値解決はその上限と一致する(挙動不変)。
 */

import { readFlag } from "../data/item/helpers.mjs";

/** 射程の物理的な短さ順(tnx-usage-sheet の RANGE_PHYSICAL と同値・複数武器の最短採用に使用)。 */
const RANGE_ORDER = { close: 0, short: 1, middle: 2, long: 3, superLong: 4 };

/**
 * 攻撃の使用武器を解決する(一本目=シートの「攻撃で使用」・以降=用途の追加分。ID 重複は除去)。
 * @param {Actor|null} actor
 * @param {object} usage 用途エントリ(weaponRefs=追加分)
 * @param {Item|null} [parentItem] 用途の親アイテム(アクター未所持時の自己参照解決用)
 * @returns {Item[]}
 */
export function resolveAttackWeapons(actor, usage, parentItem = null) {
    const out = [];
    const seen = new Set();
    const push = (w) => {
        if (w && !seen.has(w.id)) { out.push(w); seen.add(w.id); }
    };
    const sheetId = actor?.system?.weaponRefs?.attackItemId || "";
    push(sheetId ? actor?.items.get(sheetId) : null);
    for (const r of (usage?.weaponRefs ?? [])) {
        if (!r?.itemId) continue;
        push(r.itemId === parentItem?.id ? parentItem : actor?.items.get(r.itemId));
    }
    return out;
}

/**
 * 使用武器の表示名(戦闘タブの表記に合わせる: 生身書き換え=「生身（名前）」)。
 * @param {{type?:string, name?:string, system?:object}} item
 * @returns {string}
 */
export function attackWeaponDisplayName(item) {
    const fleshChange = item?.system ? readFlag(item.system, "isFleshChange") : false;
    return (item?.type === "cyborg" || fleshChange) ? `生身（${item.name}）` : (item?.name ?? "");
}

/** RANGE_ORDER の逆引き(短さ順の射程キー配列)。 */
const RANGE_KEYS = Object.entries(RANGE_ORDER).sort((a, b) => a[1] - b[1]).map(([k]) => k);

/**
 * 使用武器群から射程「武器」の実体射程を**幅**({min,max})で解決する(純関数・2026-07-16)。
 * 各武器の幅=[range.min, range.max](max="none" は単点)。複数武器は幅の**交差**を採る
 * (下限=各下限の最長・上限=各実効射程の最短=従来の resolveAttackRangeValue と同値)。
 * 交差が成立しない組み合わせは従来どおり単点(最短実効)へフォールバックする。
 * 射程を持つ武器が無ければ**至近(close)の単点**=生身の射程。
 * @param {Array<{system?:{range?:{min?:string, max?:string}}}>} weapons
 * @returns {{min: string, max: string}} 射程キーの幅。max="none"=単点
 */
export function resolveAttackRangeSpan(weapons) {
    const spans = (weapons ?? [])
        .map(w => {
            const rg = w?.system?.range ?? {};
            const hiKey = rg.max && rg.max !== "none" ? rg.max : rg.min;
            if (!hiKey || hiKey === "none" || !(hiKey in RANGE_ORDER)) return null;
            const loKey = (rg.min && rg.min in RANGE_ORDER) ? rg.min : hiKey;
            return { lo: RANGE_ORDER[loKey], hi: RANGE_ORDER[hiKey] };
        })
        .filter(Boolean);
    if (!spans.length) return { min: "close", max: "none" }; // 生身(武器なし・射程なし)=至近
    const lo = Math.max(...spans.map(s => s.lo));
    const hi = Math.min(...spans.map(s => s.hi));
    // lo===hi は単点。lo>hi(交差なし)も従来の単点(最短実効=hi)へフォールバック
    if (lo >= hi) return { min: RANGE_KEYS[hi], max: "none" };
    return { min: RANGE_KEYS[lo], max: RANGE_KEYS[hi] };
}

/**
 * 使用武器群から射程「武器」の実体射程を単一値で解決する(純関数)。
 * 各武器の実効射程=最長(max 優先・max="none" は min)。複数は最短を採用。
 * 射程を持つ武器が無ければ**至近(close)**=生身の射程。
 * 幅表現(resolveAttackRangeSpan)の上限と常に一致する。
 * @param {Array<{system?:{range?:{min?:string, max?:string}}}>} weapons
 * @returns {string} 射程キー(close/short/middle/long/superLong)
 */
export function resolveAttackRangeValue(weapons) {
    const span = resolveAttackRangeSpan(weapons);
    return span.max !== "none" ? span.max : span.min;
}
