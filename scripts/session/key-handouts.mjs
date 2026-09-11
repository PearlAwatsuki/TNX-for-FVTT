/** 原稿と配布済み記録はRL用アクト内に保存。チャットは通知とコネ受け取りに使う。 */
import { confirmDialog } from "../ui/tnx-dialog.mjs";
import { SYSTEM_ID, SOCKET_CHANNEL } from "../constants.mjs";
import { normalizeHandoutRow, buildHandoutCardData, handoutStyleDisplay, handoutDisplayTitle, handoutNumberOf } from "../rules/session.mjs";
import { loadSkillChoices, STYLE_PACK } from "../dictionary/skill-dictionary.mjs";
import { resolveHandoutContact } from "./handout-contact.mjs";

export const keyHandoutData = record => record?.data ?? record?.getFlag?.(SYSTEM_ID, "keyHandout") ?? null;
export function canReadKeyHandout(data, user) {
    return !!data && !!user && (user.isGM || data.published === true || data.userId === user.id);
}
export function canPublishKeyHandout(data, user) {
    return !!data && !!user && !data.published && (user.isGM || data.userId === user.id);
}
/** 原稿ではなく配布時の記録を取得。過渡版のチャット保存形式も読み取る。 */
export function findKeyHandoutRecord(actId, handoutId) {
    const act = game.journal.get(actId);
    let data = act?.getFlag(SYSTEM_ID, "keyHandoutDeliveries")?.[handoutId];
    if (!data) {
        const message = game.messages.find(m => {
            const d = keyHandoutData(m);
            return d?.actId === actId && d.handoutId === handoutId;
        });
        if (message) data = { ...keyHandoutData(message), messageId: message.id };
    }
    return data ? { id: `${actId}.${handoutId}`, data } : null;
}
export function getKeyHandoutRecord(id) {
    if (typeof id !== "string") return null;
    const [actId, handoutId] = id.split(".");
    return findKeyHandoutRecord(actId, handoutId);
}
/** PL側は閲覧を許された配布済みの内容だけを専用アプリへ渡す。 */
export function listKeyHandouts(actId) {
    const ids = new Set(Object.keys(game.journal.get(actId)?.getFlag(SYSTEM_ID, "keyHandoutDeliveries") ?? {}));
    for (const message of game.messages) {
        const d = keyHandoutData(message);
        if (d?.actId === actId) ids.add(d.handoutId);
    }
    return [...ids].map(id => findKeyHandoutRecord(actId, id))
        .filter(record => canReadKeyHandout(keyHandoutData(record), game.user));
}
async function saveKeyHandoutRecord(data) {
    const act = game.journal.get(data.actId);
    if (!act || !game.user.isGM) return;
    await act.setFlag(SYSTEM_ID, `keyHandoutDeliveries.${data.handoutId}`, data);
}
/** 編集用の初期値。ペルソナとは別の内容を持ち、PSは含めない。 */
export function keyHandoutFields(input = {}) {
    const fields = ["title", "recommendedStyle", "recommendedSuit", "actConnectionType", "actConnection",
        "actConnectionHandoutId", "actConnectionUuid", "content", "disclosure", "recommendedTiming"];
    const clean = Object.fromEntries(fields.map(k => [k, typeof input[k] === "string" ? input[k] : ""]));
    clean.actConnectionType = normalizeHandoutRow(clean).actConnectionType;
    return clean;
}

const distributing = new Set();
/** 初回配布はRLから本人とRLへの私信。配布内容と公開状態はアクトへ保存する。 */
export async function distributeKeyHandout(actId, handoutId) {
    if (!game.user.isGM) return;
    const lock = `${actId}:${handoutId}`;
    if (distributing.has(lock)) return;
    const existing = findKeyHandoutRecord(actId, handoutId);
    if (existing) { await saveKeyHandoutRecord(existing.data); return; }
    const act = game.journal.get(actId);
    if (!act?.getFlag(SYSTEM_ID, "useKeyHandouts")) return;
    const handouts = act.getFlag(SYSTEM_ID, "handouts") ?? [];
    const persona = handouts.find(h => h.id === handoutId);
    const user = game.users.get(persona?.userId);
    if (!user) return void ui.notifications.warn("ペルソナハンドアウトの対象ユーザーを設定してください。");
    const key = keyHandoutFields(persona.keyHandout);
    distributing.add(lock);
    try {
        const styles = await loadSkillChoices([STYLE_PACK]);
        const styleName = handoutStyleDisplay(key.recommendedStyle, styles);
        const contact = resolveHandoutContact(key, handouts);
        const card = { ...buildHandoutCardData(key, {
            title: handoutDisplayTitle(key, { number: handoutNumberOf(handouts, handoutId), styleName, label: "キーハンドアウト" }),
            styleName, playerName: user.character?.name ?? user.name, contactName: contact.contactName,
        }), typeLabel: "キーハンドアウト", isKeyHandout: true,
        disclosure: key.disclosure, recommendedTiming: key.recommendedTiming };
        const content = await renderKeyHandoutCard(card);
        const message = await ChatMessage.create({ content,
            whisper: [...new Set([user.id, ...game.users.filter(u => u.isGM).map(u => u.id)])],
            flags: { [SYSTEM_ID]: {
                keyHandout: { actId, handoutId, userId: user.id, published: false, card },
                handoutContact: { ...contact, userId: user.id, styleKey: key.recommendedStyle, granted: false },
            } },
        });
        await saveKeyHandoutRecord({ ...keyHandoutData(message), messageId: message.id });
        return message;
    } finally { distributing.delete(lock); }
}
/** カードと閲覧アプリで同じ表示部品を使う。 */
export async function renderKeyHandoutCard(card) {
    const enriched = { ...card };
    enriched.content = await foundry.applications.ux.TextEditor.enrichHTML(card.content ?? "", { async: true });
    return foundry.applications.handlebars.renderTemplate(`systems/${SYSTEM_ID}/templates/chat/handout-card.hbs`, enriched);
}
export async function requestKeyHandoutPublication(message) {
    if (!canPublishKeyHandout(keyHandoutData(message), game.user)) return;
    if (!game.user.isGM && !game.users.activeGM) return void ui.notifications.warn("公開するにはRLの接続が必要です。");
    if (!await confirmDialog({ title: "キーハンドアウトの公開", content: "<p>このキーハンドアウトを全員に公開しますか？</p>" })) return;
    if (game.user.isGM) return publishKeyHandout(message.id, game.user.id);
    game.socket.emit(SOCKET_CHANNEL, { type: "publishKeyHandout", messageId: message.id, userId: game.user.id });
}
const publishing = new Set();
/** 公開は配布済みの同じカードを全員へ見せる。原稿・PS・コネには変更を加えない。 */
export async function publishKeyHandout(messageId, userId) {
    if (!game.user.isGM || publishing.has(messageId)) return;
    const record = getKeyHandoutRecord(messageId);
    const d = keyHandoutData(record);
    if (!canPublishKeyHandout(d, game.users.get(userId))) return;
    publishing.add(messageId);
    try {
        await saveKeyHandoutRecord({ ...d, published: true });
        const message = game.messages.get(d.messageId);
        if (message) await message.update({ whisper: [], [`flags.${SYSTEM_ID}.keyHandout.published`]: true });
        else await ChatMessage.create({ content: await renderKeyHandoutCard(d.card) });
    } finally { publishing.delete(messageId); }
}

/** 担当変更時は配布済み記録の宛先を追随させる。 */
export async function syncKeyHandoutRecipients(act) {
    if (game.users.activeGM?.id !== game.user.id) return;
    const handouts = act.getFlag(SYSTEM_ID, "handouts") ?? [];
    for (const record of listKeyHandouts(act.id)) {
        const d = keyHandoutData(record);
        const persona = handouts.find(h => h.id === d.handoutId);
        if (!persona) continue;
        const userId = game.users.get(persona.userId)?.id ?? "";
        if (d.userId === userId) continue;
        await saveKeyHandoutRecord({ ...d, userId });
        const message = game.messages.get(d.messageId);
        if (!message) continue;
        const whisper = d.published ? [] : [...new Set([...(userId ? [userId] : []), ...game.users.filter(u => u.isGM).map(u => u.id)])];
        await message.update({ whisper, [`flags.${SYSTEM_ID}.keyHandout.userId`]: userId,
            [`flags.${SYSTEM_ID}.handoutContact.userId`]: userId });
    }
}
