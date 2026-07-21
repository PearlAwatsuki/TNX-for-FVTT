import { describe, it, expect } from "vitest";
import {
  isValidProcessTransition, arDecrement,
  buildEndMainUpdate, buildCantActUpdate, buildWaitUpdate, buildCleanupUpdate,
  buildSetupConfirmUpdate,
} from "../../scripts/module/combat-progression.mjs";

describe("isValidProcessTransition()（カット進行のプロセス遷移・Combat_Flow §2-6）", () => {
  it("カット進行の正規の遷移を許可する", () => {
    expect(isValidProcessTransition(null, "setup")).toBe(true);        // カット開始
    expect(isValidProcessTransition("prep", "setup")).toBe(true);      // 戦闘準備→セットアップ
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
  it("メジャー実行後は AR−1・CSカレント0（メインプロセス終了時）", () => {
    expect(buildEndMainUpdate({ actionRank: { value: 2 } }, { didMajor: true })).toEqual({
      "system.actionRank.value": 1,
      "system.combatSpeed.current": 0,
    });
  });

  it("メジャー未実行でメインプロセスを終えたら記帳なし（AR/CSは動かない）", () => {
    expect(buildEndMainUpdate({ actionRank: { value: 2 } }, { didMajor: false })).toEqual({});
  });

  it("イニシアチブで行動不能は AR−1（§4）", () => {
    expect(buildCantActUpdate({ actionRank: { value: 1 } })).toEqual({ "system.actionRank.value": 0 });
  });

  it("待機は CSカレント1（§4）", () => {
    expect(buildWaitUpdate()).toEqual({ "system.combatSpeed.current": 1 });
  });

  it("クリンナップは AR 全回復＝付与値 maxTotal（§6）", () => {
    expect(buildCleanupUpdate({ actionRank: { maxTotal: 3 } })).toEqual({ "system.actionRank.value": 3 });
  });

  it("actionRank を持たないアクターは記帳しない（空オブジェクト）", () => {
    expect(buildCantActUpdate({})).toEqual({});
    expect(buildCleanupUpdate({})).toEqual({});
    expect(buildEndMainUpdate({}, { didMajor: true })).toEqual({ "system.combatSpeed.current": 0 });
  });
});

describe("buildSetupConfirmUpdate()（セットアップ末の CSカレント確定＝CS＋CSカレントバフの焼き込み）", () => {
  it("current ← valueTotal ＋ currentBuff（CS実効値＋セットアップバフ）", () => {
    expect(buildSetupConfirmUpdate({ combatSpeed: { valueTotal: 5, currentBuff: 2 } }))
      .toEqual({ "system.combatSpeed.current": 7 });
  });

  it("バフが無ければ current ← valueTotal", () => {
    expect(buildSetupConfirmUpdate({ combatSpeed: { valueTotal: 5 } }))
      .toEqual({ "system.combatSpeed.current": 5 });
  });

  it("値が未定義なら 0 で埋める（combatSpeed はあるが空）", () => {
    expect(buildSetupConfirmUpdate({ combatSpeed: {} }))
      .toEqual({ "system.combatSpeed.current": 0 });
  });

  it("combatSpeed を持たないアクターは記帳しない", () => {
    expect(buildSetupConfirmUpdate({})).toEqual({});
    expect(buildSetupConfirmUpdate(null)).toEqual({});
  });
});
