import { SYSTEM_ID, SOCKET_CHANNEL } from "../constants.mjs";
import { buildInfoCardData, withResolvedInfoSkillNames } from "../rules/session.mjs";
import { loadGeneralSkillNameByKey } from "../dictionary/skill-dictionary.mjs";
import { enrichInfoCardData } from "./reference-links.mjs";
import { updateInfoItems } from "../session/info-items.mjs";

const SELECTOR = "a.tnx-info-link";
const bound = new WeakSet();
const requests = new Map();

/** Foundry のテキストノード単位で解釈する。表示名だけを別書式にはしない。 */
export function infoLinkPattern() {
    return /@Info\[([A-Za-z0-9_-]+)\](?:\{([^{}\n]*)\})?/g;
}

function journalByUuid(uuid) {
    return game.journal?.find(j => j.uuid === uuid) ?? null;
}

/** 文脈のない記法を現在のアクトへ暗黙に結び付けない。 */
export function createInfoLink(match, { relativeTo } = {}) {
    const link = document.createElement("a");
    link.className = "tnx-info-link";
    link.href = "#";
    link.dataset.infoId = match[1];
    const journal = relativeTo?.documentName === "JournalEntry" ? relativeTo : relativeTo?.parent;
    link.dataset.infoJournal = journal?.documentName === "JournalEntry" ? journal.uuid : "";
    if (match[2]) link.dataset.infoLabel = match[2];
    // チャットへ保存する HTML に RL 専用の項目名を焼き込まない。
    link.textContent = match[2] || "情報";
    return link;
}

function resolveLink(link) {
    const journal = journalByUuid(link.dataset.infoJournal);
    const item = journal?.getFlag(SYSTEM_ID, "infoItems")?.find(i => i.id === link.dataset.infoId);
    return { journal, item };
}

function refreshLink(link) {
    const { item } = resolveLink(link);
    const name = !item ? "参照先不明" : (game.user.isGM || item.isPublic)
        ? (item.title || "情報") : "非公開の情報";
    const label = link.dataset.infoLabel || name;
    if (link.textContent !== label) link.textContent = label;
    link.classList.toggle("broken", !item);
    link.classList.toggle("tnx-info-link--hidden", !!item && !item.isPublic);
    link.setAttribute("aria-disabled", String(!item));
}

/** HUD と同じカードを、閲覧者の公開状態に従ってホバー時に作る。 */
export async function infoLinkTooltip(journal, item, { isGM = game.user.isGM } = {}) {
    if (!item) return { text: "参照先が見つかりません。" };
    if (!isGM && !item.isPublic) return { text: "未公開の情報項目・クリックで公開" };
    const resolved = withResolvedInfoSkillNames(item, await loadGeneralSkillNameByKey());
    const html = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/info-card.hbs",
        await enrichInfoCardData(buildInfoCardData(resolved), { relativeTo: journal }));
    return { html, cssClass: "tnx-info-card-tooltip" };
}

/** 公開済み項目の開示済み本文だけを確認。secret 部分は PL の参照元にならない。 */
export function hasDisclosedInfoLink(items, targetId) {
    return items.some(item => item.isPublic === true && (item.contents ?? []).some(content => {
        const texts = [content, ...(content.tiers ?? [])].filter(row => row.isDisclosed === true);
        return texts.some(row => {
            const root = document.createElement("div");
            root.innerHTML = row.text ?? "";
            root.querySelectorAll("section.secret:not(.revealed), script, style").forEach(el => el.remove());
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                if ([...walker.currentNode.textContent.matchAll(infoLinkPattern())].some(m => m[1] === targetId)) return true;
            }
            return false;
        });
    }));
}

/** RL 側で最新の台本を再検証し、項目の公開だけを適用する。 */
export async function publishInfoLink({ journalUuid, itemId, userId }) {
    if (game.users.activeGM?.id !== game.user.id) return "RLが接続していません。";
    const user = game.users.get(userId);
    const journal = journalByUuid(journalUuid);
    const state = game.settings.get(SYSTEM_ID, "sessionState");
    if (!user?.active || !journal || !state?.actStarted || state.actId !== journal.id) {
        return "上演中のアクトの情報項目だけを公開できます。";
    }
    let error = null;
    await updateInfoItems(journal, items => {
        const current = game.settings.get(SYSTEM_ID, "sessionState");
        if (!current?.actStarted || current.actId !== journal.id) {
            error = "アクトが切り替わったため公開できません。";
            return false;
        }
        const item = items.find(i => i.id === itemId);
        if (!item) { error = "参照先が見つかりません。"; return false; }
        if (!user.isGM && !hasDisclosedInfoLink(items, itemId)) {
            error = "開示済みの情報本文から参照できる項目だけを公開できます。";
            return false;
        }
        if (item.isPublic === true) return false;
        item.isPublic = true;
    });
    return error;
}

/** 既存のシステムソケットから呼ぶ。結果は要求したクライアントにだけ通知する。 */
export async function handleInfoLinkMessage(data) {
    if (data.type === "infoLinkResult") {
        if (data.userId !== game.user.id || !requests.has(data.requestId)) return;
        const { timer, resolve } = requests.get(data.requestId);
        clearTimeout(timer);
        requests.delete(data.requestId);
        resolve(data.error || null);
        return;
    }
    if (game.users.activeGM?.id !== game.user.id) return;
    let error;
    try { error = await publishInfoLink(data); }
    catch (err) { console.error("TNX | 情報項目の公開に失敗", err); error = "情報項目の公開に失敗しました。"; }
    game.socket.emit(SOCKET_CHANNEL, {
        type: "infoLinkResult", requestId: data.requestId, userId: data.userId, error,
    });
}

async function requestPublication(link) {
    const payload = { journalUuid: link.dataset.infoJournal, itemId: link.dataset.infoId, userId: game.user.id };
    if (!game.users.activeGM) return "RLが接続していないため公開できません。";
    if (game.users.activeGM.id === game.user.id) return publishInfoLink(payload);
    return new Promise(resolve => {
        const requestId = foundry.utils.randomID();
        const timer = setTimeout(() => {
            requests.delete(requestId);
            resolve("公開結果を確認できませんでした。RLの接続と項目の状態を確認してください。");
        }, 10000);
        requests.set(requestId, { timer, resolve });
        game.socket.emit(SOCKET_CHANNEL, { ...payload, type: "infoLinkPublish", requestId });
    });
}

/** HTML が DOM に入った時に配線。カードの入れ子はここでは展開しない。 */
export function bindInfoLinks(root) {
    const links = root.matches?.(SELECTOR) ? [root] : [...root.querySelectorAll(SELECTOR)];
    for (const link of links) {
        refreshLink(link);
        if (bound.has(link)) continue;
        bound.add(link);
        let generation = 0;
        const show = async () => {
            const ticket = ++generation;
            refreshLink(link);
            const { journal, item } = resolveLink(link);
            try {
                const options = await infoLinkTooltip(journal, item);
                if (ticket === generation && link.isConnected && resolveLink(link).item === item) {
                    game.tooltip.activate(link, options);
                }
            } catch (error) { console.error("TNX | 情報リンクの表示に失敗", error); }
        };
        const hide = () => {
            generation++;
            if (game.tooltip.element === link) game.tooltip.deactivate();
        };
        link.addEventListener("pointerenter", show);
        link.addEventListener("focus", show);
        link.addEventListener("pointerleave", hide);
        link.addEventListener("blur", hide);
        link.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            if (link.closest('[contenteditable="true"]') || link.dataset.pending) return;
            const { item } = resolveLink(link);
            if (!item) return void ui.notifications.warn("参照先が見つかりません。");
            if (item.isPublic) return;
            link.dataset.pending = "true";
            try {
                const error = await requestPublication(link);
                if (error) ui.notifications.warn(error);
                else ui.notifications.info("情報項目を公開しました。");
            } catch (error) {
                console.error("TNX | 情報項目の公開に失敗", error);
                ui.notifications.error("情報項目の公開に失敗しました。");
            } finally { delete link.dataset.pending; refreshLink(link); }
        });
    }
}

/** v13 のカスタム enricher と描画後コールバックを登録する。 */
export function registerInfoLinks() {
    CONFIG.TextEditor.enrichers.push({
        id: "tnx-info", pattern: infoLinkPattern(), enricher: createInfoLink, onRender: bindInfoLinks,
    });
    Hooks.on("updateJournalEntry", () => {
        if (game.tooltip.element?.matches(SELECTOR)) game.tooltip.deactivate();
        document.querySelectorAll(SELECTOR).forEach(refreshLink);
        // ロック済みのカードにも古い開示内容を残さない。
        document.querySelectorAll(".locked-tooltip.tnx-info-card-tooltip").forEach(el => game.tooltip.dismissLockedTooltip(el));
    });
}
