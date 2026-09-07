/**
 * @fileoverview アウトフィットタブの列値・グループ分けのテスト(2026-09-07)。
 *
 * これらは 2026-09-07 にアクターシート基底から切り出した純粋関数。切り出す前は 3,124 行の
 * シートクラスの static メンバで、Foundry なしには一行も動かせず試験できなかった。
 *
 * 共通の性質: {mode,value} 形式のフィールドは **mode が value のときだけ数値を出し、それ以外は
 * "-"**(なし/解説参照/制御値 は数値にならない)。実効値(total=AE・改造込み)があればそちらを出す。
 */

import { describe, it, expect } from "vitest";
import {
  computeColValue, computeCombinedColValue, displayGroupKey, optionConsumption,
  OUTFIT_GROUP_CONFIG,
} from "../../scripts/actor/outfit-tab.mjs";
import { OUTFIT_CATEGORIES } from "../../scripts/data/item/outfit-categories.mjs";

/** {mode,value} フィールドを作る。 */
const mv = (value, over = {}) => ({ mode: "value", value, ...over });

describe("computeColValue()（アウトフィット行の列の値）", () => {
  it("実効値(total)があれば素値より優先する（AE・改造込みの値を出す）", () => {
    expect(computeColValue("guard", { guardValue: mv(2, { total: 5 }) })).toBe("5");
    expect(computeColValue("hack", { hack: mv(1, { total: 4 }) })).toBe("4");
    // total が 0 でも「値がある」ので 0 を出す(?? で拾うため 0 が消えない)
    expect(computeColValue("guard", { guardValue: mv(3, { total: 0 }) })).toBe("0");
  });

  it("mode が value でなければ数値を出さない（なし・解説参照・制御値）", () => {
    for (const mode of ["none", "reference", "control"]) {
      expect(computeColValue("guard", { guardValue: { mode, value: 9, total: 9 } })).toBe("-");
    }
    expect(computeColValue("guard", {})).toBe("-");
  });

  it("隠匿値／登場ペナルティは両方なければ「-」・片方だけでも併記する", () => {
    expect(computeColValue("hide", {})).toBe("-");
    expect(computeColValue("hide", { hide: mv(2) })).toBe("2／-");
    expect(computeColValue("hide", { appearancePenalty: mv(-1) })).toBe("-／-1");
    expect(computeColValue("hide", { hide: mv(2), appearancePenalty: mv(-1) })).toBe("2／-1");
  });

  it("攻撃力は「種別+値」・種別が無ければ「-」（値だけでは列に出さない）", () => {
    expect(computeColValue("attack", { attack: { damageType: "P", value: 3 } })).toBe("P+3");
    expect(computeColValue("attack", { attack: { value: 3 } })).toBe("-");
    // 実効種別(damageTypeTotal)と実効値(total)を優先する
    expect(computeColValue("attack", {
      attack: { damageType: "P", damageTypeTotal: "S", value: 3, total: 6 },
    })).toBe("S+6");
    // 値なしは 0 として出す(種別があるなら列は埋まる)
    expect(computeColValue("attack", { attack: { damageType: "I" } })).toBe("I+0");
  });

  it("防御力は S／P／I の 3 つ組・mode が value のときだけ", () => {
    const d = { mode: "value", S_defence: 1, P_defence: 2, I_defence: 3 };
    expect(computeColValue("defence", { defence: d })).toBe("1／2／3");
    expect(computeColValue("defence", { defence: { ...d, S_total: 4, I_total: 9 } })).toBe("4／2／9");
    expect(computeColValue("defence", { defence: { ...d, mode: "none" } })).toBe("-");
  });

  it("スロット列は種別(normal/software/hardware)で引き当てる", () => {
    const sys = { slots: [
      { kind: "normal",   count: mv(2) },
      { kind: "software", count: mv(3) },
      { kind: "hardware", count: mv(4) },
    ] };
    expect(computeColValue("slot", sys)).toBe("2");
    expect(computeColValue("soft", sys)).toBe("3");
    expect(computeColValue("hard", sys)).toBe("4");
    // 該当種別が無い行は "-"（他種別の値を借りない）
    expect(computeColValue("soft", { slots: [{ kind: "normal", count: mv(2) }] })).toBe("-");
    expect(computeColValue("slot", {})).toBe("-");
  });

  it("住宅施設の登場目標値・セキュリティは実効値 → Total → 素値 → 0 の順に拾う", () => {
    expect(computeColValue("appearance", { appearanceTarget: 8 }, null)).toBe("8");
    expect(computeColValue("appearance", { appearanceTarget: 8, appearanceTargetTotal: 10 }, null)).toBe("10");
    expect(computeColValue("appearance", { appearanceTarget: 8 }, { appearanceTarget: 12 })).toBe("12");
    expect(computeColValue("appearance", {}, null)).toBe("0");
    expect(computeColValue("security", { cyberSecurity: 1, analogSecurity: 2 }, null)).toBe("1／2");
    expect(computeColValue("security", {}, { cyberSecurity: 5 })).toBe("5／0");
  });

  it("射程は min が未設定・none なら出さない", () => {
    expect(computeColValue("range", { range: { min: "none", max: "none" } })).toBe("-");
    expect(computeColValue("range", {})).toBe("-");
  });

  it("知らない列キーは「-」（列を増やしても既存行が壊れない）", () => {
    expect(computeColValue("nosuchColumn", { guardValue: mv(3) })).toBe("-");
  });
});

describe("computeCombinedColValue()（コンバイン合成後の列の値）", () => {
  // combine.params[列] が "2" なら元アイテム2、それ以外は元アイテム1 の値を採る
  const combiner = (params = {}, appearance = "1") => ({ system: { combine: { params, appearance } } });
  const src = (sys) => ({ system: sys });
  const s1 = src({ guardValue: mv(2) });
  const s2 = src({ guardValue: mv(7) });

  it("params の指定どおりに元アイテムを選ぶ（既定は元1）", () => {
    expect(computeCombinedColValue("guard", combiner(), s1, s2, null)).toBe("2");
    expect(computeCombinedColValue("guard", combiner({ guardValue: "2" }), s1, s2, null)).toBe("7");
    expect(computeCombinedColValue("guard", combiner({ guardValue: "1" }), s1, s2, null)).toBe("2");
  });

  it("選んだ側が値を持たなければ「-」（もう一方の値を借りない）", () => {
    expect(computeCombinedColValue("guard", combiner({ guardValue: "2" }), s1, src({}), null)).toBe("-");
  });

  it("実効値(total)は合成行でも効く（AE がコンバイン行にだけ乗らない不具合の再発防止）", () => {
    expect(computeCombinedColValue("guard", combiner(),
      src({ guardValue: mv(2, { total: 9 }) }), s2, null)).toBe("9");
  });

  // 隠匿値だけは他の列と形が違う: 「見た目元の隠(コンバイナー自身の隠)／選んだ元の登場ペナルティ」。
  // 見た目をどちらから採るかは params でなく combine.appearance が決める(既定は元1)
  it("隠匿値は 見た目元の隠(コンバイナーの隠)／登場ペナルティ の形", () => {
    const c = (appearance) => ({ system: { combine: { params: {}, appearance }, hide: mv(-3) } });
    const a = src({ hide: mv(1), appearancePenalty: mv(-2) });
    const b = src({ hide: mv(5) });
    expect(computeCombinedColValue("hide", c("1"), a, b, null)).toBe("1(-3)／-2");
    expect(computeCombinedColValue("hide", c("2"), a, b, null)).toBe("5(-3)／-2");
  });

  it("隠匿値は 3 つとも値が無いときだけ「-」に畳む", () => {
    const c = { system: { combine: { params: {}, appearance: "1" } } };
    expect(computeCombinedColValue("hide", c, src({}), src({}), null)).toBe("-");
  });
});

describe("displayGroupKey()（大分類 → 表示グループ）", () => {
  it("アイテム・サービスは「その他」にまとめる", () => {
    expect(displayGroupKey("item")).toBe("other");
    expect(displayGroupKey("service")).toBe("other");
  });

  it("未設定も「その他」（分類なしの行が消えない）", () => {
    expect(displayGroupKey("")).toBe("other");
    expect(displayGroupKey(null)).toBe("other");
    expect(displayGroupKey(undefined)).toBe("other");
  });

  it("それ以外の大分類はそのままグループになる", () => {
    for (const k of ["weapon", "armor", "cyberware", "tron", "vehicle", "housing"]) {
      expect(displayGroupKey(k)).toBe(k);
    }
  });

  // 大分類が増えたときに「表示先の無い行」が生まれるのを防ぐ。分類の一覧を直書きせず
  // OUTFIT_CATEGORIES から取るので、分類を足してグループを足し忘れればここで落ちる
  it("すべての大分類が、存在するグループへ落ちる", () => {
    const groups = new Set(OUTFIT_GROUP_CONFIG.map(c => c.key));
    for (const major of Object.keys(OUTFIT_CATEGORIES)) {
      expect(groups.has(displayGroupKey(major))).toBe(true);
    }
    expect(groups.has(displayGroupKey(""))).toBe(true);   // 未設定も行き先がある
  });

  // 逆向き: グループの sourceKeys に書かれた大分類は、displayGroupKey がそのグループへ
  // 落とすものと一致していなければならない(2 箇所に同じ対応表があるため、片方だけ直すと崩れる)
  it("グループの sourceKeys と displayGroupKey の対応が一致する", () => {
    for (const g of OUTFIT_GROUP_CONFIG) {
      for (const major of g.sourceKeys) expect(displayGroupKey(major)).toBe(g.key);
    }
  });
});

describe("optionConsumption()（オプションが装備先で消費するスロット数）", () => {
  const part = (rows) => ({ part: rows });

  it("option 行の slots を採る", () => {
    expect(optionConsumption(part([{ kind: "option", slots: 2 }]))).toBe(2);
  });

  it("解説参照でも中身が option ならオプション行として扱う", () => {
    expect(optionConsumption(part([{ kind: "reference", refSubKind: "option", slots: 3 }]))).toBe(3);
  });

  it("0 は非消費として保つ（既定 1 に化けない＝武器0 等）", () => {
    expect(optionConsumption(part([{ kind: "option", slots: 0 }]))).toBe(0);
  });

  it("負の指定は 0 に丸める（占有を減らす方向には使えない）", () => {
    expect(optionConsumption(part([{ kind: "option", slots: -5 }]))).toBe(0);
  });

  it("オプション行が無い・数でない・part が配列でなければ既定 1", () => {
    expect(optionConsumption(part([{ kind: "bodyPart", slots: 4 }]))).toBe(1);
    expect(optionConsumption(part([{ kind: "option", slots: "ー" }]))).toBe(1);
    expect(optionConsumption(part([{ kind: "option" }]))).toBe(1);
    expect(optionConsumption({})).toBe(1);
    expect(optionConsumption({ part: null })).toBe(1);
  });

  it("最初のオプション行だけを見る（複数あっても合算しない）", () => {
    expect(optionConsumption(part([
      { kind: "option", slots: 1 },
      { kind: "option", slots: 5 },
    ]))).toBe(1);
  });
});
