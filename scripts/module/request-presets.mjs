/**
 * @fileoverview アクトシートの判定要求・報酬点プリセット(フェーズ12-5・2026-07-20)。
 *
 * シナリオに記載のある判定要求・前金を事前に書いておき、卓では選ぶだけで起動できるようにする。
 * 保存先はアクトシート(JournalEntry)の flags(既存のアクトシートと同じ持ち方)。
 *
 * **対象アクターはプリセットに含めない**(2026-07-20 ユーザー確定)——卓の状況で変わるため
 * 起動時に選ぶ。
 */

const SCOPE = "tokyo-nova-axleration";

// テスト環境では foundry グローバルが無いため、ID 生成は存在すれば使う
const randomID = () => (globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 18));

/**
 * ジャーナル群からプリセットを集め、ジャーナル名でグループ化する(読み込み元プルダウン用)。
 * @param {Iterable<{name:string, flags:object}>} journals
 * @param {string} key flags のキー(checkRequests / bountyGrants)
 * @returns {Array<{label:string, presets:Array<object>}>}
 */
export function collectPresets(journals, key) {
    const groups = [];
    for (const journal of (journals ?? [])) {
        const presets = journal?.flags?.[SCOPE]?.[key] ?? [];
        if (!presets.length) continue;
        groups.push({ label: journal.name, journalId: journal.id, presets: [...presets] });
    }
    return groups;
}

/**
 * プリセットの表示名。未入力なら「<種別>n」(1 始まり)をプレースホルダーにする。
 * @param {object} preset
 * @param {number} index 0 始まりの並び順
 * @param {string} kindLabel 「判定要求」「報酬点」
 */
export function presetLabel(preset, index, kindLabel) {
    const label = String(preset?.label ?? "").trim();
    return label || `${kindLabel}${index + 1}`;
}

/**
 * 判定要求プリセット → 起動フォームの値。**対象アクターは含めない**。
 * @param {object} preset
 */
export function checkRequestPresetToForm(preset) {
    return {
        checkType:         preset?.checkType ?? "skillCheck",
        identificationKey: preset?.identificationKey ?? "",
        customSkillName:   preset?.customSkillName ?? "",
        validSuits:        [...(preset?.validSuits ?? [])],
        targetValue:       Number(preset?.targetValue) || 0,
        targetValueHidden: preset?.targetValueHidden === true,
        description:       preset?.description ?? "",
    };
}

/**
 * 報酬点プリセット → 配布フォームの値。**対象アクターは含めない**。
 * @param {object} preset
 */
export function bountyPresetToForm(preset) {
    return {
        amount: Math.trunc(Number(preset?.amount) || 0),
        note:   preset?.note ?? "",
    };
}

/** 判定要求プリセットの新規行。 */
export function newCheckRequestPreset() {
    return {
        id: randomID(),
        label: "",
        checkType: "skillCheck",
        identificationKey: "",
        customSkillName: "",
        validSuits: [],
        targetValue: 0,
        targetValueHidden: false,
        description: "",
    };
}

/** 報酬点プリセットの新規行。 */
export function newBountyPreset() {
    return { id: randomID(), label: "", amount: 0, note: "" };
}

/** ダメージの決め方(固定/カード算出・2026-07-24)。不正・未指定は固定に落とす。 */
const DAMAGE_MODES = ["fixed", "card"];
const resolveDamageMode = (mode) => (DAMAGE_MODES.includes(mode) ? mode : "fixed");

/**
 * ダメージ付与プリセット → 付与フォームの値。**対象アクターは含めない**。
 * `mode`(固定/カード)も保存・再現する——カード系ギミックを丸ごと保存できるようにするため
 * (2026-07-24。既存プリセットは無印＝固定扱いで後方互換)。
 * @param {object} preset
 */
export function damagePresetToForm(preset) {
    return {
        category:   preset?.category ?? "physical",
        damageType: preset?.damageType ?? "I",
        value:      Math.max(0, Math.trunc(Number(preset?.value) || 0)),
        note:       preset?.note ?? "",
        mode:       resolveDamageMode(preset?.mode),
    };
}

/** ダメージ付与プリセットの新規行(既定は生身の攻撃と同じ I・固定モード)。 */
export function newDamageGrantPreset() {
    return { id: randomID(), label: "", category: "physical", damageType: "I", value: 0, note: "", mode: "fixed" };
}

/**
 * 効果付与プリセットの新規行。
 *
 * 効果は**実体をプリセットに持つ**(2026-07-21 設計確定)。参照ではなく実体にするのは、
 * アクトのページを持ち出せば効果も付いてくる・供給元の削除で孤児が出ない、の2点による。
 * 中身は標準の効果シートで組む(`effect-authoring.mjs`)。
 */
export function newEffectGrantPreset() {
    return { id: randomID(), label: "", effect: null };
}

/**
 * 効果が未設定のプリセットか(未設定は付与元プルダウンに出さない)。
 * @param {?object} preset
 */
export function effectPresetIsEmpty(preset) {
    const eff = preset?.effect;
    if (!eff || typeof eff !== "object") return true;
    // 効果シートで一度でも組めば必ず名前が付く。名前が無い＝まだ開いていない器
    return !String(eff.name ?? "").trim();
}

/** ワールドの判定要求プリセット(グループ化済み)。 */
export function listCheckRequestPresets() {
    return collectPresets(game.journal, "checkRequests");
}

/** ワールドの報酬点プリセット(グループ化済み)。 */
export function listBountyPresets() {
    return collectPresets(game.journal, "bountyGrants");
}

/** ワールドのダメージ付与プリセット(グループ化済み)。 */
export function listDamageGrantPresets() {
    return collectPresets(game.journal, "damageGrants");
}

/** ワールドの効果付与プリセット(グループ化済み)。 */
export function listEffectGrantPresets() {
    return collectPresets(game.journal, "effectGrants");
}
