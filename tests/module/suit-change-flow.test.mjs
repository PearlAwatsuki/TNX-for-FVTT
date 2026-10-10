/** スート変更を「成立救済」でなく自由な実効スート書き換えとして保つ回帰テスト。 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "scripts/flow/tnx-check-flow.mjs"), "utf8");

describe("スート変更フロー", () => {
  it("全4スートのプルダウンを使い、validSuits で変更先を絞らない", () => {
    const start = src.indexOf("static async _resolveSuitChange");
    const end = src.indexOf("static async _chooseSuit", start);
    const helper = src.slice(start, end);
    expect(helper).toContain("ALL_SUITS.map");
    expect(helper).toContain('<select name="suit">');
    expect(helper).not.toContain("ctx.validSuits");
  });

  it("元スートを初期選択にし、キャンセル時は元スートを返す", () => {
    expect(src).toContain('s === initialSuit ? " selected" : ""');
    expect(src).toContain("return ALL_SUITS.includes(selected) ? selected : originalSuit;");
  });

  it("変更後に通常の一致判定を行い、不成立も許容する", () => {
    expect(src).toContain("const effectiveSuit = await TnxCheckFlow._resolveSuitChange(suit, ctx);");
    expect(src).toContain("!ctx.validSuits.includes(effectiveSuit)");
    expect(src).toContain("suitMismatch: true, suitChangedFrom");
  });

  it("待ち受け式 grantSuitChange は復活していない", () => {
    expect(src).not.toContain("grantSuitChange");
    expect(src).not.toContain('peekAchievementAction("suitChange")');
  });
});
