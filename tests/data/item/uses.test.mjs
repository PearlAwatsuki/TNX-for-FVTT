import { describe, it, expect } from "vitest";
import "../../setup.mjs";

const { resolveUsesMax, migrateUsesMaxToString, usesMaxTotalOf, usesMaxBaseOf,
        computeUsesMaxTotalForActor, clampUsesMaxTotalForActor } =
  await import("../../../scripts/data/item/uses.mjs");

describe("resolveUsesMax()（使用回数の最大値＝数値または式の実効値解決）", () => {
  const never = () => { throw new Error("純数値で式評価を呼んではいけない"); };

  it("純数値の文字列は式評価を通さずその値になる", () => {
    expect(resolveUsesMax("3", never)).toBe(3);
    expect(resolveUsesMax("0", never)).toBe(0);
  });

  it("空・未設定は 0", () => {
    expect(resolveUsesMax("", () => null)).toBe(0);
    expect(resolveUsesMax(undefined, () => null)).toBe(0);
    expect(resolveUsesMax(null, () => null)).toBe(0);
  });

  it("式は評価関数の結果を使う（「レベル回」＝レベル参照の式）", () => {
    expect(resolveUsesMax("@item.self.system.levelTotal", (f) =>
      f === "@item.self.system.levelTotal" ? 2 : null)).toBe(2);
  });

  it("評価不能（自由文・ダイス入り・構文エラー）は 0", () => {
    expect(resolveUsesMax("レベル回", () => null)).toBe(0);
    expect(resolveUsesMax("1d6", () => null)).toBe(0);
  });

  it("負の値は 0 にクランプする", () => {
    expect(resolveUsesMax("-2", never)).toBe(0);
    expect(resolveUsesMax("@item.self.system.levelTotal - 5", () => -3)).toBe(0);
  });

  it("端数は切り捨てる（TNX の除算は切り捨て）", () => {
    expect(resolveUsesMax("@item.self.system.levelTotal / 2", () => 1.5)).toBe(1);
    expect(resolveUsesMax("2.9", never)).toBe(2);
  });
});

describe("migrateUsesMaxToString()（uses.max の NumberField → StringField 移行）", () => {
  it("数値の max を文字列にする", () => {
    const source = { uses: { isLimit: true, max: 3, spent: 1 } };
    migrateUsesMaxToString(source);
    expect(source.uses.max).toBe("3");
  });

  it("既に文字列（式を含む）なら触らない", () => {
    const source = { uses: { max: "@item.self.system.levelTotal" } };
    migrateUsesMaxToString(source);
    expect(source.uses.max).toBe("@item.self.system.levelTotal");
  });

  it("uses が無い・max が無いソースは何もしない（例外にしない）", () => {
    const noUses = {};
    migrateUsesMaxToString(noUses);
    expect(noUses.uses).toBeUndefined();
    const noMax = { uses: { spent: 0 } };
    migrateUsesMaxToString(noMax);
    expect(noMax.uses.max).toBeUndefined();
  });
});

describe("usesMaxTotalOf()（読み手が使う実効値リーダー）", () => {
  it("実効値 maxTotal があればそれを返す（AE・式の適用後）", () => {
    expect(usesMaxTotalOf({ uses: { max: "@item.self.system.levelTotal", maxTotal: 4 } })).toBe(4);
  });

  it("実効値が無ければ素値を数値として読む（辞典アイテム・派生前の生データ）", () => {
    expect(usesMaxTotalOf({ uses: { max: "3" } })).toBe(3);
    expect(usesMaxTotalOf({ uses: { max: 3 } })).toBe(3);
  });

  it("実効値が無く素値が式なら 0（式は派生でしか解けない）", () => {
    expect(usesMaxTotalOf({ uses: { max: "@item.self.system.levelTotal" } })).toBe(0);
  });

  it("uses を持たない system は 0", () => {
    expect(usesMaxTotalOf({})).toBe(0);
    expect(usesMaxTotalOf(null)).toBe(0);
  });
});

describe("usesMaxBaseOf()（母数を機械維持する書き手が使う「土台」）", () => {
  it("保存値が数値ならその値を返す（AE で膨らんだ実効値は使わない）", () => {
    // 神業の母数 +1 は保存値を増やす操作。AE 分まで焼き込んではいけない
    expect(usesMaxBaseOf({ uses: { max: "2", maxTotal: 3 } })).toBe(2);
  });

  it("保存値が式なら実効値を土台にする（数として扱えないため）", () => {
    expect(usesMaxBaseOf({ uses: { max: "@item.self.system.levelTotal", maxTotal: 2 } })).toBe(2);
  });

  it("uses を持たない system は 0", () => {
    expect(usesMaxBaseOf({})).toBe(0);
  });
});

describe("computeUsesMaxTotalForActor()（アクター段の再評価・AE 適用の直前）", () => {
  const fakeActor = (systems) => ({ getRollData: () => ({}), items: systems.map(system => ({ system })) });

  it("所有アイテムすべての uses.maxTotal を書き込む", () => {
    const a = { uses: { isLimit: true, max: "3", spent: 0 } };
    const b = { uses: { isLimit: true, max: "1", spent: 0 } };
    computeUsesMaxTotalForActor(fakeActor([a, b]));
    expect(a.uses.maxTotal).toBe(3);
    expect(b.uses.maxTotal).toBe(1);
  });

  it("uses を持たないアイテムには触らない（例外にしない）", () => {
    const plain = { level: 3 };
    computeUsesMaxTotalForActor(fakeActor([plain]));
    expect(plain.uses).toBeUndefined();
  });

  it("アイテムを持たない・アクターが無くても例外にしない", () => {
    expect(() => computeUsesMaxTotalForActor(fakeActor([]))).not.toThrow();
    expect(() => computeUsesMaxTotalForActor(null)).not.toThrow();
  });
});

describe("clampUsesMaxTotalForActor()（AE 適用後の 0clamp・整数化）", () => {
  const fakeActor = (systems) => ({ items: systems.map(system => ({ system })) });

  it("AE で負になった実効値を 0 に戻す", () => {
    const s = { uses: { max: "1", maxTotal: -2 } };
    clampUsesMaxTotalForActor(fakeActor([s]));
    expect(s.uses.maxTotal).toBe(0);
  });

  it("AE の乗算で生じた端数を切り捨てる", () => {
    const s = { uses: { max: "3", maxTotal: 4.5 } };
    clampUsesMaxTotalForActor(fakeActor([s]));
    expect(s.uses.maxTotal).toBe(4);
  });

  it("正常な実効値・uses を持たないアイテムはそのまま", () => {
    const ok = { uses: { max: "2", maxTotal: 2 } };
    const plain = { level: 1 };
    clampUsesMaxTotalForActor(fakeActor([ok, plain]));
    expect(ok.uses.maxTotal).toBe(2);
    expect(plain.uses).toBeUndefined();
  });
});
