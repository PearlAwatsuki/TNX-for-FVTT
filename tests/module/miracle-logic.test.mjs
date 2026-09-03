/**
 * 神業の純ロジック(17-1)のテスト。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Miracle_Rules.md「神業の位置づけ」「神業の構造」・
 *       llm-wiki/01_Wiki/Phases/Phase_17_Tasks_Detail.md「設計の中心 — 神業由来の印」・17-1
 */
import { describe, it, expect } from "vitest";
import {
    miracleUseGate, miracleConsumeUpdate, withDefaultMiracleConsumption,
    miracleOriginOf, isMiracleOrigin, buildMiracleCardData,
    defencePreventPlan, unprotectedTargetIndices, negateCheckGate, negatedCheckMods,
} from "../../scripts/module/miracle-logic.mjs";

describe("withDefaultMiracleConsumption()（消費先が空の神業用途は自身の使用回数×1を既定消費）", () => {
    it("消費先が空なら「このアイテム自身の使用回数 ×1」の行を補った複製を返す（元の用途は変えない）", () => {
        const usage = { _id: "u1", type: "declaration", consumeTargets: [] };
        const out = withDefaultMiracleConsumption(usage);
        expect(out.consumeTargets).toEqual([{ type: "item", itemId: "", resource: "uses", amount: 1 }]);
        expect(out).not.toBe(usage);
        expect(usage.consumeTargets).toEqual([]);
    });

    it("消費先が未定義でも同じく補う", () => {
        expect(withDefaultMiracleConsumption({ _id: "u1", type: "declaration" }).consumeTargets)
            .toEqual([{ type: "item", itemId: "", resource: "uses", amount: 1 }]);
    });

    it("消費先が設定済みならそのまま返す（上書きしない）", () => {
        const usage = { _id: "u1", consumeTargets: [{ type: "item", itemId: "x", resource: "uses", amount: 2 }] };
        expect(withDefaultMiracleConsumption(usage)).toBe(usage);
    });
});

describe("miracleOriginOf() / isMiracleOrigin()（神業由来の印）", () => {
    it("印の出どころは用途の親アイテムが miracle 型であること", () => {
        expect(miracleOriginOf({ id: "m1", type: "miracle", name: "チャイ" }))
            .toEqual({ itemId: "m1", name: "チャイ" });
    });

    it("神業以外のアイテムからは印が出ない（null）", () => {
        expect(miracleOriginOf({ id: "s1", type: "styleSkill", name: "運気変換" })).toBeNull();
        expect(miracleOriginOf(null)).toBeNull();
    });

    it("カードのフラグに miracle ブロックがあれば神業由来", () => {
        expect(isMiracleOrigin({ miracle: { itemId: "m1", name: "チャイ" } })).toBe(true);
    });

    it("miracle ブロックが無い・itemId が空なら神業由来ではない", () => {
        expect(isMiracleOrigin({})).toBe(false);
        expect(isMiracleOrigin({ miracle: null })).toBe(false);
        expect(isMiracleOrigin({ miracle: { itemId: "" } })).toBe(false);
        expect(isMiracleOrigin(undefined)).toBe(false);
    });
});

describe("buildMiracleCardData()（神業カードの描画データ）", () => {
    const item = { id: "m1", type: "miracle", name: "黄泉還り", system: { furigana: "フェニックス" } };

    it("タグ「神業」・名前・ふりがな・効果文・条件・残り/最大を持つ", () => {
        expect(buildMiracleCardData(item, {
            description: "<p>不死鳥のごとく</p>", condition: "<p>復活したら</p>", remaining: 1, max: 2,
        })).toEqual({
            typeLabel: "神業", name: "黄泉還り", furigana: "フェニックス",
            description: "<p>不死鳥のごとく</p>", condition: "<p>復活したら</p>",
            remaining: 1, max: 2,
        });
    });

    it("ふりがな・効果文・条件が無ければ空文字（テンプレート側で行ごと畳む）", () => {
        const d = buildMiracleCardData({ id: "m2", type: "miracle", name: "チャイ", system: {} }, { remaining: 0, max: 1 });
        expect(d.furigana).toBe("");
        expect(d.description).toBe("");
        expect(d.condition).toBe("");
    });
});

describe("miracleUseGate()（残回数ゲート）", () => {
    it("残りがあれば ok・残り＝実効最大値−消費済み", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "2", spent: 1 } }))
            .toEqual({ ok: true, remaining: 1, max: 2 });
    });

    it("実効値 maxTotal があれば素値より優先する（AE で母数が増えた神業＝《ファイト！》）", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "1", maxTotal: 2, spent: 1 } }))
            .toEqual({ ok: true, remaining: 1, max: 2 });
    });

    it("消費済みが実効最大値に達していれば不可（残り 0）", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "2", spent: 2 } }))
            .toEqual({ ok: false, remaining: 0, max: 2 });
    });

    it("消費済みが最大値を超えていても残りは 0 で止まる（負にならない）", () => {
        expect(miracleUseGate({ uses: { isLimit: true, max: "1", spent: 3 } }).remaining).toBe(0);
    });

    it("uses を持たない system は不可", () => {
        expect(miracleUseGate({}).ok).toBe(false);
        expect(miracleUseGate(null).ok).toBe(false);
    });
});

describe("miracleConsumeUpdate()（使用による消費）", () => {
    it("消費済みを 1 増やす更新を返す（尽きていなければ isUsed には触れない）", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "3", spent: 0 } }))
            .toEqual({ "system.uses.spent": 1 });
    });

    it("この消費で尽きるなら isUsed を true にする（手動リセットの起点として残す旧挙動の維持）", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "2", spent: 1 } }))
            .toEqual({ "system.uses.spent": 2, "system.isUsed": true });
    });

    it("消費済みは実効最大値を超えない", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "1", spent: 1 } })["system.uses.spent"]).toBe(1);
    });
});

// ─── 適用前に防ぐ(防御タイプ・17-2) ────────────────────────────────────────────
// 正本: Miracle_Rules「防御神業」・効果文 《難攻不落》「社会ダメージを除く…1回の判定もしくは1発の神業に
// よって発生したものすべて」「ダメージを受けてしまった後から治療することはできない」／《守護神》《友情》
// 「選択したひとりのキャラクター以外に…被害をこうむるキャラクターがいる場合、そのキャラクターを助ける
// ことはできない」
describe("defencePreventPlan()（ダメージカードの対象行を防ぐ計画）", () => {
    const by = { itemId: "m1", name: "難攻不落", actorId: "a1" };
    const f3 = { category: "physical", applied: false, targets: [{ uuid: "A" }, { uuid: "B" }, { uuid: "C" }] };
    const usageAll = { defenceScope: "all", defenceCategories: ["physical", "mental"] };
    const usageOne = { defenceScope: "one", defenceCategories: ["physical", "mental", "social"] };

    it("まるごと: どの行をクリックしても全対象を防ぐ", () => {
        expect(defencePreventPlan(f3, usageAll, { rowIndex: 1, by })).toEqual({ ok: true, indices: [0, 1, 2], by });
    });

    it("1人: クリックした行だけ防ぐ", () => {
        expect(defencePreventPlan(f3, usageOne, { rowIndex: 1, by })).toEqual({ ok: true, indices: [1], by });
    });

    it("系統が防げる系統に無ければ拒否（《難攻不落》は社会ダメージを防げない）", () => {
        expect(defencePreventPlan({ ...f3, category: "social" }, usageAll, { rowIndex: 0, by }))
            .toEqual({ ok: false, reason: "category" });
    });

    it("適用済み（受けた後）は拒否", () => {
        expect(defencePreventPlan({ ...f3, applied: true }, usageAll, { rowIndex: 0, by }))
            .toEqual({ ok: false, reason: "applied" });
    });

    it("既に防がれた行は計画から外れ、残りが無ければ拒否", () => {
        const f = { ...f3, targets: [{ uuid: "A", protectedBy: by }, { uuid: "B" }, { uuid: "C", protectedBy: by }] };
        expect(defencePreventPlan(f, usageAll, { rowIndex: 0, by })).toEqual({ ok: true, indices: [1], by });
        expect(defencePreventPlan(f, usageOne, { rowIndex: 0, by })).toEqual({ ok: false, reason: "alreadyProtected" });
    });

    it("系統の設定が無い旧用途は3系統すべて防げる", () => {
        expect(defencePreventPlan({ ...f3, category: "social" }, { defenceScope: "all" }, { rowIndex: 0, by }).ok).toBe(true);
    });

    it("対象が無ければ拒否", () => {
        expect(defencePreventPlan({ ...f3, targets: [] }, usageAll, { rowIndex: 0, by })).toEqual({ ok: false, reason: "noTargets" });
    });
});

describe("unprotectedTargetIndices()（ダメージカードで生きている対象行）", () => {
    it("防がれた行を除いた添字を返す（表示・適用の両方がこれを読む）", () => {
        const f = { targets: [{ uuid: "A", protectedBy: { itemId: "m" } }, { uuid: "B" }, { uuid: "C" }] };
        expect(unprotectedTargetIndices(f)).toEqual([1, 2]);
        expect(unprotectedTargetIndices({ targets: [] })).toEqual([]);
        expect(unprotectedTargetIndices({})).toEqual([]);
    });
});

// ─── 打ち消し(防御タイプ・17-2) ───────────────────────────────────────────────
// 正本: Miracle_Rules「打ち消しの範囲」(判定に対しては失敗させる／宣言に対しては効果の適用をキャンセル。
// いずれも適用前に限る=遡及不可)・効果文《チャイ》「既に効果が適用された神業や判定に対して、時間を
// さかのぼって打ち消すことはできない」
describe("negateCheckGate()（判定を失敗させられるか）", () => {
    it("継続を持たない素の判定は打ち消せる", () => {
        expect(negateCheckGate({ recheck: {}, damageCards: [] })).toEqual({ ok: true });
    });

    it("成功時に効果が即座に適用される継続(回復/修理/改造/購入/登場/情報収集/制御打消)は適用済み＝拒否", () => {
        for (const k of ["recovery", "repair", "modification", "purchase", "appearance", "infoGathering", "controlNegate"]) {
            expect(negateCheckGate({ recheck: { [k]: { x: 1 } }, damageCards: [] })).toEqual({ ok: false, reason: "applied" });
        }
    });

    it("リアクション・カバー・NPC取得の判定も解決が即座に適用される＝拒否", () => {
        for (const k of ["reaction", "covering", "npcAcquire"]) {
            expect(negateCheckGate({ recheck: { [k]: { x: 1 } }, damageCards: [] })).toEqual({ ok: false, reason: "applied" });
        }
    });

    it("移動判定は表示のみの継続＝打ち消せる", () => {
        expect(negateCheckGate({ recheck: { movement: { x: 1 } }, damageCards: [] })).toEqual({ ok: true });
    });

    it("攻撃: ダメージカードが出ていても適用前なら打ち消せる（そのダメージも無効にする）", () => {
        expect(negateCheckGate({ recheck: {}, damageCards: [{ applied: false }] })).toEqual({ ok: true });
    });

    it("攻撃: 適用済みのダメージカードがあれば拒否", () => {
        expect(negateCheckGate({ recheck: {}, damageCards: [{ applied: false }, { applied: true }] }))
            .toEqual({ ok: false, reason: "applied" });
    });
});

describe("negatedCheckMods()（打ち消しを事後修正の器に積む）", () => {
    it("修正 0 の打ち消し行を足し、成否を失敗・差分値なしに固定する", () => {
        const by = { itemId: "m", name: "チャイ", actorId: "a" };
        const out = negatedCheckMods({ rows: [{ label: "x", value: 2 }], achievement: 12 }, { achievement: 12, targetValue: 10, by });
        expect(out.rows).toEqual([{ label: "x", value: 2 }, { label: "打ち消し（チャイ）", value: 0, negatedBy: by }]);
        expect(out.achievement).toBe(12);
        expect(out.success).toBe(false);
        expect(out.diff).toBeNull();
        expect(out.targetValue).toBe(10);
    });

    it("事後修正が無い判定でも行を作る（目標値なしなら targetValue は持たない）", () => {
        const out = negatedCheckMods(null, { achievement: 8, targetValue: null, by: { itemId: "m", name: "平和", actorId: "a" } });
        expect(out.rows.length).toBe(1);
        expect(out.success).toBe(false);
        expect(out).not.toHaveProperty("targetValue");
    });
});
