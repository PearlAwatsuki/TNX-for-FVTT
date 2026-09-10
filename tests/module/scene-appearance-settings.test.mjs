import { describe, it, expect } from "vitest";
import { normalizeSceneRow, teamsAfterPhaseChange } from "../../scripts/rules/session.mjs";
import { sceneAppearanceMode, resolveSceneAppearance, appearanceCheckParams } from "../../scripts/rules/appearance.mjs";

describe("アクトシートのエリア指定", () => {
    it.each([["red", 8], ["yellow", 10], ["green", 10], ["white", 12], ["sanctuary", 12]])(
        "%s のエリア設定で目標値は %s に確定する", (area, targetValue) => {
            for (const appearanceMode of ["unset", "fixed", "none", "area"]) {
                const raw = { area, appearanceMode, appearanceValue: 99, appearanceSkills: ["skill"] };
                const row = normalizeSceneRow(raw);
                expect(row.appearanceMode).toBe("area");
                const appearance = resolveSceneAppearance(row, { area: "", appearanceValue: 2 });
                expect(appearance.area).toBe(area);
                expect(appearance.skills).toEqual(["skill"]);
                expect(appearanceCheckParams(appearance).targetValue).toBe(targetValue);
                expect(raw.appearanceMode).toBe(appearanceMode);
            }
        });
    it("エリアを解除すると元の数値指定に戻り、旧エリア準拠は未設定になる", () => {
        expect(sceneAppearanceMode({ area: "", appearanceMode: "fixed" })).toBe("fixed");
        expect(sceneAppearanceMode({ area: "", appearanceMode: "area" })).toBe("unset");
        expect(sceneAppearanceMode({})).toBe("unset");
    });
    it("エリア未設定での数値指定・不可は有効", () => {
        expect(appearanceCheckParams(resolveSceneAppearance({ appearanceMode: "fixed", appearanceValue: 10 })).targetValue).toBe(10);
        expect(appearanceCheckParams(resolveSceneAppearance({ appearanceMode: "none" })).forcedFailure).toBe("none");
    });
    it("巡回は台本のエリアを使わず開始時に決める", () => {
        const row = normalizeSceneRow({ kind: "rotation", area: "white", appearanceMode: "fixed" });
        expect(row.area).toBe(""); expect(row.appearanceMode).toBe("unset");
        expect(resolveSceneAppearance(row, { area: "red", appearanceValue: 8 }).area).toBe("red");
    });
});

describe("エンディング", () => {
    it.each(["unset", "area", "fixed", "none"])("古い登場設定%sがあっても判定条件を使用しない", appearanceMode => {
        expect(resolveSceneAppearance({ area: "sanctuary", appearanceMode, appearanceValue: 99, appearanceSkills: ["skill"] },
            { area: "red", appearanceValue: 8 }, "ending"))
            .toEqual({ area: "", mode: "free", fixedValue: null, skills: [] });
    });
    it("クライマックス内はチームを維持し、フェイズを抜けたときに解散する", () => {
        const teams = [{ id: "t", memberActorIds: ["a", "b"] }];
        expect(teamsAfterPhaseChange(teams, "climax", "climax")).toBe(teams);
        expect(teamsAfterPhaseChange(teams, "research", "climax")).toBe(teams);
        expect(teamsAfterPhaseChange(teams, "climax", "ending")).toEqual([]);
        expect(teamsAfterPhaseChange(teams, "research", "ending")).toEqual([]);
        expect(teams).toHaveLength(1);
    });
});
