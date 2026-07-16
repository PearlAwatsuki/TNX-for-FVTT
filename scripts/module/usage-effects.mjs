/**
 * @fileoverview 用途の「適用される効果」を、用途解決時に付与する
 * (2026-07-10 ユーザー確定・2026-07-13 再設計・正本 Usage_System.md「適用される効果」)。
 * 攻撃に限らず全用途が対象。
 *
 * - **付与先(AE 設定・flags.grantTarget)**: 「対象」(既定)=ターゲットしたキャラクターへ、
 *   結果カードの「効果を適用」ボタン(またはダメージ適用連動)で付与。「自分」=使用者へ、
 *   **用途解決時に即時自動付与**(代償デバフ等を後回しにしない。付与先選択のキャンセルは用途中止)。
 * - **着地(changes のキーで判断)**: アイテム狙いキー(素の system.<パス>/分類/識別キー)が
 *   1つでもあれば**アイテム着地**=付与先アクターの所持アイテムから選択して付与(候補はキーで絞る。
 *   1件なら無確認・0件は通知してスキップ)。それ以外は**アクター着地**(従来どおり)。混在は非対応。
 * - **ターゲット**: 用途使用時の `game.user.targets`(数・種別は問わない=居るか居ないかだけで判断)。
 *   居なければ確認ダイアログ(自分を対象に続行/キャンセル)。キャンセルで用途を中止する。
 *   付与先「対象」の効果が無ければターゲット確認自体を行わない。
 * - **付与**: 供給元 AE を複製して生成(有効化・flags.grantedFrom で由来を記録)。同一効果
 *   (flags.effectId)の既存付与が居れば**置き換えリフレッシュ**(重複可 stackable のみ並ぶ)。
 * - 効果 `{itemId, effectId}` の itemId 空＝親アイテム。実データ(toObject)をカードのフラグに載せて運ぶ。
 */

import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { resolveTargetRefsOrSelf } from "./target-resolution.mjs";
import { analyzeGrantLanding, itemGrantCandidates, rewriteGrantChangesForItem } from "../data/item/helpers.mjs";

const SCOPE = "tokyo-nova-axleration";

/**
 * 用途の effects({itemId, effectId})を、付与用のエントリ配列へ解決する。
 * itemId 空＝親アイテム(parentItem)。供給元アイテムから effect を引き、複製用データ(toObject)にする。
 * @param {Actor|null} actor 用途を使うアクター(組み合わせ技能・武器の解決に使う)
 * @param {Item|null} parentItem 用途の親アイテム(itemId 空の解決先)
 * @param {object} usage 用途エントリ
 * @returns {Array<{name:string, data:object, grantTarget:"target"|"self", landing:"actor"|"item"}>}
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
        data.transfer = false;   // 付与先に直接乗る一回性のインスタンス(自動転送の供給元にしない)
        // トークン演出(2026-07-11 ユーザー指摘): コアの浮遊テキスト(+効果名)は statuses/changes が
        // 無いと出ず、トークン上のアイコンは temporary(statuses あり or 持続時間あり)でないと出ない。
        // statuses が空の効果には付与マーカーの status を注入し、コアの標準演出を全クライアントで
        // 発火させる(CONFIG.statusEffects 未登録の id は HUD パレットには出ない=バッジ表示専用)
        if (!(data.statuses?.length)) data.statuses = ["tnx-applied"];
        // 由来と同一性(2026-07-13 再設計): grantedFrom=付与コピーの印(転送の供給元にならない)。
        // effectId=重複排除・置き換えリフレッシュの同一性(供給元に無ければ供給元 uuid を刻む)
        data.flags = data.flags ?? {};
        const f = data.flags[SCOPE] = { ...(data.flags[SCOPE] ?? {}) };
        f.grantedFrom = eff.uuid;
        if (!f.effectId) f.effectId = eff.uuid;
        delete f.applyToParent; // 付与コピーに準備先転送は無関係
        out.push({
            name: eff.name,
            data,
            grantTarget: eff.flags?.[SCOPE]?.grantTarget === "self" ? "self" : "target",
            landing: analyzeGrantLanding(data.changes),
        });
    }
    return out;
}

/**
 * 用途使用時にターゲットしたキャラクターを確定する。付与先「対象」の効果がある用途でのみ呼ぶ。
 * ターゲットが居れば全員(重複 uuid は畳む)、居なければ確認ダイアログ。
 * @param {Actor} actor 用途使用者(ノーターゲット時の既定対象=自分)
 * @returns {Promise<Array<{uuid:string, name:string}>|null>} null=キャンセル(用途中止)
 */
export async function captureUsageTargets(actor) {
    // ノーターゲット: 原則ターゲット必須のため確認を挟む(誤って未ターゲットで撃った事故を防ぐ)。
    // 続行を選べば自分自身が対象になる(自己バフ)。解決は target-resolution に一本化(2026-07-16)
    return resolveTargetRefsOrSelf(actor,
        "効果を付与する対象がターゲットされていません。",
        `「${foundry.utils.escapeHTML(actor?.name ?? "")}」自身を対象に付与して続行しますか？`);
}

/**
 * アイテム着地の付与先を選択する。候補1件は無確認でそのまま返す。
 * @param {Actor} actor 付与先アクター
 * @param {Item[]} candidates 候補(1件以上)
 * @param {string} effectName 効果名(ダイアログ表示用)
 * @returns {Promise<Item|null>} null=キャンセル
 */
async function pickGrantItem(actor, candidates, effectName) {
    if (candidates.length === 1) return candidates[0];
    const esc = foundry.utils.escapeHTML;
    const options = candidates
        .map(i => `<option value="${i.id}">${esc(i.name)}</option>`)
        .join("");
    const picked = await foundry.applications.api.DialogV2.prompt({
        window: { title: "効果の付与先" },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>「${esc(effectName)}」を付与するアイテムを選択（対象: ${esc(actor?.name ?? "")}）:</p>`
            + `<div class="form-group"><select name="itemId">${options}</select></div>`,
        ok: {
            label: "付与",
            icon: "fas fa-check",
            callback: (_event, button) => button.form.elements.itemId.value,
        },
        modal: true,
        rejectClose: false,
    });
    return picked ? actor.items.get(picked) ?? null : null;
}

/**
 * 付与コピーを生成する。同一効果(flags.effectId)の既存付与が居れば**置き換えリフレッシュ**
 * (2026-07-13 ユーザー承認=同一効果は重複しない一般原則の付与形)。stackable は常に新規に並ぶ。
 * @param {Document} doc 付与先(Actor または Item)
 * @param {object} data AE 生成データ
 */
async function createOrRefreshGrant(doc, data) {
    const f = data.flags?.[SCOPE] ?? {};
    if (f.effectId && f.stackable !== true) {
        const existing = doc.effects?.find(e => e.flags?.[SCOPE]?.effectId === f.effectId);
        if (existing) {
            await existing.update(foundry.utils.deepClone(data));
            return;
        }
    }
    await doc.createEmbeddedDocuments("ActiveEffect", [foundry.utils.deepClone(data)]);
}

/**
 * 1エントリを付与先アクター(またはそのアイテム)へ付与する。
 * @param {Actor} targetActor
 * @param {{name:string, data:object}} entry
 * @returns {Promise<true|"skip"|"cancel">} skip=候補なし(通知済み)・cancel=選択キャンセル
 */
async function grantUsageEffect(targetActor, entry) {
    const landing = analyzeGrantLanding(entry.data?.changes);
    if (landing === "item") {
        const candidates = itemGrantCandidates(targetActor?.items ?? [], entry.data?.changes);
        if (!candidates.length) {
            ui.notifications.warn(`「${entry.name}」の付与先になれるアイテムが「${targetActor?.name ?? ""}」にありません。`);
            return "skip";
        }
        const item = await pickGrantItem(targetActor, candidates, entry.name);
        if (!item) return "cancel";
        const data = { ...foundry.utils.deepClone(entry.data), changes: rewriteGrantChangesForItem(entry.data.changes) };
        await createOrRefreshGrant(item, data);
        ui.notifications.info(`「${entry.name}」を「${item.name}」に付与しました。`);
        return true;
    }
    await createOrRefreshGrant(targetActor, entry.data);
    return true;
}

/**
 * 用途の付与効果ペイロードを作る(結果カードのフラグに載せる形)。効果が無ければ null(何もしない)、
 * キャンセルされたら "cancel"(用途を中止)。付与先「自分」の効果はここで**即時付与**する。
 * @param {object} [options]
 * @param {Array<{uuid:string,name:string}>|null} [options.targetOverride] 対象を確定済みで渡す
 *   (非 null なら captureUsageTargets の確認を挟まずこの配列を対象にする)。リアクションで攻撃者を
 *   対象にする用途(リアクションの対象は「なし」=攻撃者へ返す・2026-07-15)。空配列=対象なし。
 * @returns {Promise<{effects:Array, targets:Array, applied:boolean, selfApplied?:string[]}|null|"cancel">}
 */
export async function prepareUsageEffectPayload(actor, parentItem, usage, { targetOverride = null } = {}) {
    const entries = resolveUsageEffectData(actor, parentItem, usage);
    if (!entries.length) return null;
    const selfEntries = entries.filter(e => e.grantTarget === "self");
    const targetEntries = entries.filter(e => e.grantTarget === "target");

    // 対象向けの効果があるときだけターゲットを確定する(自分向けのみなら確認は不要)。
    // targetOverride(リアクション=攻撃者)が渡されていれば確認を挟まずそれを対象にする。
    let targets = [];
    if (targetEntries.length) {
        if (targetOverride !== null) {
            targets = targetOverride;
        } else {
            targets = await captureUsageTargets(actor);
            if (targets === null) return "cancel";
        }
    }

    // 付与先「自分」: 用途解決時に即時付与(代償を後回しにしない)。付与先選択のキャンセルは用途中止
    for (const entry of selfEntries) {
        const r = await grantUsageEffect(actor, entry);
        if (r === "cancel") return "cancel";
    }
    const selfApplied = selfEntries.map(e => e.name);

    if (!targetEntries.length) {
        // 自分向けのみ: 適用済みカード表示(ボタンなし)として運ぶ
        return {
            effects: selfEntries.map(e => ({ name: e.name })),
            targets: actor ? [{ uuid: actor.uuid, name: actor.name }] : [],
            applied: true,
        };
    }
    return {
        effects: targetEntries.map(e => ({ name: e.name, data: e.data })),
        targets,
        applied: false,
        ...(selfApplied.length ? { selfApplied } : {}),
    };
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
    // 名前は「」で個別に囲う(名前自体が「・」を含みうるため区切りを明示・2026-07-15 ユーザー指摘)
    const names = payload.effects.map(e => `「${esc(e.name)}」`).join("・");
    const targetNames = (payload.targets ?? []).map(t => `「${esc(t.name)}」`).join("・") || "（対象なし）";
    // 付与先「自分」の効果は用途解決時に付与済み(2026-07-13 再設計)
    const selfNote = payload.selfApplied?.length
        ? `<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 自分へ付与済み: ${payload.selfApplied.map(n => `「${esc(n)}」`).join("・")}</p>`
        : "";

    if (payload.applied) {
        block.innerHTML = `${selfNote}<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 効果を適用済み: ${names} → ${targetNames}</p>`;
        host.appendChild(block);
        return;
    }

    // ダメージカードでは、効果はダメージ適用と**同時に自動付与**される(2026-07-12 ユーザー確定=
    // 押し順の順序依存を消す)。ダメージ適用に至る経路がある間はボタンを出さず予告のみ表示する。
    // 対象未選択(適用ボタンが出ない)・適用済みで効果だけ未適用(旧カード等)は手動ボタンを残す
    const damageF = message.getFlag(SCOPE, "damageRoll");
    if (damageF && (damageF.targets?.length ?? 0) > 0 && !damageF.applied) {
        block.innerHTML = `${selfNote}<p class="tnx-usage-effect-note">付与効果: ${names} → ${targetNames}（ダメージ適用と同時に付与されます）</p>`;
        host.appendChild(block);
        return;
    }

    block.innerHTML = `${selfNote}<p class="tnx-usage-effect-note">付与効果: ${names} → ${targetNames}</p>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tnx-chat-btn";
    btn.textContent = "効果を適用";
    btn.addEventListener("click", () => applyUsageEffectsFromMessage(message));
    block.appendChild(btn);
    host.appendChild(block);
}

/**
 * カードの付与効果を対象へ適用する(対象所有者/GM のみ)。付与＝対象アクター(アイテム着地なら
 * 選択したアイテム)へ AE を複製生成。完了後、カードを「適用済み」にする(権限が無ければ GM へ
 * ソケット委譲)。付与先選択をキャンセルした場合は適用済みにしない(ボタンが残り、やり直せる。
 * 既付与分は置き換えリフレッシュで二重にならない)。
 */
export async function applyUsageEffectsFromMessage(message) {
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload?.effects?.length || payload.applied) return;

    let appliedAny = false;
    let cancelled = false;
    const denied = [];
    for (const t of (payload.targets ?? [])) {
        const resolved = await fromUuid(t.uuid).catch(() => null);
        const actor = resolved?.actor ?? resolved;
        if (!actor?.createEmbeddedDocuments) continue;
        if (!(game.user.isGM || actor.isOwner)) { denied.push(actor.name); continue; }
        for (const e of payload.effects) {
            if (!e?.data) continue;
            const r = await grantUsageEffect(actor, e);
            if (r === "cancel") { cancelled = true; continue; }
            appliedAny = true; // skip(候補なし)も適用済み扱い(通知済み・再押下で解決しないため)
        }
    }

    if (denied.length) {
        ui.notifications.warn(`${denied.map(n => `「${n}」`).join("・")}への効果付与は対象の操作者（か RL）が行います。`);
    }
    if (cancelled || !appliedAny) return;
    // 適用の可視化は Foundry 標準のトークン演出に任せる(+効果名の浮遊テキスト・トークンのアイコン。
    // resolveUsageEffectData の statuses 注入で演出条件を満たす)。独自の通知・チャットカードは
    // 出さない(2026-07-11 ユーザー指摘で撤去)

    // カードを適用済みに(全対象へ付与済みとみなす。author/GM でなければ GM へ委譲)
    await TnxSocketHandler.applyMessagePatch(message, { applied: true }, "usageEffects");
}
