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
 * 下書きアイテムは**組み立ての間だけ**存在する(組み上がったデータを取り出したら器ごと削除する)。
 * 保存先は呼び出し側であって器ではない——アクトの効果プリセットはジャーナルのフラグに効果データ
 * 本体を持つため、器を消してもプリセットは何も失わない。加えて、その短い在世中もアイテム
 * ディレクトリには出さない(RL の目に触れる意味が無い)。
 */

import { SYSTEM_ID } from "../constants.mjs";

const SCRATCH_FLAG = "effectScratch";
const SCRATCH_NAME = "効果の下書き";

/** 下書きアイテムか。 */
const isScratchItem = (item) => item.getFlag(SYSTEM_ID, SCRATCH_FLAG) === true;

/** 下書きアイテムを作る(組み立てのたびに作って、終わったら消す)。GM のみが触る。 */
async function createScratchItem() {
    return Item.create({
        name: SCRATCH_NAME,
        type: "general",
        flags: { [SYSTEM_ID]: { [SCRATCH_FLAG]: true } },
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    });
}

/**
 * 下書きアイテムをアイテムディレクトリから隠す(init で登録)。
 *
 * 登録が ready だと**サイドバーの初回描画に間に合わない**(`Game#initializeUI` は ready より
 * 前に走る)。置き忘れがロード直後だけ一覧に見える、という状態はこれが原因だった。
 */
export function registerEffectScratchHiding() {
    Hooks.on("renderItemDirectory", (_app, element) => {
        for (const item of game.items) {
            if (!isScratchItem(item)) continue;
            element.querySelector(`.directory-item[data-entry-id="${item.id}"]`)?.remove();
        }
    });
}

/**
 * 置き忘れた下書きアイテムを片づける(ready で1回)。
 *
 * 通常は組み立ての終わりに消えるので、残るのは効果シートを開いたままワールドを閉じた場合だけ。
 * 他の GM が今まさに組み立て中の器を巻き添えにしないよう、**自分が最後に触ったものだけ**を消す。
 */
export async function sweepEffectScratchItems() {
    if (!game.user.isGM) return;
    const ids = game.items
        .filter(i => isScratchItem(i) && i._stats?.lastModifiedBy === game.user.id)
        .map(i => i.id);
    if (ids.length) await Item.deleteDocuments(ids);
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
    const scratch = await createScratchItem();
    if (!scratch) {
        ui.notifications.error("効果の下書き置き場を用意できませんでした。");
        return null;
    }

    try {
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
        if (!data) return null;

        delete data._id;
        delete data.origin;
        return data;
    } finally {
        // 器はここで役目を終える(効果データは呼び出し側が保存する)。取り消し・例外でも必ず消す
        await scratch.delete();
    }
}
