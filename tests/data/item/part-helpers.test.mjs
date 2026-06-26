import { describe, it, expect } from "vitest";
import {
  computePartOccupancy, formatOptionLabel, formatPartDesignation,
} from "../../../scripts/data/item/part-helpers.mjs";

/** body part 行を作るヘルパー */
const body = (value, slots = 1, extra = {}) => ({ kind: "bodyPart", value, slots, ...extra });
/** 準備済みアウトフィットを作るヘルパー */
const prepared = (part, extra = {}) => ({ isPrepared: true, part, ...extra });

describe("computePartOccupancy()", () => {
  it("基本: 占有を実スロットへ集計し used/free/over を返す", () => {
    const partSlots = [{ value: "片手持ち", count: 2 }, { value: "頭部", count: 1 }];
    const outfits = [prepared([body("片手持ち", 1)]), prepared([body("頭部", 1)])];
    const { slots } = computePartOccupancy(partSlots, outfits);
    const hand = slots.find((s) => s.label === "片手持ち");
    expect(hand).toMatchObject({ count: 2, used: 1, free: 1, over: false });
    expect(slots.find((s) => s.label === "頭部")).toMatchObject({ used: 1, free: 0, over: false });
  });

  it("超過: used > count で over=true・free は負", () => {
    const { slots } = computePartOccupancy(
      [{ value: "武器", count: 1 }],
      [prepared([body("武器", 2)])]
    );
    expect(slots[0]).toMatchObject({ count: 1, used: 2, free: -1, over: true });
  });

  it("エイリアス: 両手持ち=片手持ち×2 を実部位へ展開する(エイリアス自身は slot に出ない)", () => {
    const partSlots = [
      { value: "片手持ち", count: 2 },
      { value: "両手持ち", occupiesOther: true, targetPart: "片手持ち", targetCount: 2 },
    ];
    const { slots } = computePartOccupancy(partSlots, [prepared([body("両手持ち", 1)])]);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ label: "片手持ち", count: 2, used: 2, free: 0, over: false });
  });

  it("エイリアスは消費数倍率も掛かる(両手持ち×2 = 片手持ち4)", () => {
    const partSlots = [
      { value: "片手持ち", count: 2 },
      { value: "両手持ち", occupiesOther: true, targetPart: "片手持ち", targetCount: 2 },
    ];
    const { slots } = computePartOccupancy(partSlots, [prepared([body("両手持ち", 2)])]);
    expect(slots[0]).toMatchObject({ used: 4, over: true });
  });

  it("非消費: slots=0 は数えない", () => {
    const { slots } = computePartOccupancy([{ value: "武器", count: 1 }], [prepared([body("武器", 0)])]);
    expect(slots[0].used).toBe(0);
  });

  it("非消費: 小分類=住宅アクセサリは数えない", () => {
    const { slots } = computePartOccupancy(
      [{ value: "頭部", count: 1 }],
      [prepared([body("頭部", 1)], { minorCategory: "housingAccessory" })]
    );
    expect(slots[0].used).toBe(0);
  });

  it("非消費: 任意(部位全体 partOptional)は数えない", () => {
    const { slots, unlisted } = computePartOccupancy(
      [{ value: "指", count: 2 }],
      [prepared([body("指", 1)], { partOptional: true })]
    );
    expect(slots[0].used).toBe(0);
    expect(unlisted).toHaveLength(0);
  });

  it("準備していないアウトフィットは数えない", () => {
    const { slots } = computePartOccupancy(
      [{ value: "武器", count: 1 }],
      [{ isPrepared: false, part: [body("武器", 1)] }]
    );
    expect(slots[0].used).toBe(0);
  });

  it("relation=or: 装備先トグル(partOrChoice)で選んだ1行だけ占有", () => {
    const partSlots = [{ value: "片腕", count: 2 }, { value: "片脚", count: 2 }];
    const outfit = prepared([body("片腕", 1), body("片脚", 1)], { partRelation: "or", partOrChoice: 1 });
    const { slots } = computePartOccupancy(partSlots, [outfit]);
    expect(slots.find((s) => s.label === "片腕").used).toBe(0);
    expect(slots.find((s) => s.label === "片脚").used).toBe(1);
  });

  it("relation=and: 全行を占有(電脳+籠手)", () => {
    const partSlots = [{ value: "電脳", count: 1 }, { value: "籠手", count: 1 }];
    const outfit = prepared([body("電脳", 1), body("籠手", 1)], { partRelation: "and" });
    const { slots } = computePartOccupancy(partSlots, [outfit]);
    expect(slots.find((s) => s.label === "電脳").used).toBe(1);
    expect(slots.find((s) => s.label === "籠手").used).toBe(1);
  });

  it("解説参照: 実部位 refSubKind=bodyPart は占有に数える", () => {
    const outfit = prepared([{ kind: "reference", refSubKind: "bodyPart", value: "頭部", slots: 1 }]);
    const { slots } = computePartOccupancy([{ value: "頭部", count: 1 }], [outfit]);
    expect(slots[0].used).toBe(1);
  });

  it("オプション(kind=option)は身体スロットを占有しない(別系統)", () => {
    const outfit = prepared([{ kind: "option", hostMajor: "weapon", slots: 1 }]);
    const { slots } = computePartOccupancy([{ value: "武器", count: 1 }], [outfit]);
    expect(slots[0].used).toBe(0);
  });

  it("プリセット未掲載ラベルへの消費は unlisted に分離(非カウント枠)", () => {
    const { slots, unlisted } = computePartOccupancy(
      [{ value: "脳下垂体", count: 1 }],
      [prepared([body("下垂体", 1)])]
    );
    expect(slots[0].used).toBe(0);
    expect(unlisted).toEqual([{ label: "下垂体", used: 1 }]);
  });
});

const opt = (extra) => ({ kind: "option", slots: 1, ...extra });

describe("formatOptionLabel()", () => {
  it("大分類レベル(武器): 大分類名・小分類は括弧で絞る", () => {
    expect(formatOptionLabel(opt({ hostMajor: "weapon" }))).toBe("武器");
    expect(formatOptionLabel(opt({ hostMajor: "weapon", hostMinor: "melee" }))).toBe("武器(白兵武器)");
  });

  it("武器: 非消費(slots0)は名前直後・括弧の前に数字(武器0(白兵武器))", () => {
    expect(formatOptionLabel(opt({ hostMajor: "weapon", hostMinor: "melee", slots: 0 }))).toBe("武器0(白兵武器)");
  });

  it("武器: 除外は括弧内『以外』(武器(搭載兵器以外))", () => {
    expect(formatOptionLabel(opt({ hostMajor: "weapon", hostMinor: "mounted", hostMinorExclude: true })))
      .toBe("武器(搭載兵器以外)");
  });

  it("武器: その他特徴は括弧(武器(レーザー武器))", () => {
    expect(formatOptionLabel(opt({ hostMajor: "weapon", hostFeature: "isLaser" }))).toBe("武器(レーザー武器)");
  });

  it("小分類レベル(ヴィークル): 小分類名のまま(船舶。ヴィークル(船舶)ではない)", () => {
    expect(formatOptionLabel(opt({ hostMajor: "vehicle", hostMinor: "ship" }))).toBe("船舶");
  });

  it("小分類レベル: タップ / IANUS", () => {
    expect(formatOptionLabel(opt({ hostMajor: "tron", hostMinor: "tap" }))).toBe("タップ");
    expect(formatOptionLabel(opt({ hostMajor: "cyberware", hostMinor: "ianus" }))).toBe("IANUS");
  });

  it("アイテム名あり: 名前を表示(数字も付く)", () => {
    expect(formatOptionLabel(opt({ hostName: "アサルトナーヴス" }))).toBe("アサルトナーヴス");
    expect(formatOptionLabel(opt({ hostName: "アサルトナーヴス", slots: 0 }))).toBe("アサルトナーヴス0");
  });
});

describe("formatPartDesignation()", () => {
  const bp = (value, slots = 1, extra = {}) => ({ kind: "bodyPart", value, slots, ...extra });

  it("単一: 部位名のみ。身体部位は数字を付けない(片手持ち2 とはしない)", () => {
    expect(formatPartDesignation([bp("頭部")])).toBe("頭部");
    expect(formatPartDesignation([bp("片手持ち", 2)])).toBe("片手持ち");
  });

  it("and: 「A+B」(電脳+籠手)", () => {
    expect(formatPartDesignation([bp("電脳"), bp("籠手")], "and")).toBe("電脳+籠手");
  });

  it("or 身体部位: 「A、もしくはB」", () => {
    expect(formatPartDesignation([bp("片腕"), bp("片脚")], "or")).toBe("片腕、もしくは片脚");
  });

  it("or スロット持ちホスト(オプション): 「A／B」", () => {
    const part = [opt({ hostMajor: "tron", hostMinor: "pocketron" }), opt({ hostMajor: "tron", hostMinor: "tap" })];
    expect(formatPartDesignation(part, "or")).toBe("ポケットロン／タップ");
  });

  it("任意(部位全体): 「任意(指)」/ 素の任意は「任意」", () => {
    expect(formatPartDesignation([bp("指")], "and", true)).toBe("任意(指)");
    expect(formatPartDesignation([], "and", true)).toBe("任意");
  });

  it("任意＋その他: 「任意(武器、防具など)」(任意は part 全体・その他は行)", () => {
    const part = [
      { kind: "other", value: "" },
      opt({ hostMajor: "weapon" }),
      opt({ hostMajor: "armor" }),
    ];
    expect(formatPartDesignation(part, "or", true)).toBe("任意(武器、防具など)");
  });

  it("解説参照は常に「解説参照」", () => {
    expect(formatPartDesignation([{ kind: "reference", refSubKind: "bodyPart", value: "頭部", slots: 1 }]))
      .toBe("解説参照");
  });

  it("部位なし(none/空)は「-」", () => {
    expect(formatPartDesignation([])).toBe("-");
    expect(formatPartDesignation([{ kind: "none" }])).toBe("-");
  });
});
