/**
 * @fileoverview コンディション(BS)の効果値をダイアログで任意編集する(2026-07-15 ユーザー確定)。
 *
 * カードを引く等の操作を経ずに、強度・対象能力値・対象・対象武器を手で決められる。主用途は
 * 「再判定で結果が確定した後、消えるはずでなかった BS を同じ効果で与え直す」こと。効果設定シート
 * を開かず、状態タブのバッジのコンテキストメニュー「効果を編集」からこのダイアログを開く。
 *
 * 保存先は他の設定経路と同じ `flags.tokyo-nova-axleration.conditions.<kind>`(readConditions が読む)。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { CONDITION_KINDS } from "./conditions.mjs";

const ABIL = { reason: "理性", passion: "感情", life: "生命", mundane: "外界" };

/**
 * BS の効果値編集ダイアログを開く。def が効果値フィールドを持たない BS(酩酊等)では何もしない。
 * @param {Actor} actor バッジの持ち主(対象武器=このアクターの武器・生身)
 * @param {ActiveEffect} effect 対象の効果
 * @param {string} kind CONDITION_KINDS のキー
 */
export async function openConditionEditDialog(actor, effect, kind) {
    const def = CONDITION_KINDS[kind];
    if (!def) return;
    const esc = foundry.utils.escapeHTML;
    const v = effect.getFlag(SYSTEM_ID, `conditions.${kind}`) ?? {};
    const groups = [];

    if (def.magnitudeField) {
        const label = (def.type === "computed" || def.type === "continuous") ? "強度 n" : "効果量";
        groups.push(`<div class="form-group"><label>${label}</label><div class="form-fields">`
            + `<input type="number" name="magnitude" value="${Number(v.magnitude ?? 0) || 0}" step="1"></div></div>`);
    }
    if (def.abilityField) {
        const cur = v.targetAbility ?? "";
        const opts = `<option value="" ${cur === "" ? "selected" : ""}>${def.abilityBlankLabel ?? "全制御値"}</option>`
            + Object.entries(ABIL).map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("");
        groups.push(`<div class="form-group"><label>対象能力値</label><div class="form-fields"><select name="targetAbility">${opts}</select></div></div>`);
    }
    if (def.targetField) {
        const cur = v.targetUuid ?? "";
        const actors = game.actors.filter(a => ["cast", "guest", "troop", "extra"].includes(a.type));
        const opts = `<option value="">（未選択）</option>`
            + actors.map(a => `<option value="${a.uuid}" ${a.uuid === cur ? "selected" : ""}>${esc(a.name)}</option>`).join("");
        groups.push(`<div class="form-group"><label>対象</label><div class="form-fields"><select name="targetUuid">${opts}</select></div></div>`);
    }
    if (def.weaponField) {
        const cur = v.targetWeapon ?? "";
        const weapons = actor.items.filter(i => i.type === "weapon");
        const opts = `<option value="" ${cur === "" ? "selected" : ""}>生身</option>`
            + weapons.map(i => `<option value="${i.id}" ${i.id === cur ? "selected" : ""}>${esc(i.name)}</option>`).join("");
        groups.push(`<div class="form-group"><label>対象武器</label><div class="form-fields"><select name="targetWeapon">${opts}</select></div></div>`);
    }
    if (!groups.length) return; // 効果値を持たない BS(固定値=編集項目なし)

    const result = await foundry.applications.api.DialogV2.wait({
        window: { title: `効果の編集: ${def.label}` },
        classes: ["tokyo-nova", "tnx-dialog"],
        position: { width: 360 },
        // 器は div にする。DialogV2 は本文を自前の <form> の中に描くため、ここで <form> を
        // 使うと入れ子フォームとしてパーサに落とされ、**クラスごと消える**＝
        // `.tnx-select-dialog`(ラベルを全幅で上に置く意匠)が一度も効いていなかった
        content: `<div class="tnx-select-dialog">${groups.join("")}</div>`,
        buttons: [
            {
                action: "ok", icon: "fas fa-check", label: "設定", default: true,
                callback: (_e, _b, dialog) => {
                    const form = dialog.element.querySelector("form");
                    const out = {};
                    const mag = form.querySelector('[name="magnitude"]');
                    if (mag) out.magnitude = Number(mag.value) || 0;
                    const ta = form.querySelector('[name="targetAbility"]');
                    if (ta) out.targetAbility = ta.value;
                    const tu = form.querySelector('[name="targetUuid"]');
                    if (tu) out.targetUuid = tu.value;
                    const tw = form.querySelector('[name="targetWeapon"]');
                    if (tw) out.targetWeapon = tw.value;
                    return out;
                },
            },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
        ],
        close: () => null,
    });
    if (!result) return;
    await effect.setFlag(SYSTEM_ID, `conditions.${kind}`, { ...v, ...result });
}
