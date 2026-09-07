/**
 * @fileoverview 完了継続レジストリが唯一の正本であることの回帰テスト(2026-09-07)。
 *
 * 経緯: 2026-07-16 に「継続の種別リストが 3 箇所に複製され、追加漏れでカバーが再判定に
 * 引き継がれない」問題を受けて CONTINUATIONS 表が作られたが、**初回適用は _execute 内の
 * 10 個の分岐のまま残り**、「新しい継続種別はこの表と _execute の両方に追加する」という
 * 約束をコメントだけが担っていた。約束はコメントでは守らせられない。
 *
 * TnxCheckFlow は ApplicationV2 や Foundry グローバルに依存するモジュール群を静的 import する
 * ため vitest では読み込めない。usage-list-wiring.test.mjs と同じくソーステキストで検証する。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "scripts/flow/tnx-check-flow.mjs"), "utf8");

/** CONTINUATIONS の宣言部分(キーの並びが実行順)。 */
const registry = (() => {
  const s = src.indexOf("static CONTINUATIONS = Object.freeze({");
  const e = src.indexOf("\n    });", s);
  return src.slice(s, e);
})();

/** 表のキーを宣言順で返す。 */
const keys = [...registry.matchAll(/^ {8}(\w+): \{/gm)].map(m => m[1]);

describe("完了継続は CONTINUATIONS が唯一の正本", () => {
  it("表に継続種別が並んでいる(検証が空振りしていない)", () => {
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of ["controlNegate", "reaction", "covering", "recovery", "repair",
                     "modification", "appearance", "purchase", "infoGathering",
                     "npcAcquire", "movement"]) {
      expect(keys).toContain(k);
    }
  });

  it("_execute は種別ごとの分岐を持たない(表を回して適用する)", () => {
    // 旧実装の形。1 つでも残っていたら、表と _execute の二重管理に戻っている
    expect(src).not.toMatch(/if \(!ctx\.recheckMessageId && ctx\.\w+\)/);
    expect(src).toContain("for (const [key, cont] of Object.entries(TnxCheckFlow.CONTINUATIONS))");
    expect(src).toContain('await runContinuations("beforeSync");');
    expect(src).toContain('await runContinuations("afterSync");');
  });

  it("スナップショット保存・再実行も表から導く", () => {
    // _buildRecheckContext: 表のキーだけをスナップショットへ写す
    expect(src).toContain("for (const k of Object.keys(TnxCheckFlow.CONTINUATIONS))");
    // _rerunContinuation: 表から種別とポリシーを引く
    expect(src).toContain("Object.keys(TnxCheckFlow.CONTINUATIONS).find(k => cc[k])");
  });

  it("phase は beforeSync のみを明示し、既定は afterSync", () => {
    const phases = [...registry.matchAll(/phase: "(\w+)"/g)].map(m => m[1]);
    expect(new Set(phases)).toEqual(new Set(["beforeSync"]));
    // 結果そのものを書き換える種別だけが要求カード送信より前に来る
    expect(registry).toMatch(/controlNegate: \{\s*\n\s*phase: "beforeSync"/);
  });

  it("表の各エントリは apply か rerun を持つ(意図的に空なのは movement のみ)", () => {
    const empty = [];
    for (const k of keys) {
      const i = registry.indexOf(`        ${k}: {`);
      const j = registry.indexOf("\n        },", i);
      const body = j < 0 ? registry.slice(i) : registry.slice(i, j);
      if (!body.includes("apply(") && !body.includes("rerun(")) empty.push(k);
    }
    expect(empty).toEqual(["movement"]);
  });
});
