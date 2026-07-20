/**
 * @fileoverview 効果をその場で組むための下書き置き場(2026-07-21 設計確定)。
 *
 * ActiveEffect は Actor か Item の中にしか存在できないため、持ち主のいない効果
 * (RL のギミック)を**標準の効果シート**で組むには、置き場となるドキュメントが要る。
 * ここではシステムが持つ下書きアイテムを1つだけ用意し、その中で組ませて、出来上がった
 * データだけを取り出す(下書きの中身は毎回空に戻す)。
 *
 * 独自の効果エディタを作らないのは、変更キーの入力補助(注入 UI)が標準シートの
 * `renderActiveEffectConfig` に乗っているため——同じものを二重に作らない。
 *
 * 下書きアイテムはアイテムディレクトリから隠す(RL の目に触れる意味が無い)。
 */

const SCOPE = "tokyo-nova-axleration";
const SCRATCH_FLAG = "effectScratch";
const SCRATCH_NAME = "効果の下書き";

/** 下書きアイテム(無ければ作る)。GM のみが触る。 */
async function getScratchItem() {
    const found = game.items.find(i => i.getFlag(SCOPE, SCRATCH_FLAG) === true);
    if (found) return found;
    return Item.create({
        name: SCRATCH_NAME,
        type: "general",
        flags: { [SCOPE]: { [SCRATCH_FLAG]: true } },
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });
}

/** 下書きアイテムをアイテムディレクトリから隠す(ready で1回登録)。 */
export function registerEffectScratchHiding() {
    Hooks.on("renderItemDirectory", (_app, element) => {
        for (const item of game.items) {
            if (item.getFlag(SCOPE, SCRATCH_FLAG) !== true) continue;
            element.querySelector(`.directory-item[data-entry-id="${item.id}"]`)?.remove();
        }
    });
}

/**
 * 標準の効果シートを開いて効果を組ませ、出来上がったデータを返す。
 *
 * 「更新」を押した時点を確定とし、押さずに閉じたら取り消し(null)とする——
 * 注入 UI の保存もフォーム送信に乗っているため、送信＝確定で一貫する。
 *
 * @param {?object} [initial] 編集の下敷き(既存プリセットの再編集)。無ければ新規
 * @returns {Promise<?object>} 効果データ(取り消しなら null)
 */
export async function promptEffectData(initial = null) {
    const scratch = await getScratchItem();
    if (!scratch) {
        ui.notifications.error("効果の下書き置き場を用意できませんでした。");
        return null;
    }
    // 前回の残りを片づける(下書きは常に1件だけ)
    const stale = scratch.effects.map(e => e.id);
    if (stale.length) await scratch.deleteEmbeddedDocuments("ActiveEffect", stale);

    const base = initial
        ? foundry.utils.deepClone(initial)
        : { name: "新規効果", img: "icons/svg/aura.svg" };
    delete base._id;

    const [effect] = await scratch.createEmbeddedDocuments("ActiveEffect", [base]);
    if (!effect) return null;

    const data = await new Promise((resolve) => {
        let submitted = false;

        const onUpdate = (doc) => {
            if (doc.id === effect.id) submitted = true;
        };
        Hooks.on("updateActiveEffect", onUpdate);

        const sheet = effect.sheet;
        const close = sheet.close.bind(sheet);
        sheet.close = async (options) => {
            const result = await close(options);
            Hooks.off("updateActiveEffect", onUpdate);
            // 閉じた時点の最新を取る(送信していなければ取り消し)
            resolve(submitted ? scratch.effects.get(effect.id)?.toObject() ?? null : null);
            return result;
        };
        sheet.render({ force: true });
    });

    await scratch.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    if (!data) return null;

    delete data._id;
    delete data.origin;
    return data;
}
