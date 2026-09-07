/**
 * @fileoverview 正準名ブリッジの一回限り移行のテスト(2026-09-07)。
 *
 * この移行は既存ワールドのデータを書き換える——**間違えると卓のデータが壊れ、戻せない**。
 * 一回限りゲート(ワールド設定)の内側で走るため実機では 1 度しか観測できず、目視で確かめる
 * 機会が実質ない。冪等であること・対象外を巻き込まないことをここで固定する。
 *
 * 経緯: この移行は 2026-07-18 まで preCreateItem に常設で配線されており、移行済みかを区別せず
 * 技能名だけで用途を付け替えるため、辞典データが正当に持つ「判定」用途をインポートのたびに
 * 壊していた(常設経路への配線は撤去済み)。
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeSkillActions, CANONICAL_RETYPE_BY_NAME,
} from "../../scripts/core/usage-type-migration.mjs";

let n = 0;
const makeId = () => `id${++n}`;

/** 素の判定用途(移行の対象になる形)。 */
const checkUsage = (over = {}) => ({ _id: "u1", type: "check", name: "", ...over });

describe("canonicalizeSkillActions()（正準名 → 用途タイプ）", () => {
  it("正準名の技能は、素の判定用途を対応タイプへ付け替える", () => {
    for (const [name, type] of Object.entries(CANONICAL_RETYPE_BY_NAME)) {
      const out = canonicalizeSkillActions({ name, actions: [checkUsage()] }, makeId);
      expect(out).not.toBeNull();
      expect(out[0].type).toBe(type);
    }
  });

  it("冪等: 付け替え済みのデータをもう一度通しても変更なし(null)", () => {
    const once = canonicalizeSkillActions({ name: "回避", actions: [checkUsage()] }, makeId);
    expect(canonicalizeSkillActions({ name: "回避", actions: once }, makeId)).toBeNull();
  });

  it("固定値判定の用途は付け替えない（エキストラ等の固定値を判定タイプに化けさせない）", () => {
    expect(canonicalizeSkillActions(
      { name: "回避", actions: [checkUsage({ fixedResult: 7 })] }, makeId)).toBeNull();
    // 0 も「固定値が設定されている」ので対象外(偽値の取りこぼしを作らない)
    expect(canonicalizeSkillActions(
      { name: "回避", actions: [checkUsage({ fixedResult: 0 })] }, makeId)).toBeNull();
  });

  it("NPC取得の用途は付け替えない", () => {
    expect(canonicalizeSkillActions(
      { name: "信用", actions: [checkUsage({ npcAcquire: true })] }, makeId)).toBeNull();
  });

  it("判定以外のタイプは触らない（すでに別タイプの用途を上書きしない）", () => {
    expect(canonicalizeSkillActions(
      { name: "白兵", actions: [checkUsage({ type: "attack" })] }, makeId)).toBeNull();
  });

  it("正準名でない技能は何も変えない", () => {
    expect(canonicalizeSkillActions({ name: "情報：裏社会", actions: [checkUsage()] }, makeId)).toBeNull();
    expect(canonicalizeSkillActions({ actions: [checkUsage()] }, makeId)).toBeNull();
  });

  it("同じ技能の判定用途が複数あればすべて付け替える", () => {
    const out = canonicalizeSkillActions(
      { name: "回避", actions: [checkUsage({ _id: "a" }), checkUsage({ _id: "b" })] }, makeId);
    expect(out.map(a => a.type)).toEqual(["dodge", "dodge"]);
  });

  it("元の配列を書き換えない（呼び出し側が変更の有無で分岐できる）", () => {
    const actions = [checkUsage()];
    canonicalizeSkillActions({ name: "回避", actions }, makeId);
    expect(actions[0].type).toBe("check");
  });
});

describe("canonicalizeSkillActions()（操縦技能への用途追加）", () => {
  const operate = (actions = []) => ({ identificationKey: "operate_car", actions });

  it("移動・移動妨害の用途を追加する", () => {
    const out = canonicalizeSkillActions(operate(), makeId);
    expect(out.map(a => a.type)).toEqual(["move", "moveBlockReaction"]);
    // 名前は空(実効名は親アイテム名)・使用回数の消費先は親アイテム
    expect(out[0].name).toBe("");
    expect(out[0].consumeTargets).toEqual([{ type: "parent", itemId: "", amount: 1 }]);
    expect(out[0]._id).toBeTruthy();
  });

  it("冪等: 既にあるタイプは足さない(片方だけあれば残りだけ足す)", () => {
    const once = canonicalizeSkillActions(operate(), makeId);
    expect(canonicalizeSkillActions(operate(once), makeId)).toBeNull();

    const half = canonicalizeSkillActions(operate([{ _id: "x", type: "move" }]), makeId);
    expect(half.map(a => a.type)).toEqual(["move", "moveBlockReaction"]);
  });

  it("識別キーの prefix が operate でなければ足さない", () => {
    expect(canonicalizeSkillActions({ identificationKey: "society_underworld", actions: [] }, makeId))
      .toBeNull();
    expect(canonicalizeSkillActions({ actions: [] }, makeId)).toBeNull();
  });

  it("正準名と操縦は両立する（名前で付け替え、キーで追加）", () => {
    const out = canonicalizeSkillActions(
      { name: "回避", identificationKey: "operate_car", actions: [checkUsage()] }, makeId);
    expect(out.map(a => a.type)).toEqual(["dodge", "move", "moveBlockReaction"]);
  });

  it("用途を持たない技能・欠けた入力でも落ちない", () => {
    expect(canonicalizeSkillActions({ name: "回避" }, makeId)).toBeNull();
    expect(canonicalizeSkillActions(null, makeId)).toBeNull();
    expect(canonicalizeSkillActions(undefined, makeId)).toBeNull();
  });
});
