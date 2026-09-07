/**
 * @fileoverview 隠匿値の表示(hideLabel)のテスト。
 *
 * 「制御値」(2026-09-07 ユーザー裁定): 隠匿値はキャラクターの制御値**そのもの**になる。
 * ただし**どの**制御値かは知覚判定で相手が使用したスートで決まるため、アイテム単体では
 * 確定しない——静的な表示では「解説参照」と同じくラベルで示す。
 *
 * 経緯: DataModel は当初から control を choices に持っていた(outfit-base.mjs の説明文も
 * 「なし/数値/解説参照/制御値 の 4 状態」と書いていた)が、シートの選択肢と表示側の分岐が
 * 追随しておらず、選ぶこともできず、仮に入っていても "-" と表示される状態だった。
 */

import { describe, it, expect } from "vitest";
import { hideLabel } from "../../scripts/module/outfit-view.mjs";

describe("hideLabel()（隠匿値の表示）", () => {
  it("数値はその値", () => {
    expect(hideLabel({ mode: "value", value: 3 })).toBe("3");
    expect(hideLabel({ mode: "value", value: 0 })).toBe("0");
  });

  it("実効値(total)があればそちらを優先する（改造・AE 込みの値を出す）", () => {
    expect(hideLabel({ mode: "value", value: 3, total: 5 })).toBe("5");
    // total が 0 でも「値がある」ので 0 を出す(?? で拾うため || と違い 0 が消えない)
    expect(hideLabel({ mode: "value", value: 3, total: 0 })).toBe("0");
  });

  it("解説参照はラベル", () => {
    expect(hideLabel({ mode: "reference" })).toBe("解説参照");
  });

  it("制御値はラベル（どの制御値かは知覚判定のスートで決まるため数値にできない）", () => {
    expect(hideLabel({ mode: "control" })).toBe("制御値");
    // value が残っていても制御値モードなら数値を出さない
    expect(hideLabel({ mode: "control", value: 7, total: 7 })).toBe("制御値");
  });

  it("なし・未設定は -", () => {
    expect(hideLabel({ mode: "none" })).toBe("-");
    expect(hideLabel(null)).toBe("-");
    expect(hideLabel(undefined)).toBe("-");
    expect(hideLabel({})).toBe("-");
  });

  it("数値モードで値が数でなければ 0 として出す", () => {
    expect(hideLabel({ mode: "value", value: NaN })).toBe("0");
    expect(hideLabel({ mode: "value" })).toBe("0");
  });
});
