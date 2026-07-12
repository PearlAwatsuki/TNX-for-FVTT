/**
 * @fileoverview NPC取得用途の実行フロー(フェーズ11-6・正本 Troops.md「NPC取得」)。
 *
 * D&D 5e の召喚アクティビティ相当。モードは用途の明示選択(acquireMode):
 * - extra:   判定なし。取得アイテム参照(小分類「エキストラ」のアウトフィット)を派生データとして
 *            取得し、そのアウトフィットの extraActorRef が指す共有エキストラアクターのトークンを
 *            場に出す(取得と場に出るのは同時・2026-07-04 確定)。
 * - troop /  通常判定(目標値なし)。対象トループ級アクターの heads(人数/エニグマポイント)に
 *   enigma:  達成値を転記する(事前作成済みアクターを直接更新・複製しない)＋トークン配置。
 * - bunshin: 通常判定・目標値10(達成値10以上で成功=目標値の一般規約)。成功時のみ配置。
 *            分身名は所有者参照(ownerActorRef)のライブ解決名から syncTroopName が導出する。
 *
 * 対象解決は**用途側の取得アクター参照(acquireActorRef)**(2026-07-07 ユーザー裁定。
 * 当初の所有者逆引きは廃止——所有者参照は経験点計上・分身名・使用回数共有の紐づけとして残る)。
 * 旧・技能側 autoAcquireActors は廃止済み(2026-07-08 ユーザー裁定=用途側一本化)。
 * レベル転記: 取得技能のレベルがそのままトループ/エニグマのレベルになる(起動時に転記)。
 *
 * 判定はキャストの技能判定と完全に同一(カード・報酬点・判定バフ・消費先設定)。判定完了後の
 * 継続は TnxCheckFlow._execute から completeAcquisitionFromCheck が呼ばれる(ctx.npcAcquire)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { getComboSuits, comboUsesBounty } from "./tnx-check-engine.mjs";
import { resolveConsumeRowsForActor, promptConsumption, applyConsumptionPlan } from "./usage-consumption.mjs";
import { placeActorTokens } from "./tnx-token-placement.mjs";
import { computeAcquisitionOutcome, buildBunshinAbilityMods } from "./npc-acquisition-logic.mjs";

const MODE_LABELS = { extra: "エキストラ", troop: "トループ", enigma: "エニグマ", bunshin: "分身" };
const RESOURCE_LABELS = { troop: "人数", enigma: "エニグマポイント" };

/**
 * NPC取得用途の使用(エントリポイント。usage-list の「使用」ボタンから)。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage npcAcquire=true の用途エントリ(取得設定・実行はモード駆動)
 */
export async function useNpcAcquire(item, usage) {
    const actor = item.actor;
    if (!actor) {
        ui.notifications.warn("NPC取得はアクターが所持しているアイテムからのみ使用できます。");
        return;
    }
    const mode = usage.acquireMode || "extra";
    if (mode === "extra") return useExtraAcquire(actor, item, usage);
    return useCheckAcquire(actor, item, usage, mode);
}

/**
 * エキストラモード: 判定なし。消費 → 派生取得 → トークン配置(同時)。
 */
async function useExtraAcquire(actor, item, usage) {
    const refs = usage.acquireItemRefs ?? [];
    if (!refs.length) {
        ui.notifications.warn("取得するエキストラ(小分類「エキストラ」のアウトフィット)が設定されていません。");
        return;
    }

    // 消費(エキストラモードは使用時に確定。キャンセルで使用ごと中止)
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${usage.name || item.name}` });
    if (plan === null) return;

    // 取得アイテムの解決(fromUuid ライブ解決)
    const sources = [];
    for (const ref of refs) {
        const src = ref.uuid ? await fromUuid(ref.uuid).catch(() => null) : null;
        if (!src) {
            ui.notifications.warn(`取得対象を解決できません(${ref.name || ref.uuid})。`);
            continue;
        }
        sources.push(src);
    }
    if (!sources.length) return;

    await applyConsumptionPlan(plan);

    // 派生データとして取得(常備化経験点なし=isDerivedData。既存の派生データ機構と同型)
    const toCreate = sources.map(src => {
        const data = src.toObject();
        delete data._id;
        data.system = data.system ?? {};
        data.system.isDerivedData = true;
        return data;
    });
    const created = await actor.createEmbeddedDocuments("Item", toCreate);
    ui.notifications.info(`${created.map(i => `「${i.name}」`).join("・")}を取得しました。`);

    // 同時に場に出す: 取得アウトフィットの extraActorRef(共有エキストラアクター)のトークン配置
    for (const src of sources) {
        const uuid = src.system?.extraActorRef?.uuid ?? "";
        const extraActor = uuid ? await fromUuid(uuid).catch(() => null) : null;
        if (!extraActor) {
            ui.notifications.warn(`「${src.name}」にエキストラアクターが関連付けられていません(アウトフィットのシートで設定してください)。`);
            continue;
        }
        await placeActorTokens(extraActor, 1);
    }
}

/**
 * 判定系モード(troop/enigma/bunshin): 対象解決 → レベル転記 → 通常判定起動。
 * 判定完了後の転記・配置は completeAcquisitionFromCheck(ctx.npcAcquire 経由)。
 */
async function useCheckAcquire(actor, item, usage, mode) {
    // 対象解決: トループ/エニグマは用途側の取得アクター参照(2026-07-07 裁定・ライブ解決)。
    // 分身は対象を設定せずそのまま召喚(2026-07-08 裁定)＝判定成功時に永続1体を自動確保する
    let target = null;
    if (mode !== "bunshin") {
        const refUuid = usage.acquireActorRef?.uuid ?? "";
        target = refUuid ? await fromUuid(refUuid).catch(() => null) : null;
        if (!target) {
            ui.notifications.warn(
                `呼び出す${MODE_LABELS[mode]}が設定されていません。事前に作成した${MODE_LABELS[mode]}のアクターを、`
                + `用途シートの「取得するアクター」にドロップしてください。`);
            return;
        }
        if (target.type !== "troop" || target.system.troopMode !== mode) {
            ui.notifications.warn(`「${target.name}」は${MODE_LABELS[mode]}のアクターではありません（用途の取得類型と一致させてください）。`);
            return;
        }
    }

    // 参加技能の解決(check と同じ: ベース=用途の baseSkillRef または親・コンボ=skillRefs)
    const baseId = usage.baseSkillRef?.itemId || item.id;
    const baseSkill = baseId === item.id ? item : actor.items.get(baseId);
    if (!baseSkill) {
        ui.notifications.warn(`「${item.name}」の用途に不備があります（ベース技能が見つかりません）。`);
        return;
    }
    const comboIds = (usage.skillRefs ?? []).map(r => r.itemId).filter(id => id && actor.items.has(id));
    if (item.id !== baseId && !comboIds.includes(item.id)) comboIds.push(item.id);
    const allSkillIds = [baseId, ...comboIds.filter(id => id !== baseId)];
    const skillSystems = allSkillIds.map(id => (id === item.id ? item : actor.items.get(id))?.system).filter(Boolean);
    const validSuits = getComboSuits(skillSystems);
    if (!validSuits.length) {
        ui.notifications.warn(`「${item.name}」の用途に不備があります（参加技能に共通スートがありません）。`);
        return;
    }

    // レベル転記(2026-07-04 確定: 取得技能のレベルがそのままトループ/エニグマのレベル。分身は対象外)
    if (mode !== "bunshin") {
        const level = Number(item.system.level) || 0;
        if ((target.system.troopLevel ?? 0) !== level) {
            await target.update({ "system.troopLevel": level }).catch(() =>
                ui.notifications.warn(`「${target.name}」のレベルを転記できませんでした（権限を確認してください）。`));
        }
    }

    // 消費(判定系は check と同じく判定実行時に適用。ダイアログは起動時)
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const usesPlan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
    if (usesPlan === null) return;

    const skillLabel = allSkillIds
        .map(id => (id === item.id ? item : actor.items.get(id))?.name ?? "")
        .filter(Boolean)
        .join("+");
    const actorBounty = (actor.system.bountyBase ?? 0) + (actor.system.bounty ?? 0);

    await TnxCheckFlow.open({
        type:            "skillCheck",
        actorId:         actor.id,
        skillIds:        allSkillIds,
        skillLabel,
        validSuits,
        targetValue:     mode === "bunshin" ? 10 : null,
        // 報酬点: 参加技能のいずれかが usesBounty なら可(2026-07-10 ユーザー確定)
        bountyAvailable: comboUsesBounty(skillSystems) ? actorBounty : 0,
        consumeUses:     usesPlan,
        requestMessageId: null,
        allowSuitChange: usage.allowSuitChange === true, // スート変更可能(用途の設定・2026-07-12)
        // 判定完了後の取得継続(TnxCheckFlow._execute → completeAcquisitionFromCheck)
        npcAcquire: {
            mode,
            targetActorId: target?.id ?? "",
            summonerActorId: actor.id,
            count: mode === "bunshin" ? Math.max(1, usage.acquireCount ?? 1) : 1,
        },
    });
}

/**
 * 召喚者の分身アクター(永続1体)を確保する(2026-07-08 裁定=分身は対象を設定せずそのまま召喚)。
 * 既存(所有者参照=召喚者の分身)があれば使い回し、無ければ初回のみ作成する。
 * 作成にはアクター作成権限が必要(無ければ警告のみ=D&D 同様。初回のみ RL に依頼)。
 */
async function ensureBunshinActor(summoner) {
    const existing = game.actors.find(a => a.type === "troop"
        && a.system.troopMode === "bunshin"
        && (a.system.ownerActorRef?.uuid ?? "") === summoner.uuid);
    if (existing) return existing;
    try {
        const created = await Actor.create({
            name: `${summoner.name}の分身`,
            type: "troop",
            system: {
                troopMode: "bunshin",
                ownerActorRef: { uuid: summoner.uuid, name: summoner.name },
            },
        });
        if (!created) throw new Error("Actor.create returned nothing");
        return created;
    } catch (err) {
        console.error("TNX | 分身アクターの作成に失敗しました", err);
        ui.notifications.warn("分身アクターを作成できませんでした（アクター作成権限が必要です。初回のみ RL に作成を依頼してください。以後は同じアクターを使い回します）。");
        return null;
    }
}

/**
 * 分身アクターを本体(分身元)から再同期する(差分反映方式・2026-07-07 承認)。
 * 分身は永続1体を使い回し、召喚のたびにその時点の本体データを丸ごと写す——
 * 分身するたびに古い分身がワールドに残る問題を構造的に解消する(削除連動は不要)。
 * - アイテム: 全削除→本体から複製(**神業は除外**=分身も神業不可の帰結)。keepId で複製する
 *   ことで、用途内の参照(ベース技能・コンボ・武器・消費先の itemId)が写し先でも成立する
 * - 能力値: 修正値=本体の修正値+成長 / 制御修正値=本体の制御修正値+制御成長 の焼き込み
 *   (+troopLevel=0)。スタイル・アウトフィットが同一になるため実効値は本体と完全一致
 *   (2026-07-07 確定)。CS/AR は分身の固定ルール(CS=0・AR=1)のため写さない
 * - 所有者参照=本体を自動設定(分身名の導出・使用回数共有の紐づけ)
 * 分身アクターへの手動編集は再同期で失われる(本体のコピーという性質上の正しい挙動)。
 */
async function syncBunshinFromOwner(target, owner) {
    const oldIds = target.items.map(i => i.id);
    if (oldIds.length) await target.deleteEmbeddedDocuments("Item", oldIds);
    const copies = owner.items
        .filter(i => i.type !== "miracle")
        .map(i => i.toObject());
    if (copies.length) await target.createEmbeddedDocuments("Item", copies, { keepId: true });
    await target.update({
        ...buildBunshinAbilityMods(owner.system),
        "system.troopLevel": 0,
        "system.ownerActorRef": { uuid: owner.uuid, name: owner.name },
    });
}

/**
 * 判定完了後の取得継続(TnxCheckFlow._execute から呼ばれる)。
 * トループ/エニグマ: heads(現在/最大)=達成値を転記+配置。分身: 成功時のみ sourceName 自動設定+配置。
 * @param {{mode:string, targetActorId:string, summonerActorId:string}} payload ctx.npcAcquire
 * @param {object} result 判定結果
 */
export async function completeAcquisitionFromCheck(payload, result) {
    const summoner = game.actors.get(payload.summonerActorId);
    let target = payload.mode === "bunshin" ? null : game.actors.get(payload.targetActorId);
    if (payload.mode !== "bunshin" && !target) return;

    const outcome = computeAcquisitionOutcome(payload.mode, result);
    if (!outcome.acquired) {
        const label = target?.name ?? "分身";
        const reasonText = outcome.reason === "fumble" ? "ファンブルのため"
            : outcome.reason === "failed" ? "判定に失敗したため(達成値が目標値10に届かず)"
            : "達成値が 0 のため";
        ui.notifications.warn(`${reasonText}「${label}」は取得されませんでした。`);
        return;
    }

    let count = 1;
    if (payload.mode === "bunshin") {
        // 分身はそのまま召喚(2026-07-08 裁定): 永続1体を確保し、差分反映方式で本体の最新データへ
        // 丸ごと再同期してから、召喚数ぶんのトークンを配置する
        if (!summoner) return;
        target = await ensureBunshinActor(summoner);
        if (!target) return;
        try {
            await syncBunshinFromOwner(target, summoner);
        } catch (err) {
            console.error("TNX | 分身の再同期に失敗しました", err);
            ui.notifications.warn(`「${target.name}」を本体から再同期できませんでした（権限を確認してください）。`);
        }
        count = Math.max(1, payload.count ?? 1);
    } else {
        await target.update({
            "system.heads.value": outcome.heads,
            "system.heads.max":   outcome.heads,
        }).catch(() => ui.notifications.warn(`「${target.name}」の${RESOURCE_LABELS[payload.mode]}を転記できませんでした（権限を確認してください）。`));
    }

    const detail = payload.mode === "bunshin"
        ? `${count}体`
        : `${RESOURCE_LABELS[payload.mode]} ${outcome.heads}`;
    await ChatMessage.create({
        speaker: summoner ? ChatMessage.getSpeaker({ actor: summoner }) : undefined,
        content: `<div class="tnx-chat-card"><p>「${foundry.utils.escapeHTML(target.name)}」を取得（${detail}）。</p></div>`,
    });

    await placeActorTokens(target, count);
}

