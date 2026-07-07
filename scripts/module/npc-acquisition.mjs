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
 * フェーズ10 の技能側 autoAcquireActors はこのフローでは使わない(残置のみ・2026-07-04 確定)。
 * レベル転記: 取得技能のレベルがそのままトループ/エニグマのレベルになる(起動時に転記)。
 *
 * 判定はキャストの技能判定と完全に同一(カード・報酬点・判定バフ・消費先設定)。判定完了後の
 * 継続は TnxCheckFlow._execute から completeAcquisitionFromCheck が呼ばれる(ctx.npcAcquire)。
 */

import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { getComboSuits } from "./tnx-check-engine.mjs";
import { resolveConsumeRowsForActor, promptConsumption, applyConsumptionPlan } from "./usage-consumption.mjs";
import { placeActorTokens } from "./tnx-token-placement.mjs";
import { computeAcquisitionOutcome } from "./npc-acquisition-logic.mjs";

const MODE_LABELS = { extra: "エキストラ", troop: "トループ", enigma: "エニグマ", bunshin: "分身" };
const RESOURCE_LABELS = { troop: "人数", enigma: "エニグマポイント" };

/**
 * NPC取得用途の使用(エントリポイント。usage-list の「使用」ボタンから)。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage npcAcquire 用途エントリ
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
    // 対象解決: 用途側の取得アクター参照(2026-07-07 裁定・ライブ解決)
    const refUuid = usage.acquireActorRef?.uuid ?? "";
    const target = refUuid ? await fromUuid(refUuid).catch(() => null) : null;
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
    const validSuits = getComboSuits(allSkillIds.map(id => (id === item.id ? item : actor.items.get(id))?.system).filter(Boolean));
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
        bountyAvailable: baseSkill.system.usesBounty === true ? actorBounty : 0,
        consumeUses:     usesPlan,
        requestMessageId: null,
        // 判定完了後の取得継続(TnxCheckFlow._execute → completeAcquisitionFromCheck)
        npcAcquire: { mode, targetActorId: target.id, summonerActorId: actor.id },
    });
}

/**
 * 判定完了後の取得継続(TnxCheckFlow._execute から呼ばれる)。
 * トループ/エニグマ: heads(現在/最大)=達成値を転記+配置。分身: 成功時のみ sourceName 自動設定+配置。
 * @param {{mode:string, targetActorId:string, summonerActorId:string}} payload ctx.npcAcquire
 * @param {object} result 判定結果
 */
export async function completeAcquisitionFromCheck(payload, result) {
    const target = game.actors.get(payload.targetActorId);
    const summoner = game.actors.get(payload.summonerActorId);
    if (!target) return;

    const outcome = computeAcquisitionOutcome(payload.mode, result);
    if (!outcome.acquired) {
        const reasonText = outcome.reason === "fumble" ? "ファンブルのため"
            : outcome.reason === "failed" ? "判定に失敗したため(達成値が目標値10に届かず)"
            : "達成値が 0 のため";
        ui.notifications.warn(`${reasonText}「${target.name}」は取得されませんでした。`);
        return;
    }

    // 分身は転記なし(名前は所有者参照から syncTroopName が導出・ダメージ管理も不要)
    if (payload.mode !== "bunshin") {
        await target.update({
            "system.heads.value": outcome.heads,
            "system.heads.max":   outcome.heads,
        }).catch(() => ui.notifications.warn(`「${target.name}」の${RESOURCE_LABELS[payload.mode]}を転記できませんでした（権限を確認してください）。`));
    }

    const detail = payload.mode === "bunshin"
        ? "呼び出しに成功しました"
        : `${RESOURCE_LABELS[payload.mode]} ${outcome.heads}`;
    await ChatMessage.create({
        speaker: summoner ? ChatMessage.getSpeaker({ actor: summoner }) : undefined,
        content: `<div class="tnx-chat-card"><p>「${foundry.utils.escapeHTML(target.name)}」を取得（${detail}）。</p></div>`,
    });

    await placeActorTokens(target, 1);
}

