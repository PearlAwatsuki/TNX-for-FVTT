/**
 * @fileoverview スタイル技能の自動取得(フェーズ10-2)。
 *
 * スタイル技能をアクターに作成(インポート/ドロップ)した時、styleSkill.autoAcquireItems で
 * 指定された武器アイテムを UUID から複製生成する。トループ取得（autoAcquireActors）は本フェーズは
 * 保持のみ（本体生成は11）。
 *
 * 重複防止: 由来武器（fromStyleSkillKey 付き）のうち、識別キーの**プレフィックス（区切り「_」まで）**が
 * 一致する同種を既に取得済みなら生成しない（専用フラグは設けない・2026-06-27 確定）。
 * 例: `elementalPowers_melee` と `elementalPowers_ranged` は同種（prefix=`elementalPowers`）。
 * 正本: llm-wiki/01_Wiki/Phases/Phase_10_Tasks_Detail.md「スタイル技能の自動取得」。
 *
 * プレフィックス照合・重複判定は Foundry 非依存の純粋関数（テスト対象）。フック側のみ Foundry に依存。
 */

/**
 * 識別キーのプレフィックス（区切り「_」まで＝最初の `_` の前）。区切りが無ければキー全体。
 * 重複防止の同種照合に使う（ユーザーは変種キーを `base_variant` 形式で設計する規約）。
 * @param {string} key 識別キー
 * @returns {string}
 */
export function idKeyPrefix(key) {
  const s = String(key ?? "").trim();
  if (!s) return "";
  const i = s.indexOf("_");
  return i < 0 ? s : s.slice(0, i);
}

/**
 * 既取得のスタイル技能由来武器に「同種」（識別キーのプレフィックス一致）があるか。
 * @param {string} newKey これから取得する武器の識別キー
 * @param {Array<{fromStyleSkillKey?:string, identificationKey?:string}>} existing アクターの既存装備の最小データ
 * @returns {boolean} 同種を既に由来取得済みなら true（＝重複なので弾く）
 */
export function hasDuplicateStyleWeapon(newKey, existing) {
  const prefix = idKeyPrefix(newKey);
  if (!prefix) return false;
  return (existing ?? []).some(
    (w) => w?.fromStyleSkillKey && idKeyPrefix(w.identificationKey) === prefix
  );
}

/**
 * styleSkill がアクターに作成された時の自動取得（Foundry 依存）。autoAcquireItems を UUID から
 * 複製生成し、由来マーク（fromStyleSkillKey）を付ける。同種（プレフィックス一致）の既取得はスキップ。
 * トループ（autoAcquireActors）は保持のみ（生成しない・11 で対応）。
 * @param {Actor} actor 取得先アクター
 * @param {Item} styleSkillItem 作成された styleSkill アイテム
 */
export async function autoAcquireForStyleSkill(actor, styleSkillItem) {
  const sys = styleSkillItem?.system ?? {};
  const refs = Array.isArray(sys.autoAcquireItems) ? sys.autoAcquireItems : [];
  if (!actor || !refs.length) return;

  const skillKey = sys.identificationKey || "";
  // 既存の「由来あり」装備（重複判定の母数）。同バッチ内で生成したものも順次追加する。
  const existing = actor.items
    .filter((i) => i.system?.fromStyleSkillKey)
    .map((i) => ({ fromStyleSkillKey: i.system.fromStyleSkillKey, identificationKey: i.system.identificationKey }));

  const toCreate = [];
  for (const ref of refs) {
    if (!ref?.uuid) continue;
    const src = await fromUuid(ref.uuid);
    if (!src) continue; // 元アイテムが削除済み等で解決できなければ静かにスキップ(通知しない)
    const srcKey = src.system?.identificationKey ?? "";
    if (hasDuplicateStyleWeapon(srcKey, existing)) continue; // 同種(プレフィックス一致)を既取得ならスキップ(通知なし)
    const data = src.toObject();
    delete data._id;
    data.system = data.system ?? {};
    data.system.fromStyleSkillKey = skillKey; // 由来マーク
    toCreate.push(data);
    existing.push({ fromStyleSkillKey: skillKey, identificationKey: srcKey }); // 同バッチ内の重複も防ぐ
  }
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}
