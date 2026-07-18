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
 * @returns {Array<{name:string, data:object, grantTarget:"target"|"self",
 *   timing:"hit"|"damage", landing:"actor"|"item"}>}
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
            // 適用タイミング(2026-07-18): 攻撃フローでのみ意味を持つ。既定=ダメージ時(既存データ無移行)
            timing: eff.flags?.[SCOPE]?.grantTiming === "hit" ? "hit" : "damage",
            landing: analyzeGrantLanding(data.changes),
        });
    }
    return out;
}

/**
 * ペイロードの効果エントリを適用タイミングで二分する(2026-07-18)。timing 無し(旧カード互換)は
 * ダメージ時扱い。攻撃フロー専用——非攻撃用途はタイミング区分を持たず全効果を一括で扱う。
 * @param {Array<{timing?:string}>|null} effects ペイロードの効果エントリ
 * @returns {{hit:Array, damage:Array}}
 */
export function splitEffectsByTiming(effects) {
    const hit = [];
    const damage = [];
    for (const e of (effects ?? [])) (e?.timing === "hit" ? hit : damage).push(e);
    return { hit, damage };
}

/**
 * 対決判定カード(attackCheck フラグ持ち)での効果ブロックの出し分け(KI-028 是正・2026-07-18)。
 * - "attack": 攻撃。ボタンはダメージカードへ一本化(カード上は付与済みノートのみ)
 * - "button": 非攻撃対決の解決後(または終端状態)。結果カードと同じ手動ボタンを出す(適用判断は卓)
 * - "hide":   非攻撃対決の未解決。フロー終端(2026-07-11 確定)前なのでまだ出さない
 * @param {object|null} f attackCheck フラグ
 * @returns {"attack"|"button"|"hide"}
 */
export function attackCardEffectMode(f) {
    if (!f || f.isAttack !== false) return "attack";
    // 全体の終端状態: 対象ごとの解決が走らないまま終わる(fumble/miss=判定不成立・failed=対決敗北)
    if (["fumble", "miss", "failed"].includes(f.state)) return "button";
    if (f.openReaction) return f.openReaction.resolved === true ? "button" : "hide";
    return (f.targets ?? []).every(t => t?.state !== "pending") ? "button" : "hide";
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
 * 効果エントリ群を1アクターへ付与する。所有者/GM は直接、権限が無ければ GM へソケット委譲する
 * (命中時/ダメージ時の自動付与用・2026-07-18。手動ボタンの applyUsageEffectsFromMessage は
 * 従来どおり押下者の権限で付与し、権限が無い対象は警告する)。
 * @param {Actor} actor 付与先
 * @param {Array<{name:string, data:object}>} entries 付与する効果(データ持ちのみ)
 */
async function grantEntriesToActor(actor, entries) {
    if (!actor?.createEmbeddedDocuments || !entries?.length) return;
    if (game.user.isGM || actor.isOwner) {
        for (const e of entries) await grantUsageEffect(actor, e);
    } else {
        TnxSocketHandler.emitUsageEffectGrant({ targetUuid: actor.uuid, entries });
    }
}

/**
 * 命中時効果(timing="hit")を、命中が確定した対象へ自動付与する(2026-07-18)。
 * 攻撃カードの投稿(非対決の即時解決)・リアクション解決・再判定の置き換えで、対象が hit へ
 * **遷移した**ときに呼ぶ(遷移トリガー＝newlyHitTargets。ダメージカードの有無に依存しない)。
 * 付与した対象は usageEffects.hitGranted に記録し、攻撃カードの付与済みノートに使う。
 * @param {ChatMessage} attackMessage 攻撃カード
 * @param {Array<{uuid:string, name:string}>} targetRefs hit へ遷移した対象
 */
export async function grantHitTimedEffects(attackMessage, targetRefs) {
    const payload = attackMessage?.getFlag(SCOPE, "usageEffects");
    const entries = splitEffectsByTiming(payload?.effects).hit.filter(e => e?.data);
    if (!entries.length || !targetRefs?.length) return;

    for (const t of targetRefs) {
        const resolved = await fromUuid(t.uuid).catch(() => null);
        const actor = resolved?.actor ?? resolved;
        await grantEntriesToActor(actor, entries);
    }

    // 付与済みの記録(カードのノート用。再付与の判定には使わない=遷移トリガーが正)
    const merged = [...(payload.hitGranted ?? [])];
    for (const t of targetRefs) {
        if (!merged.some(g => g.uuid === t.uuid)) merged.push({ uuid: t.uuid, name: t.name });
    }
    await TnxSocketHandler.applyMessagePatch(attackMessage, { hitGranted: merged }, "usageEffects");
}

/**
 * ダメージ時効果をダメージ適用時に1対象へ付与する(2026-07-18)。呼び出し側が
 * **最終適用値≥1** の対象にのみ呼ぶ(1未満は付与しない=2026-07-18 裁定)。
 * @param {Actor} actor 付与先(ダメージを受けた対象。カバー時はカバーした側)
 * @param {Array<{name:string, data:object}>} entries ダメージ時の効果エントリ
 */
export async function grantDamageTimedEffects(actor, entries) {
    await grantEntriesToActor(actor, entries);
}

/**
 * ソケット委譲された効果付与を GM クライアントで実行する(TnxSocketHandler._onUsageEffectGrant)。
 * @param {{targetUuid:string, entries:Array<{name:string, data:object}>}} data
 */
export async function grantUsageEffectsDelegated({ targetUuid, entries }) {
    const resolved = await fromUuid(targetUuid).catch(() => null);
    const actor = resolved?.actor ?? resolved;
    if (!actor?.createEmbeddedDocuments) return;
    for (const e of (entries ?? [])) {
        if (!e?.data) continue;
        await grantUsageEffect(actor, e);
    }
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

    const esc = foundry.utils.escapeHTML;
    // 名前は「」で個別に囲う(名前自体が「・」を含みうるため区切りを明示・2026-07-15 ユーザー指摘)
    const nameList = (arr) => arr.map(n => `「${esc(n)}」`).join("・");
    // 付与先「自分」の効果は用途解決時に付与済み(2026-07-13 再設計)
    const selfNote = payload.selfApplied?.length
        ? `<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 自分へ付与済み: ${nameList(payload.selfApplied)}</p>`
        : "";

    // 差し込み先: 既存のカード本文の末尾(専用の器があればそこ、無ければカード直下)
    const host = html.querySelector(".tnx-usage-effect-area")
        ?? html.querySelector(".tnx-check-result")
        ?? html.querySelector(".tnx-chat-card")
        ?? html;
    // 二重描画防止
    if (host.querySelector(".tnx-usage-effect-block")) return;

    const block = document.createElement("div");
    block.className = "tnx-usage-effect-block";
    const append = (inner) => { block.innerHTML = inner; host.appendChild(block); };

    // 対決判定カード(attackCheck)の出し分け(2026-07-18 タイミング2種＋KI-028 是正):
    // - 攻撃: 適用ボタンはダメージカードへ一本化(2026-07-11 ユーザー確定)。カード上は
    //   自分付与ノートと命中時効果の付与済みノート(命中解決で自動付与=grantHitTimedEffects)のみ
    // - 非攻撃対決: ダメージフローを持たないため、解決後に結果カードと同じ手動ボタンを出す
    const attackF = message.getFlag(SCOPE, "attackCheck");
    if (attackF) {
        const mode = attackCardEffectMode(attackF);
        if (mode === "hide") return;
        if (mode === "attack") {
            let hitNote = "";
            const hitEntries = splitEffectsByTiming(payload.effects).hit;
            if (hitEntries.length && payload.hitGranted?.length) {
                hitNote = `<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 命中時効果を付与済み: `
                    + `${nameList(hitEntries.map(e => e.name))} → ${nameList(payload.hitGranted.map(t => t.name))}</p>`;
            }
            if (selfNote || hitNote) append(`${selfNote}${hitNote}`);
            return;
        }
        // mode === "button": 非攻撃対決の解決後 → 下の通常描画(手動ボタン)へ
    }

    const names = nameList(payload.effects.map(e => e.name));
    const damageF = message.getFlag(SCOPE, "damageRoll");

    if (payload.applied) {
        // appliedTargets=ダメージ適用で実際に付与した対象(2026-07-18・最終適用値≥1)。
        // 無ければ旧カード互換=用途時の対象を表示
        const applied = payload.appliedTargets ?? payload.targets ?? [];
        const doneNote = applied.length
            ? `効果を適用済み: ${names} → ${nameList(applied.map(t => t.name))}`
            : `効果は付与されませんでした（最終ダメージ 1 点未満）: ${names}`;
        append(`${selfNote}<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> ${doneNote}</p>`);
        return;
    }

    // ダメージカードでは、効果はダメージ適用と**同時に自動付与**される(2026-07-12 ユーザー確定=
    // 押し順の順序依存を消す)。付与されるのは最終適用値が1以上の対象のみ(2026-07-18 裁定)。
    // ダメージ適用に至る経路がある間はボタンを出さず予告のみ表示する。対象未選択(適用ボタンが
    // 出ない)・適用済みで効果だけ未適用(旧カード等)は手動ボタンを残す
    if (damageF && (damageF.targets?.length ?? 0) > 0 && !damageF.applied) {
        const targetNames = nameList(damageF.targets.map(t => t.name)) || "（対象なし）";
        append(`${selfNote}<p class="tnx-usage-effect-note">付与効果: ${names} → ${targetNames}（ダメージ適用時・1点以上の対象へ付与）</p>`);
        return;
    }

    const targetNames = nameList((payload.targets ?? []).map(t => t.name)) || "（対象なし）";
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
