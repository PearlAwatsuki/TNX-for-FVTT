import { describe, it, expect } from "vitest";
import {
  isValidProcessTransition, arDecrement, planAdvance,
  buildEndMainUpdate, buildCantActUpdate, buildWaitUpdate, buildSetupConfirmUpdate,
  planInterruptStart, planInterruptEnd, buildInterruptEndUpdate,
} from "../../scripts/module/combat-progression.mjs";

// 参加者の素データ(combat-turn-order と同形)
const P = (over = {}) => ({
  id: "x", csCurrent: 0, csBase: 0, actorType: "cast", userOrder: 0, ar: 1, ...over,
});

describe("isValidProcessTransition()（サブターンモデルのフェーズ遷移・Combat_Flow）", () => {
  it("正規の遷移を許可する（setup→initiative→main→initiative→…→cleanup→setup）", () => {
    expect(isValidProcessTransition(null, "setup")).toBe(true);          // カット進行の開始
    expect(isValidProcessTransition("setup", "initiative")).toBe(true);
    expect(isValidProcessTransition("initiative", "main")).toBe(true);
    expect(isValidProcessTransition("main", "initiative")).toBe(true);
    expect(isValidProcessTransition("initiative", "cleanup")).toBe(true); // 行動可能者なし
    expect(isValidProcessTransition("cleanup", "setup")).toBe(true);      // 次カット
  });

  it("不正な遷移を拒否する", () => {
    expect(isValidProcessTransition("setup", "main")).toBe(false);
    expect(isValidProcessTransition("main", "cleanup")).toBe(false);
    expect(isValidProcessTransition("cleanup", "initiative")).toBe(false);
    expect(isValidProcessTransition("setup", "setup")).toBe(false);
  });
});

describe("planAdvance()（nextTurn 1本で進む前進計画・サブターンモデル）", () => {
  it("セットアップ→イニシアチブ（セットアップ末の CSカレント確定を伴う）", () => {
    expect(planAdvance("setup", [P()])).toEqual({ to: "initiative", confirmSetup: true });
  });

  it("イニシアチブ→候補がいればそのキャラのメインへ（CSカレント最大かつAR≥1を確認）", () => {
    const plan = planAdvance("initiative", [
      P({ id: "a", csCurrent: 5, ar: 1 }),
      P({ id: "b", csCurrent: 9, ar: 1 }),
      P({ id: "c", csCurrent: 7, ar: 0 }),
    ]);
    expect(plan).toEqual({ to: "main", mainId: "b", penalizedIds: [] });
  });

  it("イニシアチブ→行動できない最上位（戦闘不能タグ/脱落）は AR−1 の対象になり次点がメインへ", () => {
    const plan = planAdvance("initiative", [
      P({ id: "a", csCurrent: 9, ar: 2, cantAct: true }),
      P({ id: "b", csCurrent: 7, ar: 1 }),
    ]);
    expect(plan).toEqual({ to: "main", mainId: "b", penalizedIds: ["a"] });
  });

  it("イニシアチブ→行動可能者がいなければクリンナップへ", () => {
    const plan = planAdvance("initiative", [
      P({ id: "a", ar: 0 }), P({ id: "e", actorType: "extra", ar: 3 }),
    ]);
    expect(plan).toEqual({ to: "cleanup", penalizedIds: [] });
  });

  it("メイン→イニシアチブへ戻る（メイン終了の記帳を伴う）", () => {
    expect(planAdvance("main", [P()])).toEqual({ to: "initiative", endMain: true });
  });

  it("クリンナップ→次カットのセットアップへ（再シードを伴う）", () => {
    expect(planAdvance("cleanup", [P()])).toEqual({ to: "setup", nextCut: true });
  });

  it("未開始・不明フェーズは null", () => {
    expect(planAdvance(null, [P()])).toBeNull();
    expect(planAdvance("xxx", [P()])).toBeNull();
  });
});

describe("arDecrement()（AR−1・下限0）", () => {
  it("1減算し0で下げ止まる", () => {
    expect(arDecrement(2)).toBe(1);
    expect(arDecrement(1)).toBe(0);
    expect(arDecrement(0)).toBe(0);
    expect(arDecrement(undefined)).toBe(0);
    expect(arDecrement(null)).toBe(0);
  });
});

describe("記帳の更新オブジェクト（Combat_Flow §4-6）", () => {
  it("メイン終了＝常に AR−1・CSカレント0（メジャー未実行＝「メジャーで何もしなかった」扱い・2026-07-22 裁定）", () => {
    expect(buildEndMainUpdate({ actionRank: { value: 2 } })).toEqual({
      "system.actionRank.value": 1,
      "system.combatSpeed.current": 0,
    });
  });

  it("行動不能（イニシアチブ・RL判断）＝AR−1", () => {
    expect(buildCantActUpdate({ actionRank: { value: 1 } })).toEqual({ "system.actionRank.value": 0 });
  });

  it("待機（候補の操作者の宣言）＝CSカレント1", () => {
    expect(buildWaitUpdate()).toEqual({ "system.combatSpeed.current": 1 });
  });

  it("セットアップ末確定＝current ← valueTotal ＋ currentBuff", () => {
    expect(buildSetupConfirmUpdate({ combatSpeed: { valueTotal: 5, currentBuff: 2 } }))
      .toEqual({ "system.combatSpeed.current": 7 });
    expect(buildSetupConfirmUpdate({})).toEqual({});
  });

  it("actionRank を持たないアクターは記帳しない", () => {
    expect(buildCantActUpdate({})).toEqual({});
    expect(buildEndMainUpdate({})).toEqual({ "system.combatSpeed.current": 0 });
  });
});

describe("割り込み（挿入メイン）＝メインプロセスの割り込み・追加行動（13-5）", () => {
  describe("planInterruptStart()（割り込み開始の計画）", () => {
    it("サブターン（イニシアチブ）中の割り込み: そのサブターン位置へ戻る（メイン終了なし）", () => {
      const current = { phase: "initiative", mainCombatantId: null, spotCombatantId: "s1", interruptMainId: null, interruptReturn: null };
      expect(planInterruptStart(current, "x")).toEqual({
        endMainId: null,
        interruptMainId: "x",
        interruptReturn: { phase: "initiative", spotId: "s1" },
      });
    });

    it("通常メイン中の割り込み: そのメインを終了し（戻らない）、戻り先はイニシアチブ（spot 再算出）", () => {
      const current = { phase: "main", mainCombatantId: "a", spotCombatantId: null, interruptMainId: null, interruptReturn: null };
      expect(planInterruptStart(current, "x")).toEqual({
        endMainId: "a",
        interruptMainId: "x",
        interruptReturn: { phase: "initiative", spotId: null },
      });
    });

    it("挿入メイン中の割り込み（入れ子）: 現在の挿入メインを終了し、元の戻り先を引き継ぐ", () => {
      const current = { phase: "main", mainCombatantId: "b", spotCombatantId: null, interruptMainId: "b", interruptReturn: { phase: "initiative", spotId: "s1" } };
      expect(planInterruptStart(current, "c")).toEqual({
        endMainId: "b",
        interruptMainId: "c",
        interruptReturn: { phase: "initiative", spotId: "s1" },
      });
    });

    it("セットアップ中の割り込み: そのサブターン位置へ戻る", () => {
      const current = { phase: "setup", mainCombatantId: null, spotCombatantId: "s2", interruptMainId: null, interruptReturn: null };
      expect(planInterruptStart(current, "y")).toEqual({
        endMainId: null,
        interruptMainId: "y",
        interruptReturn: { phase: "setup", spotId: "s2" },
      });
    });
  });

  describe("planInterruptEnd()（退避したサブターン位置へ戻る計画）", () => {
    it("保存した spot があればそこへ（再算出しない）", () => {
      expect(planInterruptEnd({ phase: "initiative", spotId: "s1" }))
        .toEqual({ phase: "initiative", spotId: "s1", recomputeSpot: false });
    });

    it("spot が null のサブターン（通常メイン終了後のイニシアチブ）は spot を再算出する", () => {
      expect(planInterruptEnd({ phase: "initiative", spotId: null }))
        .toEqual({ phase: "initiative", spotId: null, recomputeSpot: true });
    });

    it("戻り先なし（頑健性）＝全 null・再算出なし", () => {
      expect(planInterruptEnd(null)).toEqual({ phase: null, spotId: null, recomputeSpot: false });
    });
  });

  describe("buildInterruptEndUpdate()（挿入メイン終了の記帳＝AR のみ・CS は据え置き）", () => {
    it("「終了」（AR 据え置き）＝記帳なし", () => {
      expect(buildInterruptEndUpdate({ actionRank: { value: 3 } }, { decrementAr: false })).toEqual({});
    });

    it("「AR を−1して終了」＝AR−1（CS には触れない）", () => {
      expect(buildInterruptEndUpdate({ actionRank: { value: 3 } }, { decrementAr: true }))
        .toEqual({ "system.actionRank.value": 2 });
    });

    it("AR 下限は 0", () => {
      expect(buildInterruptEndUpdate({ actionRank: { value: 0 } }, { decrementAr: true }))
        .toEqual({ "system.actionRank.value": 0 });
    });

    it("actionRank を持たないアクターは AR−1 指定でも記帳しない", () => {
      expect(buildInterruptEndUpdate({}, { decrementAr: true })).toEqual({});
    });

    it("どちらのボタンでも CSカレントには絶対に触れない", () => {
      expect(buildInterruptEndUpdate({ combatSpeed: { current: 5 }, actionRank: { value: 2 } }, { decrementAr: true }))
        .not.toHaveProperty("system.combatSpeed.current");
    });
  });
});
