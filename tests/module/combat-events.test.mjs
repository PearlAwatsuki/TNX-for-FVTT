import { describe, it, expect } from "vitest";
import { TNX_HOOKS, planPhaseEvents } from "../../scripts/rules/combat-events.mjs";

describe("planPhaseEvents()（フェーズ遷移で発火するイベント列・13-6）", () => {
  it("setup→initiative: 離脱プロセス終了→遷移先開始（カット境界なし）", () => {
    expect(planPhaseEvents({ fromPhase: "setup", toPhase: "initiative", round: 1 })).toEqual([
      { hook: TNX_HOOKS.processEnd, data: { phase: "setup", combatantId: null, cut: 1 } },
      { hook: TNX_HOOKS.processStart, data: { phase: "initiative", combatantId: null, cut: 1 } },
    ]);
  });

  it("initiative→main: メイン開始に行動者 id を載せる", () => {
    expect(planPhaseEvents({ fromPhase: "initiative", toPhase: "main", toMainId: "a", round: 1 })).toEqual([
      { hook: TNX_HOOKS.processEnd, data: { phase: "initiative", combatantId: null, cut: 1 } },
      { hook: TNX_HOOKS.processStart, data: { phase: "main", combatantId: "a", cut: 1 } },
    ]);
  });

  it("main→initiative: メイン終了に終わる行動者 id を載せる（メイン中効果の失効点）", () => {
    expect(planPhaseEvents({ fromPhase: "main", fromMainId: "a", toPhase: "initiative", round: 2 })).toEqual([
      { hook: TNX_HOOKS.processEnd, data: { phase: "main", combatantId: "a", cut: 2 } },
      { hook: TNX_HOOKS.processStart, data: { phase: "initiative", combatantId: null, cut: 2 } },
    ]);
  });

  it("cleanup→setup（次カット）: 前カット終了→新カット開始を挟み、cut 番号は繰り上がる", () => {
    expect(planPhaseEvents({ fromPhase: "cleanup", toPhase: "setup", nextCut: true, round: 2 })).toEqual([
      { hook: TNX_HOOKS.processEnd, data: { phase: "cleanup", combatantId: null, cut: 2 } },
      { hook: TNX_HOOKS.cutEnd, data: { cut: 2 } },
      { hook: TNX_HOOKS.cutStart, data: { cut: 3 } },
      { hook: TNX_HOOKS.processStart, data: { phase: "setup", combatantId: null, cut: 3 } },
    ]);
  });

  it("fromPhase なし（頑健性）は離脱終了を出さない", () => {
    expect(planPhaseEvents({ fromPhase: null, toPhase: "setup", round: 1 })).toEqual([
      { hook: TNX_HOOKS.processStart, data: { phase: "setup", combatantId: null, cut: 1 } },
    ]);
  });
});
