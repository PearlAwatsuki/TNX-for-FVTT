/**
 * @fileoverview 用途シートの表示コンテキスト組み立て(2026-09-07 用途シートから移設)。
 *
 * タイミング・対象・射程・目標値・対決・組み合わせ・武器・ダメージ・改造…と、用途が持つ
 * 全設定分の選択肢と現在値をテンプレートへ渡す形に整える。設定項目の数だけ長くなる性質の
 * 処理で、シート本体の骨格(登録・描画・送信)とは読む理由が違うため分けてある。
 */

import { SYSTEM_ID } from "../constants.mjs";
import { TnxSkillUtils } from "../core/tnx-skill-utils.mjs";
import { getComboSuits } from "../rules/tnx-check-engine.mjs";
import { comboLockAnalysis, isComboRequired } from "../rules/skill-chain-resolution.mjs";
import { CONDITION_KINDS, conditionDisplayName } from "../rules/conditions.mjs";
import { ATTACK_DAMAGE_TYPES, readFlag } from "../data/item/helpers.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { buildCategoryKeyGroups, categoryKeyLabel, ALL_CATEGORIES_KEY } from "../data/item/outfit-categories.mjs";
import { attackWeaponDisplayName, attackWeaponKindEligible } from "../rules/attack-weapons.mjs";
import { WEAPON_RANGE_MAX_OPTIONS } from "../data/item/weapon.mjs";
import { loadSkillChoices, loadCascadeData, buildSkillCascadeSteps, SKILL_PACKS, STYLE_PACK, ORGANIZATION_PACK } from "../dictionary/skill-dictionary.mjs";
import { isAttackType, isReactionType, isMiracleType, executionFormOf, usageDisplayName } from "../rules/usage-types.mjs";
import { USAGE_CONFRONTATION_OPTIONS } from "../rules/confrontation.mjs";
import { formatSkillName, itemDisplayName } from "../core/identification.mjs";
import { orderSkills } from "../ui/skill-select.mjs";
import { RANGE_SPAN_CAPABLE, normalizeUsageExplanation } from "../rules/usage-autofill.mjs";
import { CHAIN_SKILL_TYPES, resolveUsageSiblingSkills } from "../core/usage-derivation.mjs";
import { TARGET_CONDITION_KINDS, TARGET_CONDITION_MODES } from "../rules/target-condition.mjs";

// ─── ダメージ修正の対象条件(2026-09-01 承認・照合は target-condition.mjs) ─────────
// 種類・極性の**正本は target-condition.mjs**。ここは表示名だけを持ち、並びと網羅は
// 正本の配列から導く(2026-09-07。従来ここが値を直書きしており、正本が浮いていた)
const TARGET_COND_KIND_LABELS = {
    none: "条件なし", wet: "ウェット", style: "スタイル", works: "ワークス",
};

const TARGET_COND_MODE_LABELS = { exclude: "には無効", only: "のみ有効" };

/** 条件の種類の選択肢(none=条件なし)。 */
const TARGET_COND_KIND_OPTIONS = TARGET_CONDITION_KINDS
    .map(v => ({ value: v, label: TARGET_COND_KIND_LABELS[v] ?? v }));

/** 極性の選択肢(exclude=「〜には無効」/ only=「〜のみ有効」)。 */
const TARGET_COND_MODE_OPTIONS = TARGET_CONDITION_MODES
    .map(v => ({ value: v, label: TARGET_COND_MODE_LABELS[v] ?? v }));

/**
 * 対象条件のセレクト描画用コンテキストを作る。key の候補は kind に対応する辞典
 * (style=スタイル辞典・works=組織辞典)だけを出す(識別キーを保存・表示は現在名)。
 * @param {{kind?:string, mode?:string, key?:string}|null|undefined} cond 保存済みの条件
 * @param {Record<string,string>} styleChoices スタイル辞典の選択肢(識別キー→名)
 * @param {Record<string,string>} orgChoices 組織辞典の選択肢(識別キー→名)
 * @returns {object} テンプレート用(kindOptions/modeOptions/keyChoices/key/needsKey/showDetail)
 */
function buildTargetConditionUi(cond, styleChoices, orgChoices) {
    const kind = cond?.kind ?? "none";
    const mode = cond?.mode ?? "exclude";
    const key  = cond?.key ?? "";
    return {
        kindOptions: TARGET_COND_KIND_OPTIONS.map(o => ({ ...o, selected: o.value === kind })),
        modeOptions: TARGET_COND_MODE_OPTIONS.map(o => ({ ...o, selected: o.value === mode })),
        needsKey: kind === "style" || kind === "works",
        showDetail: kind !== "none",
        keyChoices: kind === "style" ? styleChoices : (kind === "works" ? orgChoices : {}),
        key,
    };
}

/**
 * NPC取得のモード(取得類型・フェーズ11-6・Troops.md「NPC取得」)。
 * 参照先の種類からの導出はしない=モードは明示選択(2026-07-04 ユーザー裁定)。
 * extra=判定なしで派生取得+場に出す / troop・enigma=判定して達成値=人数・ポイント /
 * bunshin=判定・目標値10(達成値10以上で成功)
 */
export const ACQUIRE_MODES = Object.freeze({
    extra:   "エキストラ",
    troop:   "トループ",
    enigma:  "エニグマ",
    bunshin: "分身",
});

/** 回復範囲の大分類ラベル(group=CONDITION_KINDS の group 値・2026-07-13)。 */
const RECOVERY_GROUP_LABELS = Object.freeze({
    bs:             "BS",
    incapacitation: "戦闘不能",
    physical:       "負傷（肉体）",
    mental:         "負傷（精神）",
    social:         "負傷（社会）",
});

// ─── 発動パラメータ優先度（自動入力で使用） ───────────────────────────────────
// ルール正本: llm-wiki/01_Wiki/Game_Rules/Check_Rules.md（対象優先度・射程優先度）。
// 優先度解決の純ロジックは rules/usage-autofill.mjs へ分離(KI-033・2026-07-19)。

/** @override */
export async function prepareUsageContext(sheet, context) {
    const usage = sheet.usage;
    if (!usage) {
        sheet.close();
        return context;
    }

    context.usage      = foundry.utils.deepClone(usage);
    context.item       = sheet._item;
    context.noCombo    = sheet._item.system?.noCombo === true; // 組み合わせ不可: コンボ(組み合わせ技能)の設定を抑止
    context.editable   = sheet._item.isOwner;
    context.skillOpts  = TnxSkillUtils.getSkillOptions();
    // 用途では「解説参照」を選べない(KI-033・2026-07-19 裁定: 用途は解説の実装そのもの=自己参照)。
    // 技能シートと共用の選択肢から撤去し、保存済みの旧値は「その他」として表示する
    // (次のフォーム保存でそのまま「その他」に着地。getSkillOptions は毎回新オブジェクトを返す)
    for (const key of ["timing", "actions", "processes", "target", "range", "targetValue"]) {
        delete context.skillOpts[key].explanation;
    }
    normalizeUsageExplanation(context.usage);
    // 用途名の既定は空(2026-07-17 ユーザー確定): placeholder は空のときの実効名
    // 「タイプ名（親アイテム名）」(usageDisplayName と同一形式・技能名部分は〈〉なし=素の名前)
    context.namePlaceholder = usageDisplayName({ type: usage.type }, sheet._item.name);
    // 射程の幅(2026-07-16): 物理射程のときのみ最長射程セレクトを出す(武器エディタの min〜max と同形)
    context.showRangeMax    = RANGE_SPAN_CAPABLE.has(usage.range);
    context.rangeMaxOptions = WEAPON_RANGE_MAX_OPTIONS;

    // タイプ判定フラグ(2026-07-17 行動種別再編): isCheckType=「判定を行う用途」(攻撃・
    // リアクション・移動等の判定系タイプを含む。治療は実行形式の設定に従う)
    context.isCheckType        = executionFormOf(usage) === "check";
    // 固定値判定(フェーズ11-5・2026-07-04 確定): fixedResult が設定された判定用途。
    // スート・レベル・カード・能力値を読まないため、発動タブは固定達成値のみ・効果タブは出さない
    context.isFixedCheck       = context.isCheckType && Number.isFinite(usage.fixedResult);
    // 攻撃=攻撃タイプ(物理/精神/社会・2026-07-17 再編。系統はタイプが持つ)
    context.isAttack           = isAttackType(usage.type);
    // ダメージ種別の選択肢は ATTACK_DAMAGE_TYPES から組み立てる(2026-07-21 是正)。
    // フェーズ8 の新設時に選択肢をテンプレートへ書き写しており、X が欠けたまま残っていた
    // (アウトフィットシートは同じ表から組み立てていたため4種そろっていた)。
    // 空値=武器に従う(用途で上書きしない)
    context.damageTypeOptions = Object.entries(ATTACK_DAMAGE_TYPES)
        .map(([value, label]) => ({ value, label, selected: usage.damageType === value }));
    // 物理攻撃の白兵/射撃選択(2026-07-17): 射撃攻撃は生身では行えない(武器候補の絞り込みと実行時ブロック)
    context.isPhysicalAttack   = usage.type === "physicalAttack";
    context.attackWeaponKind   = usage.attackWeaponKind === "ranged" ? "ranged" : "melee";
    // ダメージを修正(2026-07-11→2026-07-17): 汎用の判定タイプのみの使用の仕方フラグ(攻撃はタイプ化で分離)
    context.isModifyDamage     = usage.type === "check" && usage.modifyDamage === true;
    // 判定モードのラジオ値(2026-07-11/12): 通常/再判定を付与/判定を修正/スートを変更
    // (判定用途に「なし」は無い)
    context.checkMode          = usage.grantRecheck === true ? "grant"
        : (usage.modifyCheck === true ? "modify"
            : (usage.grantSuitChange === true ? "suitChange" : "normal"));
    // 宣言(declaration)の判定/ダメージ修正(2026-07-12 ユーザー確定): バフ宣言の表現。
    // 判定用途とレイアウトを揃えた〈判定〉〈ダメージ〉fieldset・チェックボックス2つは独立
    // (排他 UI にしない。両方 ON の運用は想定せず、使用時は「判定を修正」が先に振られる)
    context.isDeclarationType  = usage.type === "declaration";
    if (context.isDeclarationType) {
        context.checkBonusSelf  = usage.checkBonusSelf ?? "";
        context.damageBonusSelf = usage.damageBonusSelf ?? "";
    }
    // リアクションタイプ(2026-07-17): リアクション設定(範囲/攻撃を失敗させる/対決不可無視)を出す
    context.isReactionUsage    = isReactionType(usage.type);
    // 治療タイプ(2026-07-17): 実行形式(判定/宣言)は用途の設定で固定・回復範囲の設定を持つ
    context.isTreatment        = usage.type === "treatment";
    if (context.isTreatment) {
        context.executionFormOptions = [
            { value: "check",       label: "判定",  selected: executionFormOf(usage) === "check" },
            { value: "declaration", label: "宣言",  selected: executionFormOf(usage) === "declaration" },
        ];
    }
    // 使用ヴィークル(2026-07-18 一般化): 用途フラグ requiresVehicle(ヴィークル準備時)がオンのとき
    // 準備済みヴィークルの単一参照欄を表示。空=実行時に準備済みヴィークルを自動解決
    // (準備済みが無ければ判定不可=実行時ブロック)。移動/リアクション（移動妨害）は既定オン
    context.showVehicleRef = usage.requiresVehicle === true;
    // 「ヴィークル準備時」トグルを判定セクションに出すか(判定を行う用途・固定値判定を除く)
    context.showRequiresVehicleToggle = context.isCheckType && !context.isFixedCheck;
    if (context.showVehicleRef) {
        const vehicles = (sheet._item.actor?.items ?? [])
            .filter(i => i.type === "vehicle" && i.system.isPrepared);
        const selId = usage.vehicleRef?.itemId ?? "";
        context.vehicleOptions = [
            { value: "", label: "自動（準備済みヴィークル）", selected: !selId },
            ...vehicles.map(v => ({ value: v.id, label: v.name, selected: v.id === selId })),
            ...(selId && !vehicles.some(v => v.id === selId)
                ? [{ value: selId, label: `(解決不能: ${selId})`, selected: true }] : []),
        ];
    }

    // 神業専用タイプ(17-2): 神業は判定を行わないため、目標値・対決の設定は出さない
    context.isMiracleUsage = isMiracleType(usage.type);
    // 即死・社会戦(17-3): 系統(肉体/精神/トループの壊滅)・結果の決め方(使用者が選ぶ/RL が決める)
    context.isMiracleKill = usage.type === "miracleKill";
    context.isMiracleSocial = usage.type === "miracleSocial";
    if (context.isMiracleKill) {
        const cat = usage.killCategory || "physical";
        // 「トループの壊滅」は肉体・精神と同列の選択肢(2026-09-06 ユーザー裁定)。
        // 《天変地異》《突破》=トループ級を壊滅させるだけで、キャスト/ゲストには効果がない
        context.killCategoryOptions = [
            { value: "physical", label: "肉体" }, { value: "mental", label: "精神" },
            { value: "troop", label: "トループの壊滅" },
        ].map(o => ({ ...o, selected: o.value === cat }));
    }
    if (context.isMiracleSocial) {
        const dec = usage.socialDecide || "choose";
        context.socialDecideOptions = [
            { value: "choose", label: "使用者がチャートの行を選ぶ（抹殺も可）" },
            { value: "rl",     label: "RL が決める（値の入力か、山札から2枚めくって合計）" },
        ].map(o => ({ ...o, selected: o.value === dec }));
    }
    // 宣言の効果(17-4/17-6・神業の宣言タイプ専用): なし／対象の神業の使用回数を+1(《ファイト！》)／
    // 対象に神業を使わせる(《プリーズ！》)／対象と自分のダメージ・状態を入れ替える(《神出鬼没》)／
    // アウトフィットを入手する(《タイムリー》《買収》)／次の行動を神業以外で妨げられなくする(《不可知》)／
    // 見聞きした神業のコピー(《突然変異》・2026-09-06 に効果の参照から移設＝コピーは宣言の効果)
    context.isMiracleDeclaration = usage.type === "miracleDeclaration";
    if (context.isMiracleDeclaration) {
        const mode = usage.miracleEffect || "";
        context.miracleEffectOptions = [
            { value: "",              label: "なし" },
            { value: "addUse",        label: "対象の神業の使用回数を+1" },
            { value: "requestUse",    label: "対象に神業を使わせる（使用済みにならない）" },
            { value: "swapDamage",    label: "宿主と自分のダメージ・状態を入れ替える" },
            { value: "acquireOutfit", label: "アウトフィットを入手する（常備化できない）" },
            { value: "insensible",    label: "次の行動を神業以外で妨げられなくする" },
            { value: "copyUsed",      label: "このアクトで見聞きした神業をコピーする" },
        ].map(o => ({ ...o, selected: o.value === mode }));
    }
    // 防御タイプ(17-2・神業専用): 動作(打ち消し/適用前に防ぐ/回避/受けた後に消す)・範囲・系統。
    // 「受けた後に消す」は治療の回復設定(範囲/除外/該当すべて/回復数)を共用し、神業の治癒で
    // 足りない2つ(スタイル技能の効果の解除・受けたシーンの制限)を足す
    context.isMiracleDefence = usage.type === "miracleDefence";
    if (context.isMiracleDefence) {
        const act = usage.defenceAction || "prevent";
        context.defenceActionOptions = [
            { value: "prevent", label: "適用前に防ぐ" },
            { value: "negate",  label: "打ち消し" },
            { value: "evade",   label: "回避" },
            { value: "cure",    label: "受けた後に消す" },
        ].map(o => ({ ...o, selected: o.value === act }));
        context.isDefencePrevent = act === "prevent";
        context.isDefenceCure    = act === "cure";
        context.isDefenceNegate  = act === "negate";
        // 打ち消せる神業の限定(《真実に対する不可触》等)。相手は神業ごとに変わる＝選ぶ操作なので
        // 辞典の神業を並べたプルダウンにする(2026-09-06 ユーザーの基準)
        if (context.isDefenceNegate) {
            const pack = game.packs.get("tokyo-nova-axleration.miracles");
            const index = pack ? await pack.getIndex() : [];
            const cur = usage.negateMiracle || "";
            context.negateMiracleOptions = [
                { value: "", label: "すべての神業", selected: !cur },
                ...[...index]
                    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                    .map(e => ({ value: e.uuid, label: e.name, selected: e.uuid === cur })),
            ];
        }
        const scope = usage.defenceScope || "all";
        context.defenceScopeOptions = [
            { value: "all", label: "一回の攻撃・神業をまるごと" },
            { value: "one", label: "選んだ1人" },
        ].map(o => ({ ...o, selected: o.value === scope }));
        const cats = new Set(usage.defenceCategories ?? ["physical", "mental", "social"]);
        context.defenceCategoryRows = [
            { key: "physical", label: "肉体" }, { key: "mental", label: "精神" }, { key: "social", label: "社会" },
        ].map(r => ({ ...r, checked: cats.has(r.key) }));
        const limit = usage.recoverySceneLimit || "none";
        context.recoverySceneLimitOptions = [
            { value: "none",     label: "なし" },
            { value: "terminal", label: "完全死亡・精神崩壊はそのシーンで受けたものだけ" },
            { value: "all",      label: "すべてそのシーンで受けたものだけ" },
        ].map(o => ({ ...o, selected: o.value === limit }));
        context.recoveryEffects = usage.recoveryEffects === true;
    }

    // 回復範囲(2026-07-13→2026-07-17): 治療タイプの設定(旧 recovery トグルはタイプへ移行)。
    // 範囲=大分類(グループ)→小分類(タグ)の行(OR)・
    // 除外=タグ(タグ自身+そのタグを与える負傷を除く=「指定タグを含むもの以外すべて」)。
    // 防御タイプの「受けた後に消す」も同じ設定を使う(17-2)
    context.isRecoveryCapable = context.isTreatment || context.isDefenceCure === true;
    if (context.isRecoveryCapable) {
        context.isRecovery      = true;
        context.recoveryAll     = usage.recoveryAll === true;
        context.recoveryCountValue   = Math.max(1, usage.recoveryCount ?? 1);
        const kindOptionsFor = (group) => Object.entries(CONDITION_KINDS)
            .filter(([, def]) => def.group === group)
            .map(([value, def]) => ({ value, label: def.label }));
        context.recoveryRows = (usage.recoveryTargets ?? []).map((r, idx) => ({
            idx,
            groupOptions: Object.entries(RECOVERY_GROUP_LABELS)
                .map(([value, label]) => ({ value, label, selected: value === r.group })),
            kindOptions: [
                { value: "", label: "（グループ全体）", selected: !r.kind },
                ...kindOptionsFor(r.group).map(o => ({ ...o, selected: o.value === r.kind })),
            ],
        }));
        // 除外タグ: 負傷以外(BS/戦闘不能)のタグから選ぶ(負傷は「そのタグを与える」経由で除外される)
        const excludeSet = new Set(usage.recoveryExcludes ?? []);
        context.recoveryExcludeRows = [...excludeSet]
            .map(k => ({ key: k, label: conditionDisplayName(k) }));
        context.recoveryExcludeChoices = Object.entries(CONDITION_KINDS)
            .filter(([k, def]) => def.type !== "wound" && !excludeSet.has(k))
            .map(([value, def]) => ({ value, label: def.label }));
    }

    // 修理(2026-07-18): この用途で修理できるアウトフィットの分類ホワイトリスト
    // (小分類キーまたは大分類キー。大分類キー=その大分類全体・2026-07-19)。
    // 選択済み=行表示(大分類/小分類ラベル)・追加=大分類 optgroup +（大分類全体）+ 小分類 option の1セレクト。
    // サービス大分類は故障/破壊しない(免疫)ため候補から除外する。
    context.isRepair = usage.type === "repair";
    if (context.isRepair) {
        const selected = new Set(usage.repairableCategories ?? []);
        context.repairCategoryRows = [...selected].map(k => ({ key: k, label: categoryKeyLabel(k) }));
        // 選択肢の構造は共通ビルダー(outfit-categories.mjs・製作技能の対応分類と共用=フェーズ16-1)
        context.repairCategoryChoices = buildCategoryKeyGroups({ excludeKeys: selected });
    }

    // 破壊(17-3・2026-09-06): この用途で破壊できるアウトフィットの分類ホワイトリスト。
    // 器は修理と同じ(大分類キー/小分類キーの混在)。**空欄は許容しない**ため、行が1つのときは
    // 削除をグレーアウト＋クリック不能にする(_onRender の applyTriggerDisable)。
    context.isMiracleDestroy = usage.type === "miracleDestroy";
    if (context.isMiracleDestroy) {
        const selected = new Set(usage.destroyableCategories ?? []);
        context.destroyCategoryRows = [...selected].map(k => ({ key: k, label: categoryKeyLabel(k) }));
        context.destroyCategoryChoices = buildCategoryKeyGroups({ excludeKeys: selected });
        // 「全て」は分類の列挙ではなく専用の選択肢(選ぶと他の分類と入れ替わる)
        context.destroyAllChoice = selected.has(ALL_CATEGORIES_KEY)
            ? null : { value: ALL_CATEGORIES_KEY, label: categoryKeyLabel(ALL_CATEGORIES_KEY) };
    }

    // NPC取得(11-6・Troops.md/2026-07-13 タイプ→フラグへ移管): check/declaration のどちらにも
    // 設定できる。設定 UI は効果タブ・設定できるのはトループ取得技能とアウトフィット
    // (旧タイプの作成ゲートを移管)。モードは明示選択・実行はモード駆動で従来どおり
    // (エキストラ=判定なし・トループ/エニグマ/分身=判定。目標値はモードで決まるため入力欄を出さない)
    context.canNpcAcquire = (sheet._item.type === "styleSkill" && sheet._item.system.unique === "troopAcquire")
        || OUTFIT_ITEM_TYPES.has(sheet._item.type);
    context.isNpcAcquireType = usage.npcAcquire === true;
    context.isAcquireExtraMode = false;
    if (context.isNpcAcquireType) {
        const mode = usage.acquireMode || "extra";
        context.isAcquireExtraMode = mode === "extra";
        context.acquireModeOptions = Object.entries(ACQUIRE_MODES)
            .map(([value, label]) => ({ value, label, selected: value === mode }));
        // 取得アイテム参照(エキストラモード)は fromUuid でライブ解決(削除済みは name フォールバック)
        context.acquireItemRows = await Promise.all((usage.acquireItemRefs ?? []).map(async (r, idx) => {
            const doc = r.uuid ? await fromUuid(r.uuid).catch(() => null) : null;
            return { idx, uuid: r.uuid, name: doc?.name ?? (r.name ? `${r.name}（削除済み）` : "(不明)"), missing: !doc };
        }));
        // 取得アクター参照(トループ/エニグマのみ・2026-07-07 裁定=対象は用途側で設定)。ライブ解決。
        // 分身は対象を設定せずそのまま召喚(2026-07-08 裁定)＝参照欄の代わりに召喚数を設定する
        context.isAcquireBunshinMode = mode === "bunshin";
        context.isAcquireRefMode = mode === "troop" || mode === "enigma";
        const aRef = usage.acquireActorRef ?? {};
        const aDoc = aRef.uuid ? await fromUuid(aRef.uuid).catch(() => null) : null;
        context.hasAcquireActor = !!aRef.uuid;
        context.acquireActorName = aDoc?.name ?? (aRef.name ? `${aRef.name}（削除済み）` : "");
        context.acquireModeLabel = ACQUIRE_MODES[mode] ?? "";
        context.acquireCount = Math.max(1, usage.acquireCount ?? 1);
    }
    context.isAcquireCheckMode = context.isNpcAcquireType && !context.isAcquireExtraMode;

    // 技能ベースの用途（コンボ・対決表示・自動入力の対象）。攻撃は check なのでここに含まれる
    context.showSkillParams    = context.isCheckType || context.isAcquireCheckMode;

    // ベース技能・組み合わせ技能候補（check / attack）
    if (context.showSkillParams) {
        const parentIsAction = sheet._item.system.isAction === true;

        // 同輩技能(2026-07-18 是正): アクター所持だけでなく辞典/ワールド直下でも、同じ
        // コレクションの技能でベース・組み合わせを解決する。アクションハンドラ(チェーン
        // enforcement 等)からも使うため直近レンダーのキャッシュとして持つ
        const siblingSkills = await resolveUsageSiblingSkills(sheet._item);
        sheet._siblingSkills = siblingSkills;
        const skillById = new Map(siblingSkills.map(i => [i.id, i]));

        // 技能チェーン解決: アクション技能がチェーンにあると、ベースは「指定技能＋その代用」に限定する
        // (他の無関係な技能はベースになれない)。候補が1つなら固定表示、代用が増えれば選択可能(ハードロックにしない)。
        const parentItemId = sheet._item.id;
        const chainRes = sheet._resolveComboChain();
        const lockedByChain = !!chainRes && !chainRes.defect && chainRes.baseLocked;
        // baseCandidates: null=全技能から選択(非ロック)、配列=その候補に限定(本体優先で先頭)
        let baseCandidates = null;
        if (parentIsAction) baseCandidates = [parentItemId];
        else if (lockedByChain) baseCandidates = (chainRes.baseCandidateItemIds ?? []).slice();

        const parentIsChainSkill = CHAIN_SKILL_TYPES.includes(sheet._item.type);
        const defaultBaseId = parentIsAction ? parentItemId : (chainRes && !chainRes.defect ? chainRes.baseItemId : null);
        let baseId = parentIsAction ? parentItemId : (usage.baseSkillRef?.itemId ?? "");
        // ロック時、現ベースが候補外(未設定含む)なら既定(指定技能・本体優先)へ寄せる
        if (baseCandidates && !baseCandidates.includes(baseId)) baseId = defaultBaseId ?? baseCandidates[0] ?? "";
        // 非ロック・未設定は連鎖の解決ベース(指定技能があれば末端・無ければ親自身)を既定に(2026-07-18 統一)。
        // 親が技能のときのみ自己ベースを既定にする(アウトフィット親はユーザーがベース技能を明示設定)
        else if (!baseCandidates && !baseId && !chainRes?.manual && parentIsChainSkill) {
            baseId = defaultBaseId || parentItemId;
        }

        const baseItem = skillById.get(baseId) ?? (baseId === parentItemId ? sheet._item : null);
        // 技能名の表示は 〈〉 整形(2026-07-18 ユーザー確定: 名前欄・アクターシートの技能リスト以外)
        context.baseSkillName  = baseItem ? formatSkillName(baseItem.name) : (baseId ? `(削除済み: ${baseId})` : "");
        context.baseSkillId    = baseId;
        // 候補が1つだけ(代用なし)なら固定表示、複数(代用あり)なら選択可能
        context.baseSkillFixed = !!baseCandidates && baseCandidates.length <= 1;

        // 非ロック候補: 親が技能なら自己(＝親をベース)を先頭に含める(2026-07-18: base=親を明示選択可能に)。
        // 指定技能があるスタイル技能の既定ベースは末端だが、自己選択の余地は残す(手動上書き)
        const selfBaseOption = parentIsChainSkill
            ? [{ id: parentItemId, name: formatSkillName(sheet._item.name) }] : [];
        // 並びはシートのソート順(手動 sort→正規順→名前・orderSkills)＝2026-07-19 ユーザー指示
        context.availableBaseSkills = baseCandidates
            ? baseCandidates.map(id => {
                const s = skillById.get(id) ?? (id === parentItemId ? sheet._item : null);
                return { id, name: s ? formatSkillName(s.name) : `(削除済み: ${id})` };
            })
            : [
                ...selfBaseOption,
                ...orderSkills(siblingSkills.filter(i => i.id !== parentItemId))
                    .map(i => ({ id: i.id, name: formatSkillName(i.name) })),
            ];

        const parentIsComboMember = !!baseId && parentItemId !== baseId;

        const usedIds = new Set([baseId, parentItemId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));

        // 現在の参加技能(ベース＋親がコンボ＋既存コンボ)のスート積。組み合わせは共通スートで成立するため、
        // 追加すると共通スートが空になる技能は候補から除外する。
        const currentSystems = [
            baseItem?.system,
            ...(parentIsComboMember ? [sheet._item.system] : []),
            ...usage.skillRefs.map(r => skillById.get(r.itemId)?.system),
        ].filter(Boolean);
        const currentSuits = getComboSuits(currentSystems);

        // 組み合わせ候補: アクション技能(必ずベース)・組み合わせ不可技能(単独判定のみ)・
        // 現在の構成と共通スートを持たない技能 は除外する。並びはシートのソート順(orderSkills)
        context.availableSkills = orderSkills(siblingSkills
            .filter(i => !usedIds.has(i.id)
                && i.system.isAction !== true && i.system.noCombo !== true
                && currentSuits.some(suit => readFlag(i.system, `suits.${suit}`))))
            .map(i => ({ id: i.id, name: formatSkillName(i.name) }));

        // 技能チェーン: 「、」候補制限(どれか1つ登録まで候補をその代替に絞る)・必須コンボの削除不可表示
        if (chainRes?.alternativeItemIds?.length
            && !usage.skillRefs.some(r => chainRes.alternativeItemIds.includes(r.itemId))) {
            const altSet = new Set(chainRes.alternativeItemIds);
            context.availableSkills = context.availableSkills.filter(s => altSet.has(s.id));
        }
        // 削除不可(ロック)判定: ベース連鎖、または他の組み合わせ技能が要求する技能のみロックする。
        // 単に組み合わせに居る(seed)だけでは外せる(自身が seed＝必須 で全ロックになるのを防ぐ)。
        const allComboIds = [...(parentIsComboMember ? [parentItemId] : []), ...usage.skillRefs.map(r => r.itemId)];
        let lockOf = () => false;
        const lockSkillItems = sheet._actorSkillItems();
        if (lockSkillItems) {
            const { rootMandatoryIds, comboChains } = comboLockAnalysis(sheet._normalizeSkillItem(sheet._item), lockSkillItems, allComboIds);
            lockOf = (id) => isComboRequired(id, allComboIds, rootMandatoryIds, comboChains);
        }

        context.skillRefItems = [
            ...(parentIsComboMember ? [{ idx: -1, itemId: parentItemId, name: itemDisplayName(sheet._item), isLocked: true }] : []),
            ...usage.skillRefs.map((r, idx) => {
                const skillItem = skillById.get(r.itemId);
                return { idx, itemId: r.itemId, name: skillItem ? formatSkillName(skillItem.name) : `(削除済み: ${r.itemId})`, isLocked: lockOf(r.itemId) };
            }),
        ];

        // 識別キー→技能名の逆引き(無視する指定技能の表示用。未収載キーはそのまま表示)
        const skillNames = await loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
        const nameOf = (key) => skillNames[key] || key;

        // 無視する指定技能(2026-07-10): この用途で設定した技能を指定「技能」とするスタイル技能は、
        // 指定技能を自動追加せず単体で組み合わせに参加できる(〈技能AⅡ〉系の効果)。
        // 保存は辞典の識別キー・表示は逆引きした技能名(未収載キーはそのまま)
        const ignoreKeys = sheet._ignoreComboKeys();
        context.ignoreComboRows = ignoreKeys.map(key => ({ key, name: formatSkillName(nameOf(key)) || key }));
        const usedIgnore = new Set(ignoreKeys);
        context.ignoreComboChoices = Object.entries(skillNames)
            .filter(([key]) => key && !usedIgnore.has(key))
            .sort((a, b) => a[1].localeCompare(b[1], "ja"))
            .map(([key, name]) => ({ key, name: formatSkillName(name) }));
    }

    // 対決欄: **全タイプが持つ**(2026-07-18 ユーザー裁定: リアクション用途でも対決「なし」で
    // 設定自体はされる。旧「判定・攻撃・移動・離脱のみ」のゲートは撤回)。行の見た目・構造は
    // スタイル技能シートの対決セクション(tnx-combo-card/grid)を踏襲し、値は用途独自の選択肢
    // (手段行=リアクション用途タイプと1:1)。「不可」はマスクで下地の行と並存保存する
    context.showConfrontation = !context.isFixedCheck && !isMiracleType(usage.type); // 神業は判定を行わない(17-2)
    if (context.showConfrontation) {
        const cascadeData = await loadCascadeData();
        // スタイル技能と同じく最低1行を表示する(空=blank 行。保存されても無効行で無害)
        const confRows = (usage.confrontation ?? []).length
            ? usage.confrontation
            : [{ value: "blank", name: "", skillDict: "", skillGroup: "", skillSub: "" }];
        context.confrontationRows = confRows.map((c, idx) => {
            const isSkill = c.value === "skillName" || c.value === "skillNameAsterisk";
            const cascadeSteps = isSkill
                ? buildSkillCascadeSteps(cascadeData,
                    { dict: c.skillDict, group: c.skillGroup, sub: c.skillSub, skill: c.name })
                : [];
            // 2列グリッドの敷き方はスタイル技能シートと同じ: 技能名系以外は種別セレクトが全幅、
            // 技能名系は種別+段で埋め、(1+段数)が奇数なら最後の段を全幅にする
            const typeFull = !isSkill;
            if (cascadeSteps.length && (1 + cascadeSteps.length) % 2 === 1) {
                cascadeSteps[cascadeSteps.length - 1].full = true;
            }
            return {
                idx,
                typeFull,
                valueOptions: Object.entries(USAGE_CONFRONTATION_OPTIONS)
                    .map(([value, label]) => ({ value, label, selected: value === (c.value || "blank") })),
                cascadeSteps,
            };
        });
    }

    // 攻撃プロファイル(2026-07-17 再編: 攻撃は行動種別タイプ)。物理攻撃のみ武器・ダメージ種別を
    // 持ち、白兵/射撃の選択(attackWeaponKind)で使用武器の候補を区分フラグで絞り込む
    // (射撃攻撃は生身では行えない=射撃武器フラグの武器が無ければ実行時ブロック)
    if (context.isPhysicalAttack && !context.isFixedCheck) {
        const actorItems = sheet._item.actor?.items ?? [];
        const refs = usage.weaponRefs ?? [];
        const refIds = new Set(refs.map(r => r.itemId).filter(Boolean));
        const kindFlag = context.attackWeaponKind === "ranged" ? "isRangedWeapon" : "isMeleeWeapon";
        // 一本目の武器=シートの「攻撃で使用」(戦闘タブ・空欄=生身。2026-07-13 ユーザー確定)。
        // 用途の weaponRefs は2本目以降の追加分。表示もこの実体に合わせる
        const sheetActor = sheet._item.actor;
        const sheetWeaponId = sheetActor?.system?.weaponRefs?.attackItemId || "";
        const sheetWeapon = sheetWeaponId ? sheetActor?.items.get(sheetWeaponId) : null;
        const atkLabel = (w) => {
            const atk = w?.system.attack ?? {};
            const val = Number(atk.total ?? atk.value) || 0;
            return `${atk.damageTypeTotal || atk.damageType || ""}${val >= 0 ? `+${val}` : val}`;
        };
        const base = sheetActor?.system?.baseAttack ?? {};
        // 生身は白兵武器(2026-07-17 ユーザー確定)。一本目も区分の適格判定(攻撃フローと同じ
        // attackWeaponKindEligible)を通す——射撃では生身・白兵専用武器は使えず「武器なし」、
        // 白兵では射撃専用武器が選ばれていれば生身フォールバック(実行時と同じ解決)
        const sheetEligible = attackWeaponKindEligible(sheetWeapon, context.attackWeaponKind);
        context.sheetAttackWeapon = sheetEligible
            ? { name: attackWeaponDisplayName(sheetWeapon), attackLabel: atkLabel(sheetWeapon) }
            : (context.attackWeaponKind === "ranged"
                ? { name: "武器なし", attackLabel: "" }
                : { name: "生身", attackLabel: `${base.damageTypeTotal || base.damageType || "I"}+${(base.value ?? 0) + (base.mod ?? 0)}` });
        // 選択済みの追加武器(表示行・攻撃力ラベル付き)。攻撃力はシート武器と合算される(2026-07-09)
        context.selectedWeapons = refs.map((r, idx) => {
            const w = sheetActor?.items.get(r.itemId);
            return {
                idx, id: r.itemId,
                name: w ? attackWeaponDisplayName(w) : "（不明な武器）",
                attackLabel: w ? atkLabel(w) : "",
            };
        });
        // 追加候補: 白兵/射撃の区分フラグで絞り込む(2026-07-17。ヴィークル等もフラグがあれば候補)
        context.availableWeapons = actorItems
            .filter(i => (i.type === "weapon" || i.type === "vehicle")
                && i.system[kindFlag] === true
                && !refIds.has(i.id) && i.id !== sheetWeaponId)
            .map(i => ({ id: i.id, name: i.name }));
        context.attackWeaponKindOptions = [
            { value: "melee",  label: "白兵攻撃", selected: context.attackWeaponKind === "melee" },
            { value: "ranged", label: "射撃攻撃", selected: context.attackWeaponKind === "ranged" },
        ];
    }

    // 判定ボーナス/ダメージ修正の行: 判定を行う用途すべて(2026-07-17 再編)
    if (context.isCheckType && !context.isFixedCheck) {
        // 判定ボーナス/ダメージ修正の行(式＋供給元)。供給元はチャットの帰属表示専用(識別キーを保存し
        // 表示は逆引きした現在名)。式は @system.*・@item.<識別キー>.system.* を参照可(2026-07-10)。
        // 供給元候補(グループ化): 組み合わせスタイル技能(一般技能除外)＋使用武器。値=識別キー・
        // 表示=現在のアイテム名。識別キーを持つものだけ(帰属できる供給元)を出す
        // 技能は同輩キャッシュ(辞典/ワールド直下でも解決・2026-07-18)・武器はアクター所持のみ
        const getItem = (id) => sheet._siblingSkills?.find(i => i.id === id) ?? sheet._item.actor?.items.get(id);
        const skillItemIds = [...new Set([usage.baseSkillRef?.itemId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean))];
        const styleSourceOpts = skillItemIds
            .map(getItem)
            .filter(it => it && it.type === "styleSkill" && it.system.identificationKey)
            .map(it => ({ value: it.system.identificationKey, label: formatSkillName(it.name) }));
        const weaponSourceOpts = (usage.weaponRefs ?? [])
            .map(r => getItem(r.itemId))
            .filter(it => it && it.system.identificationKey)
            .map(it => ({ value: it.system.identificationKey, label: it.name }));
        const sourceGroups = [];
        if (styleSourceOpts.length)  sourceGroups.push({ label: "組み合わせ技能", options: styleSourceOpts });
        if (weaponSourceOpts.length) sourceGroups.push({ label: "使用武器", options: weaponSourceOpts });
        // 行ごとに selected 付きの供給元グループを作る(テンプレートの深いネスト回避)
        const rowGroups = (source) => sourceGroups.map(g => ({
            label: g.label,
            options: g.options.map(o => ({ value: o.value, label: o.label, selected: o.value === source })),
        }));
        context.checkBonusRows  = (usage.checkBonuses  ?? []).map((r, idx) => ({ idx, formula: r.formula, source: r.source, sourceGroups: rowGroups(r.source) }));
        context.damageBonusRows = (usage.damageBonuses ?? []).map((r, idx) => ({ idx, formula: r.formula, source: r.source, sourceGroups: rowGroups(r.source) }));
        // 用途自身の修正値(専用欄・供給元つきの追加行とは別枠。式で @item.self=親アイテムを参照可)
        context.checkBonusSelf  = usage.checkBonusSelf ?? "";
        context.damageBonusSelf = usage.damageBonusSelf ?? "";
        // 対象条件(2026-09-01 承認・攻撃タイプのみ): ダメージ修正行・自身の修正値に付ける
        // 「ウェット/スタイル/ワークス × には無効/のみ有効」。key の候補はスタイル/組織の辞典
        // (識別キーを保存・表示は現在名)
        if (isAttackType(usage.type)) {
            const [styleChoices, orgChoices] = await Promise.all([
                loadSkillChoices([STYLE_PACK]), loadSkillChoices([ORGANIZATION_PACK]),
            ]);
            const condUi = (cond) => buildTargetConditionUi(cond, styleChoices, orgChoices);
            context.damageBonusRows.forEach((row, idx) => {
                row.cond = condUi((usage.damageBonuses ?? [])[idx]?.targetCondition);
            });
            context.damageBonusSelfCond = condUi(usage.damageBonusSelfCondition);
            context.withDamageCondition = true;
        }
    }

    // 消費先設定(2026-07-18 再編・全用途タイプ共通。固定値判定は消費 UI を出さない)。
    // 三段選択: [アイテム / AR] → (アイテム時)[このアイテム自身 / 各アイテム] → [使用回数 / 残弾 / 個数]。
    // アイテムの資源は使用回数・残弾・個数の3つ(2026-07-19 ユーザー裁定)。
    // 資源の段は**「使用回数だけ」のアイテムでは出さない**(1択の段を挟まないため)。
    // 逆に残弾/個数を持つアイテムでは、選択肢が1つでも必ず出す——出さないと残弾しか持たない
    // 武器の行が既定の「使用回数」のまま無消費に落ちて、残弾を選べなくなる。
    // 全消費はこの設定からのみ発生する。
    if (!context.isFixedCheck) {
        const actor = sheet._item.actor;
        const parentId = sheet._item.id;
        // 資源を持つアイテムか。神業も uses.isLimit=true で含まれる
        const hasUsesRes = (it) => it?.system?.uses?.isLimit === true;
        const hasAmmoRes = (it) => it?.type === "weapon" && it?.system?.ammo?.isLimit === true;
        const hasQtyRes  = (it) => it?.system?.isConsumption === true;
        const hasAnyRes  = (it) => hasUsesRes(it) || hasAmmoRes(it) || hasQtyRes(it);
        const resourcesFor = (it) => {
            const out = [];
            if (hasUsesRes(it)) out.push({ value: "uses", label: "使用回数" });
            if (hasAmmoRes(it)) out.push({ value: "ammo", label: "残弾" });
            if (hasQtyRes(it))  out.push({ value: "quantity", label: "個数" });
            return out;
        };
        // 候補: 「このアイテム自身」(id="") ＋ 資源を持つ同アクターのアイテム(親は自身が代表)
        const itemCandidates = [
            { id: "", name: "このアイテム自身" },
            ...(actor?.items ?? [])
                .filter(i => i.id !== parentId && hasAnyRes(i))
                .map(i => ({ id: i.id, name: itemDisplayName(i) })) // 技能は 〈〉 整形
                .sort((a, b) => a.name.localeCompare(b.name, "ja")),
        ];
        const TYPE_LABELS = { item: "アイテム", actionRank: "AR" };
        context.consumeRows = (usage.consumeTargets ?? []).map((t, idx) => {
            const type = t.type || "item";
            const resource = ["ammo", "quantity"].includes(t.resource) ? t.resource : "uses";
            const isActionRank = type === "actionRank";
            const selectedItem = isActionRank ? null
                : (t.itemId ? (actor?.items.get(t.itemId) ?? null) : sheet._item);
            const known = isActionRank || !t.itemId || itemCandidates.some(o => o.id === t.itemId);
            const amount = Number(t.amount);
            // 資源セレクトは「使用回数だけ」のアイテムでは描画しない(1択の段を挟まない)。
            // 残弾/個数を持つアイテムは選択肢が1つでも描画する——出さないと既定の
            // 「使用回数」から変更できず、その資源を消費先に指定できなくなる
            const resourceOpts = resourcesFor(selectedItem);
            const usesOnly = resourceOpts.length <= 1 && resourceOpts[0]?.value !== "ammo"
                && resourceOpts[0]?.value !== "quantity";
            return {
                idx,
                type,
                resource,
                isActionRank,
                itemId: t.itemId ?? "",
                // 消費数はロックしない(2026-07-18 ユーザー確定): 0/負値(=回復)も許容。未設定のみ 1
                amount: Number.isFinite(amount) ? amount : 1,
                typeOptions: Object.entries(TYPE_LABELS)
                    .map(([value, label]) => ({ value, label, selected: value === type })),
                itemOptions: [
                    ...itemCandidates.map(o => ({ ...o, selected: o.id === (t.itemId ?? "") })),
                    ...(!known && t.itemId ? [{ id: t.itemId, name: `(解決不能: ${t.itemId})`, selected: true }] : []),
                ],
                showResource: !isActionRank && !usesOnly,
                resourceOptions: resourceOpts.map(o => ({ ...o, selected: o.value === resource })),
            };
        });
        context.hasConsumeActor = !!actor;
    }

    // エフェクト: 用途使用時に適用する ActiveEffect の参照。供給元は親アイテム(空 itemId)＋参加技能
    // (ベース＋組み合わせ)＋使用武器(2026-07-10)。保存は {itemId, effectId}(親は itemId 空で互換)。
    const parentId = sheet._item.id;
    const effActor = sheet._item.actor;
    const getEffItem = (id) => (!id || id === parentId ? sheet._item : effActor?.items.get(id));
    const contribIds = [];
    for (const id of [parentId, usage.baseSkillRef?.itemId, ...(usage.skillRefs ?? []).map(r => r.itemId),
                      ...(usage.weaponRefs ?? []).map(r => r.itemId)].filter(Boolean)) {
        if (!contribIds.includes(id)) contribIds.push(id);
    }
    const contribItems = contribIds.map(id => (id === parentId ? sheet._item : effActor?.items.get(id))).filter(Boolean);
    const addedKey = (itemId, effectId) => `${itemId || parentId}:${effectId}`;
    // 追加済みリストの行(保存値=itemId 空=親をそのまま remove ハンドラへ渡す)。
    // 一般=effects と攻撃専用のダメージ時=damageEffects で共用(2026-07-18)
    const buildAdded = (list) => (list ?? []).map(e => {
        const host = getEffItem(e.itemId);
        const eff = host?.effects.get(e.effectId);
        const fromParent = !e.itemId || e.itemId === parentId;
        return {
            itemId: e.itemId ?? "", effectId: e.effectId,
            name: eff?.name ?? `(削除済み: ${e.effectId})`,
            sourceName: fromParent ? "" : (host?.name ?? ""),   // 親由来は帰属表示を省く
            // 効果種別(AE 設定・2026-08-30 改名=旧「付与先」)。既定の通常効果は表示せず
            // 代償効果だけタグを出す
            grantSelf: eff?.flags?.[SYSTEM_ID]?.grantTarget === "self",
        };
    });
    context.addedEffects = buildAdded(usage.effects);
    context.addedDamageEffects = buildAdded(usage.damageEffects);
    // 未追加の効果を供給元アイテムごとにグループ化(選択値=`itemId|effectId`・親は itemId 空)。
    // 除外はリストごと(同じ効果を一般とダメージ時の両方へ入れることは妨げない)
    const buildGroups = (list) => {
        const addedSet = new Set((list ?? []).map(e => addedKey(e.itemId, e.effectId)));
        return contribItems
            .map(it => ({
                label: it.name,
                options: [...it.effects]
                    .filter(e => !addedSet.has(addedKey(it.id, e.id)))
                    .map(e => ({ value: `${it.id === parentId ? "" : it.id}|${e.id}`, name: e.name })),
            }))
            .filter(g => g.options.length);
    };
    context.availableEffectGroups = buildGroups(usage.effects);
    context.availableDamageEffectGroups = buildGroups(usage.damageEffects);
    context.hasAnyEffect = contribItems.some(it => it.effects.size > 0);

    return context;
}
