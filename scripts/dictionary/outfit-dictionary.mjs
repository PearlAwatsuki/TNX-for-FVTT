/**
 * @fileoverview アウトフィット辞典(compendium)ローダ(2026-07-23)。
 *
 * オプション部位行の「アイテム名」(hostKey)を**自由記入から辞典参照へ**するための辞典ヘルパー。
 * `packs/outfits`(アウトフィット)と `packs/works-outfits`(ワークス専用装備)を読み、上位のホスト記述子
 * (大分類/小分類/除外/その他特徴)で絞り込んだ `{identificationKey: name}` の候補を返す。
 * 保存するのは識別キー・表示は逆引きした現在名(identification.mjs / feedback: no-stale-caches)。
 *
 * skill-dictionary.mjs と同じく `getIndex` で読む(getDocuments 禁止=KI-026 の孤児化回避)。
 */

import { matchesHostDescriptor } from "../data/item/part-helpers.mjs";

/** アウトフィット辞典パックの完全名。 */
export const OUTFIT_PACKS = Object.freeze({
  outfits: "tokyo-nova-axleration.outfits",
  works:   "tokyo-nova-axleration.works-outfits",
});

const _cache = new Map();

/**
 * 1 つのアウトフィット辞典から、ホスト絞り込みに要る最小メタ付きの配列を読み込む
 * (identificationKey 無しは除外)。結果はキャッシュ。名前順(ja)。
 * @param {string} packName compendium の完全名
 * @returns {Promise<Array<{identificationKey:string, name:string, majorCategory:string,
 *   minorCategory:string, additionalCategories:Array<{major:string, minor:string}>,
 *   isLaser:boolean, isCyber:boolean, isMutantOrgan:boolean}>>}
 */
export async function loadOutfitEntries(packName) {
  if (_cache.has(packName)) return _cache.get(packName);
  const pack = game.packs?.get(packName);
  if (!pack) return [];
  try {
    const index = await pack.getIndex({
      fields: [
        "system.identificationKey", "system.majorCategory", "system.minorCategory",
        "system.additionalCategories",
        "system.isLaser", "system.isCyber", "system.isMutantOrgan",
      ],
    });
    // ※index は DataModel の migrateData を通らない**生データ**。旧 isCyber はここでは残し、
    //   分類照合(outfitClassifications)が副分類サイバーウェアとして包摂する(フェーズ16-1)
    const entries = [...index]
      .filter((d) => d.system?.identificationKey)
      .map((d) => ({
        identificationKey: d.system.identificationKey,
        name: d.name,
        majorCategory: d.system.majorCategory ?? "",
        minorCategory: d.system.minorCategory ?? "",
        additionalCategories: Array.isArray(d.system.additionalCategories) ? d.system.additionalCategories : [],
        isLaser:       d.system.isLaser === true,
        isCyber:       d.system.isCyber === true,
        isMutantOrgan: d.system.isMutantOrgan === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
    _cache.set(packName, entries);
    return entries;
  } catch (e) {
    console.error(`TokyoNOVA | Failed to load outfit compendium ${packName}:`, e);
    return [];
  }
}

/** 両アウトフィット辞典(outfits + works-outfits)を結合して返す。 */
export async function loadAllOutfitEntries() {
  const out = [];
  for (const packName of Object.values(OUTFIT_PACKS)) out.push(...await loadOutfitEntries(packName));
  return out;
}

/**
 * ホスト記述子で絞り込んだ「アイテム名」候補 `{identificationKey: name}` を返す(先頭 "" → "—")。
 * hostKey は候補構築では使わない(候補の1つを選ぶための絞り込みなので大分類/小分類/特徴のみ)。
 * @param {{hostMajor?:string, hostMinor?:string, hostMinorExclude?:boolean, hostFeature?:string}} spec
 * @returns {Promise<Record<string,string>>}
 */
export async function loadOutfitHostChoices(spec = {}) {
  const filter = {
    hostMajor: spec.hostMajor ?? "",
    hostMinor: spec.hostMinor ?? "",
    hostMinorExclude: spec.hostMinorExclude === true,
    hostFeature: spec.hostFeature ?? "",
  };
  const choices = { "": "—" };
  for (const e of await loadAllOutfitEntries()) {
    if (matchesHostDescriptor(e, filter)) choices[e.identificationKey] = e.name;
  }
  return choices;
}

/**
 * 全アウトフィット辞典の `{identificationKey: name}` マップ(ラベル解決の辞典フォールバック)。
 * アクター所持品での逆引きが取れないとき(直下・辞典シート等)の表示名解決に使う。
 * @returns {Promise<Record<string,string>>}
 */
export async function loadOutfitDictNames() {
  const map = {};
  for (const e of await loadAllOutfitEntries()) map[e.identificationKey] = e.name;
  return map;
}
