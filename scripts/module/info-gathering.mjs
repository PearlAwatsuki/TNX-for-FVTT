/**
 * @fileoverview 情報収集判定(フェーズ14-9・正本 Scenario_Progress「情報収集判定の裁定」)。
 *
 * - 起動＝HUD の情報項目の判定ボタン(**項目に1つ**・2026-08-16 裁定)。技能行が複数ある項目は
 *   ダイアログで挑む行(技能＋目標値)を選ぶ。
 * - 技能の解決は判定要求の応答機構と共用(`resolveDesignatedSkillResponse`＝複数キー選択・
 *   所持技能の実解決・用途/コンボ候補・代用判定)。起動は唯一の起動関数 `_activateItemCheck`。
 * - **判定成功で自動開示**(RL 承認なし)・**達成値以下の目標値まで一括開示**・**回数制限なし**
 *   (2026-08-16 裁定)。開示の書き込みはアクトジャーナル(GM 所有)のため PL はソケット委譲。
 *   activeGM 不在では適用できないため PL に警告する(KI-042)。
 * - 開示の**実適用後**に GM 側が卓へ公開する(KI-042 是正・2026-08-25 ユーザー承認):
 *   ①結果カードへ帰結行「情報を開示した」を刻む(判定側では出さない=実適用と表示を一致させる)
 *   ②**今回新たに判明した分**の公開カードを送る(未開示の残りは目標値形式で下に併記)。
 *   どちらも新規開示があったときだけ(再判定の単調適用で重複しない)。
 * - 報酬点は使用可(2026-07-16 裁定＝情報収集は usesBounty 不問・消費時点の一元ゲートに乗る)。
 */

import { getSessionState, getActiveActJournal } from "./session-state.mjs";
import {
    withResolvedInfoSkillNames, infoCheckRows, discloseInfoByAchievement,
    newlyDisclosedInfo, buildInfoDiscloseCardData,
} from "./session-logic.mjs";
import { loadGeneralSkillNameByKey } from "./skill-dictionary.mjs";
import { resolveDesignatedSkillResponse } from "./tnx-rl-request-app.mjs";
import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { ALL_SUITS } from "./tnx-check-engine.mjs";

const SCOPE = "tokyo-nova-axleration";
const { DialogV2 } = foundry.applications.api;

/**
 * HUD の情報項目ボタンから情報収集判定を起動する。
 * 技能行が1つなら自動選択・複数ならダイアログで選ぶ(2026-08-16 裁定=ボタンは項目に1つ)。
 * @param {string} itemId 情報項目 id
 */
export async function startInfoGatheringCheck(itemId) {
    const st = getSessionState();
    if (!st.actStarted) return void ui.notifications.warn("アクトが開始されていません。");
    const actor = game.user.character;
    if (!actor) return void ui.notifications.warn("担当キャラクターが設定されていません。");
    const journal = getActiveActJournal();
    const raw = (journal?.getFlag(SCOPE, "infoItems") ?? []).find(i => i.id === itemId);
    if (!raw) return;

    const item = withResolvedInfoSkillNames(raw, await loadGeneralSkillNameByKey());
    const rows = infoCheckRows(item);
    if (!rows.length) return void ui.notifications.warn("この情報には挑める技能行がありません。");
    const title = String(item.title ?? "").trim() || "情報";
    const row = rows.length === 1 ? rows[0] : await promptInfoCheckRow(title, rows);
    if (!row) return;

    // 完了継続の文脈。entryTn=挑んだ行の目標値(入口本文の開示判定)・title=結果カードの表示
    const infoGathering = {
        actorId: actor.id, itemId, contentId: row.contentId,
        entryTn: row.tn ?? null, title,
    };

    if (row.keys.length) {
        const resolved = await resolveDesignatedSkillResponse(actor, row.keys);
        if (!resolved) return;
        const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
        const extra = { targetValue: row.tn ?? null, infoGathering };
        if (resolved.usageId) extra.usageId = resolved.usageId;
        if (resolved.substitution) {
            extra.substitution = resolved.substitution;
            extra.manualMod = resolved.manualMod;
        }
        await TnxCharacterSheetBase._activateItemCheck(actor, resolved.item, extra);
        return;
    }

    // 識別キーの無い行(旧い自由記述技能)は技能アイテムを起動できないため、判定要求の
    // 「技能名のみ要求」と同じ直接オープン(代用・組み合わせの裁定は卓)
    await TnxCheckFlow.open({
        type: "skillCheck",
        actorId: actor.id,
        skillIds: [],
        skillLabel: row.label,
        validSuits: [...ALL_SUITS],
        targetValue: row.tn ?? null,
        bountyAvailable: (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0),
        infoGathering,
    });
}

/**
 * 挑む技能行を選ぶ(技能行が複数ある項目のみ)。
 * @param {string} title 情報項目名
 * @param {Array<{label: string, tn: ?(number|string)}>} rows
 * @returns {Promise<?object>} 選ばれた行(null=キャンセル)
 */
async function promptInfoCheckRow(title, rows) {
    const esc = foundry.utils.escapeHTML;
    const options = rows.map((r, i) =>
        `<option value="${i}">${esc(r.label)}${r.tn ? `（目標値 ${esc(String(r.tn))}）` : ""}</option>`).join("");
    const res = await DialogV2.wait({
        window: { title: `情報収集判定: ${title}` },
        classes: ["tokyo-nova", "tnx-dialog"],
        position: { width: 400 },
        content: `<div class="form-group"><label>挑む技能</label><div class="form-fields"><select name="rowIndex">${options}</select></div></div>`,
        buttons: [
            { action: "ok", icon: "fas fa-diamond", label: "この技能で判定", default: true,
              callback: (_e, _b, dialog) => dialog.element.querySelector('[name="rowIndex"]')?.value ?? "" },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
    if (res === null || res === "") return null;
    return rows[Number(res)] ?? null;
}

/**
 * 情報収集判定の完了継続(判定者クライアントで走る)。**成功で自動開示**(2026-08-16 裁定)。
 * 再判定・事後修正の再実行にも使う——開示は開くだけで閉じない(単調)ため、達成値が伸びれば
 * 追加開示・下がっても既開示は維持される(冪等)。
 * @param {{itemId: string, contentId: string, entryTn: ?(number|string)}} cc 継続文脈
 * @param {{success: ?boolean, achievement: ?number}} result 判定結果
 * @param {{messageId?: ?string}} [args] messageId=結果カード(実適用後に帰結行を刻む宛先・KI-042)
 */
export async function resolveInfoGatheringFromCheck(cc, result, { messageId = null } = {}) {
    if (result?.success !== true) return;
    const payload = {
        itemId:      cc?.itemId ?? "",
        contentId:   cc?.contentId ?? "",
        entryTn:     cc?.entryTn ?? null,
        achievement: Number(result?.achievement) || 0,
        messageId:   messageId ?? null,
    };
    if (game.user.isGM) return void await applyInfoDisclosure(payload);
    // activeGM 不在では適用の代行者がおらず開示が消失する(KI-042)。判定はブロックせず、
    // 適用されない事実だけを判定者へ知らせる
    if (!game.users.activeGM) {
        return void ui.notifications.warn("RLが接続していないため、情報の開示は適用されません。");
    }
    TnxSocketHandler.emitInfoDisclose(payload);
}

/**
 * 開示の適用(GM クライアント)。達成値以下の目標値を持つ入口・段を一括で開き、**新規開示が
 * あったときだけ**卓へ公開する(帰結行の刻印+公開カード・KI-042 是正)。変化が無ければ何も
 * しない(再判定の単調適用=書き込みも通知も重複しない)。
 * @param {{itemId: string, contentId: string, entryTn?: ?(number|string), achievement: number,
 *          messageId?: ?string}} args messageId=帰結行を刻む結果カード
 */
export async function applyInfoDisclosure({ itemId, contentId, entryTn = null, achievement, messageId = null }) {
    const journal = getActiveActJournal();
    if (!journal) return;
    const items = foundry.utils.deepClone(journal.getFlag(SCOPE, "infoItems") ?? []);
    const item = items.find(i => i.id === itemId);
    const contents = item?.contents;
    const index = contents?.findIndex(c => c.id === contentId) ?? -1;
    if (index < 0) return;
    const before = contents[index];
    const after = discloseInfoByAchievement(before, { achievement, entryTn });
    const newly = newlyDisclosedInfo(before, after);
    if (!newly.entryOpened && !newly.tierIds.length) return;
    contents[index] = after;
    await journal.setFlag(SCOPE, "infoItems", items);
    await announceInfoDisclosure(item, contentId, newly, messageId);
}

/**
 * 開示の実適用を卓へ公開する(GM クライアント・KI-042 是正)。
 * ①結果カードへ帰結行「情報を開示した」を刻む——判定側は帰結行を出さないため、これが実適用の
 *   唯一の裏付け。挿入はマーカークラス(cr-info-outcome)で冪等、再判定の置き換え再構築のために
 *   `checkResult.infoDisclosed` フラグも立てる。
 * ②新たに判明した分の公開カードを送る(未開示の残りは目標値形式で併記・2026-08-25 ユーザー指示)。
 * @param {object} item 情報項目(開示適用後・識別キーは未解決の生データ)
 * @param {string} contentId 挑んだ内容(枝)の id
 * @param {{entryOpened: boolean, tierIds: Array<string>}} newly 開示の前後差分
 * @param {?string} messageId 結果カードの id(再判定経由などで無ければ帰結行はスキップ)
 */
async function announceInfoDisclosure(item, contentId, newly, messageId) {
    const message = messageId ? game.messages.get(messageId) : null;
    if (message) {
        const patch = { [`flags.${SCOPE}.checkResult.infoDisclosed`]: true };
        if (!message.content.includes("cr-info-outcome")) {
            const outcome = await foundry.applications.handlebars.renderTemplate(
                "systems/tokyo-nova-axleration/templates/chat/parts/info-disclose-outcome.hbs", {});
            const at = message.content.lastIndexOf("</div>");
            if (at >= 0) patch.content = message.content.slice(0, at) + outcome + message.content.slice(at);
        }
        await TnxSocketHandler.applyMessagePatch(message, patch);
    }

    const resolved = withResolvedInfoSkillNames(item, await loadGeneralSkillNameByKey());
    const data = buildInfoDiscloseCardData(resolved, contentId, newly);
    if (!data) return;
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/info-card.hbs", data);
    await ChatMessage.create({ content });
}
