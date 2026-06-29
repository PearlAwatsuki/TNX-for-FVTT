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
 * 取得候補が複数のとき、取得する武器を**プルダウンで1つだけ**選ばせる（複数取得は不可）。
 * 取り消し/閉じるは -1（取得しない）。
 * @param {string} skillName スタイル技能名
 * @param {Array<{name:string}>} candidates 取得候補（解決済み・重複除外後）
 * @returns {Promise<number>} 選択された候補のインデックス（取得しない場合は -1）
 */
async function promptSelectWeapon(skillName, candidates) {
  const options = candidates.map((c, i) => `<option value="${i}">${c.name}</option>`).join("");
  const content = `<p>「${skillName}」で取得する武器を1つ選んでください。</p>
    <div class="form-group"><label>武器</label><select name="acq">${options}</select></div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window:   { title: "取得武器の選択" },
    classes:  ["tokyo-nova"],
    position: { width: 360 },
    content,
    buttons: [
      { action: "ok", icon: "fas fa-check", label: "取得", default: true,
        callback: (_e, _b, dialog) => Number(dialog.element.querySelector('select[name="acq"]').value) },
      { action: "cancel", icon: "fas fa-times", label: "取得しない", callback: () => -1 },
    ],
    rejectClose: false,
  });
  return Number.isInteger(result) ? result : -1;
}

/**
 * styleSkill がアクターに作成された時の自動取得（Foundry 依存）。autoAcquireItems を UUID から
 * 複製生成し、由来マーク（fromStyleSkillKey）を付ける。同種（プレフィックス一致）の既取得はスキップ。
 * **取得候補が複数のときはダイアログで選択**させる（1つなら自動取得）。
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

  // 候補を解決（fromUuid）し、同種既取得（重複）を除外する
  const candidates = [];
  for (const ref of refs) {
    if (!ref?.uuid) continue;
    const src = await fromUuid(ref.uuid);
    if (!src) continue; // 元アイテムが削除済み等で解決できなければ静かにスキップ
    const srcKey = src.system?.identificationKey ?? "";
    if (hasDuplicateStyleWeapon(srcKey, existing)) continue; // 同種を既取得ならスキップ（候補から除外）
    candidates.push({ src, srcKey, name: src.name });
  }
  if (!candidates.length) return;

  // 複数候補ならプルダウンで1つだけ選択、1つなら自動取得（複数取得は不可）
  let chosen = candidates;
  if (candidates.length >= 2) {
    const idx = await promptSelectWeapon(styleSkillItem.name, candidates);
    if (idx < 0 || idx >= candidates.length) return; // 取得しない
    chosen = [candidates[idx]];
  }

  const toCreate = [];
  for (const { src, srcKey } of chosen) {
    if (hasDuplicateStyleWeapon(srcKey, existing)) continue; // バッチ内の同種重複も防ぐ
    const data = src.toObject();
    delete data._id;
    data.system = data.system ?? {};
    data.system.fromStyleSkillKey = skillKey; // 由来マーク
    toCreate.push(data);
    existing.push({ fromStyleSkillKey: skillKey, identificationKey: srcKey });
  }
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}

/**
 * 派生元アウトフィット（hasDerivedData）がアクターに作成された時、derivedDataRefs を全て複製生成し、
 * 派生データ本体マーク（isDerivedData=true＝常備化経験点を消費しない）を付ける。
 * 選択はせず全て自動生成する（派生データは親に内在＝ユーザーの選択対象でない。例: Tウェポンのタップ→武器）。
 * @param {Actor} actor 取得先アクター
 * @param {Item} outfitItem 作成された派生元アウトフィット
 */
export async function autoImportDerivedData(actor, outfitItem) {
  const refs = Array.isArray(outfitItem?.system?.derivedDataRefs) ? outfitItem.system.derivedDataRefs : [];
  if (!actor || !refs.length) return;
  const toCreate = [];
  for (const ref of refs) {
    if (!ref?.uuid) continue;
    const src = await fromUuid(ref.uuid);
    if (!src) continue; // 解決できなければ静かにスキップ
    const data = src.toObject();
    delete data._id;
    data.system = data.system ?? {};
    data.system.isDerivedData = true; // 派生データ＝常備化経験点なし
    toCreate.push(data);
  }
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
}
