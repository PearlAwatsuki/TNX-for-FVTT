/**
 * @fileoverview 用途実行時のターゲット解決(2026-07-16 一本化)。
 *
 * 従来は攻撃(全ターゲット→未選択はトークン選択ダイアログ＋レティクル付与)・回復(1体→未選択は
 * 「自分を対象に続行」確認)・適用効果(全ターゲット→未選択は同確認)がそれぞれ game.user.targets の
 * 読み取りと未選択ダイアログを個別に実装していた。読み取り・確認・選択の3部品をここに集約する。
 * 挙動の差(全件/1体・確認/トークン選択)は裁定済みの仕様のため、部品化しても挙動は変えない。
 */

/** 現在ターゲット中(レティクル)のアクターを列挙する。 */
export function currentTargetActors() {
    return [...(game.user?.targets ?? [])].map(t => t?.actor).filter(Boolean);
}

/**
 * ノーターゲット時の「自分を対象に続行」確認(回復・適用効果の共通形)。
 * @param {Actor|null} actor 使用者(続行時の対象)
 * @param {string} reason 未選択の説明文(例「効果を付与する対象がターゲットされていません。」)
 * @param {string} question 続行の問い(自分を対象にする旨)
 * @returns {Promise<boolean>} true=自分を対象に続行 / false=キャンセル
 */
export async function confirmSelfTarget(actor, reason, question) {
    return foundry.applications.api.DialogV2.confirm({
        window: { title: "ターゲット未選択" },
        classes: ["tokyo-nova", "tnx-dialog"],
        content: `<p>${reason}</p><p>${question}</p>`,
        yes: { label: "自分を対象に続行", icon: "fas fa-user-check" },
        no:  { label: "キャンセル", icon: "fas fa-times" },
        modal: true,
    });
}

/**
 * 1体対象の解決(回復等): 先頭のターゲット→無ければ確認して自分。
 * @param {Actor} actor 使用者
 * @param {string} reason 未選択の説明文
 * @returns {Promise<Actor|null>} null=中止
 */
export async function resolveSingleTargetOrSelf(actor, reason) {
    const targeted = currentTargetActors();
    if (targeted.length) return targeted[0];
    const proceed = await confirmSelfTarget(actor, reason,
        `「${foundry.utils.escapeHTML(actor?.name ?? "")}」自身を対象に続行しますか？`);
    return proceed ? actor : null;
}

/**
 * 対象参照の解決(適用効果等): 全ターゲット {uuid,name}(重複 uuid は畳む)→無ければ確認して自分。
 * @param {Actor|null} actor 使用者
 * @param {string} reason 未選択の説明文
 * @param {string} question 続行の問い
 * @returns {Promise<Array<{uuid:string,name:string}>|null>} null=キャンセル(中止)
 */
export async function resolveTargetRefsOrSelf(actor, reason, question) {
    const targeted = currentTargetActors();
    if (targeted.length) {
        const byUuid = new Map(targeted.map(a => [a.uuid, { uuid: a.uuid, name: a.name }]));
        return [...byUuid.values()];
    }
    const proceed = await confirmSelfTarget(actor, reason, question);
    if (!proceed) return null;
    return actor ? [{ uuid: actor.uuid, name: actor.name }] : [];
}

/**
 * 攻撃対象の解決(2026-07-15 ユーザー確定): Foundry のターゲット(レティクル)を**全件**使う。
 * 未ターゲットのときだけ選択ダイアログを出し、選んだトークンには**必ずレティクルを付与**して進める
 * (内部だけで対象を決めず、必ずターゲットされた対象に効果が及ぶようにする)。「対象なし」も許容
 * (RL 手動運用)。
 * @param {Actor} actor 攻撃者(候補から除外)
 * @returns {Promise<Array<{uuid:string,name:string}>|null>} null=キャンセル(中止)。[]=対象なし
 */
export async function resolveAttackTargetRefs(actor) {
    let targets = currentTargetActors().map(a => ({ uuid: a.uuid, name: a.name }));
    if (targets.length) return targets;

    const seen = new Set();
    const options = [{ value: "", label: "（対象なし）" }];
    if (canvas?.ready) {
        for (const t of canvas.tokens.placeables) {
            const a = t.actor;
            if (!a || a.uuid === actor.uuid || seen.has(t.id)) continue;
            seen.add(t.id);
            options.push({ value: t.id, label: a.name });
        }
    }
    // tnx-dialog はモジュールレベルで foundry を参照するため動的 import(テスト環境の非依存を保つ)
    const { TargetSelectionDialog } = await import("./tnx-dialog.mjs");
    const sel = await TargetSelectionDialog.prompt({
        title: "攻撃対象の選択",
        label: "攻撃の対象を選択してください（トークンをターゲットしておくと複数対象を一括で狙えます）。",
        options,
        selectLabel: "決定",
    });
    if (sel === null || sel === undefined) return null; // キャンセル
    targets = [];
    if (sel) {
        const token = canvas.tokens?.get(sel);
        if (token?.actor) {
            token.setTarget(true, { releaseOthers: true }); // 必ずレティクルを付与
            targets = [{ uuid: token.actor.uuid, name: token.actor.name }];
        }
    }
    return targets;
}
