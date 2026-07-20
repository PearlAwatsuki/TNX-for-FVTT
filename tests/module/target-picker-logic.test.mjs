import { describe, it, expect } from "vitest";
import {
  addTargets,
  removeTarget,
  moveTarget,
  toCheckRequestTargets,
} from "../../scripts/module/target-picker-logic.mjs";

const A = { uuid: "Actor.a", id: "a", name: "キャストA", img: "a.png" };
const B = { uuid: "Actor.b", id: "b", name: "キャストB", img: "b.png" };
const C = { uuid: "Actor.c", id: "c", name: "キャストC", img: "c.png" };

describe("addTargets()（対象の追加・2026-07-21）", () => {
  it("末尾に追加する", () => {
    expect(addTargets([A], [B]).map(t => t.uuid)).toEqual(["Actor.a", "Actor.b"]);
  });

  it("既にいる対象は重複させない（どのボタンからでも同じ）", () => {
    expect(addTargets([A, B], [B, C]).map(t => t.uuid)).toEqual(["Actor.a", "Actor.b", "Actor.c"]);
  });

  it("追加するもの同士の重複も畳む", () => {
    expect(addTargets([], [A, A, B]).map(t => t.uuid)).toEqual(["Actor.a", "Actor.b"]);
  });

  it("uuid・アクターID・名前・画像だけを持つ（アクターそのものを持ち回らない）", () => {
    expect(addTargets([], [{ ...A, extra: "x" }]))
      .toEqual([{ uuid: "Actor.a", actorId: "a", name: "キャストA", img: "a.png" }]);
  });

  it("uuid を持たないものは無視する", () => {
    expect(addTargets([], [{ name: "名無し" }, A]).map(t => t.uuid)).toEqual(["Actor.a"]);
  });

  it("元の配列を書き換えない", () => {
    const list = [A];
    addTargets(list, [B]);
    expect(list).toHaveLength(1);
  });

  it("空・null でも落ちない", () => {
    expect(addTargets(null, null)).toEqual([]);
    expect(addTargets([A], [])).toEqual([A]);
  });
});

describe("removeTarget()（対象の除去）", () => {
  it("指定した対象だけ外す", () => {
    expect(removeTarget([A, B, C], "Actor.b").map(t => t.uuid)).toEqual(["Actor.a", "Actor.c"]);
  });

  it("いない対象を指定しても変わらない", () => {
    expect(removeTarget([A], "Actor.z")).toEqual([A]);
  });

  it("元の配列を書き換えない", () => {
    const list = [A, B];
    removeTarget(list, "Actor.a");
    expect(list).toHaveLength(2);
  });
});

describe("moveTarget()（手動並び替え＝グリップのドラッグ）", () => {
  it("上へ動かす", () => {
    expect(moveTarget([A, B, C], 2, 0).map(t => t.uuid)).toEqual(["Actor.c", "Actor.a", "Actor.b"]);
  });

  it("下へ動かす", () => {
    expect(moveTarget([A, B, C], 0, 2).map(t => t.uuid)).toEqual(["Actor.b", "Actor.c", "Actor.a"]);
  });

  it("同じ位置・範囲外は変わらない", () => {
    expect(moveTarget([A, B], 0, 0).map(t => t.uuid)).toEqual(["Actor.a", "Actor.b"]);
    expect(moveTarget([A, B], 5, 0).map(t => t.uuid)).toEqual(["Actor.a", "Actor.b"]);
    expect(moveTarget([A, B], 0, 5).map(t => t.uuid)).toEqual(["Actor.a", "Actor.b"]);
  });

  it("元の配列を書き換えない", () => {
    const list = [A, B];
    moveTarget(list, 0, 1);
    expect(list[0].uuid).toBe("Actor.a");
  });
});

describe("toCheckRequestTargets()（判定要求カードの対象行への写像）", () => {
  it("uuid から ID を取り出して actorId / actorName にする", () => {
    expect(toCheckRequestTargets([A, B])).toEqual([
      { actorId: "a", actorName: "キャストA" },
      { actorId: "b", actorName: "キャストB" },
    ]);
  });

  it("トークン由来でも収集時のアクターIDを使う（uuid の末尾に頼らない）", () => {
    expect(toCheckRequestTargets([{ uuid: "Scene.s.Token.t.Actor.synthetic", actorId: "real", name: "N" }]))
      .toEqual([{ actorId: "real", actorName: "N" }]);
  });

  it("アクターIDが無ければ uuid の末尾で補う（旧データ互換）", () => {
    expect(toCheckRequestTargets([{ uuid: "Actor.z", name: "N" }]))
      .toEqual([{ actorId: "z", actorName: "N" }]);
  });

  it("空なら空", () => {
    expect(toCheckRequestTargets([])).toEqual([]);
    expect(toCheckRequestTargets(null)).toEqual([]);
  });
});
