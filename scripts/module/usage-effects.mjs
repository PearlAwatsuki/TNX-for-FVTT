/**
 * @fileoverview 用途の「適用される効果」を、用途解決時に**ターゲットしたキャラクター**へ付与する
 * (2026-07-10 ユーザー確定・正本 Usage_System.md「適用される効果」)。攻撃に限らず全用途が対象で、
 * 自己バフ(自分をターゲット)も表現できる。
 *
 * - **ターゲット**: 用途使用時の `game.user.targets`(数・種別は問わない=居るか居ないかだけで判断)。
 *   居なければ確認ダイアログ(自分を対象に続行/キャンセル)。キャンセルで用途を中止する。
 * - **付与**: 用途解決の結果カード(判定結果/攻撃/用途使用)に「効果を適用」ボタンを出し、
 *   **対象の所有者または RL(GM)** が押して付与する(ダメージ適用と同じ権限モデル・自動付与はしない)。
 *   付与＝供給元 AE を対象アクターに**複製して生成**(有効化)。
 * - 効果 `{itemId, effectId}` の itemId 空＝親アイテム。実データ(toObject)をカードのフラグに載せて運ぶ。
 */

import { TnxSocketHandler } from "./tnx-socket-handler.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 用途の effects({itemId, effectId})を、付与用の AE データ配列へ解決する。
 * itemId 空＝親アイテム(parentItem)。供給元アイテムから effect を引き、複製用データ(toObject)にする。
 * @param {Actor|null} actor 用途を使うアクター(組み合わせ技能・武器の解決に使う)
 * @param {Item|null} parentItem 用途の親アイテム(itemId 空の解決先)
 * @param {object} usage 用途エントリ
 * @returns {Array<{name:string, data:object}>}
 */
export function resolveUsageEffectData(actor, parentItem, usage) {
    const out = [];
    for (const ref of (usage?.effects ?? [])) {
        if (!ref?.effectId) continue;
        const host = (!ref.itemId || ref.itemId === parentItem?.id)
            ? parentItem
            : actor?.items?.get(ref.itemId);
        const eff = host?.effects?.get(ref.effectId);
        if (!eff) continue;
        const data = eff.toObject();
        delete data._id;
        data.disabled = false;   // 付与先で有効化
        data.transfer = false;   // アクターに直接乗る効果として付与(横断バフでない)
        // トークン演出(2026-07-11 ユーザー指摘): コアの浮遊テキスト(+効果名)は statuses/changes が
        // 無いと出ず、トークン上のアイコンは temporary(statuses あり or 持続時間あり)でないと出ない。
        // statuses が空の効果には付与マーカーの status を注入し、コアの標準演出を全クライアントで
        // 発火させる(CONFIG.statusEffects 未登録の id は HUD パレットには出ない=バッジ表示専用)
        if (!(data.statuses?.length)) data.statuses = ["tnx-applied"];
        out.push({ name: eff.name, data });
    }
    return out;
}

/**
 * 用途使用時にターゲットしたキャラクターを確定する。効果のある用途でのみ呼ぶ。
 * ターゲットが居れば全員(重複 uuid は畳む)、居なければ確認ダイアログ。
 * @param {Actor} actor 用途使用者(ノーターゲット時の既定対象=自分)
 * @returns {Promise<Array<{uuid:string, name:string}>|null>} null=キャンセル(用途中止)
 */
export async function captureUsageTargets(actor) {
    const targeted = [...(game.user?.targets ?? [])]
        .map(t => t?.actor)
        .filter(Boolean);
    if (targeted.length) {
        const byUuid = new Map(targeted.map(a => [a.uuid, { uuid: a.uuid, name: a.name }]));
        return [...byUuid.values()];
    }
    // ノーターゲット: 原則ターゲット必須のため確認を挟む(誤って未ターゲットで撃った事故を防ぐ)。
    // 続行を選べば自分自身が対象になる(自己バフ)。
    const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "ターゲット未選択" },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>効果を付与する対象がターゲットされていません。</p>`
            + `<p>「${foundry.utils.escapeHTML(actor?.name ?? "")}」自身を対象に付与して続行しますか？</p>`,
        yes: { label: "自分を対象に続行", icon: "fas fa-user-check" },
        no:  { label: "キャンセル", icon: "fas fa-times" },
        modal: true,
    });
    if (!proceed) return null;
    return actor ? [{ uuid: actor.uuid, name: actor.name }] : [];
}

/**
 * 用途の付与効果ペイロードを作る(結果カードのフラグに載せる形)。効果が無ければ null(何もしない)、
 * ノーターゲットでキャンセルされたら "cancel"(用途を中止)。
 * @returns {Promise<{effects:Array, targets:Array, applied:false}|null|"cancel">}
 */
export async function prepareUsageEffectPayload(actor, parentItem, usage) {
    const effects = resolveUsageEffectData(actor, parentItem, usage);
    if (!effects.length) return null;
    const targets = await captureUsageTargets(actor);
    if (targets === null) return "cancel";
    return { effects, targets, applied: false };
}

/**
 * 結果カード(判定結果/攻撃/用途使用)に「効果を適用」ボタン(または適用済み表示)を描画する。
 * `renderChatMessageHTML` フックから呼ぶ。フラグ `usageEffects` を持つカードにのみ効く。
 */
export function renderUsageEffectButton(message, html) {
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload?.effects?.length) return;

    // 効果の適用はフローの一番最後(2026-07-11 ユーザー確定)。攻撃(=ダメージフローを持つ)では
    // **ダメージ・チャットカードへの表示に一本化**する——攻撃カード側には一切出さない
    // (finalizeDamageRoll がペイロードをダメージカードへコピーし、そちらのフックで描画される)。
    const attackF = message.getFlag(SCOPE, "attackCheck");
    if (attackF) return;

    // 差し込み先: 既存のカード本文の末尾(専用の器があればそこ、無ければカード直下)
    const host = html.querySelector(".tnx-usage-effect-area")
        ?? html.querySelector(".tnx-check-result")
        ?? html.querySelector(".tnx-chat-card")
        ?? html;
    // 二重描画防止
    if (host.querySelector(".tnx-usage-effect-block")) return;

    const esc = foundry.utils.escapeHTML;
    const block = document.createElement("div");
    block.className = "tnx-usage-effect-block";
    const names = payload.effects.map(e => esc(e.name)).join("・");
    const targetNames = (payload.targets ?? []).map(t => esc(t.name)).join("・") || "（対象なし）";

    if (payload.applied) {
        block.innerHTML = `<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 効果を適用済み: ${names} → ${targetNames}</p>`;
        host.appendChild(block);
        return;
    }

    block.innerHTML = `<p class="tnx-usage-effect-note">付与効果: ${names} → ${targetNames}</p>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tnx-chat-btn";
    btn.textContent = "効果を適用";
    btn.addEventListener("click", () => applyUsageEffectsFromMessage(message));
    block.appendChild(btn);
    host.appendChild(block);
}

/**
 * カードの付与効果を対象へ適用する(対象所有者/GM のみ)。付与＝対象アクターへ AE を複製生成。
 * 完了後、カードを「適用済み」にする(権限が無ければ GM へソケット委譲)。
 */
export async function applyUsageEffectsFromMessage(message) {
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload?.effects?.length || payload.applied) return;

    let appliedAny = false;
    const denied = [];
    for (const t of (payload.targets ?? [])) {
        const resolved = await fromUuid(t.uuid).catch(() => null);
        const actor = resolved?.actor ?? resolved;
        if (!actor?.createEmbeddedDocuments) continue;
        if (!(game.user.isGM || actor.isOwner)) { denied.push(actor.name); continue; }
        await actor.createEmbeddedDocuments("ActiveEffect", payload.effects.map(e => e.data));
        appliedAny = true;
    }

    if (denied.length) {
        ui.notifications.warn(`「${denied.join("・")}」への効果付与は対象の操作者（か RL）が行います。`);
    }
    if (!appliedAny) return;
    // 適用の可視化は Foundry 標準のトークン演出に任せる(+効果名の浮遊テキスト・トークンのアイコン。
    // resolveUsageEffectData の statuses 注入で演出条件を満たす)。独自の通知・チャットカードは
    // 出さない(2026-07-11 ユーザー指摘で撤去)

    // カードを適用済みに(全対象へ付与済みとみなす。author/GM でなければ GM へ委譲)
    if (game.user.isGM || message.isAuthor) {
        await message.update({ [`flags.${SCOPE}.usageEffects.applied`]: true });
    } else {
        TnxSocketHandler.emitUsageEffectApplied(message.id);
    }
}
