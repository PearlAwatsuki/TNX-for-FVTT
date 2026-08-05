import { describe, it, expect } from "vitest";
import {
  isValidProcessTransition, arDecrement, planAdvance,
  buildArDecrementUpdate, buildWaitUpdate, buildSetupConfirmUpdate,
  pushInterruptFrame, popInterruptFrame,
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
  it("セットアップ→イニシアチブ（記帳フラグは持たず遷移先のみ・記帳は advancePhase 側）", () => {
    expect(planAdvance("setup", [P()])).toEqual({ to: "initiative" });
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

  it("メイン→イニシアチブへ戻る（メジャー記帳は majorActed 側・plan は遷移先のみ）", () => {
    expect(planAdvance("main", [P()])).toEqual({ to: "initiative" });
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

describe("記帳の更新オブジェクト（Combat_Flow §4-6・2026-07-26 一般則）", () => {
  it("AR 消費＝AR−1 かつ CSカレント0（AR減少⟺CS0・メジャー終了と行動不能で共通）", () => {
    expect(buildArDecrementUpdate({ actionRank: { value: 2 } })).toEqual({
      "system.actionRank.value": 1,
      "system.combatSpeed.current": 0,
    });
    expect(buildArDecrementUpdate({ actionRank: { value: 1 } })).toEqual({
      "system.actionRank.value": 0,
      "system.combatSpeed.current": 0,
    });
  });

  it("待機（候補の操作者の宣言）＝CSカレント1", () => {
    expect(buildWaitUpdate()).toEqual({ "system.combatSpeed.current": 1 });
  });

  it("セットアップ末確定＝current ← valueTotal ＋ currentBuff", () => {
    expect(buildSetupConfirmUpdate({ combatSpeed: { valueTotal: 5, currentBuff: 2 } }))
      .toEqual({ "system.combatSpeed.current": 7 });
    expect(buildSetupConfirmUpdate({})).toEqual({});
  });

  it("actionRank を持たないアクターは記帳しない（AR 減少が無いので CS0 もない）", () => {
    expect(buildArDecrementUpdate({})).toEqual({});
  });
});

describe("割り込み（挿入メイン）＝サスペンド／レジューム＋consumesAr（2026-07-26 全面改訂）", () => {
  // 現在の進行状態(combat フラグと同形)。interruptConsumesAr は「現在走っている挿入メインが AR を
  // 消費するか」= 素の(無所有)プロセスや通常メインを走っているときは null。
  const CUR = (over = {}) => ({
    phase: "initiative", mainCombatantId: null, spotCombatantId: "s1",
    majorActed: [], interruptConsumesAr: null, ...over,
  });

  describe("pushInterruptFrame()（現在の進行を退避し、挿入メインへ入る）", () => {
    it("サブターン（イニシアチブ）中の自己割り込み: 現在位置を退避し、挿入メインは consumesAr=真", () => {
      const { frame, next } = pushInterruptFrame(
        CUR({ spotCombatantId: "s1", majorActed: ["m0"] }), "x", true);
      // 退避フレーム＝そのまま復帰できる完全な状態(親の consumesAr=null=素のプロセス)
      expect(frame).toEqual({
        phase: "initiative", mainCombatantId: null, spotCombatantId: "s1",
        majorActed: ["m0"], consumesAr: null,
      });
      // 挿入メイン＝メインプロセス・majorActed は新規・consumesAr は付与された値
      expect(next).toEqual({
        phase: "main", mainCombatantId: "x", spotCombatantId: null,
        majorActed: [], interruptConsumesAr: true,
      });
    });

    it("通常メイン中に割り込み: 元のメインは終了せず退避される（あとで戻る）", () => {
      const { frame, next } = pushInterruptFrame(
        CUR({ phase: "main", mainCombatantId: "a", spotCombatantId: null, majorActed: ["a"] }), "x", true);
      expect(frame).toEqual({
        phase: "main", mainCombatantId: "a", spotCombatantId: null,
        majorActed: ["a"], consumesAr: null,
      });
      expect(next.mainCombatantId).toBe("x");
      expect(next.majorActed).toEqual([]);
    });

    it("挿入メイン中の入れ子: 親挿入メインの consumesAr を退避フレームに引き継ぐ", () => {
      const { frame, next } = pushInterruptFrame(
        CUR({ phase: "main", mainCombatantId: "b", spotCombatantId: null, majorActed: ["b"], interruptConsumesAr: true }),
        "c", false);
      expect(frame.consumesAr).toBe(true);           // 親挿入メイン(b)の consumesAr を保存
      expect(next.mainCombatantId).toBe("c");
      expect(next.interruptConsumesAr).toBe(false);   // 追加行動＝無償
    });

    it("consumesAr は厳密に真のときだけ真（頑健性・既定の解決は combat 側）", () => {
      expect(pushInterruptFrame(CUR(), "x", undefined).next.interruptConsumesAr).toBe(false);
      expect(pushInterruptFrame(CUR(), "x", false).next.interruptConsumesAr).toBe(false);
      expect(pushInterruptFrame(CUR(), "x", true).next.interruptConsumesAr).toBe(true);
    });
  });

  describe("popInterruptFrame()（挿入メイン終了→退避した進行位置を復元）", () => {
    it("退避フレームをそのまま復元する（spot 再算出はしない＝正確な位置を保存済み）", () => {
      const stack = [{ phase: "initiative", mainCombatantId: null, spotCombatantId: "s1", majorActed: ["m0"], consumesAr: null }];
      const { restore, remaining } = popInterruptFrame(stack);
      expect(restore).toEqual({
        phase: "initiative", mainCombatantId: null, spotCombatantId: "s1",
        majorActed: ["m0"], interruptConsumesAr: null,
      });
      expect(remaining).toEqual([]);
    });

    it("入れ子は先頭（最後に積んだフレーム）から戻り、残りを保つ", () => {
      const frameA = { phase: "main", mainCombatantId: "a", spotCombatantId: null, majorActed: ["a"], consumesAr: null };
      const frameB = { phase: "main", mainCombatantId: "b", spotCombatantId: null, majorActed: ["b"], consumesAr: true };
      const { restore, remaining } = popInterruptFrame([frameA, frameB]);
      expect(restore.mainCombatantId).toBe("b");           // 直近の親(b)へ戻る
      expect(restore.interruptConsumesAr).toBe(true);      // b の consumesAr を復元
      expect(remaining).toEqual([frameA]);                 // a はまだ退避されたまま
    });

    it("空スタック（頑健性）＝全 null・空 majorActed", () => {
      expect(popInterruptFrame([])).toEqual({
        restore: { phase: null, mainCombatantId: null, spotCombatantId: null, majorActed: [], interruptConsumesAr: null },
        remaining: [],
      });
    });

    it("入力配列を破壊しない（pop は複製に対して行う）", () => {
      const stack = [{ phase: "main", mainCombatantId: "a", majorActed: [], consumesAr: null }];
      popInterruptFrame(stack);
      expect(stack).toHaveLength(1);
    });
  });
});
