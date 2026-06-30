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
 * レベル自動参照(10-3)の解決。参照先の識別キーに一致する同アクター内スタイル技能のレベルを返す。
 * 一致が無ければ null(呼び出し側は上書きしない＝この技能自身のレベルを保つ)。Foundry 非依存。
 * @param {string} key 参照先の識別キー
 * @param {Array<{identificationKey?:string, level?:number}>} siblings 同アクターの他スタイル技能(自分を除く)
 * @returns {number|null} 参照先のレベル(数値)。未一致は null
 */
export function resolveLevelRef(key, siblings) {
  const k = String(key ?? "").trim();
  if (!k) return null;
  const ref = (siblings ?? []).find((s) => s?.identificationKey === k);
  return ref ? (Number(ref.level) || 0) : null;
}

/**
 * スタイル技能を**スタイル単位でグループ化**し、各スタイル群の秘技/奥義の取得数(個数)と上限を付す
 * (10-3・表示のみ・非強制)。秘技/奥義の取得数はキャラ全体でなく**スタイルごとに上限が決まる**
 * (秘技＝スタイルレベル×2／奥義＝スタイルレベル)。取得数に含まない(excludeFromCount)・レベル自動参照
 * (levelRefEnabled＝実体が同一技能)のブロックは二重計上を避けて除外する。
 * スタイルに紐付かない技能(ワークス技能・style 未一致)は末尾「その他」群へ(上限なし)。Foundry 非依存。
 * @param {Array<{id:string, style?:string, category?:string, excludeFromCount?:boolean, levelRefEnabled?:boolean}>} skills
 * @param {Array<{key:string, name:string, level:number}>} styles アクターのスタイル(表示順)
 * @returns {Array<{key:string, label:string, isStyle:boolean, secret:number, secretLimit:number, mystery:number, mysteryLimit:number, skillIds:string[]}>} 表示順のグループ
 */
export function groupStyleSkillsByStyle(skills, styles) {
  const styleByKey = new Map();
  (styles ?? []).forEach((s, idx) => { if (s?.key) styleByKey.set(s.key, { ...s, idx }); });

  const groups = new Map();
  const OTHER = "__other__";
  const ensure = (key, label, sortIdx, isStyle, level) => {
    if (!groups.has(key)) {
      const lv = Math.max(0, Number(level) || 0);
      groups.set(key, {
        key, label, isStyle, sortIdx,
        secret: 0, secretLimit: isStyle ? lv * 2 : 0,
        mystery: 0, mysteryLimit: isStyle ? lv : 0,
        skillIds: [],
      });
    }
    return groups.get(key);
  };

  for (const sk of (skills ?? [])) {
    const st = sk?.style ? styleByKey.get(sk.style) : null;
    const g = st
      ? ensure(`style:${st.key}`, st.name, st.idx, true, st.level)
      : ensure(OTHER, "その他", Number.MAX_SAFE_INTEGER, false, 0);
    g.skillIds.push(sk.id);
    if (!sk?.excludeFromCount && !sk?.levelRefEnabled) {
      if (sk?.category === "secret") g.secret++;
      else if (sk?.category === "mystery") g.mystery++;
    }
  }
  return [...groups.values()].sort((a, b) => a.sortIdx - b.sortIdx);
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
