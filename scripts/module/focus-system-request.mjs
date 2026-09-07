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
import { loadSkillEntries, SKILL_PACKS, formatDesignatedSkills } from "./skill-dictionary.mjs";
import { listActiveFocusSystems } from "./focus-system-state.mjs";

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
        ar:        Number(a.system?.actionRank?.value) || 0, // 支援=AR残量での絞り込み(ルール15・13-7③)
    }));
}

/**
 * 進行判定の宛先(ルール14)＝メインプロセスを行うキャスト(トラッカーの mainCombatantId のアクター)。
 * メインターン中でなければ空。
 * @param {Combat} [combat]
 * @returns {Array<{actorId:string, actorName:string}>}
 */
export function mainProcessTargets(combat = game.combat) {
    const actor = combat?.combatants?.get(combat?.mainCombatantId)?.actor;
    return actor?.type === "cast" ? [{ actorId: actor.id, actorName: actor.name }] : [];
}

/**
 * 支援判定の宛先(ルール13＋15)＝トラッカー登録キャストのうち AR の残った者。
 * @param {Combat} [combat]
 * @returns {Array<{actorId:string, actorName:string}>}
 */
export function arRemainingTargets(combat = game.combat) {
    return [...(combat?.combatants ?? [])]
        .map(c => c.actor)
        .filter(a => a?.type === "cast" && (Number(a.system?.actionRank?.value) || 0) >= 1)
        .map(a => ({ actorId: a.id, actorName: a.name }));
}

/**
 * 識別キーの列 → 指定技能の表示(**規則は全画面共通**＝`formatDesignatedSkills`・2026-08-15。
 * 登場判定・情報項目・判定要求と同じ書き方)。解決できるキーが無ければ「（指定なし）」。
 */
async function skillLabel(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    if (!list.length) return "（指定なし）";
    const entries = await loadSkillEntries(SKILL_PACKS.general);
    const nameByKey = new Map(entries.map(e => [e.identificationKey, e.name]));
    return formatDesignatedSkills(list, nameByKey) || "（指定なし）";
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
    // 既定の宛先を自動判別(13-7③④): 進行=メインプロセスのキャストを既定選択・支援=AR残の者を既定チェック
    const mainId = mainProcessTargets()[0]?.actorId ?? null;
    const body = single
        ? `<div class="form-group"><label>メインプロセスを行うキャスト</label>
             <select name="actorId">${candidates.map(c => `<option value="${c.actorId}"${c.actorId === mainId ? " selected" : ""}>${esc(c.actorName)}</option>`).join("")}</select>
           </div>`
        : `<div class="rl-targets-list">${candidates.map(c => `
             <label class="rl-check-label rl-player-row">
               <input type="checkbox" name="target_${c.actorId}"${c.ar >= 1 ? " checked" : ""}>
               <span class="rl-player-name">${esc(c.actorName)}${c.ar >= 1 ? "" : "（AR0）"}</span>
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
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
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
export async function requestFocusSystemCheck(fs, kind, { targets = null } = {}) {
    const req = kind === "progress" ? buildProgressRequest(fs) : buildSupportRequest(fs);
    if (!req) {
        ui.notifications.warn("この進行値で行える判定が設定されていません。");
        return;
    }
    // targets 明示(自動送信)ならプロンプトを挟まない。未指定(手動=パネルボタン)はダイアログで選ぶ
    const resolved = targets ?? await promptTargets(kind);
    if (!resolved?.length) return;

    // 進行判定・支援判定とも指定技能は複数ありうる(2026-07-21)
    const keys = req.identificationKeys ?? [];

    await postCheckRequest({
        checkType:          "skillCheck",
        identificationKeys: keys,
        skillLabel:         await skillLabel(keys),
        validSuits:        [],
        targetValue:       req.targetValue,
        description:       `${fs.name}（${kind === "progress" ? "進行判定" : "支援判定"}）`,
        targets:            resolved,
        extra:             { focusSystemId: req.focusSystemId, focusSystemKind: req.kind },
    });
}

/**
 * カット進行のプロセス開始で FS判定を自動送信する(13-7③④・カット進行への合流)。
 * - メインプロセス開始 → その手番のキャストへ進行判定を要求(各実行中 FS・ルール14)。
 * - イニシアチブプロセス開始 → AR の残った参加キャストへ支援判定を要求(各実行中 FS・ルール15)。
 * 境界イベントは GM 側発火のため GM で実行。有効行の無い FS・宛先の無いプロセスは静かにスキップ。
 * @param {Combat} combat
 * @param {"setup"|"initiative"|"main"|"cleanup"} phase
 */
export async function autoSendFocusChecks(combat, phase) {
    if (!game.user.isGM) return;
    const kind = phase === "main" ? "progress" : phase === "initiative" ? "support" : null;
    if (!kind) return;
    const targets = kind === "progress" ? mainProcessTargets(combat) : arRemainingTargets(combat);
    if (!targets.length) return;
    for (const fs of listActiveFocusSystems()) {
        const req = kind === "progress" ? buildProgressRequest(fs) : buildSupportRequest(fs);
        if (!req) continue; // 有効行が無い FS は自動送信では静かにスキップ(警告しない)
        await requestFocusSystemCheck(fs, kind, { targets });
    }
}
