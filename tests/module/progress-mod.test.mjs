import { describe, it, expect } from "vitest";

// 式評価は Foundry の Roll（ダイスなし決定的評価）に委ねている。テスト環境には Roll が
// 無いため、算術と参照キー展開だけを行う最小の代替を置く（本番と同じ経路＝式と data を
// evaluateFormula に渡す形を検証する）。
globalThis.Roll = class {
  constructor(formula, data = {}) {
    this.formula = String(formula).replace(/@(\w+)/g, (_m, k) => String(Number(data[k]) || 0));
    this.isDeterministic = !/\bd\d/.test(this.formula);
  }
  async evaluate() {
    const expr = this.formula.replace(/\b(floor|ceil|round|abs|min|max)\(/g, "Math.$1(");
    if (!/^[\d\s+\-*/().,]|Math\./.test(expr)) throw new Error("not an expression");
    this.total = Function(`"use strict"; return (${expr});`)();
    if (typeof this.total !== "number" || !Number.isFinite(this.total)) throw new Error("not a number");
    return this;
  }
};

const {
  PROGRESS_MOD_SOURCES,
  buildProgressModChoices,
  resolveProgressMod,
  outfitFieldNumber,
} = await import("../../scripts/focus-system/progress-mod.mjs");

describe("PROGRESS_MOD_SOURCES（進行修正の参照元）", () => {
  it("なし・アウトフィット・キャラクターの3つ", () => {
    expect(PROGRESS_MOD_SOURCES.map(s => s.value)).toEqual(["none", "outfit", "actor"]);
  });

  it("表示は日本語ラベル", () => {
    expect(PROGRESS_MOD_SOURCES.find(s => s.value === "none").label).toBe("なし（固定値）");
  });
});

describe("buildProgressModChoices()（グループ形式プルダウンの選択肢）", () => {
  it("参照元なしでは選択肢を持たない", () => {
    expect(buildProgressModChoices("none")).toEqual([]);
  });

  it("キャラクターは能力値・制御値などをグループ見出しつきで返す", () => {
    const groups = buildProgressModChoices("actor");
    expect(groups.map(g => g.label)).toContain("能力値");
    expect(groups.map(g => g.label)).toContain("制御値");
    const params = groups.flatMap(g => g.params);
    expect(params.find(p => p.value === "life.total").label).toBe("生命");
    expect(params.find(p => p.value === "life.totalControl").label).toBe("生命");
  });

  it("アウトフィットはアイテム種別をグループ見出しにする", () => {
    const groups = buildProgressModChoices("outfit");
    expect(groups.map(g => g.label)).toContain("タップ");
    const tap = groups.find(g => g.label === "タップ");
    expect(tap.params.find(p => p.value === "tap.cycle").label).toBe("サイクル数");
  });

  it("選択肢は内部キーの生値をラベルに出さない", () => {
    for (const source of ["actor", "outfit"]) {
      for (const g of buildProgressModChoices(source)) {
        for (const p of g.params) {
          expect(p.label).not.toContain(".");
          expect(p.label).not.toMatch(/^[a-z]+$/);
        }
      }
    }
  });

  it("未知の参照元は空", () => {
    expect(buildProgressModChoices("nope")).toEqual([]);
  });
});

describe("resolveProgressMod()（式評価・@param 注入）", () => {
  it("参照元なしでは式の数値をそのまま返す", async () => {
    expect(await resolveProgressMod({ source: "none", formula: "3" })).toBe(3);
  });

  it("パラメータの解決値が @param に入る", async () => {
    expect(await resolveProgressMod({ source: "outfit", param: "tap.cycle", formula: "@param" },
      { paramValue: 4 })).toBe(4);
  });

  it("係数は式で表せる", async () => {
    expect(await resolveProgressMod({ source: "actor", param: "life.total", formula: "@param * 2" },
      { paramValue: 5 })).toBe(10);
    expect(await resolveProgressMod({ source: "actor", param: "life.total", formula: "floor(@param / 2)" },
      { paramValue: 5 })).toBe(2);
  });

  it("パラメータが未解決なら @param は0として評価する", async () => {
    expect(await resolveProgressMod({ source: "outfit", param: "tap.cycle", formula: "@param + 1" })).toBe(1);
  });

  it("式が空なら0", async () => {
    expect(await resolveProgressMod({ source: "none", formula: "" })).toBe(0);
    expect(await resolveProgressMod(null)).toBe(0);
  });

  it("評価できない自由文は0（例外を投げない）", async () => {
    expect(await resolveProgressMod({ source: "none", formula: "タップのサイクル数" })).toBe(0);
  });
});

describe("outfitFieldNumber()（進行修正 outfit の値取り出し・13-7）", () => {
  it("直値（NumberField）はそのまま", () => {
    expect(outfitFieldNumber(5)).toBe(5);
    expect(outfitFieldNumber(0)).toBe(0);
  });
  it("modeValueField（{mode,value}）は value", () => {
    expect(outfitFieldNumber({ mode: "value", value: 3 })).toBe(3);
    expect(outfitFieldNumber({ mode: "none", value: 0 })).toBe(0);
  });
  it("total を持つ（attackField 等）は total を優先", () => {
    expect(outfitFieldNumber({ value: 2, total: 7 })).toBe(7);
  });
  it("非数・空は 0", () => {
    expect(outfitFieldNumber(null)).toBe(0);
    expect(outfitFieldNumber({})).toBe(0);
    expect(outfitFieldNumber("x")).toBe(0);
  });
});
