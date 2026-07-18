import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { resolveTargetDefense, resolveOpenReactions, reactionButtonPlan } =
  await import("../../scripts/module/reaction-logic.mjs");

const R = (over = {}) => ({
  mode: "dodge", achievement: 0, established: true, parryGuard: 0,
  reactorName: "R", isSelf: false, ...over,
});

describe("resolveTargetDefense()（複数リアクション併存の防御合成・2026-07-18）", () => {
  it("本人未決断・リアクションなし= pending", () => {
    const r = resolveTargetDefense(15, { controlValue: 10, selfDecision: null, reactions: [] });
    expect(r.state).toBe("pending");
    expect(r.diff).toBeNull();
  });

  it("スキップのみ= 制御値受け（達成値≥制御値で命中・差分値=達成値−制御値）", () => {
    const hit = resolveTargetDefense(15, { controlValue: 15, selfDecision: "skipped", reactions: [] });
    expect(hit.state).toBe("hit");
    expect(hit.resolution).toBe("none");
    expect(hit.diff).toBe(0);
    expect(hit.reactionAchievement).toBeNull();

    const miss = resolveTargetDefense(14, { controlValue: 15, selfDecision: "skipped", reactions: [] });
    expect(miss.state).toBe("miss");
    expect(miss.diff).toBeNull();
  });

  it("本人リアクションのみ= 受動有利（同値はリアクション側勝利）", () => {
    const r = resolveTargetDefense(15, {
      controlValue: 10, selfDecision: "reacted",
      reactions: [R({ isSelf: true, achievement: 15 })],
    });
    expect(r.state).toBe("miss");
    expect(r.reactionAchievement).toBe(15);
  });

  it("スキップ＋代理= 制御値と代理の対決の両方を破らないと命中しない", () => {
    // 攻撃18: 制御値15は破る(diff3)が、代理の対決18は同値=受動有利で止まる
    const stopped = resolveTargetDefense(18, {
      controlValue: 15, selfDecision: "skipped",
      reactions: [R({ achievement: 18 })],
    });
    expect(stopped.state).toBe("miss");

    // 攻撃19: 両方破る。差分値は最も固い防御要素との差(min)
    const through = resolveTargetDefense(19, {
      controlValue: 15, selfDecision: "skipped",
      reactions: [R({ achievement: 18 })],
    });
    expect(through.state).toBe("hit");
    expect(through.diff).toBe(1);
  });

  it("本人＋代理= 高い方が適用（表示は最高達成値の1件）・全要素を破って命中", () => {
    const r = resolveTargetDefense(20, {
      controlValue: 10, selfDecision: "reacted",
      reactions: [
        R({ isSelf: true, mode: "dodge", achievement: 12 }),
        R({ mode: "reaction", achievement: 18, reactorName: "助っ人" }),
      ],
    });
    expect(r.state).toBe("hit");
    expect(r.resolution).toBe("reaction");   // 適用=最高達成値の代理
    expect(r.reactionAchievement).toBe(18);
    expect(r.diff).toBe(2);
  });

  it("不成立（ファンブル/スート不一致）のリアクションは達成値0として扱う", () => {
    const r = resolveTargetDefense(1, {
      controlValue: 0, selfDecision: "reacted",
      reactions: [R({ isSelf: true, established: false, achievement: 17 })],
    });
    expect(r.state).toBe("hit");
    expect(r.reactionAchievement).toBe(0);
    expect(r.reactionEstablished).toBe(false);
  });

  it("受け値=成立したパリーの最大1つのみ（不成立は除外）", () => {
    const r = resolveTargetDefense(20, {
      controlValue: 0, selfDecision: "reacted",
      reactions: [
        R({ isSelf: true, mode: "parry", achievement: 10, parryGuard: 3 }),
        R({ mode: "parry", achievement: 12, parryGuard: 5 }),
        R({ mode: "parry", achievement: 14, parryGuard: 9, established: false }),
      ],
    });
    expect(r.parryGuard).toBe(5);
  });

  it("成立ゲート（社会軽減）= 代理の成立でも開く", () => {
    const r = resolveTargetDefense(20, {
      controlValue: 0, selfDecision: "skipped",
      reactions: [R({ established: true, achievement: 3 })],
    });
    expect(r.reactionEstablished).toBe(true);
  });

  it("本人未決断でも代理が攻撃を止めれば miss・止めなければ pending のまま", () => {
    const stopped = resolveTargetDefense(10, {
      controlValue: 15, selfDecision: null,
      reactions: [R({ achievement: 10 })],
    });
    expect(stopped.state).toBe("miss");

    const pending = resolveTargetDefense(15, {
      controlValue: 15, selfDecision: null,
      reactions: [R({ achievement: 10 })],
    });
    expect(pending.state).toBe("pending");
  });
});

describe("resolveOpenReactions()（オープンリアクションの最高値解決・2026-07-18）", () => {
  it("リアクション0件= 失敗しない・結果なし", () => {
    expect(resolveOpenReactions(10, [])).toEqual({ failed: false, effective: null });
  });

  it("受動有利: 実行側達成値が最高値を上回れば成功・同値以下は失敗", () => {
    expect(resolveOpenReactions(15, [R({ achievement: 14 })]).failed).toBe(false);
    expect(resolveOpenReactions(15, [R({ achievement: 15 })]).failed).toBe(true);
  });

  it("結果=最高達成値の1件のみ（成立したものから選ぶ・不成立は無視）", () => {
    const r = resolveOpenReactions(20, [
      R({ achievement: 10, reactorName: "A" }),
      R({ achievement: 16, reactorName: "B" }),
      R({ achievement: 18, reactorName: "C", established: false }),
    ]);
    expect(r.effective.reactorName).toBe("B");
    expect(r.effective.achievement).toBe(16);
    expect(r.failed).toBe(false);
  });

  it("全て不成立= 結果なし・失敗しない", () => {
    const r = resolveOpenReactions(5, [R({ achievement: 9, established: false })]);
    expect(r.effective).toBeNull();
    expect(r.failed).toBe(false);
  });
});

describe("reactionButtonPlan()（対決欄→リアクションボタン構成・2026-07-18）", () => {
  const row = (value, name = "") => ({ value, name });

  it("物理攻撃の既定（ドッジ+パリー）= ドッジ/パリー/その他・統合リアクションなし", () => {
    const p = reactionButtonPlan([row("dodge"), row("parry")]);
    expect(p.dodge).toBe(true);
    expect(p.parry).toBe(true);
    expect(p.reaction).toBeNull();
    expect(p.other).toBe(true);
  });

  it("精神攻撃（リアクション（精神攻撃）行）= 「リアクション」1つ（系統∪汎用）・その他なし", () => {
    const p = reactionButtonPlan([row("mentalReaction")]);
    expect(p.dodge).toBe(false);
    expect(p.reaction).toEqual({ types: ["mentalReaction", "reaction"], skillKeys: [] });
    expect(p.other).toBe(false);
  });

  it("移動（リアクション（移動妨害）行）= 「リアクション」1つ（手段∪汎用）", () => {
    const p = reactionButtonPlan([row("moveBlockReaction")]);
    expect(p.reaction).toEqual({ types: ["moveBlockReaction", "reaction"], skillKeys: [] });
    expect(p.other).toBe(false);
  });

  it("無印技能名行= 「リアクション」（列挙技能∪汎用）に統合", () => {
    const p = reactionButtonPlan([row("skillName", "key.a"), row("skillNameAsterisk", "key.b")]);
    expect(p.reaction).toEqual({ types: ["reaction"], skillKeys: ["key.a"] });
    expect(p.other).toBe(false);
  });

  it("ドッジ＋技能名行= ドッジと「リアクション」が並ぶ・その他はなし（重複回避）", () => {
    const p = reactionButtonPlan([row("dodge"), row("skillName", "key.a")]);
    expect(p.dodge).toBe(true);
    expect(p.reaction).not.toBeNull();
    expect(p.other).toBe(false);
  });

  it("「不可」のみ= マスク表示＋その他のみ（対決不可無視の入口）", () => {
    const p = reactionButtonPlan([row("cannot")]);
    expect(p.cannot).toBe(true);
    expect(p.dodge).toBe(false);
    expect(p.reaction).toBeNull();
    expect(p.other).toBe(true);
  });

  it("汎用「リアクション」行= 統合ボタン（汎用と重複しない）", () => {
    const p = reactionButtonPlan([row("reaction")]);
    expect(p.reaction).toEqual({ types: ["reaction"], skillKeys: [] });
    expect(p.other).toBe(false);
  });

  it("汎用行＋精神行= タイプは重複なしの和集合", () => {
    const p = reactionButtonPlan([row("mentalReaction"), row("reaction")]);
    expect(p.reaction.types).toEqual(["mentalReaction", "reaction"]);
  });
});
