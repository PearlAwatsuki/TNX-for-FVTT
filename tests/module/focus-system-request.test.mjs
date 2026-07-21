import { describe, it, expect } from "vitest";
import {
  buildProgressRequest,
  buildSupportRequest,
} from "../../scripts/module/focus-system-request-logic.mjs";

const FS = {
  id: "fs1",
  supportSkillKeys: ["info", "negotiation"],
  targetProgress: 20,
  progress: 0,
  rows: [
    { id: "a", threshold: 0, skillKeys: ["hacking"],  targetValue: 12 },
    { id: "b", threshold: 3, skillKeys: ["research"], targetValue: 15 },
    { id: "c", threshold: 5, skillKeys: ["cracking"], targetValue: 18 },
  ],
};

describe("buildProgressRequest()（進行判定の要求・ルール14）", () => {
  it("有効行の技能（複数可）と目標値を使う", () => {
    expect(buildProgressRequest(FS)).toEqual({
      identificationKeys: ["hacking"],
      targetValue: 12,
      focusSystemId: "fs1",
      kind: "progress",
    });
  });

  it("進行値が進んで行が切り替わると要求も変わる", () => {
    expect(buildProgressRequest({ ...FS, progress: 3 }).identificationKeys).toEqual(["research"]);
    expect(buildProgressRequest({ ...FS, progress: 3 }).targetValue).toBe(15);
    expect(buildProgressRequest({ ...FS, progress: 6 }).identificationKeys).toEqual(["cracking"]);
  });

  it("技能を複数指定した行はすべて渡す（2026-07-21）", () => {
    const fs = { ...FS, rows: [{ threshold: 0, skillKeys: ["a", "b"], targetValue: 10 }] };
    expect(buildProgressRequest(fs).identificationKeys).toEqual(["a", "b"]);
  });

  it("旧・単数の skillKey の行も読める", () => {
    const fs = { ...FS, rows: [{ threshold: 0, skillKey: "hacking", targetValue: 10 }] };
    expect(buildProgressRequest(fs).identificationKeys).toEqual(["hacking"]);
  });

  it("有効行が無ければ null", () => {
    expect(buildProgressRequest({ ...FS, rows: [] })).toBeNull();
    expect(buildProgressRequest({ ...FS, rows: [{ threshold: 5, skillKeys: ["x"], targetValue: 1 }] })).toBeNull();
    expect(buildProgressRequest(null)).toBeNull();
  });
});

describe("buildSupportRequest()（支援判定の要求・ルール5/15）", () => {
  it("技能は支援判定の指定技能すべて、目標値は進行判定と同じ（有効行の目標値）", () => {
    expect(buildSupportRequest(FS)).toEqual({
      identificationKeys: ["info", "negotiation"],
      targetValue: 12,
      focusSystemId: "fs1",
      kind: "support",
    });
  });

  it("進行値が進むと目標値も有効行に追随する", () => {
    expect(buildSupportRequest({ ...FS, progress: 5 }).targetValue).toBe(18);
  });

  it("支援判定の技能が未指定でも要求できる（代用判定に委ねる）", () => {
    expect(buildSupportRequest({ ...FS, supportSkillKeys: [] }).identificationKeys).toEqual([]);
  });

  it("旧・単数の supportSkillKey しか無い実行中データも読める", () => {
    const old = { ...FS, supportSkillKeys: undefined, supportSkillKey: "info" };
    expect(buildSupportRequest(old).identificationKeys).toEqual(["info"]);
  });

  it("有効行が無ければ目標値を決められないので null", () => {
    expect(buildSupportRequest({ ...FS, rows: [] })).toBeNull();
    expect(buildSupportRequest(null)).toBeNull();
  });
});
