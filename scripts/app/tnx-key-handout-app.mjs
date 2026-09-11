import { SYSTEM_ID } from "../constants.mjs";
import { keyHandoutData, getKeyHandoutRecord, canReadKeyHandout, canPublishKeyHandout,
    renderKeyHandoutCard, requestKeyHandoutPublication } from "../session/key-handouts.mjs";
import { renderHandoutCard } from "../session/handout-contact.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** コントロールパネルから開く、配布済みキーハンドアウト専用の閲覧アプリ。 */
export class TnxKeyHandoutApp extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(messageId, options = {}) {
        super({ ...options, id: `tnx-key-handout-${messageId}` });
        this.messageId = messageId;
    }
    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "tnx-key-handout"],
        window: { title: "キーハンドアウト", resizable: true }, position: { width: 560, height: 620 },
        actions: { publish: TnxKeyHandoutApp._onPublish },
    };
    static PARTS = { main: { template: `systems/${SYSTEM_ID}/templates/app/key-handout.hbs`, scrollable: [".key-handout-body"] } };
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const message = getKeyHandoutRecord(this.messageId);
        const d = keyHandoutData(message);
        if (!canReadKeyHandout(d, game.user)) return { ...context, allowed: false };
        return { ...context, allowed: true, content: await renderKeyHandoutCard(d.card),
            published: d.published, canPublish: canPublishKeyHandout(d, game.user) };
    }
    _onRender(context) {
        if (context.allowed) {
            const d = keyHandoutData(getKeyHandoutRecord(this.messageId));
            const message = game.messages.get(d?.messageId);
            if (message) renderHandoutCard(message, this.element);
        }
    }
    static async _onPublish() { await requestKeyHandoutPublication(getKeyHandoutRecord(this.messageId)); }
}
export function openKeyHandoutApp(messageId) {
    if (!canReadKeyHandout(keyHandoutData(getKeyHandoutRecord(messageId)), game.user)) return;
    const app = foundry.applications.instances.get(`tnx-key-handout-${messageId}`) ?? new TnxKeyHandoutApp(messageId);
    return app.render({ force: true });
}
