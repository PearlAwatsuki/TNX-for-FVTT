import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { buildCheckFormulaData, buildFormulaData, evaluateBonusRows, evaluateSelfBonus, parsePlainNumber,
  evaluateFormula, evaluateFormulaSync, normalizeFormulaItemRefs } = await import("../../scripts/rules/tnx-formula.mjs");

describe("buildCheckFormulaData()（式評価用の判定結果コンテキスト・Check_Rules「差分値」）", () => {
  it("diff / achievement / card を数値で供給する", () => {
    expect(buildCheckFormulaData({ diff: 7, achievement: 22, cardValue: 10 })).toEqual({ diff: 7, achievement: 22, card: 10 });
    expect(buildCheckFormulaData({ diff: -3, achievement: 12 })).toEqual({ diff: -3, achievement: 12, card: 0 });
  });

  it("目標値なし(diff=null)・欠損は 0 として供給する", () => {
    expect(buildCheckFormulaData({ diff: null, achievement: null })).toEqual({ diff: 0, achievement: 0, card: 0 });
    expect(buildCheckFormulaData(undefined)).toEqual({ diff: 0, achievement: 0, card: 0 });
  });

  it("カード値の表示用文字列(21固定の 'A(21固定)' 等)は 0 に落ちる（数値は持ち回り側で供給）", () => {
    expect(buildCheckFormulaData({ cardValue: "A(21固定)" }).card).toBe(0);
  });
});

describe("buildFormulaData()（AE と同じ system.* / @item.<識別キー> を式に供給・2026-07-10）", () => {
  // getRollData() は AE と同じ system.* を @system.* として公開(initiative と同流儀)。
  // 所持アイテムは識別キーで @item.<key>.system.* として公開する。
  const actor = {
    getRollData: () => ({ system: { life: { total: 8 } } }),
    items: [
      { system: { identificationKey: "operate_car", attack: { value: 4 } } },
      { system: { identificationKey: "", level: 3 } }, // 識別キー無し → @item に載せない
    ],
  };

  it("アクターの @system.* ＋ 所持アイテムの @item.<識別キー>.system.* を供給する", () => {
    expect(buildFormulaData(actor)).toEqual({
      system: { life: { total: 8 } },
      item: { operate_car: { system: { identificationKey: "operate_car", attack: { value: 4 } } } },
    });
  });

  it("判定結果(@diff/@achievement)を重ねる", () => {
    const d = buildFormulaData(actor, { diff: 7, achievement: 22 });
    expect(d.diff).toBe(7);
    expect(d.achievement).toBe(22);
    expect(d.item.operate_car.system.attack.value).toBe(4); // @item.<key>.system.attack.value
  });

  it("数字始まりの識別キーも data.item[...] の下に保持する", () => {
    const d = buildFormulaData({
      getRollData: () => ({ system: {} }),
      items: [{ system: { identificationKey: "01feeling", levelTotal: 5 } }],
    });
    expect(d.item["01feeling"].system.levelTotal).toBe(5);
  });

  it("アクターが無ければ system 無し・item は空", () => {
    expect(buildFormulaData(null)).toEqual({ item: {} });
    expect(buildFormulaData(null, { diff: 3, achievement: 10 })).toEqual({ diff: 3, achievement: 10, card: 0, item: {} });
  });

  it("bearer 指定で相対参照 @item.self / @item.parent（装備先ホスト）を供給する", () => {
    const host = { id: "host1", system: { identificationKey: "host_key", attack: { total: 9 } } };
    const items = [host]; items.get = (id) => items.find(i => i.id === id);
    const actor = { getRollData: () => ({ system: {} }), items };
    const bearer = { system: { identificationKey: "opt", parentItemId: "host1", appearancePenalty: { total: 3 } } };
    const d = buildFormulaData(actor, null, bearer);
    expect(d.item.self.system.appearancePenalty.total).toBe(3); // @item.self.*（乗るアイテム自身）
    expect(d.item.parent.system.attack.total).toBe(9);          // @item.parent.*（装備先ホスト）
    expect(d.item.host_key.system.attack.total).toBe(9);        // 識別キーでも引ける
  });

  it("target 指定で @target.system.* と @target.style/works（1/0・欠損も0）を供給する", () => {
    const target = {
      getRollData: () => ({ system: { life: { total: 6 } } }),
      items: [
        { type: "style", system: { identificationKey: "ayakashi" } },
        { type: "styleSkill", system: { special: { works: { organization: "kabuki" } } } },
      ],
    };
    const d = buildFormulaData(actor, null, null, target);
    expect(d.target.system.life.total).toBe(6);   // @target.system.*（対象の実効値）
    expect(d.target.style.ayakashi).toBe(1);       // 所持スタイル → 1
    expect(d.target.style.tatara).toBe(0);         // 未所持（欠損キー）→ 0
    expect(d.target.works.kabuki).toBe(1);
    expect(d.target.works.union).toBe(0);
    // target を渡さなければ @target は無い（判定・AE 値では非供給）
    expect(buildFormulaData(actor).target).toBeUndefined();
  });
});

describe("normalizeFormulaItemRefs()（識別キーが数値始まり／非識別子でも式内参照可能にする）", () => {
  it("数字始まり・ハイフン入りの識別キーも Roll のドット区切り参照を保持する", () => {
    expect(normalizeFormulaItemRefs("@item.01feeling.system.levelTotal + 2")).toBe("@item.01feeling.system.levelTotal + 2");
    expect(normalizeFormulaItemRefs("@item.style-x.system.level + @item.self.system.level")).toBe("@item.style-x.system.level + @item.self.system.level");
  });

  it("通常の識別キーはそのまま維持する", () => {
    expect(normalizeFormulaItemRefs("@item.style_x.system.level + @item.parent.system.level")).toBe("@item.style_x.system.level + @item.parent.system.level");
  });
});

describe("evaluateFormulaSync()（AE 値の同期評価・2026-07-10）", () => {
  it("純数値は Roll を介さず即返し", () => {
    expect(evaluateFormulaSync("5")).toBe(5);
    expect(evaluateFormulaSync("-2")).toBe(-2);
  });

  it("空・評価不能(テスト環境の Roll 不在)は null", () => {
    expect(evaluateFormulaSync("")).toBeNull();
    expect(evaluateFormulaSync("2 + @system.life.total", { system: { life: { total: 3 } } })).toBeNull();
  });
});

describe("evaluateBonusRows()（判定/ダメージの行を評価＋供給元帰属・2026-07-10）", () => {
  const actor = {
    getRollData: () => ({ system: {} }),
    items: [{ name: "〈スタイルX〉", type: "styleSkill", system: { identificationKey: "style_x" } }],
  };

  it("各行の式(数値)を合計し、供給元は逆引きした現在名で帰属する(なしは用途)", async () => {
    const { total, sources } = await evaluateBonusRows(
      [{ formula: "2", source: "style_x" }, { formula: "3", source: "" }], actor);
    expect(total).toBe(5);
    expect(sources).toEqual([{ name: "〈スタイルX〉", value: 2 }, { name: "用途", value: 3 }]);
  });

  it("label 行はそのまま帰属名に使う(識別キー逆引きを通さない・システム供給の固定ラベル=14-5)", async () => {
    const { total, sources } = await evaluateBonusRows(
      [{ formula: "-4", label: "危険値（ホワイト）" }], actor);
    expect(total).toBe(-4);
    expect(sources).toEqual([{ name: "危険値（ホワイト）", value: -4 }]);
  });

  it("評価不能(テスト環境の Roll 不在)・0 の行は除外", async () => {
    const { total, sources } = await evaluateBonusRows(
      [{ formula: "0", source: "" }, { formula: "@item.style_x.system.level", source: "style_x" }], actor);
    expect(total).toBe(0);
    expect(sources).toEqual([]);
  });
});

describe("evaluateSelfBonus()（用途自身の修正値・専用欄・親アイテム名で帰属・2026-07-10）", () => {
  const actor = { getRollData: () => ({ system: {} }), items: [] };
  const bearer = { name: "〈カブトワリ〉の刃", system: { identificationKey: "kabutowari", attack: { total: 4 } } };

  it("数値を評価し、帰属名は親アイテム名(bearer.name)", async () => {
    expect(await evaluateSelfBonus("3", actor, null, null, bearer)).toEqual({ name: "〈カブトワリ〉の刃", value: 3 });
  });

  it("bearer なしは帰属名 '用途'", async () => {
    expect(await evaluateSelfBonus("2", actor)).toEqual({ name: "用途", value: 2 });
  });

  it("空・0・評価不能(Roll 不在の式)は null", async () => {
    expect(await evaluateSelfBonus("", actor, null, null, bearer)).toBeNull();
    expect(await evaluateSelfBonus("0", actor, null, null, bearer)).toBeNull();
    expect(await evaluateSelfBonus("@item.self.system.attack.total", actor, null, null, bearer)).toBeNull();
  });
});

describe("parsePlainNumber()（純数値の速判定）", () => {
  it("整数・符号付き・小数を数値として返す", () => {
    expect(parsePlainNumber("3")).toBe(3);
    expect(parsePlainNumber("-2")).toBe(-2);
    expect(parsePlainNumber("+4")).toBe(4);
    expect(parsePlainNumber(" 1.5 ")).toBe(1.5);
  });

  it("式・自由文・空は null（式は Roll 評価へ・自由文は表示のみ扱い）", () => {
    expect(parsePlainNumber("2 + @diff")).toBeNull();
    expect(parsePlainNumber("サイクル数を加算")).toBeNull();
    expect(parsePlainNumber("")).toBeNull();
    expect(parsePlainNumber(undefined)).toBeNull();
  });
});

describe("evaluateFormula()（決定的評価・Foundry Roll 不在環境では数値のみ）", () => {
  it("純数値は Roll を介さず評価される", async () => {
    expect(await evaluateFormula("5")).toBe(5);
    expect(await evaluateFormula("-1")).toBe(-1);
  });

  it("空・評価不能は null", async () => {
    expect(await evaluateFormula("")).toBeNull();
    // テスト環境に Roll が無いため式は評価不能=null（実環境では Roll 決定的評価が解決する）
    expect(await evaluateFormula("2 + @diff", { diff: 3 })).toBeNull();
  });
});
