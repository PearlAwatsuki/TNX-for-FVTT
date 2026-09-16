/**
 * @fileoverview 用途実行時のターゲット解決(2026-07-16 一本化 → 2026-07-18 決定表駆動へ全面改訂)。
 *
 * 起動用途のタイプで場合分けせず、用途の「対決」×「対象」の決定表(usage-target-plan.mjs・
 * Combat_Flow.md「対象解決とカード形式の一般化」)で解決する。
 * - 対象「-」「解説参照」「その他」= 対象要求なし(「-」=完全に対象なし・「解説参照」「その他」=
 *   基本ルール内で解決できない対象。「その他」はレティクルでターゲットできない対象を取る値)。
 * - 対象「自身」= 常に自分へレティクル自動付与。「単体」= 非対決なら未ターゲット時に自動セルフ。
 * - 「自身に適用できない」(cannotTargetSelf)= 自動セルフ抑止(→選択ダイアログ・候補から自分を除外)。
 * - 明示ターゲットは常に尊重する(2026-07-19 ユーザー裁定): 自動解決はターゲットし忘れの救済で
 *   あり、ターゲット済みの対象を「正規ではない」とはじかない(旧・妥当性中止は撤廃)。
 * - 対象にレティクルが付与されないのは対象なし群のみ=効果やダメージの対象は常に明示される。
 *   旧「自分を対象に続行」確認(回復/適用効果)と選択ダイアログの「（対象なし）」は全廃。
 */

import { planUsageTargets } from "../rules/usage-target-plan.mjs";
import { isOpposedConfrontation } from "../rules/confrontation.mjs";
import { TargetSelectionDialog } from "../ui/tnx-dialog.mjs";
import { crewTarget, selectedCrew, vehicleOutfit, ghostCanInteract, crewVehicle, vehicleToken } from "../session/vehicle-state.mjs";
import { isDrone } from "../rules/vehicle.mjs";

/** 車両トークンは乗員の明示選択、ドローンは操縦者へ解決する。 */
function tokenTargetRefs(token) {
    const actor = token?.actor;
    if (!actor || !token.isVisible) return [];
    if (actor.type !== "vehicle") return actor.system?.isGhost || crewVehicle(actor) ? [] : [{ uuid: actor.uuid, name: actor.name }];
    const selected = [...selectedCrew.values()].filter(t => t.vehicleRoute.tokenUuid === token.document.uuid)
        .map(t => {
            const member = actor.system.crew.find(c => c.actorUuid === t.uuid);
            return member ? crewTarget(actor, member) : null;
        }).filter(Boolean);
    if (selected.length) return selected;
    if (isDrone(vehicleOutfit(actor))) {
        const driver = actor.system.crew.find(c => c.role === "driver");
        const target = driver ? crewTarget(actor, driver) : null;
        return target ? [target] : [];
    }
    return [];
}

/** 現在ターゲット中(レティクル)のアクターを列挙する。 */
export function currentTargetActors({ rawVehicles = false } = {}) {
    const tokens = [...(game.user?.targets ?? [])];
    if (rawVehicles) return tokens.map(t => t?.actor).filter(Boolean);
    const actors = tokens.flatMap(tokenTargetRefs).map(t => fromUuidSync(t.uuid)).filter(Boolean);
    return [...new Map(actors.map(a => [a.uuid, a])).values()];
}

/** アクターの場のトークンへレティクルを付与する(トークンが無ければ何もしない)。 */
function targetActorToken(actor) {
    const relation = crewVehicle(actor);
    if (relation) {
        const ref = crewTarget(relation.vehicle, relation.member);
        if (ref) {
            selectedCrew.clear();
            vehicleToken(relation.vehicle)?.object?.setTarget(true, { releaseOthers: true });
            selectedCrew.set(`${relation.vehicle.uuid}:${actor.uuid}`, ref);
        }
        return;
    }
    const token = actor?.getActiveTokens?.()[0] ?? null;
    token?.setTarget(true, { releaseOthers: true });
}

/**
 * ターゲット中の先頭アクター・いなければ自分(ターゲットし忘れの自動解決・2026-07-19 ユーザー裁定)。
 * 治療・修理など「実対象がキャラクターでない/キャラクターのターゲットが所持品や状態を指す便宜」の
 * フローで使う。対象欄の値では分岐しない=対象欄を理由に実行をブロックしない。
 * 自分に解決したときはレティクルを付与する(対象は常に明示される)。
 * @param {Actor} actor 使用者
 * @returns {Actor}
 */
export function resolveTargetedOrSelf(actor) {
    const targeted = currentTargetActors();
    if (targeted.length) return targeted[0];
    targetActorToken(actor);
    return actor;
}

/**
 * 用途の対象解決(決定表駆動・2026-07-18)。判定起動の全経路がここを通る。
 * @param {Actor} actor 使用者
 * @param {object} usage 用途エントリ(target / cannotTargetSelf / confrontation を読む)
 * @returns {Promise<Array<{uuid:string,name:string}>|null>} null=中止(通知済み)。[]=対象なし
 */
export async function resolveUsageTargetRefs(actor, usage) {
    if (!ghostCanInteract(actor)) {
        ui.notifications.warn("ゴーストがシーンに干渉するには、ドローンで登場してください。");
        return null;
    }
    const targeted = currentTargetActors({ rawVehicles: true });
    const plan = planUsageTargets({
        target:           usage?.target,
        cannotTargetSelf: usage?.cannotTargetSelf === true,
        opposed:          isOpposedConfrontation(usage?.confrontation),
        targetedSelf:     targeted.some(a => a.uuid === actor.uuid),
        targetedOthers:   targeted.some(a => a.uuid !== actor.uuid),
    });

    switch (plan.mode) {
        case "none":
            return [];
        case "targets": {
            const refs = [];
            for (const token of game.user.targets ?? []) {
                const resolved = tokenTargetRefs(token);
                if (!resolved.length && token.actor?.type === "vehicle") {
                    const options = token.actor.system.crew.map(c => crewTarget(token.actor, c)).filter(Boolean);
                    if (!options.length) { ui.notifications.warn("この車両に攻撃対象となる乗員はいません。車両自体の破壊には破壊可能な効果を使用してください。"); return null; }
                    const uuid = await TargetSelectionDialog.prompt({ title: "乗員をターゲット", label: token.actor.name,
                        options: options.map(t => ({ value: t.uuid, label: t.name })), selectLabel: "決定" });
                    const ref = options.find(t => t.uuid === uuid);
                    if (!ref) return null;
                    selectedCrew.set(`${token.actor.uuid}:${ref.uuid}`, ref);
                    refs.push(ref);
                } else if (!resolved.length) {
                    ui.notifications.warn("ゴースト本人や非表示の乗員は直接ターゲットにできません。");
                    return null;
                } else refs.push(...resolved);
            }
            if (!refs.length) return promptTargetToken(actor);
            const byUuid = new Map(refs.map(t => [`${t.uuid}:${t.vehicleRoute?.tokenUuid ?? ""}`, t]));
            return [...byUuid.values()];
        }
        case "autoSelf":
            // 対象「自身」(常時)・「単体」(非対決): 自分へレティクルを自動付与(2026-07-18 ユーザー確定)
            targetActorToken(actor);
            return [([...selectedCrew.values()].find(t => t.uuid === actor.uuid)) ?? { uuid: actor.uuid, name: actor.name }];
        case "dialog":
        default:
            return promptTargetToken(actor);
    }
}

/**
 * 未ターゲット時の対象選択ダイアログ。選んだトークンには**必ずレティクルを付与**して進める
 * (内部だけで対象を決めず、必ずターゲットされた対象に効果が及ぶようにする)。
 * 「（対象なし）」は置かない(2026-07-18 ユーザー確定=レティクル無しへの働きかけ不可。対象なしの
 * 運用は対象「-」等の用途で表す)。自分自身は候補に出さない(ダイアログに来るのは対決あり
 * または「自身に適用できない」のときだけのため)。
 * @param {Actor} actor 使用者(候補から除外)
 * @returns {Promise<Array<{uuid:string,name:string}>|null>} null=キャンセル(中止)
 */
export async function promptTargetToken(actor) {
    const seen = new Set();
    const options = [];
    if (canvas?.ready) {
        for (const t of canvas.tokens.placeables) {
            const a = t.actor;
            if (!a || !t.isVisible || a.system?.isGhost || a.uuid === actor.uuid || seen.has(t.id)) continue;
            seen.add(t.id);
            if (a.type === "vehicle") {
                for (const member of a.system.crew) {
                    const ref = crewTarget(a, member);
                    if (ref && ref.uuid !== actor.uuid) options.push({ value: `${t.id}|${member.actorUuid}`, label: ref.name });
                }
                continue;
            }
            options.push({ value: t.id, label: a.name });
        }
    }
    if (!options.length) {
        ui.notifications.warn("対象にできるトークンがありません（対象をターゲットしてから使用してください）。");
        return null;
    }
    // tnx-dialog はモジュールレベルで foundry を参照するため動的 import(テスト環境の非依存を保つ)
    const sel = await TargetSelectionDialog.prompt({
        title: "対象の選択",
        label: "対象を選択してください（トークンをターゲットしておくと複数対象を一括で狙えます）。",
        options,
        selectLabel: "決定",
    });
    if (sel === null || sel === undefined || sel === "") return null; // キャンセル
    const [tokenId, memberUuid] = sel.split("|");
    const token = canvas.tokens?.get(tokenId);
    if (!token?.actor) return null;
    token.setTarget(true, { releaseOthers: true }); // 必ずレティクルを付与
    if (memberUuid) {
        const member = token.actor.system.crew.find(c => c.actorUuid === memberUuid);
        const ref = member ? crewTarget(token.actor, member) : null;
        if (!ref) return null;
        selectedCrew.set(`${token.actor.uuid}:${memberUuid}`, ref);
        return [ref];
    }
    return [{ uuid: token.actor.uuid, name: token.actor.name }];
}
