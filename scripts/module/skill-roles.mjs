/**
 * @fileoverview 技能の役割(skillRoles)定義と検出ヘルパー(2026-07-09 新設計)。
 *
 * 「デフォルトの使用技能が決まっている行動」(治療=医療・ドッジ=回避・パリー=白兵・
 * 各リアクション・各攻撃)を、技能名の一致でなく **技能側の役割フラグ**(system.skillRoles)で
 * 検出する。スタイル技能の効果「規定以外の技能をベースに所定の行動が行える」は、
 * **そのスタイル技能自身が役割を持つ**ことで表す(他技能のフラグは立てない)。
 *
 * skillRoles が真の権威。未設定の既定(canonical)一般技能には正準名ベースの既定値を
 * ブリッジとして与える(コンペンディウムに役割を設定すれば以後はフィールドが使われる)。
 */

/** 役割キー → 表示ラベルと分類(reaction/attack/treatment・系統)。 */
export const SKILL_ROLES = Object.freeze({
    dodge:          { label: "ドッジ",         kind: "reaction",  category: "physical" },
    parry:          { label: "パリー",         kind: "reaction",  category: "physical" },
    mentalReaction: { label: "精神リアクション", kind: "reaction",  category: "mental"   },
    socialReaction: { label: "社会リアクション", kind: "reaction",  category: "social"   },
    meleeAttack:    { label: "白兵攻撃",       kind: "attack",    category: "physical" },
    rangedAttack:   { label: "射撃攻撃",       kind: "attack",    category: "physical" },
    mentalAttack:   { label: "精神攻撃",       kind: "attack",    category: "mental"   },
    socialAttack:   { label: "社会攻撃",       kind: "attack",    category: "social"   },
    treatment:      { label: "治療",           kind: "treatment"                        },
});

export const SKILL_ROLE_KEYS = Object.freeze(Object.keys(SKILL_ROLES));

/**
 * 既定(canonical)一般技能の役割の既定値。skillRoles 未設定時のブリッジ。
 * ※フィールドが真の権威。ここは正準名ベースの初期値で、コンペンディウム/エディタでの設定が優先される。
 */
export const DEFAULT_SKILL_ROLES_BY_NAME = Object.freeze({
    "回避": ["dodge"],
    "操縦": ["dodge"],                 // ヴィークル搭乗時のドッジ(搭乗中は回避を不可にする文脈ブロックは13)
    "白兵": ["parry", "meleeAttack"],
    "射撃": ["rangedAttack"],
    "心理": ["mentalAttack"],
    "圧力": ["socialAttack"],
    "自我": ["mentalReaction"],
    "信用": ["socialReaction"],
    "医療": ["treatment"],
});

/**
 * 技能アイテムの役割を返す(system.skillRoles が真の権威・未設定なら正準名の既定値)。
 * @param {Item|{name?:string, system?:{skillRoles?:string[]}}} skill
 * @returns {string[]}
 */
export function getSkillRoles(skill) {
    const roles = skill?.system?.skillRoles;
    if (Array.isArray(roles) && roles.length) return roles.filter(r => SKILL_ROLES[r]);
    return DEFAULT_SKILL_ROLES_BY_NAME[skill?.name] ?? [];
}

/**
 * アクターの技能から、指定役割を持つものを返す(一般・スタイル技能・item.sort 順)。
 * @param {Actor} actor
 * @param {string} role SKILL_ROLES のキー
 * @returns {Item[]}
 */
export function actorSkillsWithRole(actor, role) {
    return (actor?.items ?? [])
        .filter(i => (i.type === "generalSkill" || i.type === "styleSkill") && getSkillRoles(i).includes(role))
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}
