/**
 * @fileoverview 用途の起動＝**唯一の起動関数** activateItemCheck とその周辺(2026-09-07 移設)。
 *
 * 経緯: この関数は「シートの技能クリック」から生まれたためアクターシート基底の static メンバに
 * 置かれていたが、実体は用途を読んで各フローへ振り分ける**フローの入口**であり、シートの状態
 * (this)を一切使わない。置き場が実態と合わないせいで、フロー側から呼ぶ 13 箇所すべてが
 * `await import("../actor/tnx-character-sheet-base.mjs")` という循環回避の動的 import を書き、
 * 起動のたびに 3,000 行のシートクラスとその依存 56 本を評価していた。関数は 1 つのまま、
 * 呼ばれるべき階層へ移す(「起動関数を増やさない」規約は名前が 1 つであることを指す)。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { isOutfitUnusable, isOutfitDestroyed } from "../data/item/helpers.mjs";
import { TnxCheckFlow } from "./tnx-check-flow.mjs";
import { resolveConsumeRowsForActor, promptConsumption, applyConsumptionPlan } from "./usage-consumption.mjs";
import { useNpcAcquire } from "./npc-acquisition.mjs";
import { useRecovery } from "./recovery-flow.mjs";
import { useRepair } from "./repair-flow.mjs";
import { buildUsageCheckContext } from "./usage-check-context.mjs";
import { useAttack, useOpposedCheck } from "./attack-flow.mjs";
import { prepareUsageEffectPayload } from "./usage-effects.mjs";
import { applyInterruptGrantForUsage } from "./interrupt-grant.mjs";
import { useMiracleWithoutUsage, postMiracleCard, resolveMiracleRewrite, useMiracleDamage, useMiracleDestroy, resolveMiracleCopyFromLog } from "./miracle-flow.mjs";
import { withDefaultMiracleConsumption, withoutConsumption } from "../rules/miracle.mjs";
import { isAttackUsage } from "../data/item/common/usage.mjs";
import { executionFormOf, usageDisplayName, isReactionType, isMiracleType } from "../rules/usage-types.mjs";
import { itemDisplayName } from "../core/identification.mjs";
import { isOpposedConfrontation } from "../rules/confrontation.mjs";
import { startPurchasePicker } from "./purchase-flow.mjs";
import { useModification } from "./modification-flow.mjs";
import { resolveUsageTargetRefs } from "./target-resolution.mjs";

/**
 * 技能/アイテムの用途起動＝**唯一の起動関数**(2026-07-15 ユーザー確定)。シートの技能クリックだけで
 * なく、リアクション・治療・操縦移動・判定要求・アイテムシートの使用ボタンなど**あらゆる技能起動は
 * この 1 関数を通す**(入口は多くてよいが、起動処理を実際に行うのはここだけ)。用途選択→分岐
 * (カバー/NPC取得/バフ宣言/回復/攻撃/固定値/宣言使用)→通常判定(共通前段=buildUsageCheckContext
 * →TnxCheckFlow.open)。**組み合わせ(コンボ)の可否はユーザー/RL が決めるものであり、システム側は
 * 一切制限しない。** extraOpen は各入口が注入する追加文脈(reaction/movement/requestMessageId/
 * substitution/manualMod・目標値上書き等)で、通常判定の open へ最後に合流する。treatment は
 * 治療メニュー起点の prebound 文脈で、回復フローの分岐が消費する(open へは流れない・2026-07-18)。
 * usageId は用途の直接指定(アイテムシートの使用ボタン=ピッカーを出さない・2026-07-16 統合)。
 * @param {Actor} actor 起動アクター
 * @param {Item} item 起動する技能/アイテム
 * @param {object} [extraOpen] TnxCheckFlow.open へ合流する追加パラメータ(既定値を上書き可)。
 *   miracleFree={messageId}: 《プリーズ！》の要求カードから使わされる神業(残回数ゲートも消費も無い・17-4)。
 *   asOther={uuid,name,source}: 効果の参照/コピー(17-5)の解決済みの参照先(再入時に載る)
 * @returns {Promise<boolean|undefined>} 神業の分岐は発動したか(要求カードが使用済みを記録する)。判定系は未定義
 */
export async function activateItemCheck(actor, item, extraOpen = {}) {
    // usageId(用途の直接指定)は起動制御のみに使い、open へは流さない
    const { usageId: directUsageId, ...openExtra } = extraOpen;

    // 故障/破壊(2026-07-18): 故障または破壊したアウトフィットはロール(使用)できない。修理用途は
    // 〈製作〉技能側にあるため対象外——ここでブロックされるのは壊れたアウトフィット自身のロール
    // (その武器を使う攻撃判定の禁止は useAttack 側)。サービス大分類は免疫(isOutfitUnusable=false)。
    if (OUTFIT_ITEM_TYPES.has(item.type) && isOutfitUnusable(item.system)) {
        const state = isOutfitDestroyed(item.system) ? "破壊" : "故障";
        ui.notifications.warn(`「${item.name}」は${state}しているため使用できません。`);
        return;
    }

    // 既定の挙動: 用途が無ければ、解説をそのままチャット表示する(アイテムの基本機能)。
    // 用途があればその実行に切り替わる(経路の漏れを作らない=11-6/12-2 の確定方針)。
    // **用途は種別で絞らない**(2026-07-19 ユーザー指示「宣言用途を勝手に除外しないでください」)——
    // フラグ無しの宣言も含め全用途が候補。下の分岐がすべての用途に実行経路を持つ(宣言は
    // _useDeclarationUsage=消費と適用効果)ため、除外すると到達不能な用途が生まれる。
    // 旧 usableUsagesOf(フラグ無し宣言を除外)は廃止=アウトフィットのように宣言用途しか
    // 持たないアイテムがロールできず解説カードに落ちていた。
    // ※判定要求への応答は別規則(canAnswerCheckRequest=判定タイプ限定・2026-07-19 ユーザー裁定)。
    // 効果の参照(17-5・《万能道具》《神意》《半身》)は**実体を写す**方式(2026-09-06 方針A)。
    // 効果を決めた時点で参照先の用途と経験点条件がこの神業へコピーされているので、
    // ここでは何もしない(実行時の間接参照は《突然変異》のコピーだけ=openExtra.asOther)
    let asOther = openExtra.asOther ?? null;

    // 神業書き換え技能(スタイル技能・神業と同じタイミングで使い、その1回の効果を書き換える):
    // 対応する技能を使用回数を残して持っていれば、ここで「書き換えるか」を尋ねる。書き換えを
    // 選ぶと技能が使用され、以降は効果の出どころが差し替わったまま既存の分岐を通る
    // (名前・使用回数・神業由来の印は元の神業のまま)。再入(出どころが決まっている)では尋ねない。
    // 《プリーズ！》で使わされる神業でも尋ねる——使うのは本人であり、書き換えるのも本人のため
    if (item.type === "miracle" && !asOther) {
        const rewritten = await resolveMiracleRewrite(actor, item, { free: !!openExtra.miracleFree });
        if (rewritten === "cancel") return false;
        if (rewritten) {
            asOther = rewritten;
            openExtra.asOther = rewritten; // 再入する分岐(アウトフィットの入手など)へも引き継ぐ
        }
    }

    const usableUsages = (asOther?.source ?? item).system.actions ?? [];

    // 用途を決定（直接指定→カバー再入の引き継ぎ→1つなら自動選択→複数はピッカー表示）。
    // カバーの判定起動(covering)は、待ち受け開始時に確定した用途を再選択せず引き継ぐ。
    let selectedUsage;
    if (directUsageId) {
        selectedUsage = usableUsages.find(a => a._id === directUsageId) ?? null;
        if (!selectedUsage) return;
    } else if (openExtra.covering?.usageId) {
        selectedUsage = usableUsages.find(a => a._id === openExtra.covering.usageId) ?? null;
        if (!selectedUsage) return;
    } else if (!usableUsages.length) {
        // 神業(17-1)は用途が無くても機能する: 残回数ゲート→使用回数の消費→神業カード。
        // 用途は前提条件でなく、固有の挙動(打ち消し・防御・ダメージ等)を足すためのもの
        // 《プリーズ！》で使わされる(openExtra.miracleFree)ときは残回数ゲートも消費も無い(17-4)
        if (item.type === "miracle") return useMiracleWithoutUsage(item, { free: !!openExtra.miracleFree, asOther });
        await item.postDescriptionCard();
        return;
    } else if (usableUsages.length === 1) {
        selectedUsage = usableUsages[0];
    } else {
        selectedUsage = await promptCheckUsage(usableUsages, item.name);
        if (!selectedUsage) return;
    }

    // 神業(17-1): 消費先が空の用途は自身の使用回数×1を既定消費する(使用＝回数消費が定義に
    // 含まれる。実行時のみ補い保存しない)。用途の分岐(宣言・クリック待ち・治療 等)のどれを
    // 通っても効くよう、用途が決まった直後のここ1か所で差し替える。神業は判定を行わない
    // 《プリーズ！》で使わされる神業(openExtra.miracleFree・17-4)は「使用済みにならない」=既定消費を補わず
    // 消費先を空にする。以降の全分岐は消費行ゼロで動き(消費ダイアログも出ない)、神業の挙動だけが起こる
    if (item.type === "miracle") {
        selectedUsage = openExtra.miracleFree ? withoutConsumption(selectedUsage) : withDefaultMiracleConsumption(selectedUsage);
    }

    // カバー(2026-07-16→2026-07-17 タイプ化): アイテムロールで使用したら「カバー待ち受け」に入り、
    // ダメージカードのカバーする対象クリックで判定を起動する(covering 文脈つきで本関数へ再入=下の
    // 通常判定へ合流)。再入時(openExtra.covering)はこの分岐を通さず通常判定を行う。
    if (selectedUsage.type === "covering" && !openExtra.covering) {
        TnxCheckFlow.startAchievementAction("covering", actor, item, { usageId: selectedUsage._id });
        return;
    }

    // 購入(16-3 追補・2026-08-31): 購入用途をアイテムロールから起動したら、アウトフィットのみの
    // 辞典ブラウザ(選択モード)を開いて対象を選ばせる(D&D のドロップエリア起動と同型)。対象の
    // 購入ボタンで購入文脈(openExtra.purchase)つきで本関数へ合流し、通常判定へ流れる
    if (selectedUsage.type === "purchase" && !openExtra.purchase) {
        await startPurchasePicker(actor, item, selectedUsage);
        return;
    }

    // ヴィークル準備時(2026-07-18 一般化): 用途フラグ requiresVehicle がオンなら準備済みヴィークルが
    // 無ければ判定できない。参照は完全に単一(空=準備済みを自動解決)。移動タイプは移動文脈
    // (達成値÷10 段階の移動カード)をここで注入する(旧・戦闘タブの合成アクションを置換)
    if (selectedUsage.requiresVehicle === true) {
        const refId = selectedUsage.vehicleRef?.itemId || "";
        let vehicle = null;
        if (refId) {
            const v = actor.items.get(refId);
            vehicle = (v && v.type === "vehicle" && v.system.isPrepared) ? v : null;
        } else {
            vehicle = actor.items.find(i => i.type === "vehicle" && i.system.isPrepared) ?? null;
        }
        if (!vehicle) {
            ui.notifications.warn("準備済みのヴィークルが無いため、この判定は行えません。");
            return;
        }
        if (selectedUsage.type === "move" && !openExtra.movement) {
            openExtra.movement = { actorId: actor.id, vehicleName: vehicle.name, skillName: item.name };
        }
    }

    // NPC取得(2026-07-13 フラグ化)は専用フローへ(消費・対象解決・判定・転記・配置を一貫して扱う)
    if (selectedUsage.npcAcquire === true) {
        try {
            await useNpcAcquire(item, selectedUsage);
        } catch (err) {
            console.error("TNX | NPC取得の実行に失敗しました", err);
            ui.notifications.error(`NPC取得の実行に失敗しました: ${err.message}`);
        }
        return;
    }

    // クリック待ち系の用途(2026-07-11): 判定を行わず「クリック待ち」モードに入る。
    // 再判定を付与=達成値クリックでその判定にこの技能を組み合わせた再判定を起動。
    // 判定を修正=達成値クリックでその判定に事後ボーナス/ペナルティを適用。
    // ダメージを修正=ダメージカードの攻撃側合計クリックでそのダメージに修正を適用。
    // スートを変更=次の自分の判定で使用不可スートを出したとき使用可能スートへ変更(2026-07-12)。
    // 宣言(declaration)の再判定を付与/判定を修正/ダメージを修正/スートを変更も同経路
    // (バフ宣言・2026-07-12。再判定を付与は 2026-07-13=判定でないため組み合わせなし)。
    // 複数フラグ ON は上記の順で先に振る(排他 UI にはしない・複数 ON の運用は想定しない)。
    // 消費は用途の consumeTargets(プランを持ち回り、発動時に適用)
    if ((selectedUsage.type === "check" || selectedUsage.type === "declaration")
        && (selectedUsage.grantRecheck === true || selectedUsage.modifyCheck === true
            || selectedUsage.modifyDamage === true || selectedUsage.grantSuitChange === true)) {
        const kind = selectedUsage.grantRecheck === true ? "recheck"
            : (selectedUsage.modifyCheck === true ? "modify"
                : (selectedUsage.modifyDamage === true ? "modifyDamage" : "suitChange"));
        const grantRows = resolveConsumeRowsForActor(actor, item, selectedUsage.consumeTargets);
        const grantPlan = await promptConsumption(actor, grantRows, { title: `使用回数の消費: ${item.name}` });
        if (grantPlan === null) return;
        TnxCheckFlow.startAchievementAction(kind, actor, item, {
            usageId: selectedUsage._id, consumeUses: grantPlan, merge: selectedUsage.type === "check",
        });
        return;
    }

    // 治療(2026-07-13→2026-07-17 タイプ化→2026-07-18 一本化): 常に回復フローへ。
    // 治療メニュー起点(openExtra.treatment=患者・クリック状態が確定済み)は prebound 文脈として
    // 渡し、対象解決・回復対象の選択をスキップする(宣言形=即除去/判定形=完了継続 ctx.recovery)
    if (selectedUsage.type === "treatment") {
        try {
            await useRecovery(item, selectedUsage, openExtra.treatment ?? null);
        } catch (err) {
            console.error("TNX | 治療の実行に失敗しました", err);
            ui.notifications.error(`治療の実行に失敗しました: ${err.message}`);
        }
        return;
    }

    // 修理(2026-07-18 タイプ化): 専用フローへ(対象解決→修理可能な故障アウトフィットの選択→
    // 判定へ。完了継続 ctx.repair が成功で故障を解除)。判定のみ(selectableForm なし)。
    if (selectedUsage.type === "repair" && !openExtra.repair) {
        try {
            await useRepair(item, selectedUsage);
        } catch (err) {
            console.error("TNX | 修理の実行に失敗しました", err);
            ui.notifications.error(`修理の実行に失敗しました: ${err.message}`);
        }
        return;
    }

    // 改造(16-4): 専用フローへ(対象解決→対象アウトフィット選択→項目選択(判定前)→判定。
    // 完了継続 ctx.modification が成功で改造行を適用)
    if (selectedUsage.type === "modification" && !openExtra.modification) {
        try {
            await useModification(item, selectedUsage);
        } catch (err) {
            console.error("TNX | 改造の実行に失敗しました", err);
            ui.notifications.error(`改造の実行に失敗しました: ${err.message}`);
        }
        return;
    }

    // 攻撃(攻撃タイプ・2026-07-17 再編)は専用フローへ(武器解決・対象決定・成否保留の
    // 対決判定カード・リアクション対決=12-2)
    if (isAttackUsage(selectedUsage)) {
        try {
            await useAttack(item, selectedUsage);
        } catch (err) {
            console.error("TNX | 攻撃の実行に失敗しました", err);
            ui.notifications.error(`攻撃の実行に失敗しました: ${err.message}`);
        }
        return;
    }

    // 対決判定(2026-07-17 ユーザー確定): 対決欄に「-」「なし」以外の行がある判定は、成否保留の
    // 対決判定カードへ(攻撃は上の専用フローが同カードを出す)。リアクション・カバー・判定要求の
    // 文脈で行う判定は対決の入れ子にしない(その判定自体が対決・要求の解決側のため)
    if (executionFormOf(selectedUsage) === "check" && !Number.isFinite(selectedUsage.fixedResult)
        && isOpposedConfrontation(selectedUsage.confrontation)
        && !openExtra.reaction && !openExtra.covering && !openExtra.requestMessageId) {
        try {
            await useOpposedCheck(item, selectedUsage, openExtra);
        } catch (err) {
            console.error("TNX | 対決判定の実行に失敗しました", err);
            ui.notifications.error(`対決判定の実行に失敗しました: ${err.message}`);
        }
        return;
    }

    // 固定達成値の用途(フェーズ11-5・Check_Rules「固定値判定」): カードも出さず能力値も参照せず、
    // 記載の数値がそのまま達成値になる。エキストラが行える唯一の判定形(他アクターでも使用可)
    if (Number.isFinite(selectedUsage.fixedResult)) {
        await postFixedCheckResult(actor, item, selectedUsage);
        return;
    }

    // 宣言(実行フラグなし)の使用: 判定を行わず消費と適用効果だけ処理する。用途の直接指定
    // (アイテムシートの使用ボタン)に加え、**アイテムロールからも到達する**(2026-07-19 ユーザー指示で
    // 候補から除外しなくなった。2026-07-16 にアイテムシートから移設・統合した実行本体は同じ)
    // 防御タイプ(17-2・神業専用): 動作で分岐する。受けた後に消す=治療の宣言形(回復フロー)。
    // 適用前に防ぐ/打ち消し/回避=クリック待ち(消費は待ち受け開始時に確定し発動時に適用)
    if (selectedUsage.type === "miracleDefence") {
        const action = selectedUsage.defenceAction || "prevent";
        if (action === "cure") {
            try {
                return await useRecovery(item, selectedUsage, openExtra.treatment ?? null, { asOther }) === true;
            } catch (err) {
                console.error("TNX | 神業の治癒の実行に失敗しました", err);
                ui.notifications.error(`神業の治癒の実行に失敗しました: ${err.message}`);
                return false;
            }
        }
        const kind = { prevent: "protect", negate: "negate", evade: "evade" }[action] ?? "protect";
        const rows = resolveConsumeRowsForActor(actor, item, selectedUsage.consumeTargets);
        const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${item.name}` });
        if (plan === null) return;
        TnxCheckFlow.startAchievementAction(kind, actor, item, {
            usageId: selectedUsage._id, usage: selectedUsage, consumeUses: plan, merge: false, asOther,
        });
        return true;
    }

    // 即死・社会戦(17-3): 対象解決→消費→結果の選択→神業版のダメージカード(軽減を通さない)
    if (selectedUsage.type === "miracleKill" || selectedUsage.type === "miracleSocial") {
        try {
            return await useMiracleDamage(actor, item, selectedUsage, { asOther });
        } catch (err) {
            console.error("TNX | 神業のダメージの実行に失敗しました", err);
            ui.notifications.error(`神業のダメージの実行に失敗しました: ${err.message}`);
            return false;
        }
    }
    // 破壊(17-3): 対象解決→未破壊のアウトフィットを選ぶ→神業カードに結果行と適用ボタン
    if (selectedUsage.type === "miracleDestroy") {
        try {
            return await useMiracleDestroy(actor, item, selectedUsage, { asOther });
        } catch (err) {
            console.error("TNX | 神業の破壊の実行に失敗しました", err);
            ui.notifications.error(`神業の破壊の実行に失敗しました: ${err.message}`);
            return false;
        }
    }
    // 宣言の効果(17-4/17-6・神業の宣言タイプ): 設定があれば専用の流れ。addUse/requestUse=他の神業への
    // 干渉(対象1人→消費→神業カードの段・適用/使用は対象の操作者)／swapDamage=《神出鬼没》(状態の
    // 入れ替え・適用は RL か両者の操作者)／acquireOutfit=《タイムリー》《買収》(辞典ブラウザで選んで
    // 再入→複製を付与・神業由来の印=常備化できない)／insensible=《不可知》(次の行動に印)
    if (selectedUsage.type === "miracleDeclaration" && selectedUsage.miracleEffect) {
        const effect = selectedUsage.miracleEffect;
        if (effect === "acquireOutfit" && !openExtra.purchase) {
            const { TnxDictionaryBrowser } = await import("../app/tnx-dictionary-browser.mjs");
            TnxDictionaryBrowser.openOutfitPicker({
                actorId: actor.id, itemId: item.id, usageId: selectedUsage._id, miracle: true,
                asOtherUuid: asOther?.uuid ?? "", rewriteId: asOther?.via?.itemId ?? "",
            });
            return false;
        }
        // 見聞きした神業のコピー(《突然変異》): コピー元を決めて**その用途で再入**する。
        // 名前・使用回数・印・消費・話者は元の神業のまま(効果の参照と同じ再入の仕組み)
        if (effect === "copyUsed" && !asOther) {
            const picked = await resolveMiracleCopyFromLog(actor, item);
            if (!picked) return false;
            return activateItemCheck(actor, item, { ...openExtra, asOther: picked });
        }
        try {
            const mf = await import("./miracle-flow.mjs");
            if (effect === "swapDamage")    return await mf.useMiracleSwap(actor, item, selectedUsage, { asOther });
            if (effect === "acquireOutfit") return await mf.useMiracleAcquire(actor, item, selectedUsage, { uuid: openExtra.purchase.uuid, asOther });
            if (effect === "insensible")    return await mf.useMiracleInsensible(actor, item, selectedUsage, { asOther });
            return await mf.useMiracleInterference(actor, item, selectedUsage, { asOther });
        } catch (err) {
            console.error("TNX | 神業の宣言の効果の実行に失敗しました", err);
            ui.notifications.error(`神業の宣言の効果の実行に失敗しました: ${err.message}`);
            return false;
        }
    }

    // 神業専用タイプ(17-2)は判定を行わない。宣言=17-1 の宣言経路(神業カード＋適用効果)
    if (selectedUsage.type === "declaration" || isMiracleType(selectedUsage.type)) {
        return await useDeclarationUsage(actor, item, selectedUsage, { asOther }) === true;
    }

    // リアクションの適用効果は攻撃者へ返す(リアクションの対象は「なし」=万一 AE があれば攻撃者に
    // 付与・2026-07-15 ユーザー確定)。攻撃者を対象上書きとして渡し、対象確認ダイアログを挟まない。
    let effectTargetOverride;
    if (openExtra.reaction) {
        effectTargetOverride = [];
        const atkMsg = openExtra.reaction.attackMessageId
            ? game.messages.get(openExtra.reaction.attackMessageId) : null;
        const atkF = atkMsg?.getFlag(game.system.id, "attackCheck");
        if (atkF?.attackerUuid) {
            const atkDoc = await fromUuid(atkF.attackerUuid).catch(() => null);
            const atkActor = atkDoc?.actor ?? atkDoc;
            if (atkActor) effectTargetOverride = [{ uuid: atkActor.uuid, name: atkActor.name }];
        }
    }

    // 判定起動の共通前段(エキストラ制限・不備検知・参加技能・報酬点・消費・適用効果・目標値)。
    // 攻撃/NPC取得/回復の専用フローも同じ前段を通る(2026-07-16 一本化)
    const base = await buildUsageCheckContext(actor, item, selectedUsage, { effectTargetOverride });
    if (!base) return;

    // リアクション用途の追加挙動(範囲攻撃へのリアクション/攻撃を失敗させる)を reaction 文脈へ載せる
    // (完了継続 completeReactionFromCheck が参照する・2026-07-15)
    if (openExtra.reaction) {
        openExtra.reaction = {
            ...openExtra.reaction,
            reactionAreaAttack: selectedUsage.reactionAreaAttack === true,
            reactionFailsAttack: selectedUsage.reactionFailsAttack === true,
        };
    }

    // extraCheckBonuses(14-5): 入口が供給する追加の判定ボーナス行(固定ラベル可)。上書きでなく
    // 共通前段の checkBonuses へ**追記**する(例=登場判定の危険値ペナルティ)
    const { extraCheckBonuses, ...restOpen } = openExtra;
    await TnxCheckFlow.open({
        ...base,
        // 各入口が注入する追加文脈(reaction/treatment/movement/requestMessageId・目標値上書き等)を
        // 最後に合流(既定値を上書き可)。起動集約の要=各入口はここに文脈を載せるだけ(2026-07-15)
        ...restOpen,
        ...(extraCheckBonuses?.length
            ? { checkBonuses: [...(base.checkBonuses ?? []), ...extraCheckBonuses] }
            : {}),
    });
}

/**
 * 宣言(実行フラグなし)の使用(2026-07-16 アイテムシートの使用ボタンから移設): 判定を行わず、
 * 使用回数の消費(使用時に確定・適用)→解説カード(postDescriptionCard)を投稿する
 * (2026-08-30 統合)。適用効果があればカード末尾に「効果を適用」ボタンが注入される。
 */
export async function useDeclarationUsage(actor, item, usage, { asOther = null } = {}) {
    // 対象解決(2026-08-30 是正): 宣言も判定系と同じ決定表駆動の対象解決を通す(自身/単体の
    // 自動セルフ等)。従来は素通りでレティクル頼み=対象=自身の宣言がノーターゲットで
    // 「対象なし」になる欠陥だった。キャンセルは中止(消費より前に置く)
    if (await resolveUsageTargetRefs(actor, usage) === null) return;

    // 分身は本体側カウンターへ差し替えて共有(Troops.md)。神業の既定消費は起動関数で用途に
    // 補われて届く(17-1)
    const rows = resolveConsumeRowsForActor(actor, item, usage.consumeTargets);
    const plan = await promptConsumption(actor, rows, { title: `使用回数の消費: ${usage.name || item.name}` });
    if (plan === null) return;
    await applyConsumptionPlan(plan);

    // 割り込み許可(13-5): grantsInterrupt の宣言用途は対象へ割り込み許可を立てる(効果が無くても)
    await applyInterruptGrantForUsage(actor, usage);

    // 用途の適用効果: ペイロードを組んで解説カードに載せる(判定を伴わない用途=宣言等・
    // 2026-07-10)。使用カードはアイテムの解説カードに統合(2026-08-30 ユーザー承認)——宣言は
    // 判定を行わず組み合わせも無いため、効果文=解説をカードで卓に提示する。適用効果が
    // あれば効果セクション(トレイ)が末尾に注入され、無くてもカードは出す
    // (旧・実行者ローカル通知はカード化に伴い廃止=他クライアントに見えなかった)。
    // 神業は神業カード(印つき・条件と残り使用回数を持つ)で出す(17-1)。神業は「適用される効果」を
    // 持たない(2026-09-07 ユーザー指示で用途シートのセクションごと削除)ため、ペイロードも組まない。
    // 解説の段(効果文と条件)は**具体的な効果を持たない宣言**のときだけ出す(2026-09-05 ユーザー指示)。
    // 宣言の効果(使用回数+1・神業を使わせる・入れ替え 等)を持つ用途は結果がカードに出る
    if (item.type === "miracle") { await postMiracleCard(item, { asOther }); return true; }
    const usageEffects = await prepareUsageEffectPayload(actor, asOther?.source ?? item, usage);
    await item.postDescriptionCard({ usageEffects });
    return true; // 発動した(神業の要求カードが使用済みを記録する・17-4)
}

/**
 * 固定達成値の判定結果をチャットへ出す(フェーズ11-5・Check_Rules「固定値判定」)。
 * カード・能力値・報酬点を使わないため通常の判定フロー(TnxCheckFlow)を経由しない。
 * flags は通常判定と同じ checkResult 形で持たせ、対決の読み取り等から同様に扱えるようにする。
 */
export async function postFixedCheckResult(actor, item, usage) {
    const achievement = Math.max(0, Number(usage.fixedResult) || 0);
    const result = {
        achievement,
        cardValue: 0, abilityVal: 0, bountyUsed: 0,
        targetValue: null, diff: null,
        success: null, fixed: true,
    };
    // 通常の判定結果カード(check-result.hbs)の固定値分岐で描画する(レイアウト統一)。
    // カードを引かないためカード行はバッジ「固定値」のみ・計算内訳は達成値の合計行のみ
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/tokyo-nova-axleration/templates/chat/check-result.hbs",
        {
            actor,
            actorName:      actor?.name ?? "不明",
            typeLabel:      "技能判定",
            skillLabel:     itemDisplayName(item),
            isFixedCheck:   true,
            result,
            checkSources:   [],
            hasCheckBonus:  false,
            isControlCheck: false,
            isFixed21:      false,
            hasTargetValue: false,
            showSuccess:    false,
        }
    );
    await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ actor }),
        flags: {
            [SYSTEM_ID]: {
                checkResult: { actorId: actor.id, result },
            },
        },
    });
}

/** 複数の用途を D&D スタイルの縦ボタンダイアログで選択させる */
export async function promptCheckUsage(usages, skillName) {
    // NPC取得は 2026-07-13 のフラグ化で type でなく usage.npcAcquire に載る(旧 type 参照は死に分岐)。
    // 宣言(判定を行わない用途)は判定と並ぶため別アイコンで区別する(2026-07-19 に候補へ復帰)
    const iconFor = (u) => u.npcAcquire === true ? "fas fa-users"
        : isAttackUsage(u) ? "fas fa-burst"
            : isReactionType(u.type) ? "fas fa-shield-halved"
                : executionFormOf(u) === "declaration" ? "fas fa-bullhorn" : "fas fa-diamond";
    // 名前が空のときは実効名「タイプ名（親アイテム名）」(usageDisplayName と同一規約)。
    // 親名は素の名前=実効名規約どおり(2026-07-19 訂正: 旧コメント「呼び出し側で〈〉整形済み」は
    // 実装と食い違い——呼び出し側は従来から item.name を渡している)
    const labelFor = (u) => usageDisplayName(u, skillName);
    const buttons = [
        ...usages.map((u, i) => ({
            action:   String(i),
            icon:     iconFor(u),
            label:    labelFor(u),
            callback: () => i,
        })),
        { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
    ];

    const idx = await foundry.applications.api.DialogV2.wait({
        window:   { title: skillName },
        classes:  ["tokyo-nova", "tnx-dialog", "tnx-usage-picker"],
        position: { width: 320 },
        content:  "",
        buttons,
        close:    () => null,
    });

    // 確定は**数値の添字**(0 を含む)。中止(false / null)と 0 を取り違えないよう整数で判定する
    return Number.isInteger(idx) ? (usages[idx] ?? null) : null;
}
