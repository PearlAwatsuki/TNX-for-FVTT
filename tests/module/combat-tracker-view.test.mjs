import { describe, it, expect } from "vitest";
import { processLabel, processActions, rowActions } from "../../scripts/module/combat-tracker-view.mjs";

describe("processLabel()（プロセスの日本語ラベル）", () => {
  it("各プロセスのラベルを返す", () => {
    expect(processLabel("setup")).toBe("セットアップ");
    expect(processLabel("initiative")).toBe("イニシアチブ");
    expect(processLabel("main")).toBe("メイン");
    expect(processLabel("cleanup")).toBe("クリンナップ");
  });

  it("未開始/不明は —", () => {
    expect(processLabel(null)).toBe("—");
    expect(processLabel("xxx")).toBe("—");
  });
});

describe("processActions()（プロセスごとの RL 進行ボタン）", () => {
  it("セットアップ→イニシアチブへ", () => {
    expect(processActions("setup")).toEqual([{ action: "tnxToInitiative", label: "イニシアチブへ" }]);
  });

  it("イニシアチブ→クリンナップへ", () => {
    expect(processActions("initiative")).toEqual([{ action: "tnxToCleanup", label: "クリンナップへ" }]);
  });

  it("メイン→メジャー有/無で終了の2択", () => {
    expect(processActions("main")).toEqual([
      { action: "tnxEndMainMajor", label: "メジャーで終了" },
      { action: "tnxEndMainMinor", label: "メジャーなしで終了" },
    ]);
  });

  it("クリンナップ→次カットへ", () => {
    expect(processActions("cleanup")).toEqual([{ action: "tnxNextCut", label: "次カットへ" }]);
  });

  it("未開始は空", () => {
    expect(processActions(null)).toEqual([]);
  });
});

describe("rowActions()（イニシアチブ中・行動可能キャラの行操作）", () => {
  it("イニシアチブ＋行動可能＝メイン/待機/行動不能", () => {
    expect(rowActions("initiative", true)).toEqual([
      { action: "tnxAssignMain", label: "メイン" },
      { action: "tnxWait", label: "待機" },
      { action: "tnxCantAct", label: "行動不能" },
    ]);
  });

  it("行動できないキャラ（エキストラ等）は行操作なし", () => {
    expect(rowActions("initiative", false)).toEqual([]);
  });

  it("イニシアチブ以外は行操作なし", () => {
    expect(rowActions("main", true)).toEqual([]);
    expect(rowActions("setup", true)).toEqual([]);
  });
});
