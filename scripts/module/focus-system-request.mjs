/**
 * @fileoverview FS判定の進行判定・支援判定の要求(フェーズ12-5・2026-07-20)。
 *
 * 既存の判定要求機構(checkRequest)にそのまま乗せる。カードには FS の文脈(focusSystemId)を
 * 持たせ、フェーズ13 が結果を受け取って進行値へ反映できるようにする。
 *
 * **参加アクター＝コンバットトラッカーの登録者**(ルール13)。`Combat` / `Combatant` は
 * Foundry コアのドキュメントで、13 で作るのはトラッカー UI の上書きとプロセス進行であって
 * 参加者という概念自体ではない。したがって宛先の解決はこの時点で可能。
 */

import { postCheckRequest } from "./tnx-rl-request-app.mjs";
import { buildProgressRequest, buildSupportRequest } from "./focus-system-request-logic.mjs";
import { loadSkillEntries, SKILL_PACKS } from "./skill-dictionary.mjs";
import { formatSkillName } from "./identification.mjs";

/**
 * 参加アクターの候補。コンバットに登録されたキャストを既定とし、コンバットが無ければ
 * ワールドのキャストにフォールバックする。
 * @returns {Array<{actorId:string, actorName:string, inCombat:boolean}>}
 */
export function listParticipantCandidates() {
    const combatants = [...(game.combat?.combatants ?? [])]
        .map(c => c.actor)
        .filter(a => a?.type === "cast");
    const source = combatants.length ? combatants : game.actors.filter(a => a.type === "cast");
    return source.map(a => ({
        actorId:   a.id,
        actorName: a.name,
        inCombat:  combatants.some(c => c.id === a.id),
    }));
}

/** 識別キー → 〈技能名〉(未指定・未解決は「（指定なし）」)。 */
async function skillLabel(key) {
    if (!key) return "（指定なし）";
    const entries = await loadSkillEntries(SKILL_PACKS.general);
    const hit = entries.find(s => s.identificationKey === key);
    return hit?.name ? formatSkillName(hit.name) : key;
}

/**
 * 宛先を選ぶダイアログ。進行判定は**その手番のキャスト1名**(ルール14)なので単一選択、
 * 支援判定は AR の残ったキャストが自由に行える(ルール15)ので複数選択。
 * 手番の自動判別・AR 残量での絞り込みはフェーズ13。
 * @param {"progress"|"support"} kind
 * @returns {Promise<?Array<{actorId:string, actorName:string}>>}
 */
async function promptTargets(kind) {
    const candidates = listParticipantCandidates();
    if (!candidates.length) {
        ui.notifications.warn("参加できるキャストがいません。");
        return null;
    }
    const esc = foundry.utils.escapeHTML;
    const single = kind === "progress";
    const body = single
        ? `<div class="form-group"><label>メインプロセスを行うキャスト</label>
             <select name="actorId">${candidates.map(c => `<option value="${c.actorId}">${esc(c.actorName)}</option>`).join("")}</select>
           </div>`
        : `<div class="rl-targets-list">${candidates.map(c => `
             <label class="rl-check-label rl-player-row">
               <input type="checkbox" name="target_${c.actorId}" checked>
               <span class="rl-player-name">${esc(c.actorName)}</span>
             </label>`).join("")}</div>`;

    const res = await foundry.applications.api.DialogV2.wait({
        window: { title: single ? "進行判定を要求" : "支援判定を要求" },
        classes: ["tokyo-nova", "tnx-dialog", "tnx-rl-request"],
        position: { width: 360 },
        content: body,
        buttons: [
            { action: "ok", icon: "fas fa-paper-plane", label: "要求を送信", default: true,
              callback: (_e, _b, dialog) => {
                  const el = dialog.element;
                  if (single) {
                      const id = el.querySelector('[name="actorId"]')?.value ?? "";
                      return candidates.filter(c => c.actorId === id);
                  }
                  return candidates.filter(c => el.querySelector(`[name="target_${c.actorId}"]`)?.checked);
              } },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    if (!res?.length) return null;
    return res.map(c => ({ actorId: c.actorId, actorName: c.actorName }));
}

/**
 * 進行判定・支援判定の要求カードを投稿する。
 * @param {object} fs 実行中 FS
 * @param {"progress"|"support"} kind
 */
export async function requestFocusSystemCheck(fs, kind) {
    const req = kind === "progress" ? buildProgressRequest(fs) : buildSupportRequest(fs);
    if (!req) {
        ui.notifications.warn("この進行値で行える判定が設定されていません。");
        return;
    }
    const targets = await promptTargets(kind);
    if (!targets) return;

    await postCheckRequest({
        checkType:         "skillCheck",
        identificationKey: req.identificationKey,
        skillLabel:        await skillLabel(req.identificationKey),
        validSuits:        [],
        targetValue:       req.targetValue,
        description:       `${fs.name}（${kind === "progress" ? "進行判定" : "支援判定"}）`,
        targets,
        extra:             { focusSystemId: req.focusSystemId, focusSystemKind: req.kind },
    });
}
