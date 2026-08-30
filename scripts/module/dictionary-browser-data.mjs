/**
 * @fileoverview 辞典ブラウザのデータ層(フェーズ16-2)。
 *
 * タブ定義・パック index の読み込み・絞り込みの純ロジックを持つ。UI(アプリ本体)は
 * tnx-dictionary-browser.mjs。タブ構成は 2026-08-31 ユーザー明示の8種
 * (スタイル技能/アウトフィット/一般技能/スタイル/神業/オーガニゼーション/ライフパス/NPC)。
 * ドロー表はブラウザに入れない(2026-08-31 裁定=埋め込み参照・メカニクス参照の性格)。
 * サンプルPC辞典(sample-casts)もブラウザには載せない(2026-08-31 ユーザー指示)。
 *
 * 読み込みは getIndex(fields) のみ(getDocuments 禁止=KI-026 の孤児化回避)。
 * index は migrateData を通らない生データのため、分類照合は outfitClassifications
 * (旧 isCyber 包摂込み)を経由する。
 */

import { SKILL_PACKS, STYLE_PACK, ORGANIZATION_PACK, SOCIETY_CLASSES, ONOMASTIC_TYPES, onomasticTypeOf } from "./skill-dictionary.mjs";
import { OUTFIT_PACKS } from "./outfit-dictionary.mjs";
import { OUTFIT_CATEGORIES, getMajorCategoryLabel, getMinorCategoryLabel, outfitClassifications } from "../data/item/outfit-categories.mjs";
import { skillSortPosition } from "./identification.mjs";

/** ライフパス辞典パックの完全名 */
export const LIFE_PATH_PACK = "tokyo-nova-axleration.life-paths";
/** 神業辞典パックの完全名 */
export const MIRACLE_PACK = "tokyo-nova-axleration.miracles";
/** NPC 辞典パックの完全名 */
export const NPC_PACK = "tokyo-nova-axleration.npc";

/** NPC タブに出すアクター型 → 表示ラベル。キャストは辞典に載せない(2026-08-31 ユーザー指摘)。 */
export const NPC_TYPE_LABELS = Object.freeze({
    guest: "ゲスト",
    troop: "トループ",
    extra: "エキストラ",
});

/** ライフパス種別の表示順(データモデルの choices と同順) */
export const LIFE_PATH_TYPE_LABELS = Object.freeze({
    origin:     "出自",
    experience: "経験",
    encounter:  "邂逅",
});

/**
 * タブ定義(2026-08-31 ユーザー明示の8種・この順)。
 * packs は {packName: ソース表示ラベル}(ソース列=どの辞典由来か)。
 */
export const BROWSER_TABS = Object.freeze([
    // ワークス専用技能はスタイル技能タブに含める(2026-08-31 ユーザー指摘=ワークス技能の
    // チェックと所属組織で絞り込む)。一般技能タブは一般技能辞典のみ
    { key: "styleSkill",   label: "スタイル技能",       icon: "fa-solid fa-star",
      packs: { [SKILL_PACKS.style]: "スタイル技能", [SKILL_PACKS.works]: "ワークス専用技能" } },
    { key: "outfit",       label: "アウトフィット",     icon: "fa-solid fa-suitcase",
      packs: { [OUTFIT_PACKS.outfits]: "アウトフィット", [OUTFIT_PACKS.works]: "ワークス専用装備" } },
    { key: "generalSkill", label: "一般技能",           icon: "fa-solid fa-book",
      packs: { [SKILL_PACKS.general]: "一般技能" } },
    { key: "style",        label: "スタイル",           icon: "fa-solid fa-masks-theater",
      packs: { [STYLE_PACK]: "スタイル" } },
    { key: "miracle",      label: "神業",               icon: "fa-solid fa-bolt",
      packs: { [MIRACLE_PACK]: "神業" } },
    { key: "organization", label: "オーガニゼーション", icon: "fa-solid fa-building",
      packs: { [ORGANIZATION_PACK]: "オーガニゼーション" } },
    { key: "lifePath",     label: "ライフパス",         icon: "fa-solid fa-route",
      packs: { [LIFE_PATH_PACK]: "ライフパス" } },
    { key: "npc",          label: "NPC",                icon: "fa-solid fa-user-group",
      packs: { [NPC_PACK]: "NPC" } },
]);

/**
 * 1タブぶんのエントリを読み込む。index 行に uuid / type / img / name / system(全体)と、
 * ソース表示ラベル(sourceLabel)を付けて返す。
 * @param {{key: string, packs: Record<string, string>}} tab BROWSER_TABS の1要素
 * @returns {Promise<Array<object>>}
 */
export async function loadTabEntries(tab) {
    const out = [];
    for (const [packName, sourceLabel] of Object.entries(tab.packs)) {
        const pack = game.packs?.get(packName);
        if (!pack) continue;
        try {
            // NPC(Actor)は一覧に名前・型だけで足りるため system を引かない(重量回避)
            const fields = tab.key === "npc" ? ["sort"] : ["system", "sort"];
            const index = await pack.getIndex({ fields });
            for (const d of index) {
                // NPC タブ: キャストは辞典に載せない(2026-08-31 ユーザー指摘)
                if (tab.key === "npc" && !NPC_TYPE_LABELS[d.type]) continue;
                out.push({
                    uuid: d.uuid,
                    id: d._id,
                    name: d.name,
                    img: d.img,
                    type: d.type,
                    sort: d.sort ?? 0,
                    system: d.system ?? {},
                    sourceLabel,
                    docName: pack.documentName,
                });
            }
        } catch (e) {
            console.error(`TokyoNOVA | 辞典ブラウザ: パック読み込みに失敗 ${packName}:`, e);
        }
    }
    return sortEntriesForTab(tab.key, out);
}

/**
 * パックの {識別キー: 名前} を**登録順(document sort)**で読む。
 * スタイル・組織のグループ/絞り込み選択肢の並びに使う(名前順に並べ替えない)。
 * @param {string} packName
 * @returns {Promise<Record<string, string>>}
 */
export async function loadOrderedNames(packName) {
    const pack = game.packs?.get(packName);
    if (!pack) return {};
    try {
        const index = await pack.getIndex({ fields: ["system.identificationKey", "sort"] });
        const rows = [...index]
            .filter((d) => d.system?.identificationKey)
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, "ja"));
        return Object.fromEntries(rows.map((d) => [d.system.identificationKey, d.name]));
    } catch (e) {
        console.error(`TokyoNOVA | 辞典ブラウザ: 名前マップの読み込みに失敗 ${packName}:`, e);
        return {};
    }
}

/**
 * タブごとの並び順(純関数・2026-08-31 ユーザー指摘=登録されている順序を守る):
 * - 一般技能: 正規ソート順(識別キー基準・skillSortPosition=キャスト技能リストと同じ規則)→名前
 * - スタイル・神業: 辞典の登録順(document sort)→名前
 * - それ以外: 名前(ja)
 * @param {string} tabKey
 * @param {Array<object>} entries
 * @returns {Array<object>}
 */
export function sortEntriesForTab(tabKey, entries) {
    const byName = (a, b) => a.name.localeCompare(b.name, "ja");
    if (tabKey === "generalSkill") {
        return entries.sort((a, b) => {
            const pa = skillSortPosition(a.system?.identificationKey ?? "");
            const pb = skillSortPosition(b.system?.identificationKey ?? "");
            if (pa !== pb) return pa - pb;
            return byName(a, b);
        });
    }
    if (tabKey === "style" || tabKey === "miracle") {
        return entries.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || byName(a, b));
    }
    return entries.sort(byName);
}

/**
 * タブごとの絞り込みグループ定義を組み立てる(純関数)。
 * グループ = {key, label, options: [{value, label}]}(チェックボックス群)。
 * 選択肢が動的なもの(スタイル名)は引数で受ける。
 * @param {string} tabKey
 * @param {{styleNames?: Record<string, string>, orgNames?: Record<string, string>}} [ctx]
 * @returns {Array<{key: string, label: string, options: Array<{value: string, label: string}>}>}
 */
export function buildFilterGroups(tabKey, { styleNames = {}, orgNames = {} } = {}) {
    const opts = (record) => Object.entries(record).map(([value, label]) => ({ value, label }));
    switch (tabKey) {
        case "styleSkill":
            // ワークス技能チェック＋所属組織(2026-08-31 ユーザー指摘)
            return [
                { key: "style", label: "スタイル", options: opts(styleNames) },
                { key: "category", label: "カテゴリ",
                  options: opts({ special: "特技", performance: "演出特技", secret: "秘技", mystery: "奥義" }) },
                { key: "works", label: "ワークス", options: [{ value: "works", label: "ワークス技能" }] },
                { key: "organization", label: "所属組織", options: opts(orgNames) },
            ];
        case "outfit": {
            const majors = { key: "major", label: "大分類",
                options: Object.entries(OUTFIT_CATEGORIES).map(([k, v]) => ({ value: k, label: v.label })) };
            const minors = { key: "minor", label: "小分類",
                options: Object.values(OUTFIT_CATEGORIES).flatMap((major) =>
                    Object.entries(major.minors).map(([k, v]) => ({ value: k, label: v.label }))) };
            // ワークス専用装備チェック＋所属組織(専用 exclusive の組織参照・2026-08-31 ユーザー指摘)
            const works = { key: "works", label: "ワークス", options: [{ value: "works", label: "ワークス専用装備" }] };
            const orgs = { key: "organization", label: "所属組織", options: opts(orgNames) };
            return [majors, minors, works, orgs];
        }
        case "generalSkill":
            return [
                { key: "category", label: "種別",
                  options: opts({ initialSkill: "無条件取得技能", onomasticSkill: "固有名詞技能" }) },
                { key: "onomastic", label: "区分", options: opts(ONOMASTIC_TYPES) },
                { key: "societyClass", label: "下位区分", options: opts(SOCIETY_CLASSES) },
                { key: "trait", label: "特性",
                  options: opts({ isAction: "アクション技能", usesBounty: "報酬点を使用可能" }) },
            ];
        case "lifePath":
            return [{ key: "lifePathType", label: "種別", options: opts(LIFE_PATH_TYPE_LABELS) }];
        case "npc":
            return [{ key: "npcType", label: "種別", options: opts(NPC_TYPE_LABELS) }];
        default: // style / miracle / organization は検索のみ
            return [];
    }
}

/**
 * エントリから絞り込みグループの該当値(複数可)を引く(純関数)。
 * @param {string} tabKey
 * @param {string} groupKey
 * @param {object} entry loadTabEntries の1要素
 * @returns {string[]} 該当値の配列(1つでもチェック集合に含まれれば一致)
 */
export function entryGroupValues(tabKey, groupKey, entry) {
    const sys = entry.system ?? {};
    if (tabKey === "styleSkill") {
        if (groupKey === "style") return [sys.style ?? ""];
        if (groupKey === "category") return [sys.styleSkillCategory ?? ""];
        // ワークス技能=special.works.value(データ権威)。所属組織は special.works.organization
        if (groupKey === "works") return sys.special?.works?.value === true ? ["works"] : [];
        if (groupKey === "organization") return [sys.special?.works?.organization ?? ""];
    }
    if (tabKey === "outfit") {
        const cls = outfitClassifications(sys);
        if (groupKey === "major") return cls.map((c) => c.major);
        if (groupKey === "minor") return cls.map((c) => c.minor).filter(Boolean);
        // ワークス専用装備=ワークス専用装備辞典由来。所属組織=専用(exclusive)の組織参照
        if (groupKey === "works") return entry.sourceLabel === "ワークス専用装備" ? ["works"] : [];
        if (groupKey === "organization") {
            return (Array.isArray(sys.exclusive) ? sys.exclusive : [])
                .filter((r) => r?.type === "organization" && r.key)
                .map((r) => r.key);
        }
    }
    if (tabKey === "generalSkill") {
        if (groupKey === "category") return [sys.generalSkillCategory ?? ""];
        if (groupKey === "onomastic") return [onomasticTypeOf(sys)];
        if (groupKey === "societyClass") return [sys.societyClass ?? ""];
        if (groupKey === "trait") {
            const out = [];
            if (sys.isAction === true) out.push("isAction");
            if (sys.usesBounty === true) out.push("usesBounty");
            return out;
        }
    }
    if (tabKey === "lifePath" && groupKey === "lifePathType") return [sys.lifePathType ?? ""];
    if (tabKey === "npc" && groupKey === "npcType") return [entry.type];
    return [];
}

/**
 * 絞り込み(純関数)。
 * @param {string} tabKey
 * @param {Array<object>} entries
 * @param {{search?: string, checks?: Record<string, string[]>, buyMin?: ?number, buyMax?: ?number}} state
 *   checks: グループキー → チェック済み値の配列(空/未定義=そのグループでは絞らない)
 *   buyMin/buyMax: アウトフィットの購入値レンジ(null=未指定。指定時、購入値が数値でないものは除外)
 * @returns {Array<object>}
 */
export function filterEntries(tabKey, entries, state = {}) {
    const search = String(state.search ?? "").trim().toLowerCase();
    const checks = state.checks ?? {};
    const buyMin = state.buyMin ?? null;
    const buyMax = state.buyMax ?? null;
    return entries.filter((entry) => {
        if (search) {
            const furigana = entry.system?.furigana ?? "";
            const hay = `${entry.name}\n${furigana}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        for (const [groupKey, checked] of Object.entries(checks)) {
            if (!checked?.length) continue;
            const values = entryGroupValues(tabKey, groupKey, entry);
            if (!values.some((v) => checked.includes(v))) return false;
        }
        if (tabKey === "outfit" && (buyMin !== null || buyMax !== null)) {
            const buy = entry.system?.buy;
            if (buy?.mode !== "value") return false;
            const v = Number(buy.value) || 0;
            if (buyMin !== null && v < buyMin) return false;
            if (buyMax !== null && v > buyMax) return false;
        }
        return true;
    });
}

/**
 * アウトフィットの大分類→小分類の見出しグループへ整列する(純関数)。
 * 分類順は OUTFIT_CATEGORIES の樹の順・グループ内は名前順(入力順を保持)。
 * 分類は**主分類**で束ねる(置き場所の権威。副分類は絞り込みでのみ効く)。
 * @param {Array<object>} entries
 * @returns {Array<{majorKey: string, majorLabel: string, minors: Array<{minorKey: string, minorLabel: string, entries: Array<object>}>}>}
 */
export function groupOutfitEntries(entries) {
    const byMinor = new Map();
    const unclassified = [];
    for (const e of entries) {
        const minor = e.system?.minorCategory ?? "";
        if (!minor) { unclassified.push(e); continue; }
        if (!byMinor.has(minor)) byMinor.set(minor, []);
        byMinor.get(minor).push(e);
    }
    const out = [];
    for (const [majorKey, major] of Object.entries(OUTFIT_CATEGORIES)) {
        const minors = [];
        for (const minorKey of Object.keys(major.minors)) {
            const list = byMinor.get(minorKey);
            if (list?.length) minors.push({ minorKey, minorLabel: getMinorCategoryLabel(minorKey), entries: list });
        }
        if (minors.length) out.push({ majorKey, majorLabel: getMajorCategoryLabel(majorKey), minors });
    }
    if (unclassified.length) {
        out.push({ majorKey: "", majorLabel: "未分類", minors: [{ minorKey: "", minorLabel: "", entries: unclassified }] });
    }
    return out;
}

/**
 * スタイル技能をスタイル別の見出しグループへ整列する(純関数)。
 * - スタイル技能: styleNames(スタイル辞典の並び)の順でグループ化。
 * - ワークス技能(special.works.value): スタイル群の後ろに**所属組織別**でグループ化
 *   (ワークス専用技能はワークスごとの掲載=2026-08-31 の絞り込み追加と同じ軸)。
 * - どちらにも該当しない/不明は末尾「その他」。
 * @param {Array<object>} entries
 * @param {Record<string, string>} styleNames スタイル識別キー → 名前
 * @param {Record<string, string>} [orgNames] 組織識別キー → 名前
 * @returns {Array<{styleKey: string, styleLabel: string, entries: Array<object>}>}
 */
export function groupStyleSkillEntries(entries, styleNames = {}, orgNames = {}) {
    const byStyle = new Map();
    const byOrg = new Map();
    const rest = [];
    for (const e of entries) {
        const sys = e.system ?? {};
        if (sys.special?.works?.value === true) {
            const orgKey = orgNames[sys.special.works.organization] ? sys.special.works.organization : "";
            if (!byOrg.has(orgKey)) byOrg.set(orgKey, []);
            byOrg.get(orgKey).push(e);
            continue;
        }
        const key = sys.style && styleNames[sys.style] ? sys.style : null;
        if (key === null) { rest.push(e); continue; }
        if (!byStyle.has(key)) byStyle.set(key, []);
        byStyle.get(key).push(e);
    }
    const out = [];
    for (const [styleKey, styleLabel] of Object.entries(styleNames)) {
        const list = byStyle.get(styleKey);
        if (list?.length) out.push({ styleKey, styleLabel, entries: list });
    }
    for (const [orgKey, orgLabel] of Object.entries(orgNames)) {
        const list = byOrg.get(orgKey);
        if (list?.length) out.push({ styleKey: `org:${orgKey}`, styleLabel: orgLabel, entries: list });
    }
    const orgRest = byOrg.get("");
    if (orgRest?.length) out.push({ styleKey: "org:", styleLabel: "ワークス技能（組織未設定）", entries: orgRest });
    if (rest.length) out.push({ styleKey: "", styleLabel: "その他", entries: rest });
    return out;
}

/**
 * ライフパスを種別ごとの表グループへ整列する(純関数)。順は 出自/経験/邂逅・種別なしは末尾。
 * @param {Array<object>} entries
 * @returns {Array<{typeKey: string, typeLabel: string, entries: Array<object>}>}
 */
export function groupLifePathEntries(entries) {
    const out = [];
    for (const [typeKey, typeLabel] of Object.entries(LIFE_PATH_TYPE_LABELS)) {
        const list = entries.filter((e) => e.system?.lifePathType === typeKey);
        if (list.length) out.push({ typeKey, typeLabel, entries: list });
    }
    const rest = entries.filter((e) => !LIFE_PATH_TYPE_LABELS[e.system?.lifePathType]);
    if (rest.length) out.push({ typeKey: "", typeLabel: "その他", entries: rest });
    return out;
}
