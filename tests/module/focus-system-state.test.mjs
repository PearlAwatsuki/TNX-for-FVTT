import { describe, it, expect } from "vitest";
import {
  activeProgressRow,
  clampGauge,
  gaugeMarkers,
  buildFocusSystemSnapshot,
} from "../../scripts/module/focus-system-logic.mjs";

const ROWS = [
  { id: "a", threshold: 0, skillKey: "hacking",  targetValue: 12 },
  { id: "b", threshold: 3, skillKey: "research", targetValue: 15 },
  { id: "c", threshold: 5, skillKey: "cracking", targetValue: 18 },
  { id: "d", threshold: 8, skillKey: "wizardry", targetValue: 20 },
];

describe("activeProgressRow()（判定行の切り替え・ルール8/9/12）", () => {
  it("初期値の行は進行値0の時点で有効", () => {
    expect(activeProgressRow(ROWS, 0).id).toBe("a");
  });

  it("閾値ちょうどで切り替わる（2026-07-20 裁定＝閾値 ≦ 現在進行値）", () => {
    expect(activeProgressRow(ROWS, 2).id).toBe("a");
    expect(activeProgressRow(ROWS, 3).id).toBe("b");
    expect(activeProgressRow(ROWS, 4).id).toBe("b");
    expect(activeProgressRow(ROWS, 5).id).toBe("c");
  });

  it("飛ばされた行は無視される（初期値から一気に5まで進んだら3の行は使われない）", () => {
    expect(activeProgressRow(ROWS, 5).id).toBe("c");
    expect(activeProgressRow(ROWS, 9).id).toBe("d");
  });

  it("並び順に依存しない（閾値が最大の行を選ぶ）", () => {
    const shuffled = [ROWS[2], ROWS[0], ROWS[3], ROWS[1]];
    expect(activeProgressRow(shuffled, 5).id).toBe("c");
  });

  it("行が無ければ null", () => {
    expect(activeProgressRow([], 3)).toBeNull();
    expect(activeProgressRow(null, 3)).toBeNull();
  });

  it("どの閾値にも達していなければ null", () => {
    expect(activeProgressRow([{ id: "x", threshold: 5 }], 3)).toBeNull();
  });
});

describe("clampGauge()（ゲージの現在値）", () => {
  it("0以上・最大値以下に収める", () => {
    expect(clampGauge(5, 10)).toBe(5);
    expect(clampGauge(-3, 10)).toBe(0);
    expect(clampGauge(14, 10)).toBe(10);
  });

  it("最大値が0以下なら0", () => {
    expect(clampGauge(5, 0)).toBe(0);
  });

  it("非数は0", () => {
    expect(clampGauge(NaN, 10)).toBe(0);
    expect(clampGauge(undefined, 10)).toBe(0);
  });
});

describe("gaugeMarkers()（進行値ゲージの切り替わりポイント）", () => {
  it("閾値の位置を割合（%）で返す", () => {
    expect(gaugeMarkers(ROWS, 10)).toEqual([
      { threshold: 0, percent: 0 },
      { threshold: 3, percent: 30 },
      { threshold: 5, percent: 50 },
      { threshold: 8, percent: 80 },
    ]);
  });

  it("最大値を超える閾値は含めない（ゲージの外に描かない）", () => {
    expect(gaugeMarkers(ROWS, 4).map(m => m.threshold)).toEqual([0, 3]);
  });

  it("最大値が0以下なら空", () => {
    expect(gaugeMarkers(ROWS, 0)).toEqual([]);
  });
});

describe("buildFocusSystemSnapshot()（起動時のスナップショット）", () => {
  const page = {
    name: "ハッキング",
    system: {
      restriction: "タップを準備していること",
      defeatCondition: { type: "cut", text: "", cutLimit: 6 },
      defeatEffect: "肉体ダメージ10",
      targetProgress: 20,
      supportSkillKey: "info",
      rows: ROWS,
      memo: "メモ",
    },
  };

  it("ページ名を FS 名として取り込む", () => {
    expect(buildFocusSystemSnapshot(page).name).toBe("ハッキング");
  });

  it("設定を写し取り、進行状態を0から始める", () => {
    const s = buildFocusSystemSnapshot(page);
    expect(s.targetProgress).toBe(20);
    expect(s.supportSkillKey).toBe("info");
    expect(s.rows).toHaveLength(4);
    expect(s.progress).toBe(0);
    expect(s.cut).toBe(0);
  });

  it("読み込み元のページを記録する（手動設定なら null）", () => {
    expect(buildFocusSystemSnapshot(page, { sourcePageUuid: "JournalEntry.a.JournalEntryPage.b" }).sourcePageUuid)
      .toBe("JournalEntry.a.JournalEntryPage.b");
    expect(buildFocusSystemSnapshot(page).sourcePageUuid).toBeNull();
  });

  it("id を持つ（実行中 FS の識別）", () => {
    expect(buildFocusSystemSnapshot(page, { id: "fs1" }).id).toBe("fs1");
  });

  it("ページを編集しても実行中の FS は変わらない（値のコピーであること）", () => {
    const s = buildFocusSystemSnapshot(page);
    s.rows[0].threshold = 99;
    expect(page.system.rows[0].threshold).toBe(0);
  });
});
