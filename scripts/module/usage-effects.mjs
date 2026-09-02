/**
 * @fileoverview 用途の「適用される効果」を、カードの効果セクションから付与する
 * (2026-07-10 ユーザー確定・2026-07-13 v3 再設計・2026-08-30 効果セクション再設計・
 * 正本 Usage_System.md「適用される効果」)。攻撃に限らず全用途が対象。
 *
 * - **効果種別(AE 設定・flags.grantTarget)**: 「通常効果」(既定・値 "target")=ボタン押下で
 *   チェック済みの対象行へ付与。「代償効果」(値 "self")=同じ押下で**同時に使用者へ**付与
 *   (単独のボタンは持たない。フラグ名 grantTarget は当初「付与先: 対象/自分」と命名した
 *   歴史的経緯の保存キーで、表示は効果種別=通常/代償・2026-08-30 命名不良の是正)。
 *   **自動付与はどこにも無い**(旧・付与先「自分」の解決時即時付与は 2026-08-30 廃止)。
 * - **効果セクション(トレイ・2026-08-30 ユーザー確定=D&D 5e のトレイに倣う)**: 「効果」見出しで
 *   開閉する折りたたみ。初期=展開・適用で畳む(クライアントローカルの見た目だけ。適用しても
 *   **メッセージは書き換えない**=適用済みフラグを持たない。適用の正本は対象アクター上の AE)。
 *   対象行=チェックボックス(既定オン)。再展開すれば何度でも押し直せる。
 *   成功報告の文言・通知は出さない(不成立の警告のみ残す)。
 * - **適用タイミング(2026-07-18 ユーザー確定)**: 攻撃用途は効果リストが2つ——`effects`=一般
 *   (攻撃では命中時=攻撃カードのセクション。カバー宣言後に押せばカバー側へ乗る)・
 *   `damageEffects`=ダメージ時(ダメージカードのセクション)。タイミングは**リスト所属**で決まり
 *   AE 側には持たせない。「1点でも与えたら」等の条件はコード化せず卓判断に委ねる。
 *   代償効果は所属リストのボタンに同乗する。
 * - **着地(changes のキーで判断)**: アイテム狙いキー(素の system.<パス>/分類/識別キー)が
 *   1つでもあれば**アイテム着地**=付与先アクターの所持アイテムから選択して付与(候補はキーで絞る。
 *   1件なら無確認・0件は警告してスキップ)。それ以外は**アクター着地**(従来どおり)。混在は非対応。
 * - **ターゲット**: 起動時の対象解決(決定表駆動)で確定済みのレティクルが正。通常効果が
 *   無ければターゲットは読まない。
 * - **付与**: 供給元 AE を複製して生成(有効化・flags.grantedFrom で由来を記録)。同一効果
 *   (flags.effectId)の既存付与が居れば**置き換えリフレッシュ**(重複可 stackable のみ並ぶ)。
 * - 効果 `{itemId, effectId}` の itemId 空＝親アイテム。実データ(toObject)をカードのフラグに載せて運ぶ。
 */

import { currentTargetActors } from "./target-resolution.mjs";
import { analyzeGrantLanding, itemGrantCandidates, rewriteGrantChangesForItem } from "../data/item/helpers.mjs";
import { isWetActor } from "./conditions.mjs";

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
/**
 * 供給元の効果から**付与コピー**のデータを組み立てる(用途の適用効果・RL 任意付与に共通)。
 *
 * 付与コピーは**供給元と切り離された一回性のインスタンス**である: `transferredFrom` を持たない
 * ため、アイテム狙い AE の片方向同期(供給元が正・更新で上書き・供給元削除で除去)の対象に
 * ならない。`grantedFrom` は由来の記録であって同期の紐づけではない。
 *
 * @param {ActiveEffect} eff 供給元の効果
 * @returns {object} createEmbeddedDocuments("ActiveEffect", ...) 用のデータ
 */
export function buildGrantedEffectData(eff) {
    return buildGrantedEffectDataFrom(eff.toObject(), eff.uuid);
}

/**
 * 素の効果データから付与コピーを組み立てる(`buildGrantedEffectData` の実体)。
 *
 * 供給元のドキュメントを持たない効果——アクトのプリセット・その場で組んだ効果——も
 * 同じ経路に乗せるための入口(2026-07-21)。由来 uuid が無い場合は `grantedFrom` を刻まない
 * (どこにも紐づかない一回性の効果である、という事実をそのまま記録する)。
 *
 * @param {object} source 効果データ(書き換えない)
 * @param {?string} [sourceUuid] 由来の効果の uuid(あれば)
 * @returns {object} createEmbeddedDocuments("ActiveEffect", ...) 用のデータ
 */
export function buildGrantedEffectDataFrom(source, sourceUuid = null) {
    const clone = globalThis.foundry?.utils?.deepClone ?? structuredClone;
    const data = clone(source ?? {});
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
    if (sourceUuid) {
        f.grantedFrom = sourceUuid;
        if (!f.effectId) f.effectId = sourceUuid;
    }
    delete f.applyToParent; // 付与コピーに準備先転送は無関係
    return data;
}

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
            const data = buildGrantedEffectData(eff);
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
    // 着地は**付与先の所持アイテムの種別**で決まる(2026-09-02): 技能・神業だけを狙うペイロードは
    // アクターへ着地し、遠隔適用で実効値に届く(付与先を選ばせない・持続の失効掃引にも乗る)
    const landing = analyzeGrantLanding(entry.data?.changes, targetActor?.items);
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
        // 成功報告の通知は出さない(2026-08-30 ユーザー確定=不成立の警告のみ残す)
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
 * 効果エントリ群を対象群へ付与する共通ループ(押下者の権限で付与・権限が無い対象は警告)。
 * @param {Array<{uuid:string, name:string}>} refs 適用先
 * @param {Array<{name:string, data:object}>} entries 効果エントリ(データ持ちのみ渡す)
 * @returns {Promise<{cancelled:boolean}>} cancelled=アイテム着地の付与先選択がキャンセルされた
 */
async function grantEffectsToRefs(refs, entries) {
    let cancelled = false;
    const denied = [];
    for (const ref of refs) {
        const resolved = await fromUuid(ref.uuid).catch(() => null);
        const actor = resolved?.actor ?? resolved;
        if (!actor?.createEmbeddedDocuments) continue;
        if (!(game.user.isGM || actor.isOwner)) { denied.push(actor.name ?? ref.name); continue; }
        for (const e of entries) {
            if (await grantUsageEffect(actor, e) === "cancel") cancelled = true;
        }
    }
    if (denied.length) {
        ui.notifications.warn(`${denied.map(n => `「${n}」`).join("・")}への効果付与は対象の操作者（か RL）が行います。`);
    }
    return { cancelled };
}

/**
 * 用途の付与効果ペイロードを作る(結果カードのフラグに載せる形)。効果が無ければ null(何もしない)。
 * 代償効果(grantTarget="self")もペイロードで運び、「効果を適用」押下時に通常効果と**同時に**
 * 使用者へ付与する(2026-08-30 ユーザー確定。旧・解決時の即時自動付与=2026-07-13 の唯一の
 * 自動付与例外は廃止=自動付与はどこにも無い)。
 * @param {object} [options]
 * @param {Array<{uuid:string,name:string}>|null} [options.targetOverride] 対象を確定済みで渡す
 *   (非 null なら現在のレティクルを読まずこの配列を対象にする)。リアクションで攻撃者を
 *   対象にする用途(リアクションの対象は「なし」=攻撃者へ返す・2026-07-15)。空配列=対象なし。
 * @returns {Promise<{effects:Array, targets:Array, sourceActorUuid:?string}|null>}
 */
export async function prepareUsageEffectPayload(actor, parentItem, usage, { targetOverride = null } = {}) {
    const entries = resolveUsageEffectData(actor, parentItem, usage);
    if (!entries.length) return null;
    const targetEntries = entries.filter(e => e.grantTarget === "target");

    // 通常効果があるときだけターゲットを読む(起動時の対象解決=決定表駆動で確定済みの
    // レティクルが正・2026-07-18)。targetOverride(リアクション=攻撃者)が渡されていればそれを対象にする。
    let targets = [];
    if (targetEntries.length) {
        targets = targetOverride !== null ? targetOverride : captureUsageTargets();
    }

    return {
        // timing を必ず載せる(2026-07-18 是正: 落とすと splitEffectsByTiming が全てダメージ時と
        // 見なし、命中時効果がダメージ適用時に付与される)。self=代償効果の印
        effects: entries.map(e => ({ name: e.name, data: e.data, timing: e.timing,
            ...(e.grantTarget === "self" ? { self: true } : {}) })),
        targets,
        sourceActorUuid: actor?.uuid ?? null, // 代償効果の適用先=使用者
        // 「ウェットの対象には効果がない」(2026-09-01 承認): ウェットの対象行は付与から外す
        // (トレイに注記つきで残す=黙って消さない)。代償効果(自分)には効かせない
        ...(usage?.noEffectVsWet === true ? { noEffectVsWet: true } : {}),
    };
}

/**
 * 効果セクションの描画/適用に使う文脈をカードの種別から解決する(2026-08-30 再設計)。
 * - 攻撃カード(attackCheck): 命中時(hit)エントリのみ・全対象解決後に表示・対象行=命中対象
 *   (カバー宣言済みはカバー側へ付け替え)。ダメージ時エントリはダメージカードが担う
 *   (2026-07-11 ユーザー確定の一本化)。非攻撃対決は attackCardEffectMode の出し分けに従う。
 * - ダメージカード(damageRoll): 対象行=カードの対象(命中対象のカバー展開済み・2026-07-18)。
 * - それ以外(判定結果/用途使用/リアクション/移動): 対象行=ペイロードの対象。
 * 旧カード互換: データ持ちエントリが無いペイロード(旧・自分のみカード)は何も出さない。
 * 旧 applied/hitApplied 等の適用済みフラグは読まない(カードは状態を主張しない)。
 * @param {ChatMessage} message
 * @returns {{entries:Array, refs:Array<{uuid:string,name:string}>, sourceActorUuid:?string}|null}
 *   null=このカードには効果セクションを出さない
 */
function usageEffectTrayContext(message) {
    const payload = message.getFlag(SCOPE, "usageEffects");
    if (!(payload?.effects ?? []).some(e => e?.data)) return null;

    let entries = payload.effects;
    let refs = payload.targets ?? [];
    const attackF = message.getFlag(SCOPE, "attackCheck");
    const damageF = message.getFlag(SCOPE, "damageRoll");
    if (attackF) {
        const mode = attackCardEffectMode(attackF);
        if (mode === "hide") return null;
        if (mode === "attack") {
            // 命中時効果はこのカード・全対象の解決後に出す。対象行=現時点の命中対象
            entries = splitEffectsByTiming(payload.effects).hit;
            const resolvedAll = (attackF.targets ?? []).every(t => t?.state !== "pending");
            if (!resolvedAll) return null;
            refs = hitEffectTargetRefs(attackF.targets);
            // 命中対象も代償効果も無ければ出さない(命中0の攻撃は適用機会なし)
            if (!refs.length && !entries.some(e => e?.self)) return null;
        }
        // mode === "button": 非攻撃対決の解決後 → 全エントリ・ペイロードの対象で通常表示
    } else if (damageF?.targets?.length) {
        refs = damageF.targets;
    }
    if (!entries.some(e => e?.data)) return null;
    // 「ウェットの対象には効果がない」(noEffectVsWet・2026-09-01): ウェットの対象行に印を付ける
    // (トレイでグレーアウト+注記・適用からも除外。判定時点でなく描画/押下時点の状態で判定)
    const wetGate = payload.noEffectVsWet === true;
    return {
        entries,
        refs: refs.map(t => ({ uuid: t.uuid, name: t.name,
            ...(wetGate && isWetTargetRef(t.uuid) ? { wetBlocked: true } : {}) })),
        sourceActorUuid: payload.sourceActorUuid ?? null,
    };
}

/**
 * 対象行の uuid がウェットのアクターを指すか(同期解決・解決不能は false=ゲートしない)。
 * @param {string} uuid
 * @returns {boolean}
 */
function isWetTargetRef(uuid) {
    if (!uuid) return false;
    let doc = null;
    try { doc = fromUuidSync(uuid); } catch { return false; }
    return isWetActor(doc?.actor ?? doc);
}

/**
 * 結果カード(判定結果/攻撃/ダメージ/用途使用)に効果セクション(トレイ)を描画する。
 * `renderChatMessageHTML` フックから呼ぶ。フラグ `usageEffects` を持つカードにのみ効く。
 *
 * D&D 5e のトレイに倣った形(2026-08-30 ユーザー確定):
 * - 「効果」見出しで開閉する折りたたみ。初期=展開・「効果を適用」押下で畳む。折りたたみは
 *   クライアントローカルの見た目だけで、適用しても**メッセージは書き換えない**(適用済み
 *   フラグを持たない=適用の正本は対象アクター上の AE。再展開でいつでも押し直せる=
 *   誤適用・未適用のやり直しを塞がない。非スタッカブルは置き換えリフレッシュで二重にならない)。
 * - 対象行=チェックボックス(既定オン)。旧・除外ダイアログはカード常設の行に置換。
 */
export async function renderUsageEffectButton(message, html) {
    const ctx = usageEffectTrayContext(message);
    if (!ctx) return;

    // 差し込み先: 既存のカード本文の末尾(専用の器があればそこ、無ければカード直下)
    const host = html.querySelector(".tnx-usage-effect-area")
        ?? html.querySelector(".tnx-check-result")
        ?? html.querySelector(".tnx-chat-card")
        ?? html;
    // 二重描画防止
    if (host.querySelector(".tnx-usage-effect-block")) return;

    const block = document.createElement("div");
    block.className = "tnx-usage-effect-block";
    block.innerHTML = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/parts/usage-effect-tray.hbs",
        {
            targets: ctx.refs,
            effects: ctx.entries.filter(e => e?.data)
                .map(e => ({ name: e.name, self: e.self === true })),
        });
    block.querySelector('[data-action="trayToggle"]')
        ?.addEventListener("click", () => block.classList.toggle("collapsed"));
    block.querySelector('[data-action="trayApply"]')
        ?.addEventListener("click", () => applyUsageEffectsFromTray(message, block));
    host.appendChild(block);
}

/**
 * 「効果を適用」: チェック済みの対象行へ通常効果を付与し、**同時に**代償効果(self)を使用者へ
 * 付与する(2026-08-30 ユーザー確定=代償は単独のボタンを持たず主効果の適用に同乗する)。
 * 付与は対象それぞれの所有者/GM の権限で行い、権限が無い対象は警告してスキップ。
 * エントリは押下時点のカード状態から解決し直し、対象はチェックの入った行から読む
 * (攻撃カードはフラグ更新で行ごと再描画されるため常に現在の命中対象)。
 * 完了でセクションを畳む(ローカル)。アイテム着地の選択キャンセル時は畳まない(やり直せる)。
 * 適用の可視化は Foundry 標準のトークン演出に任せ、成功報告の文言・通知は出さない
 * (2026-08-30 ユーザー確定=状態はカードでなくアクターが正本)。
 */
async function applyUsageEffectsFromTray(message, block) {
    const ctx = usageEffectTrayContext(message);
    if (!ctx) return;
    const targetEntries = ctx.entries.filter(e => e?.data && e.self !== true);
    const selfEntries = ctx.entries.filter(e => e?.data && e.self === true);
    // ウェット無効(noEffectVsWet)の対象行はチェック不能だが、押下時点の状態でも除外する(二重ガード)
    const blocked = new Set(ctx.refs.filter(r => r.wetBlocked).map(r => r.uuid));
    const checked = [...block.querySelectorAll(".tnx-effect-target-row input:checked")]
        .map(cb => ({ uuid: cb.dataset.uuid, name: cb.dataset.name }))
        .filter(r => !blocked.has(r.uuid));

    let cancelled = false;
    if (targetEntries.length && checked.length) {
        cancelled = (await grantEffectsToRefs(checked, targetEntries)).cancelled || cancelled;
    }
    if (selfEntries.length && ctx.sourceActorUuid) {
        const doc = await fromUuid(ctx.sourceActorUuid).catch(() => null);
        const src = doc?.actor ?? doc;
        if (src) {
            cancelled = (await grantEffectsToRefs([{ uuid: src.uuid, name: src.name }], selfEntries)).cancelled || cancelled;
        }
    }
    if (!cancelled) block.classList.add("collapsed");
}
