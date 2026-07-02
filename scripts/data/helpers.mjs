/**
 * @fileoverview DataModel 定義で使うヘルパー関数の置き場
 *
 * TNX のフィールド定義に頻出するパターンを関数化し、重複を減らす。
 * 新しいパターンが増えたらここに追加する。
 */

/**
 * ダメージ量を表す { value, min, max } の SchemaField を返す。
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function damageField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value: new fields.NumberField({ initial: 0 }),
    min:   new fields.NumberField({ initial: 0 }),
    max:   new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 能力値(reason / passion / life / mundane)の14フィールド構造を返す SchemaField。
 * template.json > Actor.templates.attributes.reason 等の構造に準拠。
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function attributeField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value:            new fields.NumberField({ initial: 0 }),
    control:          new fields.NumberField({ initial: 0 }),
    styleA_value:     new fields.NumberField({ initial: 0 }),
    styleA_control:   new fields.NumberField({ initial: 0 }),
    styleB_value:     new fields.NumberField({ initial: 0 }),
    styleB_control:   new fields.NumberField({ initial: 0 }),
    styleC_value:     new fields.NumberField({ initial: 0 }),
    styleC_control:   new fields.NumberField({ initial: 0 }),
    growth:           new fields.NumberField({ initial: 0 }),
    controlGrowth:    new fields.NumberField({ initial: 0 }),
    mod:              new fields.NumberField({ initial: 0 }),
    controlMod:       new fields.NumberField({ initial: 0 }),
  });
}

/**
 * 能力値・制御値の最終実効値(total / totalControl)を算出する純粋関数。
 *
 * 実効値 = growth + Σ(スタイル基本値 × レベル) + mod + outfitMod(バフは適用パスが total へ直接)。
 * 制御値も同様に control 系フィールドで算出する。
 * 最終合算後に 0clamp を適用する(全修正合算後・順序非依存。能力値/制御値とも)。
 * → llm-wiki/01_Wiki/Game_Rules/Character_Creation.md「能力値・制御値の上限と最終値clamp」
 *
 * 判定・シート表示・mundane 算出が同一式を参照するための単一の真実。
 * DataModel(prepareDerivedData)から呼ぶ。Item に依存しないよう、スタイル寄与は
 * { value, control, level } の素オブジェクト配列で受け取る(テスト容易性のため)。
 *
 * @param {object}   ability  能力値フィールド(growth/mod/effectMod/controlGrowth/controlMod/controlEffectMod)
 * @param {Array<{value:number, control:number, level:number}>} styles  スタイル寄与
 * @param {number}   [outfitMod=0]         能力値へのアウトフィット修正
 * @param {number}   [outfitControlMod=0]  制御値へのアウトフィット修正
 * @returns {{ total:number, totalControl:number }}
 */
export function computeAttributeFinal(ability, styles, outfitMod = 0, outfitControlMod = 0) {
  let styleValue = 0, styleControl = 0;
  for (const s of styles) {
    const level = s.level || 1;
    styleValue   += (s.value   ?? 0) * level;
    styleControl += (s.control ?? 0) * level;
  }
  // v2: effectMod 項は廃止(バフは適用パスが total へ直接効かせる)。0clamp は
  // バフ適用後に行うため、ここでは clamp しない素の base 合計を返す。
  return {
    total:        (ability.growth        ?? 0) + styleValue   + (ability.mod        ?? 0) + outfitMod,
    totalControl: (ability.controlGrowth ?? 0) + styleControl + (ability.controlMod ?? 0) + outfitControlMod,
  };
}

/** OutfitBaseTemplate を合成するアイテム type(アウトフィット集計・シート表示/並び替え/経験点計算の判別に共用。単一ソース) */
export const OUTFIT_ITEM_TYPES = new Set([
  "weapon", "armor", "ianus", "cyborg", "tron", "tap",
  "vehicle", "residence", "combiner", "general",
]);

/**
 * 携帯中アウトフィットから outfitMod(制御値修正・CS修正)と appearanceModifier(危険値合計)を
 * 集計する純粋関数(フェーズ9-2、B-2 派生化。CS はフェーズ10-5 でフラグ駆動化)。
 *
 * - 制御値修正: 準備済み(isPrepared)かつ携帯中のアウトフィットのみ加算。
 * - CS修正(タップ・2026-07-02 裁定): 「ゴースト時は適用しない」フラグで一元化。
 *   - フラグ OFF: 一般原則どおり準備済みでのみ加算(combatSpeed)。ゴースト無関係。
 *   - フラグ ON: 携帯起点で別枠に加算(combatSpeedGhostIgnorable)。ゴースト登場中の
 *     読み飛ばしは呼び出し側(CastDataModel)が行う(決定値に触れない「修正項の条件付き除外」)。
 * - 危険値(appearancePenalty): 携帯中のアウトフィットを合算(登場判定用)。
 *
 * Item に依存しないよう、items は { type, system } を持つ素オブジェクト配列で受け取る。
 *
 * @param {Array<{type:string, system:object}>} items  アクターの全アイテム
 * @returns {{ control:number, combatSpeed:number, combatSpeedGhostIgnorable:number, appearance:number }}
 */
export function computeOutfitAggregates(items) {
  let control = 0, combatSpeed = 0, combatSpeedGhostIgnorable = 0, appearance = 0;
  for (const item of items) {
    if (!OUTFIT_ITEM_TYPES.has(item.type)) continue;
    const s = item.system;
    if (!s?.isCarrying) continue;
    if (s.isPrepared && s.controlMod?.mode === "value")        control     += Number(s.controlMod.value) || 0;
    if (s.combatSpeedMod?.mode === "value") {
      const v = Number(s.combatSpeedMod.value) || 0;
      if (s.combatSpeedModGhostIgnore)  combatSpeedGhostIgnorable += v;
      else if (s.isPrepared)            combatSpeed               += v;
    }
    if (s.appearancePenalty?.mode === "value")                appearance  += Number(s.appearancePenalty.value) || 0;
  }
  return { control, combatSpeed, combatSpeedGhostIgnorable, appearance };
}

/**
 * 戦闘速度(combatSpeed)の3層モデル(フェーズ10-5・正本 Combat_Flow.md「コンバットスピード」)。
 * 各層とも「決定値(再計算不可・保存)＋修正値(ライブ)」で表現する:
 * - base:    CSベースの能力値項スナップショット。「プレアクト初期化」で
 *            floor((理性+感情+生命)÷2) をその時点の実効値から焼き込む(以後追従しない)。
 * - value:   CS(中段)。プレアクト初期化で CSベース実効値から設定。
 * - current: CSカレント(カット中の自動管理はフェーズ13)。
 * - freeMod: CSベースへの手動修正(ライブ加算)。
 * シート表示は常に単一の「CS」で、3層は内部データ(ユーザー裁定 2026-07-02)。どの層を表示するかは
 * **自動制御**: カット(戦闘)進行中=カレント／それ以外=CS。ベースは編集モードの内部参照のみ。
 * initiative も表示中の値(displayTotal)を読む。
 * 実効値(baseTotal/valueTotal/currentTotal/displayTotal)は派生算出する(保存しない)。
 * 旧 mod フィールドは 3層モデルに役割がないため削除(フェーズ10-5・§4.3 承認済み)。
 *
 * @returns {foundry.data.fields.SchemaField}
 */
export function combatSpeedField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    value:   new fields.NumberField({ initial: 0 }),
    base:    new fields.NumberField({ initial: 0 }),
    current: new fields.NumberField({ initial: 0 }),
    freeMod: new fields.NumberField({ initial: 0 }),
  });
}

/**
 * シートに「CS」として表示する層の実効値を返す純粋関数(フェーズ10-5・自動制御)。
 * カット(戦闘)進行中はカレント、それ以外は CS(中段)。initiative もこの値を読む。
 * カット開始時にカレントへ CS が自動セットされる(tnx.mjs の戦闘フック)ため、
 * セットアップ時点の表示・initiative は CS と一致し、セットアップ行動での修正が
 * そのままカレントに乗る(「セットアップ末に決定・初期値は CS」の近似)。
 * @param {{valueTotal?:number, currentTotal?:number}} cs
 * @param {boolean} inCombat カット(開始済み戦闘)に参加中か
 * @returns {number}
 */
export function resolveCombatSpeedDisplayTotal(cs, inCombat) {
  return inCombat ? (cs?.currentTotal ?? 0) : (cs?.valueTotal ?? 0);
}

/**
 * アクターが開始済みの戦闘(カット進行中)に参加しているか(Foundry 依存・安全ガード付き)。
 * prepareDerivedData から呼ばれるため、game 未初期化時は false を返す。
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isActorInStartedCombat(actor) {
  try {
    const combat = game?.combat;
    if (!combat?.started || !actor) return false;
    return !!combat.getCombatantByActor?.(actor);
  } catch {
    return false;
  }
}
