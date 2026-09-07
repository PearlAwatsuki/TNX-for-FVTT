/**
 * @fileoverview アイテム狙い ActiveEffect の物理転送(2026-07-13 再設計)。
 *
 * 「このアイテムのパラメータを変える」効果は、対象アイテムの上に**実体のコピー**を作って
 * 適用する(エンチャント)。供給元が正で、更新でコピーを上書きし、狙いから外れたら除去する。
 * 転送先はモノ(アウトフィット)に限る(2026-09-02 ユーザー確定)——技能・神業のように
 * キャラクターの一部を表すアイテムは、キャラクターに乗った効果から遠隔で適用する。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { defaultWeaponKindForCategory } from "../data/item/common/outfit-base.mjs";
import { CONDITION_KINDS, getConditionKinds, buildInflictedEffectsData, applyDamageTagMods, readConditions, blocksMainProcess, actorCannotMainProcess } from "../rules/conditions.mjs";
import { gatherDamageTagMods, parseEffectTargetKey, buildTransferredEffectData, planTransferCopySync, transferCopyIsCurrent, isOutfitItem, planCapabilityTransferCleanup } from "../data/item/helpers.mjs";
import { runSerial } from "./serial-queue.mjs";
import { conditionNeedsDraw, postDrawPrompt, postControlNegatePrompt, promptWoundSkillSelection } from "../flow/condition-resolution.mjs";
import { applyAsOtherEffectCopy } from "../flow/miracle-flow.mjs";

// アイテム狙いの AE の物理転送(2026-07-13 再設計)+片方向同期(2026-07-12 ユーザー指摘=
// 「後から元のエフェクト側を更新した場合に反映されない」)。**供給元が正**:
// - 効果の作成/更新時・アイテムの追加/装着系更新時に、**自動適用(transfer)オン**の効果の
//   アイテム狙いの変更(item.<識別キー>/system.category)を**対象アイテム上の実体コピー**
//   (キーは素の system.<パス> に書き換え)として作成/上書きする。
// - 「準備先(親アイテム)に適用」(flags.applyToParent)の効果は、素のパラメータキーの変更を
//   準備先ホスト(bearer.system.parentItemId)へ転送する(準備で転送・解除で除去)。
// - 自動適用オフ(=使用時付与用ペイロード)は転送しない。オフへの切替・狙い外れ・供給元の削除で
//   コピーを除去する。
// コピーは対象アイテムの通常の効果=無条件にそのアイテムへ効く。コピー側の手動編集・切替は
// 供給元の次の更新で上書きされる(供給元が正の帰結)。

async function materializeItemTransfers(actor, effect, bearer) {
    if (!actor || actor.documentName !== "Actor") return;
    const flags = effect.flags?.[SYSTEM_ID] ?? {};
    // 実体化済みインスタンス(転送コピー/使用時付与コピー)は転送の供給元にならない
    if (flags.transferredFrom || flags.grantedFrom) return;
    const isAuto = effect.transfer !== false; // 自動適用ゲート(オフ=ペイロード)
    const toParent = flags.applyToParent === true && bearer?.documentName === "Item";
    const hasItemTarget = isAuto && !toParent && (effect.changes ?? []).some(c => {
        const p = parseEffectTargetKey(c.key);
        return p && ["skill", "category"].includes(p.scope);
    });
    // 転送先は**モノ(アウトフィット)に限る**(2026-09-02 ユーザー確定)。技能・神業のように
    // キャラクターの一部を表すアイテムのパラメータは、キャラクターに乗った効果から遠隔で
    // 適用する(_applyEffectBuffs)ため、実体コピーを作らない
    const targets = (item) => isOutfitItem(item) && ((isAuto && toParent)
        ? bearer.system?.parentItemId === item.id
        : hasItemTarget);
    // アクター単位で直列化する(KI-049): 「コピーを探す→無ければ作る」は原子的でないため、
    // 複数アイテムの一括追加でフックが同時多発すると、どの発火も「まだ無い」と判断して
    // 個数分のコピーを作っていた(4アイテム同時ドロップで4重・攻撃力が3回余計に乗る)。
    await runSerial(actor.uuid, async () => {
        for (const item of actor.items) {
            // 供給元×アイテムごとにコピーは1つ、が不変条件。過去に多重作成されたものも
            // planTransferCopySync が1つへ畳む(残りは除去)
            const copies = item.effects.filter(
                e => e.flags?.[SYSTEM_ID]?.transferredFrom === effect.uuid);
            const data = targets(item) ? buildTransferredEffectData(effect, item, bearer) : null;
            const plan = planTransferCopySync(copies, !!data);
            // 狙わなくなった/余分なコピーを先に除去してから、残す1つを現在値へ揃える
            if (plan.delete.length) await item.deleteEmbeddedDocuments("ActiveEffect", plan.delete);
            if (plan.update) {
                // 供給元が正。ただし**同じ内容なら書かない**(2026-09-07)——埋め込み効果の update は
                // 派生再計算とシート再描画を伴い、アイテム追加のたびに全コピーを書き直していた
                const copy = item.effects.get(plan.update);
                if (copy && !transferCopyIsCurrent(copy, data)) await copy.update(data);
            } else if (plan.create) {
                await item.createEmbeddedDocuments("ActiveEffect", [data]);
            }
        }
    });
}

/**
 * 技能・神業などキャラクターの一部を表すアイテムの上に残った転送コピーを、起動時に一回だけ除去する
 * (2026-09-02 ユーザー確定)。それらの効果はキャラクター付与(遠隔適用)へ移ったため、旧経路のコピーが
 * 残ると遠隔適用と二重に乗る。版番号ゲート(部位キー移行と同じ作法)で一回きり。触るのは転送コピー
 * だけで、付与コピーと供給元の定義、モノ(アウトフィット)上のコピー(エンチャント)には手を出さない。
 */
const CAPABILITY_TRANSFER_CLEANUP_SCHEME = 1;
export async function cleanupCapabilityTransferCopies() {
    if (!game.user.isGM) return;
    const done = Number(game.settings.get(SYSTEM_ID, "capabilityTransferCleanupScheme")) || 0;
    if (done >= CAPABILITY_TRANSFER_CLEANUP_SCHEME) return;
    let removed = 0;
    for (const actor of game.actors) {
        for (const { itemId, effectIds } of planCapabilityTransferCleanup(actor.items)) {
            await actor.items.get(itemId)?.deleteEmbeddedDocuments("ActiveEffect", effectIds);
            removed += effectIds.length;
        }
    }
    if (removed) console.info(`TNX | 技能・神業の上に残っていた転送コピーを ${removed} 件除去しました(キャラクター付与への移行)`);
    await game.settings.set(SYSTEM_ID, "capabilityTransferCleanupScheme", CAPABILITY_TRANSFER_CLEANUP_SCHEME);
}

/** 供給元(uuid 群)由来の転送コピーをアクターの全アイテムから除去する。 */
async function removeItemTransferCopies(actor, sourceUuids) {
    for (const item of actor.items) {
        const ids = item.effects
            .filter(e => sourceUuids.includes(e.flags?.[SYSTEM_ID]?.transferredFrom))
            .map(e => e.id);
        if (ids.length) await item.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
}










// 辞典ブラウザの起動ボタンを辞典サイドバータブ上部へ差し込む(フェーズ16-2・D&D と同配置)

/** 転送の実体化に関わるフックを登録する(init から呼ぶ)。 */
export function registerItemTransferHooks() {
    Hooks.on("createActiveEffect", async (effect, options, userId) => {
        if (game.user.id !== userId) return;
        const actor = effect.parent;
        if (!actor || actor.documentName !== "Actor") return;

        // 1. カスケード: inflicts の別状態を付与(状態のみ・hideFromList)。
        // 供給元が負傷(wound)の場合、その inflicts は「そのダメージチャートの効果」なので woundSource で
        // 負傷に紐づける(戦闘不能も BS も含め全て)。消費側で扱いを分ける:
        //   ・治療(〈医療〉): 負傷＋紐づきの非BSを除去し BS は残す(BS は独立効果)。
        //   ・制御判定の無効化: 負傷＋紐づき全て(BS 含む)を除去=ダメージ自体が無効(2026-07-09 裁定)。
        // ※BS の回復(BS 自身の解除条件・解除効果・将来の自動回復=15)は **その BS のみ**を除去し、
        //   woundSource を辿って負傷を消してはならない(BS を回復してもダメージは治療されない=2026-07-09)。
        const srcKind = getConditionKinds(effect)[0];
        const srcIsWound = CONDITION_KINDS[srcKind]?.type === "wound";
        // タグ改変(2026-07-12・支配タグ): 負傷(ダメージチャート)由来の付与のみ、対象自身の AE
        // (damage.replaceTag/addTag)でタグを置換/追加する(例 昏睡/精神崩壊→支配・抹殺に支配を追加)
        const tagMods = srcIsWound ? gatherDamageTagMods(actor) : null;
        // 説得(2026-07-15 ユーザー確定): 精神攻撃の説得は、精神ダメージの「効果タグ」＝戦闘不能
        // (incapacitation グループ・支配含む)を付けず「説得に応じる」形にする。BS は通常どおり付与する。
        const persuade = effect.flags?.[SYSTEM_ID]?.persuade === true;
        const data = [];
        const seen = new Set();
        for (const kind of getConditionKinds(effect)) {
            let list = buildInflictedEffectsData(kind, { hidden: true });
            if (tagMods) list = applyDamageTagMods(list, tagMods);
            for (const d of list) {
                const ik = d.statuses[0];
                const idef = CONDITION_KINDS[ik];
                if (persuade && idef?.group === "incapacitation") continue; // 説得: 戦闘不能タグ(支配含む)を付けない
                if (idef && !idef.stackable && (actor.statuses?.has?.(ik) || seen.has(ik))) continue;
                if (srcIsWound) {
                    d.flags[SYSTEM_ID].woundSource = effect.id;
                }
                // 神業由来の印(17-3): 神業のダメージから生じた負傷のカスケード(戦闘不能・BS)も神業由来
                // (神業でしか治せない)
                if (effect.flags?.[SYSTEM_ID]?.fromMiracle === true) {
                    d.flags[SYSTEM_ID].fromMiracle = true;
                }
                seen.add(ik);
                data.push(d);
            }
        }
        if (data.length) await actor.createEmbeddedDocuments("ActiveEffect", data);

        // 2. この状態自身の解決受付: 衰弱/重圧のカード決定ドロー / controlNegate の制御判定。
        //    フラグ(inflicts 由来=付与時に焼き込み)に加え、状態定義直下の controlNegate(付与状態を
        //    持たない負傷自身の制御判定=動転)も読む(2026-07-22 ユーザー指摘で配線)。
        const perKind = effect.flags?.[SYSTEM_ID]?.conditions ?? {};
        for (const c of readConditions(effect)) {
            if (conditionNeedsDraw(c.kind, c)) await postDrawPrompt(actor, effect, c.kind);
            const cn = perKind[c.kind]?.pendingControlNegate ?? c.def?.controlNegate;
            if (cn) await postControlNegatePrompt(actor, effect, c.kind, cn);
        }
        // 3. 選択型負傷(造反/人脈消失/スキャンダル/信頼喪失=社会/コネ「ひとつ」)の使用不可対象を、
        //    付与ユーザーに選ばせて targetSkill を確定する(付与経路を問わない=2026-07-16 是正)。
        await promptWoundSkillSelection(actor, effect);

        // 4. メインプロセス不可の戦闘不能(気絶/失神/仮死/昏睡/完全死亡/精神崩壊=blocksMainProcess。
        //    抹殺・支配は除く)が付いたら、カット進行の脱落マーク(combatant.defeated)を自動でオンにする
        //    (2026-07-22 ユーザー指示。「dead」だけ core の特別ステータス(DEFEATED)で自動脱落になる
        //    非対称の解消)。除去時の自動オフは下の deleteActiveEffect フック。
        if (getConditionKinds(effect).some(k => blocksMainProcess(CONDITION_KINDS[k]))) {
            for (const combat of game.combats) {
                for (const c of (combat.getCombatantsByActor?.(actor) ?? [])) {
                    if (!c.defeated) await c.update({ defeated: true }).catch(() => {});
                }
            }
        }
    });

    // 脱落マークの自動オフ: メインプロセス不可の状態が除去され、他に該当状態が残っていなければ
    // 脱落マークを外す(治療・制御判定無効・カット終了回復のたびに RL の手動戻しを要しないため。
    // タグと無関係に RL が手で付けた脱落は、この経路では該当状態が元々無い=除去イベントも来ないので触らない)
    Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
        if (game.user.id !== userId) return;
        const actor = effect.parent;
        if (!actor || actor.documentName !== "Actor") return;
        if (!getConditionKinds(effect).some(k => blocksMainProcess(CONDITION_KINDS[k]))) return;
        if (actorCannotMainProcess(actor)) return; // まだ別の該当状態が残っている
        for (const combat of game.combats) {
            for (const c of (combat.getCombatantsByActor?.(actor) ?? [])) {
                if (c.defeated) await c.update({ defeated: false }).catch(() => {});
            }
        }
    });

    Hooks.on("createActiveEffect", async (effect, _options, userId) => {
        if (game.user.id !== userId) return;
        const parent = effect.parent;
        const actor = parent?.documentName === "Actor" ? parent : parent?.actor;
        if (actor) await materializeItemTransfers(actor, effect, parent);
    });

    Hooks.on("updateActiveEffect", async (effect, changed, _options, userId) => {
        if (game.user.id !== userId) return;
        // transfer(自動適用ゲート)・flags(準備先チェック等)の切替でも転送を再評価する(2026-07-13 再設計)
        if (!["changes", "disabled", "name", "img", "transfer", "flags"].some(k => k in (changed ?? {}))) return;
        const parent = effect.parent;
        const actor = parent?.documentName === "Actor" ? parent : parent?.actor;
        if (actor) await materializeItemTransfers(actor, effect, parent);
    });

    // 供給元の効果が削除されたら転送コピーも除去する(供給元が正・2026-07-12)
    Hooks.on("deleteActiveEffect", async (effect, _options, userId) => {
        if (game.user.id !== userId) return;
        const flags = effect.flags?.[SYSTEM_ID] ?? {};
        if (flags.transferredFrom || flags.grantedFrom) return; // コピー自身の削除は独立
        const parent = effect.parent;
        const actor = parent?.documentName === "Actor" ? parent : parent?.actor;
        if (actor) await removeItemTransferCopies(actor, [effect.uuid]);
    });

    // 供給元アイテムごと削除された場合(内包効果の deleteActiveEffect は発火しない)
    Hooks.on("deleteItem", async (item, _options, userId) => {
        if (game.user.id !== userId) return;
        const actor = item.actor;
        if (!actor) return;
        const uuids = item.effects.map(e => e.uuid);
        if (uuids.length) await removeItemTransferCopies(actor, uuids);
    });

    // アイテムがアクターに追加されたとき: 転送を実体化し直す。追加されたアイテムは**狙われる側**
    // にも**供給元側**にもなりうるため、アクター自身と全所持アイテム(追加されたもの自身を含む)を
    // 走査する。追加されたアイテム自身を除外していたため、他のアイテムを狙う効果を内包した
    // アイテム(辞典からドラッグしたドラッグ・サイバーウェア等)は、別の操作が起きるまで効果が
    // 乗らなかった(KI-050)。Foundry はアイテムに内包して作成された効果に createActiveEffect を
    // 発火しないため、そちらの経路でも拾えない
    Hooks.on("createItem", async (item, _options, userId) => {
        if (game.user.id !== userId) return;
        const actor = item.actor;
        if (!actor) return;
        for (const e of actor.effects) await materializeItemTransfers(actor, e, actor);
        for (const it of actor.items) {
            for (const e of it.effects) await materializeItemTransfers(actor, e, it);
        }
    });

    // 効果の参照を持つ神業(《万能道具》《神意》《半身》)をアクターが得たら、その場で効果を決める。
    // スタイル経由の取得だけでなく**神業を直接インポートしたときも**通す(2026-09-06 ユーザー指摘
    // 「万能道具をインポートして使用しても、万能道具自体に用途の設定が無いため何の効果も発揮しません」
    // ——効果と用途は参照先の神業から来るので、参照が決まっていないと何も起きない)。
    // **転送コピーの実体化とは別のフックにする**——前段が長い/失敗すると後段が動かないため
    // (実機で、既定技能を持つアクターへインポートしたときに動かなかった)
    Hooks.on("createItem", (item, _options, userId) => {
        if (game.user.id !== userId) return;
        if (!item.actor || item.type !== "miracle") return;
        if (item.system?.asOther?.mode !== "choice" || item.system.asOther.selected) return;
        // **作成の処理から出てから**書き込む。作成フックの中で同じ文書を update しても落ちる
        // (2026-09-06 実機で確認。手で呼べば通るのにフック内では効かなかった)
        setTimeout(async () => {
            const { TnxCharacterSheetBase } = await import("./actor/tnx-character-sheet-base.mjs");
            await TnxCharacterSheetBase._chooseMiracleFormEffect(item);
        }, 0);
    });

    // 武器区分フラグの分類既定(2026-07-17 ユーザー確定): 分類(小分類)を変更したら、その分類の
    // 既定(白兵武器→白兵/射撃武器・搭載兵器→射撃/生体装備→白兵/該当なし=両OFF)で敷き直す
    // (自動入力と同じ「明示的な上書き」の意味論。以後の手動変更はそのまま生きる)
    // 効果の参照を選び直したら、参照先の用途と経験点の取得条件を写し直す(2026-09-06 方針A)
    Hooks.on("updateItem", async (item, changes, _options, userId) => {
        if (userId !== game.user.id) return;
        if (item.type !== "miracle") return;
        if (foundry.utils.getProperty(changes, "system.asOther.selected") === undefined) return;
        await applyAsOtherEffectCopy(item);
    });

    Hooks.on("preUpdateItem", (item, changes) => {
        const minor = changes?.system?.minorCategory;
        if (minor === undefined || item.system?.isMeleeWeapon === undefined) return;
        if (minor === item.system.minorCategory) return;
        const seed = defaultWeaponKindForCategory(minor) ?? { melee: false, ranged: false };
        changes.system.isMeleeWeapon  = seed.melee;
        changes.system.isRangedWeapon = seed.ranged;
    });

    // アイテムの装着系フィールドが変わったとき: 転送を再評価する(2026-07-13 再設計)。
    // 準備/解除(parentItemId)で準備先転送が付け外しされ、分類・識別キーの変更で
    // アイテム狙い転送の照合が変わる(従来はここが穴で、装着変更が反映されなかった)
    Hooks.on("updateItem", async (item, changed, _options, userId) => {
        if (game.user.id !== userId) return;
        const actor = item.actor;
        if (!actor) return;
        const sys = changed?.system ?? {};
        if (!["parentItemId", "identificationKey", "majorCategory", "minorCategory", "additionalCategories"].some(k => k in sys)) return;
        for (const e of actor.effects) await materializeItemTransfers(actor, e, actor);
        for (const it of actor.items) {
            for (const e of it.effects) await materializeItemTransfers(actor, e, it);
        }
    });
}
