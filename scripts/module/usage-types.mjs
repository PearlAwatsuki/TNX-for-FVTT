/**
 * @fileoverview 用途タイプ(行動種別)の正本レジストリ(2026-07-17 ユーザー確定・Foundry 非依存)。
 * 正本: Check_Rules.md「用途タイプ」行動種別への再編。
 *
 * タイプ＝行動種別。「技能クリック以外の場所から起動し、可能な技能を識別する必要がある
 * 行動」だけをタイプにする(リアクション・治療・カバー・移動・離脱など)。判定要求の延長
 * (情報収集・登場判定=可能技能が毎回明示される)や、用途内で機能が完結するもの(NPC取得)は
 * タイプにせずフラグのまま。旧 check/declaration の2タイプ+damageCategory 等のフラグ構成からの
 * 移行は usage.mjs の migrateData が行う。
 *
 * kind:
 * - generic:  判定/宣言(汎用)
 * - attack:   攻撃(attackCategory=系統。対決判定カードに攻撃項目を出す)
 * - reaction: リアクション(対決欄の「手段」行と 1:1。資格=このタイプの用途を持つ技能の所持)
 * - action:   その他の行動(移動・離脱・治療・改造・カバー)
 */

/** タイプキー → 定義。キーは保存値(migrateData・シート・起動ディスパッチの正本)。 */
export const USAGE_TYPE_DEFS = Object.freeze({
    check:               { label: "判定",                     kind: "generic" },
    declaration:         { label: "宣言",                     kind: "generic" },
    physicalAttack:      { label: "物理攻撃",                 kind: "attack", attackCategory: "physical" },
    mentalAttack:        { label: "精神攻撃",                 kind: "attack", attackCategory: "mental" },
    socialAttack:        { label: "社会攻撃",                 kind: "attack", attackCategory: "social" },
    dodge:               { label: "ドッジ",                   kind: "reaction" },
    parry:               { label: "パリー",                   kind: "reaction" },
    mentalReaction:      { label: "リアクション（精神攻撃）", kind: "reaction" },
    socialReaction:      { label: "リアクション（社会攻撃）", kind: "reaction" },
    moveBlockReaction:   { label: "リアクション（移動妨害）", kind: "reaction", usesVehicle: true },
    escapeBlockReaction: { label: "リアクション（離脱妨害）", kind: "reaction" },
    // 汎用「リアクション」(2026-07-18 ユーザー確定): 系統フラグを持たず**あらゆる対決判定への
    // リアクション資格**を持つ(適否は卓が都度判断・システムはブロックしない)。系統別タイプとは
    // 統合しない——系統別の資格ゲート(一般則)は維持され、本タイプは細則(例外能力)の受け皿
    reaction:            { label: "リアクション",             kind: "reaction" },
    move:                { label: "移動",                     kind: "action", usesVehicle: true },
    escape:              { label: "離脱",                     kind: "action" },
    treatment:           { label: "治療",                     kind: "action", selectableForm: true },
    repair:              { label: "修理",                     kind: "action" },
    modification:        { label: "改造",                     kind: "action" },
    covering:            { label: "カバー",                   kind: "action" },
});

/** タイプキー → 表示ラベル(用途作成ダイアログ・用途一覧・シートのタグ表示)。 */
export const USAGE_TYPE_LABELS = Object.freeze(
    Object.fromEntries(Object.entries(USAGE_TYPE_DEFS).map(([k, d]) => [k, d.label]))
);

/** 攻撃タイプか。 */
export function isAttackType(type) {
    return USAGE_TYPE_DEFS[type]?.kind === "attack";
}

/** 攻撃タイプの系統("physical"|"mental"|"social")。攻撃タイプ以外は ""。 */
export function attackCategoryOf(type) {
    return USAGE_TYPE_DEFS[type]?.attackCategory ?? "";
}

/** リアクションタイプか(対決欄の手段行と 1:1)。 */
export function isReactionType(type) {
    return USAGE_TYPE_DEFS[type]?.kind === "reaction";
}

/** 使用ヴィークルを要するタイプか(移動/リアクション（移動妨害）・準備済みヴィークルが無ければ判定不可)。 */
export function usesVehicle(type) {
    return USAGE_TYPE_DEFS[type]?.usesVehicle === true;
}

/**
 * 用途の実行形式("check"=判定 / "declaration"=宣言)。
 * 宣言タイプ=宣言。治療タイプのみ用途の設定(executionForm)で判定/宣言を選ぶ
 * (「1つのタイプで両形式をカバーする」2026-07-17 ユーザー裁定)。他は全て判定。
 * @param {{type?: string, executionForm?: string}} usage
 * @returns {"check"|"declaration"}
 */
export function executionFormOf(usage) {
    const type = usage?.type;
    if (type === "declaration") return "declaration";
    if (USAGE_TYPE_DEFS[type]?.selectableForm) {
        return usage?.executionForm === "declaration" ? "declaration" : "check";
    }
    return "check";
}

/**
 * タイプの系統既定の対決行(作成時・自動入力で敷く。全て enum 値=技能名・辞典キーのハードコード無し)。
 * 物理攻撃→ドッジ+パリー / 精神攻撃→リアクション（精神攻撃） / 社会攻撃→リアクション（社会攻撃） /
 * 移動→リアクション（移動妨害） / 離脱→リアクション（離脱妨害）(2026-07-17 ユーザー確定)。
 * リアクション系→「なし」(2026-07-18 ユーザー裁定: リアクション用途でも対決「なし」で設定自体は
 * される=対決欄は全タイプが持つ。旧「リアクション等は対決欄を持たない」は Code の過大一般化で撤回)。
 * @param {string} type
 * @returns {Array<{value: string, name: string, skillDict: string, skillGroup: string, skillSub: string}>}
 */
export function defaultConfrontationForType(type) {
    const values = {
        physicalAttack: ["dodge", "parry"],
        mentalAttack:   ["mentalReaction"],
        socialAttack:   ["socialReaction"],
        move:           ["moveBlockReaction"],
        escape:         ["escapeBlockReaction"],
    }[type] ?? (isReactionType(type) ? ["none"] : []);
    return values.map(v => ({ value: v, name: "", skillDict: "", skillGroup: "", skillSub: "" }));
}

/**
 * アイテムロール(技能クリック)で実行対象になる用途(2026-07-17 行動種別再編の確定規則・
 * 2026-07-19 に _activateItemCheck から抽出=KI-025 の候補列挙と規則を共有する)。
 * 判定を行う用途すべて(攻撃・リアクション・移動・治療(判定形)等)に加え、事後系フラグ付きの
 * 宣言(再判定を付与/判定を修正/ダメージを修正/スートを変更=バフ宣言)と宣言形の治療・
 * NPC取得宣言を含む。フラグ無しの宣言は用途の直接指定時のみ実行(ここには入らない)。
 * @param {Array<object>|undefined} actions 用途配列(system.actions)
 * @returns {Array<object>}
 */
export function usableUsagesOf(actions) {
    return (actions ?? []).filter(a => executionFormOf(a) === "check"
        || (executionFormOf(a) === "declaration"
            && (a.grantRecheck === true || a.modifyCheck === true || a.modifyDamage === true
                || a.grantSuitChange === true || a.type === "treatment" || a.npcAcquire === true)));
}

/**
 * 用途の実効ベース技能 id の唯一の解決関数(2026-07-18 集約)。散在していた
 * `usage.baseSkillRef?.itemId || item.id` の重複を一本化する。
 * アクション技能は常に自身がベース。非アクションは baseSkillRef があればそれ、無ければ親自身。
 * ベースは用途設定確定時に永続化されるため通常は baseSkillRef が埋まっている——この関数は
 * 未永続の瞬間(作成直後など)の最終フォールバックとして親自身を返す安全網。
 * @param {{baseSkillRef?: {itemId?: string}}} usage
 * @param {{id: string, system?: {isAction?: boolean}}} item 用途の親アイテム
 * @returns {string}
 */
export function effectiveBaseSkillId(usage, item) {
    if (item?.system?.isAction === true) return item.id;
    return usage?.baseSkillRef?.itemId || item?.id || "";
}

/**
 * 用途の実効表示名: 名前が空なら「タイプ名（親アイテム名）」(2026-07-17 ユーザー確定・
 * 用途シートの placeholder と同形。例:「判定（ペネトレイト）」)。一覧・タイトル・戦闘タブ・
 * カード・通知の全表示箇所でこの一形式に統一する(親名のみの旧形式は同名行が並ぶと判別不能)。
 * @param {{name?: string, type?: string}} usage
 * @param {string} parentName 親アイテム名
 * @returns {string}
 */
export function usageDisplayName(usage, parentName) {
    const name = (usage?.name ?? "").trim();
    if (name) return name;
    const label = USAGE_TYPE_LABELS[usage?.type] ?? usage?.type ?? "";
    if (!label) return parentName || "";
    if (!parentName) return label;
    return `${label}（${parentName}）`;
}
