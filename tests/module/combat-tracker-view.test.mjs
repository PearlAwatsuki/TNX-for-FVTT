import { describe, it, expect } from "vitest";
import { processLabel, footerPlan, rowActions } from "../../scripts/rules/combat-tracker-view.mjs";

describe("processLabel()（フェーズの日本語ラベル）", () => {
  it("各フェーズのラベルを返す", () => {
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

describe("footerPlan()（フッター＝「次へ」＋フェーズ送り＋開始/終了）", () => {
  const base = {
    hasCombat: true, started: true, phase: null, isGM: true,
    isMainOwner: false, isSpotOwner: false, candidateName: null,
  };

  it("カット進行が無ければ空（作成はヘッダー）", () => {
    expect(footerPlan({ ...base, hasCombat: false })).toEqual([]);
  });

  it("未開始＝RL にカット進行の開始", () => {
    expect(footerPlan({ ...base, started: false })).toEqual([
      { action: "tnxStartCombat", label: "カット進行の開始", primary: true },
    ]);
    expect(footerPlan({ ...base, started: false, isGM: false })).toEqual([]);
  });

  it("履歴があれば RL の進行操作の先頭に戻るボタンを出す", () => {
    expect(footerPlan({ ...base, phase: "setup", canRewind: true })).toEqual([
      { action: "tnxRewind", label: "戻る" },
      { action: "tnxAdvance", label: "次へ", primary: true },
      { action: "tnxPhase", label: "イニシアチブへ" },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("セットアップ（RL）＝次へ＋イニシアチブへ＋終了", () => {
    expect(footerPlan({ ...base, phase: "setup" })).toEqual([
      { action: "tnxAdvance", label: "次へ", primary: true },
      { action: "tnxPhase", label: "イニシアチブへ" },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("イニシアチブ（RL）＝次へ＋メインプロセスへ（候補名）＋終了", () => {
    expect(footerPlan({ ...base, phase: "initiative", candidateName: "カスミ" })).toEqual([
      { action: "tnxAdvance", label: "次へ", primary: true },
      { action: "tnxPhase", label: "メインプロセスへ（カスミ）" },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("イニシアチブ（RL・候補なし）＝フェーズ送りはクリンナップへ", () => {
    expect(footerPlan({ ...base, phase: "initiative" })).toEqual([
      { action: "tnxAdvance", label: "次へ", primary: true },
      { action: "tnxPhase", label: "クリンナップへ" },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("メイン（RL）＝手番終了＋終了（メジャー未実行も「何もしないメジャー」＝分岐なし・2026-07-22 裁定）", () => {
    expect(footerPlan({ ...base, phase: "main" })).toEqual([
      { action: "tnxAdvance", label: "手番終了", primary: true },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("クリンナップ（RL）＝次へ＋次カットへ＋終了", () => {
    expect(footerPlan({ ...base, phase: "cleanup" })).toEqual([
      { action: "tnxAdvance", label: "次へ", primary: true },
      { action: "tnxPhase", label: "次カットへ" },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("メイン＝手番キャラの操作者（非GM）に手番終了（行動権を渡す）", () => {
    expect(footerPlan({ ...base, isGM: false, isMainOwner: true, phase: "main" })).toEqual([
      { action: "tnxAdvance", label: "手番終了", primary: true },
    ]);
  });

  it("サブターン＝スポットの操作者（非GM）に次へ（プロセスの行動権を渡す）", () => {
    for (const phase of ["setup", "initiative", "cleanup"]) {
      expect(footerPlan({ ...base, isGM: false, isSpotOwner: true, phase })).toEqual([
        { action: "tnxAdvance", label: "次へ", primary: true },
      ]);
    }
  });

  it("自分の番でないプレイヤーには何も出ない", () => {
    expect(footerPlan({ ...base, isGM: false, phase: "main" })).toEqual([]);
    expect(footerPlan({ ...base, isGM: false, phase: "setup" })).toEqual([]);
  });
});

describe("rowActions: interrupt without a grant", () => {
  it.each(["setup", "initiative", "main", "cleanup"])("offers interrupt in %s", phase => {
    for (const permissions of [{isOwner: true}, {isGM: true}]) {
      expect(rowActions({phase, started: true, ...permissions}).map(a => a.action)).toEqual(["tnxInterrupt"]);
    }
  });
  it("requires ownership or GM and a started combat", () => {
    expect(rowActions({phase: "main", started: true})).toEqual([]);
    expect(rowActions({phase: "main", started: false, isGM: true})).toEqual([]);
  });
  it("retains wait alongside interrupt for the initiative candidate", () => {
    expect(rowActions({phase: "initiative", started: true, isCandidate: true, isOwner: true}).map(a => a.action))
      .toEqual(["tnxWait", "tnxInterrupt"]);
  });
});

describe("footerPlan()（挿入メイン中＝「割り込みを終了」1本・通常メインの手番終了は出さない・2026-07-26）", () => {
  const base = {
    hasCombat: true, started: true, phase: "main", isGM: true,
    isMainOwner: false, isSpotOwner: false, candidateName: null, isInterruptMain: true,
  };

  it("RL＝割り込みを終了＋カット進行の終了（手番終了は出さない・AR 消費は consumesAr で自動判定）", () => {
    expect(footerPlan(base)).toEqual([
      { action: "tnxInterruptEnd", label: "割り込みを終了", primary: true },
      { action: "tnxEndCombat", label: "カット進行の終了" },
    ]);
  });

  it("挿入メインの操作者（非GM）＝割り込みを終了のみ", () => {
    expect(footerPlan({ ...base, isGM: false, isMainOwner: true })).toEqual([
      { action: "tnxInterruptEnd", label: "割り込みを終了", primary: true },
    ]);
  });

  it("挿入メインでも操作者でない非GMには出さない", () => {
    expect(footerPlan({ ...base, isGM: false, isMainOwner: false })).toEqual([]);
  });
});
