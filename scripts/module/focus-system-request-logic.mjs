/**
 * @fileoverview 進行判定・支援判定の要求の純ロジック(フェーズ12-5・2026-07-20)。
 *
 * どちらも単発で閉じる判定なので、既存の判定要求機構(checkRequest)にそのまま乗せる。
 * - **進行判定**(ルール14): メインプロセスに、その手番のキャストが行う。技能・目標値は
 *   **有効行**から導出する。
 * - **支援判定**(ルール15): イニシアチブプロセスに、AR の残ったキャストが自由に行える
 *   (複数人可)。技能は `supportSkillKey`、**目標値は進行判定と同じ**(ルール5)＝有効行の目標値。
 *
 * AR 残量での絞り込みと、進行判定の宛先(手番のキャスト)の自動判別は**フェーズ13**。
 */

import { activeProgressRow } from "./focus-system-logic.mjs";

/**
 * 進行判定の要求内容。
 * @param {?object} fs 実行中 FS
 * @returns {?{identificationKey:string, targetValue:number, focusSystemId:string, kind:string}}
 */
export function buildProgressRequest(fs) {
    const row = activeProgressRow(fs?.rows, fs?.progress);
    if (!row) return null;
    return {
        identificationKey: row.skillKey ?? "",
        targetValue:       Number(row.targetValue) || 0,
        focusSystemId:     fs.id,
        kind:              "progress",
    };
}

/**
 * 支援判定の要求内容。目標値は有効行と同じ(ルール5)。
 *
 * 指定技能は**複数**持てる(2026-07-21・現物のシートの「支援判定」欄は自由記入)。
 * 旧データ(単数 `supportSkillKey`)も読める。
 *
 * @param {?object} fs 実行中 FS
 * @returns {?{identificationKeys:Array<string>, targetValue:number, focusSystemId:string, kind:string}}
 */
export function buildSupportRequest(fs) {
    const row = activeProgressRow(fs?.rows, fs?.progress);
    if (!row) return null;
    const keys = fs.supportSkillKeys ?? (fs.supportSkillKey ? [fs.supportSkillKey] : []);
    return {
        identificationKeys: [...keys],
        targetValue:        Number(row.targetValue) || 0,
        focusSystemId:      fs.id,
        kind:               "support",
    };
}
