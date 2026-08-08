import { describe, it, expect } from "vitest";
import { moveItemBy, moveItemTo } from "../../scripts/module/list-order.mjs";

const LIST = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("moveItemBy()（上下ボタンの並び替え・非破壊）", () => {
  it("+1 で下へ・-1 で上へ動く", () => {
    expect(moveItemBy(LIST, "b", 1).map(x => x.id)).toEqual(["a", "c", "b", "d"]);
    expect(moveItemBy(LIST, "c", -1).map(x => x.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("端でクランプする（先頭の-1・末尾の+1 は変化なし）", () => {
    expect(moveItemBy(LIST, "a", -1).map(x => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(moveItemBy(LIST, "d", 1).map(x => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("見つからない id は変化なし・元配列は破壊しない", () => {
    expect(moveItemBy(LIST, "zz", 1).map(x => x.id)).toEqual(["a", "b", "c", "d"]);
    moveItemBy(LIST, "b", 1);
    expect(LIST.map(x => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("moveItemTo()（ドラッグ＆ドロップの並び替え・FS エディタと同じ挿入意味論）", () => {
  it("抜いてから指定 index に挿入する（下方向）", () => {
    expect(moveItemTo(LIST, "a", 2).map(x => x.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("上方向へも動く", () => {
    expect(moveItemTo(LIST, "d", 0).map(x => x.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("同じ位置へのドロップ・不明 id は変化なし", () => {
    expect(moveItemTo(LIST, "b", 1).map(x => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(moveItemTo(LIST, "zz", 0).map(x => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("範囲外 index はクランプする", () => {
    expect(moveItemTo(LIST, "a", 99).map(x => x.id)).toEqual(["b", "c", "d", "a"]);
    expect(moveItemTo(LIST, "c", -5).map(x => x.id)).toEqual(["c", "a", "b", "d"]);
  });
});
