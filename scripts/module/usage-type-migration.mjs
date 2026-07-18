/**
 * @fileoverview 正準名ブリッジの一回限り移行(2026-07-17 ユーザー承認・Foundry 非依存の純ロジック)。
 *
 * 行動種別タイプ再編に伴い、既定(canonical)一般技能の用途をリアクション/治療/移動タイプへ
 * 付け替える。旧 skillRoles(役割フラグ)・正準名ブリッジ(DEFAULT_SKILL_ROLES_BY_NAME)は
 * この移行をもって**完全廃止**——実行時の資格・候補判定は今後**用途タイプの所持**だけで行う。
 * この表は移行(既存データへの初期値の注入)にのみ使う。
 *
 * 適用点(tnx.mjs):
 * - ready(GM・一回限り=ワールド設定でゲート): ワールド直下とアクター所持の既存技能へ適用する。
 *
 * preCreateItem での常設適用は 2026-07-18 に撤去。移行済みかを区別せず技能名だけで素の判定用途を
 * 付け替えるため、現行の辞典データが正当に持つ「判定」用途をインポートのたびに破壊していた。
 */

import { defaultConfrontationForType } from "./usage-types.mjs";
import { idKeyPrefix } from "./skill-dictionary.mjs";

/** 正準名 → 素の判定用途(check・固定値でない)を付け替えるタイプ。 */
export const CANONICAL_RETYPE_BY_NAME = Object.freeze({
    "回避": "dodge",
    "白兵": "parry",
    "自我": "mentalReaction",
    "信用": "socialReaction",
    "医療": "treatment",
});

/** 操縦技能(識別キー prefix=operate)へ追加する用途タイプ → タイミング。 */
const OPERATE_ADDED_USAGES = Object.freeze([
    { type: "move",              timing: { value: "action", actionName: "major",    processName: "blank", timingOther: "" } },
    { type: "moveBlockReaction", timing: { value: "action", actionName: "reaction", processName: "blank", timingOther: "" } },
]);

/**
 * 一般技能の用途を正準名に基づいてタイプへ正規化する(冪等)。
 * - 正準名(回避/白兵/自我/信用/医療): 素の判定用途(type="check"・固定値でない)を該当タイプへ付け替える。
 * - 操縦(識別キー prefix=operate): 移動/リアクション（移動妨害）用途が無ければ追加する
 *   (名前は空=実効名は親アイテム名・対決欄はタイプの系統既定)。
 * @param {{name?: string, identificationKey?: string, actions?: Array<object>}} skill
 * @param {() => string} makeId 新規用途の _id 生成(foundry.utils.randomID を注入)
 * @returns {?Array<object>} 変更後の actions(変更が無ければ null)
 */
export function canonicalizeSkillActions(skill, makeId) {
    const actions = (skill?.actions ?? []).map(a => ({ ...a }));
    let changed = false;

    const retype = CANONICAL_RETYPE_BY_NAME[skill?.name ?? ""];
    if (retype) {
        for (const a of actions) {
            if (a.type !== "check" || Number.isFinite(a.fixedResult) || a.npcAcquire === true) continue;
            a.type = retype;
            changed = true;
        }
    }

    if (idKeyPrefix(skill?.identificationKey ?? "") === "operate") {
        for (const spec of OPERATE_ADDED_USAGES) {
            if (actions.some(a => a.type === spec.type)) continue;
            actions.push({
                _id: makeId(),
                type: spec.type,
                name: "",
                description: "",
                timing: { ...spec.timing },
                target: "blank",
                effects: [],
                baseSkillRef: { itemId: "" },
                skillRefs: [],
                weaponRefs: [],
                damageType: "",
                checkBonuses: [],
                damageBonuses: [],
                modifiableParams: [],
                confrontation: defaultConfrontationForType(spec.type),
                consumeTargets: [{ type: "parent", itemId: "", amount: 1 }],
            });
            changed = true;
        }
    }

    return changed ? actions : null;
}
