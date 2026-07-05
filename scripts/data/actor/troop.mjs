/**
 * @fileoverview TroopDataModel - トループ Actor の DataModel
 *
 * フェーズ11-4 で CharacterBaseDataModel 継承に再構成(正本 Troops.md・2026-07-03 言語化):
 * - トループの構成はスタイル(1つ)・能力値・技能・アウトフィット・状態で、判定はキャストと同じ
 *   → 派生値パイプライン(AE 適用・アウトフィット集計・CS/AR)を共通基底から得る。
 * - biography も持つが、市民ランク・パーソナルデータ・ハンドルはシート非表示
 *   (個人を識別するキャラクターではない・2026-07-03 確定)。旧 memo は biography.description へ
 *   統合し廃止(migrateData で移行)。
 * - 能力値は**スタイルの基本値＋トループレベル**で決定する(成長なし・2026-07-03 確定)。
 * - 基底由来のフィールドのうち報酬点・部位(partSlots)・生身(baseAttack 等)・isGhost・
 *   handMaxSizeMod はトループのルール上は未使用(シートも非表示)。スキーマ上は残るが死蔵で実害なし。
 *
 * 固有フィールド:
 * - troopMode: 種別「トループ(troop)/エニグマ(enigma)/分身(bunshin)」のドロップダウン切替
 *   (2026-07-03 確定。旧 isEnigmaMode フラグは誤設計として廃止・migrateData で移行)。
 *   - troop:   heads=人数。名前は「(スタイル名)・トループ」で固定。
 *   - enigma:  heads=エニグマポイント。名前は自由(個体識別が必要なのはエニグマのみ)。
 *   - bunshin: リソース管理なし(1点でも被ダメージで消滅)。名前は「(分身元キャラ)の分身」で固定。
 * - sourceName: 分身元キャラクター名(bunshin の固定名に使用。NPC取得用途=11-6 で自動設定へ拡張予定)。
 * - troopLevel: トループレベル(エニグマでは「エニグマレベル」呼称)。能力値の決定項(スタイル基本値＋
 *   トループレベル)。取得技能のレベルがそのままレベルになる(2026-07-04 確定・NPC取得で転記)。
 * - heads {value, max}: 人数/エニグマポイント。HP のように機能しダメージ分減少する(チャート不参照)。
 *   トークンリソースバーに割り当てる。
 * - ownerActorRef {uuid, name}: 所有者(取得元)アクター参照(11-6・Troops.md「事前作成と所有者記録」)。
 *   経験点の出所の紐づけの正本——トループ級の消費経験点は取得元キャストの消費として計上される。
 *   User でなくアクターを指す(取得元アクターの明示が必須=2026-07-04 確定)。name は参照先削除時の
 *   表示フォールバックのみ(ライブ解決原則)。未設定=RL 作成の敵対トループ等(計上なし)。
 */

import { CharacterBaseDataModel, ABILITY_KEYS } from "./common/character-base.mjs";
import { computeAttributeFinal } from "../helpers.mjs";

/** トループ種別(troopMode)の選択肢 */
export const TROOP_MODES = {
  troop:   "トループ",
  enigma:  "エニグマ",
  bunshin: "分身",
};

export class TroopDataModel extends CharacterBaseDataModel {
  /** @override */
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      troopMode: new fields.StringField({
        required: true,
        initial: "troop",
        choices: Object.keys(TROOP_MODES),
      }),
      // 「ワークスを設定」(2026-07-03 確定): トループは基本ワークスを持たないが、
      // ワークスを持つトループは作成可能。ON かつ組織アイテムありのとき名前が
      // 「(組織名)（(スタイル名)(トループレベル)レベル）」になる(組織未設定なら OFF と同じ挙動)。
      hasWorks: new fields.BooleanField({ initial: false }),
      sourceName: new fields.StringField({ initial: "" }),
      troopLevel: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      heads: new fields.SchemaField({
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max:   new fields.NumberField({ initial: 1, min: 0, integer: true }),
      }),
      ownerActorRef: new fields.SchemaField({
        uuid: new fields.StringField({ initial: "" }),
        name: new fields.StringField({ initial: "" }),
      }),
    };
  }

  /**
   * @override
   * - 旧 memo(フェーズ6-0〜11-4)を biography.description へ移行する(description が空のときだけ)。
   * - 旧 isEnigmaMode(11-4 初版のみ)を troopMode へ移行する。
   */
  static migrateData(source) {
    if (source.memo && !source.description) {
      source.description = source.memo;
    }
    delete source.memo;
    if (source.isEnigmaMode && !source.troopMode) {
      source.troopMode = "enigma";
    }
    delete source.isEnigmaMode;
    return super.migrateData(source);
  }

  /**
   * @override
   * トループの能力値は**スタイルの基本値＋トループレベル**で決定する(成長なし・2026-07-03 確定)。
   * computeAttributeFinal を growth=トループレベルの疑似能力値で再利用し、修正(mod)・
   * アウトフィット修正・AE・0clamp の扱いは共通どおりとする。制御値も同式(＋トループレベル)。
   * 制御値へのトループレベル加算も同式(2026-07-03 ユーザー確定)。
   * 分身は本体のスタイル構成をコピーする想定のため、スタイル寄与はキャスト同様レベル乗算
   * (トループ/エニグマのスタイルは1つ・レベル1想定なので「基本値＋レベル」の表記どおりになる)。
   */
  _prepareAbilityTotals(styleItems) {
    const outfitMod = this.outfitMod ?? {};
    const lv = this.troopLevel ?? 0;
    for (const key of ABILITY_KEYS) {
      const styles = styleItems.map(s => ({
        value:   s.system[key]?.value,
        control: s.system[key]?.control,
        level:   s.system.level,
      }));
      const pseudo = {
        growth:        lv,
        controlGrowth: lv,
        mod:           this[key].mod,
        controlMod:    this[key].controlMod,
      };
      const { total, totalControl } = computeAttributeFinal(
        pseudo, styles, outfitMod[key] ?? 0, outfitMod.control ?? 0
      );
      this[key].total        = total;
      this[key].totalControl = totalControl;
    }
  }
}
