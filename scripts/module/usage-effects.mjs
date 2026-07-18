/**
 * @fileoverview 用途の「適用される効果」を、用途解決時に付与する
 * (2026-07-10 ユーザー確定・2026-07-13 再設計・正本 Usage_System.md「適用される効果」)。
 * 攻撃に限らず全用途が対象。
 *
 * - **付与先(AE 設定・flags.grantTarget)**: 「対象」(既定)=ターゲットしたキャラクターへ、
 *   カードの「効果を適用」ボタンで付与。「自分」=使用者へ、
 *   **用途解決時に即時自動付与**(代償デバフ等を後回しにしない。付与先選択のキャンセルは用途中止)。
 * - **適用タイミング(2026-07-18 ユーザー確定)**: 攻撃用途は効果リストが2つ——`effects`=一般
 *   (攻撃では命中時=攻撃カードの「効果を適用」ボタン。カバー宣言後に押せばカバー側へ乗る)・
 *   `damageEffects`=ダメージ時(ダメージカードのボタン)。タイミングは**リスト所属**で決まり
 *   AE 側には持たせない。「1点でも与えたら」等の条件はコード化せず、ボタンを押す/押さない・
 *   除外ダイアログ(複数対象)の卓判断に委ねる。自動付与はどこにも無い(付与先「自分」の即時のみ)。
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
import { currentTargetActors } from "./target-resolution.mjs";
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
    // タイミングはリスト所属で決まる(2026-07-18 ユーザー確定=AE 側には持たせない)。
    // effects=一般(攻撃では命中時・非攻撃では従来どおり)・damageEffects=攻撃専用のダメージ時
    const lists = [
        { refs: usage?.effects ?? [], timing: "hit" },
        { refs: usage?.damageEffects ?? [], timing: "damage" },
    ];
    for (const { refs, timing } of lists) {
        for (const ref of refs) {
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
                timing,
                landing: analyzeGrantLanding(data.changes),
            });
        }
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
 * - "attack": 攻撃。一般(命中時)効果はこのカードのボタン・ダメージ時効果はダメージカードのボタン
 * - "button": 非攻撃対決の解決後(または終端状態)。結果カードと同じ手動ボタンを出す(適用判断は卓)
 * - "hide":   非攻撃対決の未解決。フロー終端(2026-07-11 確定)前なのでまだ出さない
 * @param {object|null} f attackCheck フラグ
 * @returns {"attack"|"button"|"hide"}
 */
export function attackCardEffectMode(f) {
    if (!f || f.isAttack !== false) return "attack";
    // 全体の終端状態: 対象ごとの解決が走らないまま終わる(fumble/miss=判定不成立・failed=対決敗北)
    if (["fumble", "miss", "failed"].includes(f.state)) return "button";
    // オープンリアクション(2026-07-18 任意・複数化): 明示の確定操作が無い(ライブ成否)ため終端も無い。
    // ボタンは常時表示し、押す時機は卓判断(v3 原則)
    if (f.openReactions) return "button";
    if (f.openReaction) return f.openReaction.resolved === true ? "button" : "hide"; // 旧形式(先着1件)
    return (f.targets ?? []).every(t => t?.state !== "pending") ? "button" : "hide";
}

/**
 * 用途使用時にターゲットしたキャラクターを確定する。付与先「対象」の効果がある用途でのみ呼ぶ。
 * 対象は起動時の対象解決(決定表駆動・2026-07-18)で確定済みのレティクルが正——自身/単体の
 * 自動セルフでセルフバフも成立するため、旧「自分を対象に続行」確認は廃止。ノーターゲット
 * (対象なし群の用途)は対象なしのまま運ぶ(レティクル無しへの働きかけは基本的にできない)。
 * @returns {Array<{uuid:string, name:string}>} 現在ターゲット中の対象(重複 uuid は畳む)
 */
export function captureUsageTargets() {
    const targeted = currentTargetActors();
    const byUuid = new Map(targeted.map(a => [a.uuid, { uuid: a.uuid, name: a.name }]));
    return [...byUuid.values()];
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
 * 命中時効果の適用先を攻撃カードの対象リストから解決する(2026-07-18 是正)。
 * 命中(hit)した対象のみ。**カバー宣言済みの対象はカバーした側へ付け替える**
 * (「カバー時は効果もダメージもカバー側」裁定)。カバーした側が自分も命中対象なら1件に畳む。
 * @param {Array<{uuid:string,name:string,state:string,coveredBy?:{uuid:string,name:string}}>|null} targets
 * @returns {Array<{uuid:string, name:string}>}
 */
export function hitEffectTargetRefs(targets) {
    const out = [];
    for (const t of (targets ?? [])) {
        if (t?.state !== "hit") continue;
        const ref = t.coveredBy
            ? { uuid: t.coveredBy.uuid, name: t.coveredBy.name }
            : { uuid: t.uuid, name: t.name };
        if (!out.some(r => r.uuid === ref.uuid)) out.push(ref);
    }
    return out;
}

/**
 * 攻撃カードの「効果を適用」ボタン: 命中時効果(timing="hit")を現在の命中対象へ付与する
 * (2026-07-18 是正=**自動付与しない**・v3 原則へ回帰。押すのは対象の所有者か RL。手動だから
 * こそカバー宣言後に押せば付け替え先=カバー側へ正しく適用できる)。
 * 適用先は押下時点の hitEffectTargetRefs で解決。完了で usageEffects.hitApplied=true と
 * 適用先(hitGranted)を記録し、ボタンは適用済みノートに変わる。
 */
export async function applyHitEffectsFromMessage(message) {
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload?.effects?.length || payload.hitApplied) return;
    const entries = splitEffectsByTiming(payload.effects).hit.filter(e => e?.data);
    if (!entries.length) return;
    // 複数対象は除外ダイアログで確定(2026-07-18 ユーザー確定)
    const refs = await confirmEffectTargets(
        hitEffectTargetRefs(message.getFlag(SCOPE, "attackCheck")?.targets));
    if (!refs) return;

    const { appliedAny, cancelled, granted } = await grantEffectsToRefs(refs, entries);
    if (cancelled || !appliedAny) return;
    await TnxSocketHandler.applyMessagePatch(message, { hitApplied: true, hitGranted: granted }, "usageEffects");
}

/**
 * 効果エントリ群を対象群へ付与する共通ループ(押下者の権限で付与・権限が無い対象は警告)。
 * @param {Array<{uuid:string, name:string}>} refs 適用先
 * @param {Array<{name:string, data:object}>} entries 効果エントリ(データ持ちのみ渡す)
 * @returns {Promise<{appliedAny:boolean, cancelled:boolean, granted:Array<{uuid:string,name:string}>}>}
 */
async function grantEffectsToRefs(refs, entries) {
    let appliedAny = false;
    let cancelled = false;
    const denied = [];
    const granted = [];
    for (const ref of refs) {
        const resolved = await fromUuid(ref.uuid).catch(() => null);
        const actor = resolved?.actor ?? resolved;
        if (!actor?.createEmbeddedDocuments) continue;
        if (!(game.user.isGM || actor.isOwner)) { denied.push(actor.name ?? ref.name); continue; }
        let grantedThis = false;
        for (const e of entries) {
            const r = await grantUsageEffect(actor, e);
            if (r === "cancel") { cancelled = true; continue; }
            appliedAny = true; // skip(候補なし)も適用済み扱い(通知済み・再押下で解決しないため)
            grantedThis = true;
        }
        if (grantedThis) granted.push({ uuid: ref.uuid, name: ref.name });
    }
    if (denied.length) {
        ui.notifications.warn(`${denied.map(n => `「${n}」`).join("・")}への効果付与は対象の操作者（か RL）が行います。`);
    }
    return { appliedAny, cancelled, granted };
}

/**
 * 「効果を適用」の適用先を確定する共通ダイアログ(2026-07-18 ユーザー確定)。
 * 対象1体はそのまま(ダイアログなし)・0体は null。2体以上はチェックボックスで除外を選べる
 * (全員チェック済みが初期状態。例: ダメージ0だった対象を外す)。キャンセル・全除外は
 * null=適用しない(ボタンは残る)。
 * @param {Array<{uuid:string, name:string}>} refs 候補の対象
 * @returns {Promise<Array<{uuid:string, name:string}>|null>}
 */
async function confirmEffectTargets(refs) {
    if ((refs?.length ?? 0) <= 1) return refs?.length ? refs : null;
    const esc = foundry.utils.escapeHTML;
    const rows = refs.map((r, i) => `<div class="tnx-uses-row"><label>
        <input type="checkbox" name="t-${i}" checked><span>${esc(r.name)}</span></label></div>`).join("");
    const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: "効果の適用先" },
        classes: ["tokyo-nova", "tnx-dialog"],
        position: { width: 360 },
        content: `<p>効果を適用する対象を選択:</p>${rows}`,
        buttons: [
            { action: "apply", icon: "fas fa-check", label: "適用", default: true,
              callback: (_e, _b, dialog) => refs.filter((_r, i) => dialog.element.querySelector(`[name="t-${i}"]`)?.checked) },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        rejectClose: false,
        close: () => null,
    });
    return (picked && picked.length) ? picked : null;
}

/**
 * 用途の付与効果ペイロードを作る(結果カードのフラグに載せる形)。効果が無ければ null(何もしない)、
 * キャンセルされたら "cancel"(用途を中止)。付与先「自分」の効果はここで**即時付与**する。
 * @param {object} [options]
 * @param {Array<{uuid:string,name:string}>|null} [options.targetOverride] 対象を確定済みで渡す
 *   (非 null なら現在のレティクルを読まずこの配列を対象にする)。リアクションで攻撃者を
 *   対象にする用途(リアクションの対象は「なし」=攻撃者へ返す・2026-07-15)。空配列=対象なし。
 * @returns {Promise<{effects:Array, targets:Array, applied:boolean, selfApplied?:string[]}|null|"cancel">}
 */
export async function prepareUsageEffectPayload(actor, parentItem, usage, { targetOverride = null } = {}) {
    const entries = resolveUsageEffectData(actor, parentItem, usage);
    if (!entries.length) return null;
    const selfEntries = entries.filter(e => e.grantTarget === "self");
    const targetEntries = entries.filter(e => e.grantTarget === "target");

    // 対象向けの効果があるときだけターゲットを読む(起動時の対象解決=決定表駆動で確定済みの
    // レティクルが正・2026-07-18)。targetOverride(リアクション=攻撃者)が渡されていればそれを対象にする。
    let targets = [];
    if (targetEntries.length) {
        targets = targetOverride !== null ? targetOverride : captureUsageTargets();
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
        // timing を必ず載せる(2026-07-18 是正: 落とすと splitEffectsByTiming が全てダメージ時と
        // 見なし、命中時効果がダメージ適用時に付与される)
        effects: targetEntries.map(e => ({ name: e.name, data: e.data, timing: e.timing })),
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
    // - 攻撃: ダメージ時効果のボタンはダメージカードへ一本化(2026-07-11 ユーザー確定)。
    //   **命中時効果はこのカードの手動ボタンで適用**(2026-07-18 是正=自動付与しない。手動だから
    //   こそカバー宣言後に押せばカバー側へ正しく適用できる)。自分付与はノート表示のみ
    // - 非攻撃対決: ダメージフローを持たないため、解決後に結果カードと同じ手動ボタンを出す
    const attackF = message.getFlag(SCOPE, "attackCheck");
    if (attackF) {
        const mode = attackCardEffectMode(attackF);
        if (mode === "hide") return;
        if (mode === "attack") {
            const hitEntries = splitEffectsByTiming(payload.effects).hit;
            const hitNames = nameList(hitEntries.map(e => e.name));
            let hitNote = "";
            let showButton = false;
            if (hitEntries.length && payload.hitApplied) {
                hitNote = `<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 効果を適用済み: `
                    + `${hitNames} → ${nameList((payload.hitGranted ?? []).map(t => t.name)) || "（対象なし）"}</p>`;
            } else if (hitEntries.length) {
                // 全対象の解決後・命中が1体以上のとき表示。適用先=現時点の命中対象(カバー宣言済みは
                // カバー側へ付け替え)。押下時に hitEffectTargetRefs で再解決される
                const refs = hitEffectTargetRefs(attackF.targets);
                const resolvedAll = (attackF.targets ?? []).every(t => t?.state !== "pending");
                if (resolvedAll && refs.length) {
                    hitNote = `<p class="tnx-usage-effect-note">付与効果: ${hitNames} → ${nameList(refs.map(r => r.name))}</p>`;
                    showButton = true;
                }
            }
            if (!selfNote && !hitNote) return;
            block.innerHTML = `${selfNote}${hitNote}`;
            if (showButton) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "tnx-chat-btn";
                btn.textContent = "効果を適用";
                btn.addEventListener("click", () => applyHitEffectsFromMessage(message));
                block.appendChild(btn);
            }
            host.appendChild(block);
            return;
        }
        // mode === "button": 非攻撃対決の解決後 → 下の通常描画(手動ボタン)へ
    }

    const names = nameList(payload.effects.map(e => e.name));
    const damageF = message.getFlag(SCOPE, "damageRoll");

    if (payload.applied) {
        // appliedTargets=実際に付与した対象(除外ダイアログで確定・2026-07-18)。無ければ旧カード互換
        const applied = payload.appliedTargets ?? payload.targets ?? [];
        append(`${selfNote}<p class="tnx-usage-effect-note"><i class="fas fa-check"></i> 効果を適用済み: `
            + `${names} → ${nameList(applied.map(t => t.name)) || "（対象なし）"}</p>`);
        return;
    }

    // 未適用: 手動ボタン(2026-07-18 ユーザー確定=ダメージ時も自動付与しない。「1点でも」等の
    // 条件はコード化せず、押す/押さない・除外ダイアログの卓判断に委ねる)。
    // ダメージカードの適用先はカードの対象(命中対象のカバー展開済み)
    const refTargets = (damageF?.targets?.length ? damageF.targets : (payload.targets ?? []));
    const qualifier = damageF ? "（ダメージ時）" : "";
    const targetNames = nameList(refTargets.map(t => t.name)) || "（対象なし）";
    block.innerHTML = `${selfNote}<p class="tnx-usage-effect-note">付与効果${qualifier}: ${names} → ${targetNames}</p>`;
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
 * 選択したアイテム)へ AE を複製生成。適用先はダメージカードなら**カードの対象**(命中対象の
 * カバー展開済み=2026-07-18)、それ以外は用途時の対象。複数対象は除外ダイアログで確定する。
 * 完了後、カードを「適用済み」にし実際の適用先を記録する(権限が無ければ GM へソケット委譲)。
 * 付与先選択をキャンセルした場合は適用済みにしない(ボタンが残り、やり直せる。
 * 既付与分は置き換えリフレッシュで二重にならない)。
 */
export async function applyUsageEffectsFromMessage(message) {
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!payload?.effects?.length || payload.applied) return;

    const damageTargets = message.getFlag(SCOPE, "damageRoll")?.targets;
    const baseRefs = ((damageTargets?.length ? damageTargets : payload.targets) ?? [])
        .map(t => ({ uuid: t.uuid, name: t.name }));
    const refs = await confirmEffectTargets(baseRefs);
    if (!refs) return;

    const entries = payload.effects.filter(e => e?.data);
    const { appliedAny, cancelled, granted } = await grantEffectsToRefs(refs, entries);
    if (cancelled || !appliedAny) return;
    // 適用の可視化は Foundry 標準のトークン演出に任せる(+効果名の浮遊テキスト・トークンのアイコン。
    // resolveUsageEffectData の statuses 注入で演出条件を満たす)。独自の通知・チャットカードは
    // 出さない(2026-07-11 ユーザー指摘で撤去)

    // カードを適用済みに(実際の適用先を記録。author/GM でなければ GM へ委譲)
    await TnxSocketHandler.applyMessagePatch(message, { applied: true, appliedTargets: granted }, "usageEffects");
}
