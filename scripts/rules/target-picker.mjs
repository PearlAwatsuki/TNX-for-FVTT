/**
 * @fileoverview 対象選択リストの純ロジック(2026-07-21 ユーザー指示)。
 *
 * 判定要求・報酬点の配布・RL 任意ダメージ付与・RL 任意の状態/効果付与の4つで、
 * 対象の選び方を**同じ形式**に統一する。リストへの追加は「選択したアクター」「ターゲットした
 * アクター」「キャスト全員」「プレイヤーキャラクター全員」の4通りで、どれから入れても
 * 重複しない。並びは手動で入れ替えられる(表・リスト系 UI は既定で並び替え可能=TNX 標準)。
 *
 * 対象は `{uuid, actorId, name, img}` だけを持ち回る(アクターそのものを保持しない=削除時も落ちない)。
 */

/**
 * 対象1件の最小形へ落とす。`actorId` は収集時のアクター ID を保つ——トークン由来の uuid
 * (`Scene.x.Token.y.Actor.z`)は末尾がワールドのアクター ID とは限らないため、
 * uuid の末尾に頼らない(判定要求はアクター登録方式=ID で引く)。
 */
function toEntry(a) {
    return { uuid: a.uuid, actorId: a.id ?? a.actorId ?? "", name: a.name, img: a.img };
}

/**
 * 対象を追加する(重複は畳む)。どのボタンから入れても同じ結果になる。
 * @param {?Array<{uuid:string}>} list 現在のリスト
 * @param {?Array<{uuid:string,name:string,img:string}>} actors 追加するもの
 * @returns {Array} 新しいリスト(元は書き換えない)
 */
export function addTargets(list, actors) {
    const out = [...(list ?? [])];
    const seen = new Set(out.map(t => t.uuid));
    for (const a of (actors ?? [])) {
        if (!a?.uuid || seen.has(a.uuid)) continue;
        seen.add(a.uuid);
        out.push(toEntry(a));
    }
    return out;
}

/**
 * 対象を外す。
 * @param {?Array<{uuid:string}>} list
 * @param {string} uuid
 * @returns {Array} 新しいリスト(元は書き換えない)
 */
export function removeTarget(list, uuid) {
    return (list ?? []).filter(t => t.uuid !== uuid);
}

/**
 * 対象を手動で並び替える(グリップのドラッグ＆ドロップ)。
 * @param {?Array} list
 * @param {number} from
 * @param {number} to
 * @returns {Array} 新しいリスト(元は書き換えない)
 */
export function moveTarget(list, from, to) {
    const out = [...(list ?? [])];
    if (!Number.isInteger(from) || !Number.isInteger(to)) return out;
    if (from === to || !out[from] || !out[to]) return out;
    const [moved] = out.splice(from, 1);
    out.splice(to, 0, moved);
    return out;
}

/**
 * 判定要求カードの対象行(`{actorId, actorName}`)へ写す。
 * 判定要求はアクター登録方式(2026-07-19)で actorId を持つため、uuid から ID を取り出す。
 * @param {?Array<{uuid:string,name:string}>} list
 */
export function toCheckRequestTargets(list) {
    return (list ?? []).map(t => ({
        actorId:   t.actorId || String(t.uuid ?? "").split(".").pop(),
        actorName: t.name,
    }));
}
