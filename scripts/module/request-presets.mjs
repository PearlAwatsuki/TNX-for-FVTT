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
        groups.push({ label: journal.name, presets: [...presets] });
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

/** ワールドの判定要求プリセット(グループ化済み)。 */
export function listCheckRequestPresets() {
    return collectPresets(game.journal, "checkRequests");
}

/** ワールドの報酬点プリセット(グループ化済み)。 */
export function listBountyPresets() {
    return collectPresets(game.journal, "bountyGrants");
}
