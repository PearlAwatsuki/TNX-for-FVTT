import { describe, it, expect } from "vitest";
import {
  NEW_EFFECT_KEY,
  effectSourceKey,
  parseEffectSourceKey,
  buildEffectSourceGroups,
  describeEffectData,
} from "../../scripts/module/effect-source-logic.mjs";

describe("effectSourceKey() / parseEffectSourceKey()（付与元の1値エンコード・2026-07-21）", () => {
  it("プリセットはジャーナルIDとプリセットIDを持つ", () => {
    const key = effectSourceKey("preset", "j1", "p1");
    expect(parseEffectSourceKey(key)).toEqual({ kind: "preset", a: "j1", b: "p1" });
  });

  it("アイテムの効果は uuid と効果IDを持つ", () => {
    const key = effectSourceKey("item", "Actor.a.Item.i", "e1");
    expect(parseEffectSourceKey(key)).toEqual({ kind: "item", a: "Actor.a.Item.i", b: "e1" });
  });

  it("新規作成は単独のキー", () => {
    expect(parseEffectSourceKey(NEW_EFFECT_KEY)).toEqual({ kind: "new", a: "", b: "" });
  });

  it("uuid に区切り文字が含まれても壊れない", () => {
    const uuid = "Scene.s.Token.t.Actor.a.Item.i";
    expect(parseEffectSourceKey(effectSourceKey("item", uuid, "e"))).toEqual({
      kind: "item", a: uuid, b: "e",
    });
  });

  it("空・不正な値は null", () => {
    expect(parseEffectSourceKey("")).toBeNull();
    expect(parseEffectSourceKey(null)).toBeNull();
    expect(parseEffectSourceKey("item")).toBeNull();
  });
});

describe("buildEffectSourceGroups()（付与元プルダウンのグループ化）", () => {
  it("アクトのプリセットをジャーナルごとのグループにする", () => {
    const groups = buildEffectSourceGroups({
      presetGroups: [{ label: "第1幕", journalId: "j1", presets: [{ id: "p1", label: "罠" }] }],
    });
    expect(groups).toEqual([
      { label: "第1幕", options: [{ value: "preset|j1|p1", label: "罠" }] },
    ]);
  });

  it("アクターの所持アイテムの効果をアクターごとにまとめる", () => {
    const groups = buildEffectSourceGroups({
      actorGroups: [{
        label: "敵A",
        items: [{ uuid: "Actor.a.Item.i", name: "毒牙", effects: [{ id: "e1", name: "麻痺" }] }],
      }],
    });
    expect(groups).toEqual([
      { label: "敵A", options: [{ value: "item|Actor.a.Item.i|e1", label: "麻痺（毒牙）" }] },
    ]);
  });

  it("効果名とアイテム名が同じならアイテム名を添えない", () => {
    const groups = buildEffectSourceGroups({
      worldItems: [{ uuid: "Item.w", name: "呪い", effects: [{ id: "e1", name: "呪い" }] }],
    });
    expect(groups[0].options).toEqual([{ value: "item|Item.w|e1", label: "呪い" }]);
  });

  it("ワールドアイテムは1つのグループにまとめる", () => {
    const groups = buildEffectSourceGroups({
      worldItems: [
        { uuid: "Item.w1", name: "A", effects: [{ id: "e1", name: "X" }] },
        { uuid: "Item.w2", name: "B", effects: [{ id: "e2", name: "Y" }] },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("ワールドのアイテム");
    expect(groups[0].options).toHaveLength(2);
  });

  it("1アイテムが複数の効果を持てば全部出す", () => {
    const groups = buildEffectSourceGroups({
      worldItems: [{ uuid: "Item.w", name: "罠", effects: [{ id: "e1", name: "X" }, { id: "e2", name: "Y" }] }],
    });
    expect(groups[0].options.map(o => o.label)).toEqual(["X（罠）", "Y（罠）"]);
  });

  it("効果を持たないアイテム・空のグループは出さない", () => {
    const groups = buildEffectSourceGroups({
      presetGroups: [{ label: "空の幕", journalId: "j0", presets: [] }],
      actorGroups: [{ label: "敵B", items: [{ uuid: "Actor.b.Item.j", name: "素手", effects: [] }] }],
      worldItems: [],
    });
    expect(groups).toEqual([]);
  });

  it("プリセット→アクター→ワールドの順に並べる", () => {
    const groups = buildEffectSourceGroups({
      presetGroups: [{ label: "幕", journalId: "j", presets: [{ id: "p", label: "P" }] }],
      actorGroups: [{ label: "敵", items: [{ uuid: "Actor.a.Item.i", name: "I", effects: [{ id: "e", name: "E" }] }] }],
      worldItems: [{ uuid: "Item.w", name: "W", effects: [{ id: "e", name: "E" }] }],
    });
    expect(groups.map(g => g.label)).toEqual(["幕", "敵", "ワールドのアイテム"]);
  });

  it("効果が未設定のプリセットは選べないので出さない", () => {
    const groups = buildEffectSourceGroups({
      presetGroups: [{
        label: "幕", journalId: "j",
        presets: [{ id: "p1", label: "未設定", empty: true }, { id: "p2", label: "設定済" }],
      }],
    });
    expect(groups[0].options).toEqual([{ value: "preset|j|p2", label: "設定済" }]);
  });

  it("引数なしでも落ちない", () => {
    expect(buildEffectSourceGroups()).toEqual([]);
  });
});

describe("describeEffectData()（効果プリセットの要約表示・2026-07-21）", () => {
  const LABELS = { panic: "恐慌", faint: "気絶" };

  it("状態を表示ラベルで並べる", () => {
    expect(describeEffectData({ statuses: ["panic"] }, LABELS)).toBe("恐慌");
  });

  it("変更の件数を出す", () => {
    expect(describeEffectData({ changes: [{ key: "a" }, { key: "b" }] })).toBe("変更 2 件");
  });

  it("状態と変更を併記する", () => {
    expect(describeEffectData({ statuses: ["panic"], changes: [{ key: "a" }] }, LABELS))
      .toBe("恐慌 ／ 変更 1 件");
  });

  it("付与マーカーは表示しない（内部の印であって状態ではない）", () => {
    expect(describeEffectData({ statuses: ["tnx-applied"], changes: [{ key: "a" }] })).toBe("変更 1 件");
  });

  it("ラベルの無い状態はそのまま出さず数で表す（内部キーを見せない）", () => {
    expect(describeEffectData({ statuses: ["unknown-thing"] })).toBe("状態 1 件");
  });

  it("中身が無ければ空文字", () => {
    expect(describeEffectData({})).toBe("");
    expect(describeEffectData(null)).toBe("");
  });
});
