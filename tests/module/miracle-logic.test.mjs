/**
 * 神業の純ロジック(17-1)のテスト。
 * 正本: llm-wiki/01_Wiki/Game_Rules/Miracle_Rules.md「神業の位置づけ」「神業の構造」・
 *       llm-wiki/01_Wiki/Phases/Phase_17_Tasks_Detail.md「設計の中心 — 神業由来の印」・17-1
 */
import { describe, it, expect } from "vitest";
import {
    miracleUseGate, miracleConsumeUpdate, withDefaultMiracleConsumption,
    miracleOriginOf, isMiracleOrigin, buildMiracleCardData,
    defencePreventPlan, unprotectedTargetIndices, negateCheckGate, negatedCheckMods, evadePlan, recoveryCandidateAllowed,
    terminalKindFor, buildMiracleDamageFlag, miracleResultLabel, miracleTargetOutcome,
    withoutConsumption, interferenceCandidates, addUseEffectSource,
    asOtherSelection, renameMiracleInText, miracleLogCandidates, buildMiracleUseLogEntry, miracleUseFromMessageFlags,
    miracleUsePending, markMiracleUseApplied, conditionSwapPlan, miracleRemovalUpdate, miracleIdentityMatches,
    listDestroyableOutfits,
    miracleRewriteCandidates, miracleRewriteVia, miracleCardTextPlan } from "../../scripts/rules/miracle.mjs";

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
        expect(miracleOriginOf({ id: "m1", type: "miracle", name: "チャイ", uuid: "Actor.a.Item.m1" }))
            .toEqual({ itemId: "m1", name: "チャイ", uuid: "Actor.a.Item.m1" });
    });

    it("他の神業として使ったときは、その神業(uuid と名前)を印に添える(17-5)", () => {
        const origin = miracleOriginOf({ id: "m1", type: "miracle", name: "万能道具", uuid: "Actor.a.Item.m1" },
            { uuid: "Compendium.p.Item.x", name: "難攻不落", source: { junk: true } });
        expect(origin).toEqual({ itemId: "m1", name: "万能道具", uuid: "Actor.a.Item.m1",
            asOther: { uuid: "Compendium.p.Item.x", name: "難攻不落" } });
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
            hasProse: true,
            remaining: 1, max: 2,
        });
    });

    it("解説の段は常に畳んだ状態で置く＝開く条件を持たない", () => {
        const d = buildMiracleCardData(item, { description: "<p>x</p>", condition: "", remaining: 1, max: 2 });
        expect(d.hasProse).toBe(true);
        expect("proseOpen" in d).toBe(false);
    });

    it("効果文も条件も無ければ解説の段を出さない", () => {
        expect(buildMiracleCardData(item, { remaining: 1, max: 2 }).hasProse).toBe(false);
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
    it("消費済みを 1 増やす更新を返す", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "3", spent: 0 } }))
            .toEqual({ "system.uses.spent": 1 });
    });

    it("尽きるときも消費済みを増やすだけ（使用済みフラグは廃止＝残り使用回数から導く・2026-09-05）", () => {
        expect(miracleConsumeUpdate({ uses: { isLimit: true, max: "2", spent: 1 } }))
            .toEqual({ "system.uses.spent": 2 });
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

    // Miracle_Rules「防御神業」: 防ぐものはダメージに限らず悪影響を含み、**何を防ぐかは使用者が選ぶ**
    // ため、システムが機械的に判別しない(2026-09-03 ユーザー裁定)。トループの壊滅はダメージ系統を
    // 持たないので、系統の設定で弾かない(防げるかどうかは卓が決める)
    it("トループの壊滅（系統を持たない結果）は防げる系統の設定で弾かない", () => {
        expect(defencePreventPlan({ ...f3, category: "troop" }, usageAll, { rowIndex: 0, by }))
            .toEqual({ ok: true, indices: [0, 1, 2], by });
        expect(defencePreventPlan({ ...f3, category: "troop" }, { defenceScope: "one", defenceCategories: ["social"] }, { rowIndex: 2, by }))
            .toEqual({ ok: true, indices: [2], by });
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

// ─── 回避(防御タイプ・17-2・《脱出》) ─────────────────────────────────────────
// 効果文《脱出》「1回の判定や1発の神業によるあなた、もしくはあなたの操縦するヴィークルへの物理攻撃を
// かわすこともできる（その場合、位置は変わらない）」。回避は命中の段階の動作(ダメージが決まった後は防御の領分)。
// ヴィークルへの攻撃は操縦者を対象にするため「自分の行」に含まれる(同乗者は同乗を持たないため手動)。
describe("evadePlan()（攻撃カードの自分の対象行を回避にする計画）", () => {
    const by = { itemId: "m", name: "脱出", actorId: "me" };
    const f = { category: "physical", damageRolled: false, targets: [
        { uuid: "Actor.other", name: "他人", state: "pending" },
        { uuid: "Actor.me", name: "自分", state: "pending" },
    ] };
    const resolveActorId = (uuid) => uuid.replace("Actor.", "");

    it("自分の行なら回避にできる", () => {
        expect(evadePlan(f, { rowIndex: 1, actorId: "me", by, resolveActorId })).toEqual({ ok: true, index: 1, by });
    });

    it("他人の行は拒否（自分か自分の操縦するヴィークルへの攻撃のみ）", () => {
        expect(evadePlan(f, { rowIndex: 0, actorId: "me", by, resolveActorId })).toEqual({ ok: false, reason: "notSelf" });
    });

    it("物理攻撃以外は拒否", () => {
        expect(evadePlan({ ...f, category: "mental" }, { rowIndex: 1, actorId: "me", by, resolveActorId })).toEqual({ ok: false, reason: "category" });
    });

    it("ダメージカードが出た後は拒否（回避は命中の段階）", () => {
        expect(evadePlan({ ...f, damageRolled: true }, { rowIndex: 1, actorId: "me", by, resolveActorId })).toEqual({ ok: false, reason: "damageRolled" });
    });

    it("既に回避/失敗している行は拒否", () => {
        const g = { ...f, targets: [f.targets[0], { ...f.targets[1], state: "miss" }] };
        expect(evadePlan(g, { rowIndex: 1, actorId: "me", by, resolveActorId })).toEqual({ ok: false, reason: "alreadyMiss" });
    });

    it("行が無ければ拒否", () => {
        expect(evadePlan(f, { rowIndex: 5, actorId: "me", by, resolveActorId })).toEqual({ ok: false, reason: "noTarget" });
    });
});

// ─── 受けた後に消す(防御タイプ・17-2・神業の治癒) ─────────────────────────────
// 効果文《人命救助》「任意のスタイル技能の効果を解除する」・《腹心》《人命救助》「［完全死亡］［精神崩壊］
// はそのシーンで受けたものしか」・《黄泉還り》他人には「そのシーン中に受けたダメージしか」。
// 印のゲートの受け側: 神業由来(fromMiracle)の状態・効果は神業の治療でしか除去できない。
describe("recoveryCandidateAllowed()（神業の治癒で候補に載せてよいか）", () => {
    const here = { act: "A1", number: 3 };
    const cond = (over = {}) => ({ isCondition: true, isTerminal: false, isGranted: false, sourceIsStyleSkill: null, fromMiracle: false, receivedScene: here, ...over });

    it("受けたシーンの制限なし: 別シーンで受けた状態も候補", () => {
        expect(recoveryCandidateAllowed(cond({ receivedScene: { act: "A1", number: 1 } }), { recoverySceneLimit: "none" }, { byMiracle: true, currentScene: here })).toBe(true);
    });

    it("terminal: 完全死亡・精神崩壊はそのシーンで受けたものだけ（他の状態は制限なし）", () => {
        const u = { recoverySceneLimit: "terminal" };
        expect(recoveryCandidateAllowed(cond({ isTerminal: true, receivedScene: { act: "A1", number: 1 } }), u, { byMiracle: true, currentScene: here })).toBe(false);
        expect(recoveryCandidateAllowed(cond({ isTerminal: true }), u, { byMiracle: true, currentScene: here })).toBe(true);
        expect(recoveryCandidateAllowed(cond({ isTerminal: false, receivedScene: { act: "A1", number: 1 } }), u, { byMiracle: true, currentScene: here })).toBe(true);
    });

    it("all: すべてそのシーンで受けたものだけ", () => {
        const u = { recoverySceneLimit: "all" };
        expect(recoveryCandidateAllowed(cond({ receivedScene: { act: "A1", number: 2 } }), u, { byMiracle: true, currentScene: here })).toBe(false);
        expect(recoveryCandidateAllowed(cond(), u, { byMiracle: true, currentScene: here })).toBe(true);
    });

    it("受けたシーンが不明な状態（旧データ・アクト外）は制限で落とさない（検査できないものはゲートしない）", () => {
        expect(recoveryCandidateAllowed(cond({ isTerminal: true, receivedScene: null }), { recoverySceneLimit: "terminal" }, { byMiracle: true, currentScene: here })).toBe(true);
        expect(recoveryCandidateAllowed(cond({ receivedScene: here }), { recoverySceneLimit: "all" }, { byMiracle: true, currentScene: null })).toBe(true);
    });

    it("別のアクトで受けたものは同じ番号でも別シーン", () => {
        expect(recoveryCandidateAllowed(cond({ receivedScene: { act: "A0", number: 3 } }), { recoverySceneLimit: "all" }, { byMiracle: true, currentScene: here })).toBe(false);
    });

    it("神業由来の状態は神業の治療でしか除去できない（印のゲートの受け側）", () => {
        expect(recoveryCandidateAllowed(cond({ fromMiracle: true }), { recoverySceneLimit: "none" }, { byMiracle: false, currentScene: here })).toBe(false);
        expect(recoveryCandidateAllowed(cond({ fromMiracle: true }), { recoverySceneLimit: "none" }, { byMiracle: true, currentScene: here })).toBe(true);
    });

    it("BS・ダメージ以外の効果は recoveryEffects がオンの神業の治癒でだけ候補になる", () => {
        const eff = { isCondition: false, isTerminal: false, fromMiracle: false, receivedScene: null };
        expect(recoveryCandidateAllowed(eff, { recoveryEffects: true }, { byMiracle: true, currentScene: here })).toBe(true);
        expect(recoveryCandidateAllowed(eff, { recoveryEffects: false }, { byMiracle: true, currentScene: here })).toBe(false);
        expect(recoveryCandidateAllowed(eff, { recoveryEffects: true }, { byMiracle: false, currentScene: here })).toBe(false);
    });

    it("効果の出どころ(付与経路・供給元の種類)では絞り込まない（2026-09-07 ユーザー指示・選ぶのはダイアログ）", () => {
        const usage = { recoveryEffects: true };
        const ctx = { byMiracle: true, currentScene: here };
        // 付与コピーでない効果・供給元が一般技能の付与コピー・供給元を解決できない効果——すべて候補
        expect(recoveryCandidateAllowed({ isCondition: false }, usage, ctx)).toBe(true);
        expect(recoveryCandidateAllowed({ isCondition: false, isGranted: false }, usage, ctx)).toBe(true);
        expect(recoveryCandidateAllowed({ isCondition: false, isGranted: true, sourceIsStyleSkill: false }, usage, ctx)).toBe(true);
    });

    it("神業由来の印がある効果は神業の治癒でしか解除できない（印のゲートは効果にも効く）", () => {
        const eff = { isCondition: false, fromMiracle: true };
        expect(recoveryCandidateAllowed(eff, { recoveryEffects: true }, { byMiracle: true, currentScene: here })).toBe(true);
        expect(recoveryCandidateAllowed(eff, { recoveryEffects: true }, { byMiracle: false, currentScene: here })).toBe(false);
    });
});

// ─── 即死・社会戦(17-3)＝神業版のダメージカード ─────────────────────────────────
// 効果文《死の舞踏》「［完全死亡］させる…代わりに任意の肉体戦ダメージを与えても良い」《神の御言葉》
// 「［精神崩壊］…代わりに任意の精神戦ダメージ」《制裁》「任意の社会戦ダメージ…抹殺でもよい。トループならば
// 全滅させてもよい」。トループ壊滅は即死に含める(ユーザー裁定 2026-09-04)。
describe("terminalKindFor()（系統→終端状態）", () => {
    it("肉体=完全死亡・精神=精神崩壊・社会=抹殺", () => {
        expect(terminalKindFor("physical")).toBe("dead");
        expect(terminalKindFor("mental")).toBe("mind-break");
        expect(terminalKindFor("social")).toBe("erased");
    });
});

describe("buildMiracleDamageFlag()（神業版ダメージカードのフラグ）", () => {
    const by = { itemId: "m", name: "死の舞踏", actorId: "a" };
    it("印・系統・対象・結果を持ち、カードや攻撃力の段は持たない(軽減を通さない器)", () => {
        const f = buildMiracleDamageFlag({ by, category: "physical", targets: [{ uuid: "Actor.x", name: "X" }], result: { kind: "terminal" } });
        expect(f.miracle).toEqual(by);
        expect(f.category).toBe("physical");
        expect(f.targets).toEqual([{ uuid: "Actor.x", name: "X", parryGuard: 0, reactionEstablished: false }]);
        expect(f.miracleResult).toEqual({ kind: "terminal" });
        expect(f.cards).toEqual([]);
        expect(f.applied).toBe(false);
        expect(f.attackPower).toBe(0);
    });
});

describe("miracleResultLabel()（結果の表示）", () => {
    it("終端状態は系統の終端の名前(戦闘不能のタグは ［］ つき)・任意ダメージは値", () => {
        expect(miracleResultLabel({ kind: "terminal" }, "physical")).toBe("［完全死亡］");
        expect(miracleResultLabel({ kind: "terminal" }, "mental")).toBe("［精神崩壊］");
        expect(miracleResultLabel({ kind: "terminal" }, "social")).toBe("［抹殺］");
        expect(miracleResultLabel({ kind: "chart", value: 13 }, "physical")).toBe("ダメージ 13");
    });

    it("対象がトループなら終端の呼び名は壊滅(人数 0)＝完全死亡ではない", () => {
        expect(miracleResultLabel({ kind: "terminal" }, "physical", ["troop"])).toBe("壊滅");
        expect(miracleResultLabel({ kind: "terminal" }, "social", ["troop"])).toBe("壊滅");
    });

    it("トループと他の対象が混ざるときは両方を並べる(どちらが起きるかは対象ごと)", () => {
        expect(miracleResultLabel({ kind: "terminal" }, "physical", ["troop", "cast"])).toBe("［完全死亡］／壊滅");
        expect(miracleResultLabel({ kind: "terminal" }, "physical", ["cast", "guest"])).toBe("［完全死亡］");
    });

    it("任意ダメージは対象の型で変わらない(トループは人数から引く値)", () => {
        expect(miracleResultLabel({ kind: "chart", value: 5 }, "physical", ["troop"])).toBe("ダメージ 5");
    });

    it("解決できない対象(null)は型の無い対象として扱う＝終端状態の名前", () => {
        expect(miracleResultLabel({ kind: "terminal" }, "physical", [null])).toBe("［完全死亡］");
    });

    it("系統＝トループの壊滅: 結果は常に壊滅・キャスト/ゲストだけの行は効果なし", () => {
        expect(miracleResultLabel({ kind: "terminal" }, "troop")).toBe("壊滅");
        expect(miracleResultLabel({ kind: "terminal" }, "troop", ["troop"])).toBe("壊滅");
        expect(miracleResultLabel({ kind: "terminal" }, "troop", ["cast", "troop"])).toBe("壊滅");
        expect(miracleResultLabel({ kind: "terminal" }, "troop", ["cast"])).toBe("効果なし");
        expect(miracleResultLabel({ kind: "terminal" }, "troop", ["guest"])).toBe("効果なし");
    });
});

describe("miracleTargetOutcome()（対象の型ごとに何が起こるか）", () => {
    it("キャスト/ゲスト: 終端状態はその状態を直接付与・任意ダメージはチャートの値をそのまま(軽減なし)", () => {
        expect(miracleTargetOutcome({ kind: "terminal" }, "cast", "physical")).toEqual({ op: "terminal", kind: "dead" });
        expect(miracleTargetOutcome({ kind: "chart", value: 9 }, "guest", "social")).toEqual({ op: "chart", value: 9 });
    });

    it("トループ: 終端状態は壊滅(人数 0)・任意ダメージは人数から値を引く", () => {
        expect(miracleTargetOutcome({ kind: "terminal" }, "troop", "physical")).toEqual({ op: "annihilate" });
        expect(miracleTargetOutcome({ kind: "chart", value: 5 }, "troop", "physical")).toEqual({ op: "heads", value: 5 });
    });

    it("エキストラ: ダメージの概念が無い(宣言死)＝適用なし", () => {
        expect(miracleTargetOutcome({ kind: "terminal" }, "extra", "physical")).toEqual({ op: "none", reason: "extra" });
    });

    // 系統「トループの壊滅」(《天変地異》《突破》)。効果文「トループ1グループを全滅させることができる」
    // 「この効果で、キャストやゲストに直接ダメージを与えることはできない」
    it("系統＝トループの壊滅: トループは壊滅・キャスト/ゲストには効果がない", () => {
        expect(miracleTargetOutcome({ kind: "terminal" }, "troop", "troop")).toEqual({ op: "annihilate" });
        expect(miracleTargetOutcome({ kind: "terminal" }, "cast", "troop")).toEqual({ op: "none", reason: "notTroop" });
        expect(miracleTargetOutcome({ kind: "terminal" }, "guest", "troop")).toEqual({ op: "none", reason: "notTroop" });
        expect(miracleTargetOutcome({ kind: "terminal" }, "extra", "troop")).toEqual({ op: "none", reason: "extra" });
    });
});

// ─── 神業に干渉する神業(17-4・《ファイト！》《プリーズ！》) ─────────────────────────────
// 正本: Miracle_Effects「ファイト！」= 他のキャラクターの神業の使用回数を 1 回増やす・使用済みでも可・
// アクトを越えて持ち越せない・《ファイト！》を《ファイト！》することはできない。
// 「プリーズ！」= 他人に神業を使わせる・相手の神業は使用済みにならない(Miracle_Rules 一覧: 使用済みも可)

describe("withoutConsumption()（《プリーズ！》で使わされる神業は使用済みにならない）", () => {
    it("消費先を空にした複製を返し、元の用途は変えない", () => {
        const usage = { _id: "u1", type: "miracleKill", consumeTargets: [{ type: "item", itemId: "", resource: "uses", amount: 1 }] };
        const out = withoutConsumption(usage);
        expect(out.consumeTargets).toEqual([]);
        expect(out._id).toBe("u1");
        expect(out).not.toBe(usage);
        expect(usage.consumeTargets).toHaveLength(1);
    });
});

describe("interferenceCandidates()（対象の神業のうち干渉できるもの）", () => {
    const items = [
        { id: "a", type: "miracle", name: "死の舞踏", system: { uses: { max: 1, maxTotal: 1, spent: 1 } } },
        { id: "b", type: "miracle", name: "ファイト！", system: { uses: { max: 1, maxTotal: 1, spent: 0 } } },
        { id: "c", type: "generalSkill", name: "白兵", system: {} },
    ];
    it("addUse: 使用中の神業と同名のものを除き、使い切った神業も候補に入る(id と名前)", () => {
        expect(interferenceCandidates(items, { mode: "addUse", byName: "ファイト！" }))
            .toEqual([{ id: "a", name: "死の舞踏" }]);
    });
    it("requestUse: 神業をすべて列挙する(使い切ったものも・同名も)", () => {
        expect(interferenceCandidates(items, { mode: "requestUse", byName: "プリーズ！" }))
            .toEqual([{ id: "a", name: "死の舞踏" }, { id: "b", name: "ファイト！" }]);
    });
    it("神業でないアイテムは候補にならない", () => {
        expect(interferenceCandidates(items, { mode: "requestUse" }).some(c => c.id === "c")).toBe(false);
    });
});

describe("addUseEffectSource()（《ファイト！》が対象の神業に載せる効果の素）", () => {
    it("uses.max を +1 する変更・アクト中の持続・神業由来の印・重ねがけ可(2人が同じ神業に使えば +2)", () => {
        const src = addUseEffectSource({ name: "ファイト！", img: "icons/x.png" });
        expect(src.name).toBe("ファイト！");
        expect(src.img).toBe("icons/x.png");
        expect(src.changes).toEqual([{ key: "system.uses.max", mode: 2, value: "1" }]);
        const f = src.flags["tokyo-nova-axleration"];
        expect(f.tnxDuration).toBe("act");
        expect(f.fromMiracle).toBe(true);
        expect(f.stackable).toBe(true);
    });
});

// ─── 他の神業として使う神業(17-5・《万能道具》《突然変異》) ───────────────────────────
// 効果文《万能道具》「取得している〈フォルム〉によって、異なるスタイルの神業と同等の効果が発生する」＋対応表／
// 《突然変異》「そのアクト中に使用された神業をコピーして使用する」「あなたが登場したシーンで使用されたものに限られる」

describe("asOtherSelection()（選択肢から選んで固定した効果・《万能道具》《半身》《神意》）", () => {
    // 効果は〈フォルム〉等を選ぶときに神業側で選んで固定する(スタイル→神業→スタイル技能の順・使用時に
    // 取得技能から導かない=ユーザー訂正 2026-09-04)
    const choices = [{ skillUuid: "S.weapon", uuid: "U.dance" }, { skillUuid: "S.weapon", uuid: "U.finish" }, { skillUuid: "S.armor", uuid: "U.fortress" }];
    it("選んだ選択肢(selected)がその参照先", () => {
        expect(asOtherSelection({ mode: "choice", choices, selected: "U.fortress" })).toEqual({ uuid: "U.fortress" });
    });
    it("未選択で選択肢が複数なら unselected(警告して中止)・選択肢が1つなら自動", () => {
        expect(asOtherSelection({ mode: "choice", choices, selected: "" })).toEqual({ uuid: "", reason: "unselected" });
        expect(asOtherSelection({ mode: "choice", choices: [choices[2]], selected: "" })).toEqual({ uuid: "U.fortress" });
    });
    it("選択肢に無い selected は無効・参照先の無い選択肢は数えない・choice 以外は null", () => {
        expect(asOtherSelection({ mode: "choice", choices, selected: "U.gone" })).toEqual({ uuid: "", reason: "unselected" });
        expect(asOtherSelection({ mode: "choice", choices: [{ skillUuid: "S.x", uuid: "" }], selected: "" })).toEqual({ uuid: "", reason: "noChoices" });
        expect(asOtherSelection({ mode: "log", choices, selected: "U.dance" })).toBeNull();
    });
});

describe("renameMiracleInText()（写した経験点の取得条件の神業名を写し先の名前にする）", () => {
    // 効果文《万能道具》「《万能道具》を『うまく使った』条件は、元となった神業と同じである」＝条件の文を
    // 名乗るのは写し先の神業なので、文中の《ファイト！》は《万能道具》になる(ユーザー指示 2026-09-06)
    it("条件の文中の元の神業の名前を、写し先の名前に全て置き換える", () => {
        const src = "<p>《ファイト！》を使用することで、対象から感謝されたなら「うまく使った」として経験点をもらってよい。"
            + "また、使用回数を増やされた対象は、その神業を「うまく使った」なら、その分の経験点をもらってよい。"
            + "ただし、《ファイト！》を《ファイト！》することはできない。</p>";
        expect(renameMiracleInText(src, "ファイト！", "万能道具")).toBe(
            "<p>《万能道具》を使用することで、対象から感謝されたなら「うまく使った」として経験点をもらってよい。"
            + "また、使用回数を増やされた対象は、その神業を「うまく使った」なら、その分の経験点をもらってよい。"
            + "ただし、《万能道具》を《万能道具》することはできない。</p>");
    });
    it("名前が 《》 で囲まれていない書き方にも届く・名前が出てこない条件はそのまま", () => {
        expect(renameMiracleInText("<p>タイムリーで他人の危機を救ったら</p>", "タイムリー", "万能道具"))
            .toBe("<p>万能道具で他人の危機を救ったら</p>");
        expect(renameMiracleInText("<p>障害を排除するなど役に立つ使い方をしたなら</p>", "天変地異", "万能道具"))
            .toBe("<p>障害を排除するなど役に立つ使い方をしたなら</p>");
    });
    it("条件が空・どちらかの名前が空・同じ名前なら元のまま返す", () => {
        expect(renameMiracleInText("", "ファイト！", "万能道具")).toBe("");
        expect(renameMiracleInText(null, "ファイト！", "万能道具")).toBe("");
        expect(renameMiracleInText("<p>《ファイト！》を</p>", "", "万能道具")).toBe("<p>《ファイト！》を</p>");
        expect(renameMiracleInText("<p>《ファイト！》を</p>", "ファイト！", "")).toBe("<p>《ファイト！》を</p>");
        expect(renameMiracleInText("<p>《ファイト！》を</p>", "ファイト！", "ファイト！")).toBe("<p>《ファイト！》を</p>");
    });
});

describe("miracleLogCandidates()（使用ログのうち「見聞きした」神業）", () => {
    // ユーザー裁定 2026-09-04: 基本は自分が登場している間に使われたものだけ。同一シーンで登場前に使われた
    // 神業は、登場した時点でまだ効果が適用されていなければ「登場中に使用された」と見做す(使用→登場→適用は可、
    // 使用→適用→登場は不可)
    const log = [
        { scene: 1, uuid: "U.dance", name: "死の舞踏", appeared: ["hiruko", "x"], applied: true, appliedAppeared: ["hiruko", "x"] },
        { scene: 2, uuid: "U.chai", name: "チャイ", appeared: ["x"], applied: true, appliedAppeared: ["x"] },
        { scene: 3, uuid: "U.buy", name: "買収", appeared: ["x"], applied: false, appliedAppeared: [] },
        { scene: 3, uuid: "U.plain", name: "電脳神", appeared: ["x"], applied: true, appliedAppeared: ["x"] },
        { scene: 3, uuid: "U.word", name: "神の御言葉", appeared: ["x"], applied: true, appliedAppeared: ["x", "hiruko"] },
        { scene: 1, uuid: "U.dance", name: "死の舞踏", appeared: ["hiruko"], applied: true, appliedAppeared: ["hiruko"] },
    ];
    it("使用時に登場していたシーンの神業を、同じ神業は1つにまとめて返す", () => {
        expect(miracleLogCandidates(log, { actorId: "hiruko", sceneNumber: 5, appearedNow: [] }))
            .toEqual([{ uuid: "U.dance", name: "死の舞踏" }, { uuid: "U.word", name: "神の御言葉" }]);
    });
    it("現在シーンで登場前に使われた神業は、まだ適用されていなければ候補(使用→登場→適用)・適用済みなら候補外(使用→適用→登場)", () => {
        const out = miracleLogCandidates(log, { actorId: "hiruko", sceneNumber: 3, appearedNow: ["hiruko"] });
        expect(out.map(c => c.uuid)).toEqual(["U.dance", "U.buy", "U.word"]);
    });
    it("適用の時点で登場していれば、使用時に不在でも候補(使用→登場→適用)", () => {
        expect(miracleLogCandidates(log, { actorId: "hiruko", sceneNumber: 9, appearedNow: [] }).some(c => c.uuid === "U.word")).toBe(true);
    });
});

describe("miracleUsePending() / markMiracleUseApplied()（効果の適用待ちと適用の記帳）", () => {
    it("適用ボタンを持つカード(神業版ダメージ・破壊・使用回数+1・要求)は適用されるまで pending", () => {
        expect(miracleUsePending({ damageRoll: { miracle: { itemId: "m" }, applied: false } })).toBe(true);
        expect(miracleUsePending({ damageRoll: { miracle: { itemId: "m" }, applied: true } })).toBe(false);
        expect(miracleUsePending({ miracle: { itemId: "m", destroy: { applied: false } } })).toBe(true);
        expect(miracleUsePending({ miracle: { itemId: "m", addUse: { applied: true } } })).toBe(false);
        expect(miracleUsePending({ miracle: { itemId: "m", swap: { hostUuid: "Actor.h", hostName: "宿主" } } })).toBe(false); // 入れ替えは宣言で即時
        expect(miracleUsePending({ miracle: { itemId: "m", request: { used: null } } })).toBe(true);
        expect(miracleUsePending({ miracle: { itemId: "m", request: { used: { id: "x" } } } })).toBe(false);
    });
    it("それ以外の神業カード(宣言・防ぐ/打ち消し/回避・治癒・入手・不可知)は投稿時に適用済み", () => {
        expect(miracleUsePending({ miracle: { itemId: "m" } })).toBe(false);
        expect(miracleUsePending({ miracle: { itemId: "m", acquire: { itemId: "o" } } })).toBe(false);
    });
    it("記帳の行は messageId と applied/appliedAppeared を持ち、適用でその時点の登場者を刻む(1回だけ)", () => {
        const origin = { itemId: "m", name: "制裁", uuid: "U.m" };
        const entry = buildMiracleUseLogEntry({ sceneNumber: 3, sceneId: "s3", actorId: "x", actorName: "X", origin, appeared: ["x"], messageId: "msg1", applied: false });
        expect(entry).toEqual({ scene: 3, sceneId: "s3", actorId: "x", actorName: "X", uuid: "U.m", name: "制裁", appeared: ["x"], messageId: "msg1", applied: false, appliedAppeared: [] });
        const log = [entry];
        const marked = markMiracleUseApplied(log, "msg1", ["x", "hiruko"]);
        expect(marked[0]).toEqual({ ...entry, applied: true, appliedAppeared: ["x", "hiruko"] });
        expect(log[0].applied).toBe(false);
        expect(markMiracleUseApplied(marked, "msg1", ["x"])).toBeNull();
        expect(markMiracleUseApplied(log, "nope", ["x"])).toBeNull();
    });
});

describe("buildMiracleUseLogEntry() / miracleUseFromMessageFlags()（アクト内の神業使用ログ）", () => {
    it("神業カードのフラグから印を取り、他の神業として使った分は解決後の神業を記帳する", () => {
        const flags = { miracle: { itemId: "m1", name: "万能道具", uuid: "Actor.a.Item.m1", asOther: { uuid: "C.x", name: "難攻不落" } } };
        const origin = miracleUseFromMessageFlags(flags);
        expect(origin?.name).toBe("万能道具");
        const entry = buildMiracleUseLogEntry({ sceneNumber: 2, sceneId: "s2", actorId: "a", actorName: "A", origin, appeared: ["a", "b"], messageId: "m2", applied: true });
        expect(entry).toEqual({ scene: 2, sceneId: "s2", actorId: "a", actorName: "A", uuid: "C.x", name: "難攻不落", appeared: ["a", "b"], messageId: "m2", applied: true, appliedAppeared: ["a", "b"] });
    });
    it("神業版ダメージカード(damageRoll.miracle)からも印を取る・神業でないカードは null", () => {
        expect(miracleUseFromMessageFlags({ damageRoll: { miracle: { itemId: "m", name: "制裁", uuid: "U.m", actorId: "a" } } })?.uuid).toBe("U.m");
        expect(miracleUseFromMessageFlags({ damageRoll: { attackPower: 3 } })).toBeNull();
        expect(miracleUseFromMessageFlags({})).toBeNull();
    });
});

// ─── 《神出鬼没》(17-6): 宿主とカゲムシャのダメージ・状態を丸ごと入れ替える ────────────────
// 効果文「“宿主”が受けたあらゆるダメージや状況はカゲムシャが引き受けることになるし、その逆も発生する」
describe("conditionSwapPlan()（両者の状態を入れ替える計画）", () => {
    const SC = "tokyo-nova-axleration";
    const eff = (id, kind, extra = {}) => ({ id, flags: { [SC]: { conditionKind: kind, ...extra } } });
    const A = [eff("a1", "wound-light"), eff("a2", "stagger", { addedFrom: "a1", hideFromList: true }), { id: "a3", flags: { [SC]: { grantedFrom: "x" } } }];
    const B = [eff("b1", "erased")];
    it("状態(conditionKind)だけを対象にし、カスケードの子(addedFrom)は消すだけで移さない(移した親から再生する)", () => {
        const plan = conditionSwapPlan(A, B);
        expect(plan.deleteA).toEqual(["a1", "a2"]);
        expect(plan.deleteB).toEqual(["b1"]);
        expect(plan.moveToB.map(e => e.id)).toEqual(["a1"]);
        expect(plan.moveToA.map(e => e.id)).toEqual(["b1"]);
    });
    it("状態でない効果(付与コピー等)には触れない", () => {
        const plan = conditionSwapPlan(A, []);
        expect(plan.deleteA).not.toContain("a3");
        expect(plan.moveToA).toEqual([]);
    });
});

describe("miracleRemovalUpdate()（多重取得の神業を1つ外す）", () => {
    it("母数が2以上なら削除でなく母数-1（消費済みは新しい母数まで詰める）", () => {
        expect(miracleRemovalUpdate({ uses: { max: "3", spent: 3 } }))
            .toEqual({ "system.uses.max": "2", "system.uses.spent": 2 });
    });

    it("消費済みが新しい母数に収まっていればそのまま", () => {
        expect(miracleRemovalUpdate({ uses: { max: "2", spent: 0 } }))
            .toEqual({ "system.uses.max": "1", "system.uses.spent": 0 });
    });

    it("母数が1以下ならアイテムごと削除する（null を返す）", () => {
        expect(miracleRemovalUpdate({ uses: { max: "1", spent: 0 } })).toBeNull();
        expect(miracleRemovalUpdate({ uses: {} })).toBeNull();
        expect(miracleRemovalUpdate(null)).toBeNull();
    });
});

describe("miracleIdentityMatches()（打ち消しの限定＝同じ神業かの照合）", () => {
    it("識別キーが両方にあればキーで照合する（名前が違っても同じ神業）", () => {
        expect(miracleIdentityMatches({ identificationKey: "m_touch", name: "真実に対する不可触" },
            { identificationKey: "m_touch", name: "真実に対する不可触（写し）" })).toBe(true);
        expect(miracleIdentityMatches({ identificationKey: "m_touch" }, { identificationKey: "m_other" })).toBe(false);
    });

    it("識別キーが片方でも無ければ名前で照合する", () => {
        expect(miracleIdentityMatches({ name: "チャイ" }, { name: "チャイ" })).toBe(true);
        expect(miracleIdentityMatches({ name: "チャイ" }, { identificationKey: "", name: "黄泉還り" })).toBe(false);
    });

    it("名前も識別キーも無ければ一致しない", () => {
        expect(miracleIdentityMatches(null, { name: "チャイ" })).toBe(false);
        expect(miracleIdentityMatches({}, {})).toBe(false);
    });
});

describe("listDestroyableOutfits()（破壊タイプ・破壊できるアウトフィットの分類で候補を絞る）", () => {
    const gun      = { id: "i1", name: "拳銃",   type: "weapon",    system: { majorCategory: "weapon",  minorCategory: "ranged" } };
    const sword    = { id: "i2", name: "刀",     type: "weapon",    system: { majorCategory: "weapon",  minorCategory: "melee" } };
    const car      = { id: "i3", name: "車",     type: "vehicle",   system: { majorCategory: "vehicle", minorCategory: "groundVehicle" } };
    const house    = { id: "i4", name: "自宅",   type: "residence", system: { majorCategory: "housing", minorCategory: "residence" } };
    const contact  = { id: "i5", name: "コネ",   type: "general",   system: { majorCategory: "service", minorCategory: "social" } };
    const skill    = { id: "i6", name: "〈運転〉", type: "generalSkill", system: {} };

    it("分類ホワイトリストに合致するアウトフィットだけを候補にする（大分類キー＝その大分類の全小分類）", () => {
        const target = { items: [gun, car, house] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["vehicle", "housing"] }).map(i => i.id))
            .toEqual(["i3", "i4"]);
    });

    it("小分類キーはその小分類だけに効く", () => {
        const target = { items: [gun, sword, car] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["melee"] }).map(i => i.id))
            .toEqual(["i2"]);
    });

    it("破壊済みのアウトフィットは候補にしない", () => {
        const wrecked = { id: "i7", name: "残骸", type: "vehicle", system: { majorCategory: "vehicle", minorCategory: "groundVehicle", isDestroyed: true } };
        const target = { items: [car, wrecked] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["vehicle"] }).map(i => i.id))
            .toEqual(["i3"]);
    });

    it("副分類でも合致する（主分類・副分類の「両方の分類として扱う」）", () => {
        const bioBlade = { id: "i8", name: "生体刃", type: "weapon", system: {
            majorCategory: "item", minorCategory: "biotech",
            additionalCategories: [{ major: "weapon", minor: "melee" }],
        } };
        const target = { items: [bioBlade] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["weapon"] }).map(i => i.id))
            .toEqual(["i8"]);
    });

    it("「全て」（初期値）はアウトフィットを分類で絞らない", () => {
        const target = { items: [gun, car, house] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["all"] }).map(i => i.id))
            .toEqual(["i1", "i3", "i4"]);
    });

    it("サービス大分類は破壊免疫のため「全て」でも候補に出ない", () => {
        const target = { items: [gun, contact] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["all"] }).map(i => i.id))
            .toEqual(["i1"]);
    });

    it("アウトフィットでないアイテムは候補にしない", () => {
        const target = { items: [skill, gun] };
        expect(listDestroyableOutfits(target, { destroyableCategories: ["weapon"] }).map(i => i.id))
            .toEqual(["i1"]);
    });

    it("分類が空（シートでは作れない状態）なら候補なし＝「全部壊せる」へフォールバックしない", () => {
        const target = { items: [gun, car] };
        expect(listDestroyableOutfits(target, { destroyableCategories: [] })).toEqual([]);
        expect(listDestroyableOutfits(target, {})).toEqual([]);
    });
});

// ─── 神業書き換え技能（神業と同じタイミングで使い、その1回の効果を書き換えるスタイル技能） ───────
// 正本: llm-wiki/01_Wiki/Game_Rules/Miracle_Rules.md「神業書き換え技能」
// 効果の出どころ（別の神業／この技能の用途）× 経験点の取得条件（元のまま／書き換える）の2軸。

describe("miracleRewriteCandidates()（その神業をロールしたときに書き換えを申し出る技能）", () => {
    const skill = (over = {}) => ({
        id: "s1", name: "〈書き換え〉", type: "styleSkill",
        system: {
            unique: "miracleChange",
            uses: { isLimit: true, max: "1", maxTotal: 1, spent: 0 },
            miracleRewrite: { targetKey: "chai", effect: "own", refUuid: "", rewriteCondition: false, condition: "" },
            ...over,
        },
    });
    const chai = { id: "m1", name: "チャイ", type: "miracle", system: { identificationKey: "chai" } };

    it("対応する神業（識別キーが一致）で、使用回数が残っている技能が候補になる", () => {
        expect(miracleRewriteCandidates([skill()], chai).map(i => i.id)).toEqual(["s1"]);
    });

    it("対応する神業を指定していない技能は候補にならない（対象の指定は必須）", () => {
        const unset = skill({ miracleRewrite: { targetKey: "", effect: "own" } });
        expect(miracleRewriteCandidates([unset], chai)).toEqual([]);
    });

    it("対応する神業が違えば候補にならない", () => {
        const other = { id: "m2", name: "平和", type: "miracle", system: { identificationKey: "peace" } };
        expect(miracleRewriteCandidates([skill()], other)).toEqual([]);
    });

    it("対応づけは識別キーだけで見る（識別キーを持たない神業は、指定のある技能とは対応しない）", () => {
        const noKey = { id: "m3", name: "チャイ", type: "miracle", system: {} };
        expect(miracleRewriteCandidates([skill()], noKey)).toEqual([]);
    });

    it("使用回数を使い切った技能は候補にならない", () => {
        const spent = skill({ uses: { isLimit: true, max: "1", maxTotal: 1, spent: 1 } });
        expect(miracleRewriteCandidates([spent], chai)).toEqual([]);
    });

    it("使用回数の制限が無い技能は常に候補になる", () => {
        const unlimited = skill({ uses: { isLimit: false, max: "", maxTotal: 0, spent: 3 } });
        expect(miracleRewriteCandidates([unlimited], chai).map(i => i.id)).toEqual(["s1"]);
    });

    it("書き換えの設定が未了なら候補にならない（効果の出どころが空／参照型で参照先が空）", () => {
        const blank = skill({ miracleRewrite: { targetKey: "chai", effect: "" } });
        const refNothing = skill({ miracleRewrite: { targetKey: "chai", effect: "ref", refUuid: "" } });
        expect(miracleRewriteCandidates([blank, refNothing], chai)).toEqual([]);
    });

    it("区分が「神業書き換え技能」でない技能は候補にならない（設定が残っていても効かない）", () => {
        const notChange = { ...skill(), system: { ...skill().system, unique: "clone" } };
        expect(miracleRewriteCandidates([notChange], chai)).toEqual([]);
    });

    it("スタイル技能以外は候補にならない", () => {
        const general = { ...skill(), type: "generalSkill" };
        expect(miracleRewriteCandidates([general], chai)).toEqual([]);
    });

    it("神業以外をロールしたときは候補を出さない", () => {
        expect(miracleRewriteCandidates([skill()], { id: "w1", name: "拳銃", type: "weapon", system: {} })).toEqual([]);
    });
});

describe("miracleRewriteVia()（書き換え技能から、印と効果文・条件の決め方を組む）", () => {
    const via = (over) => miracleRewriteVia({ id: "s1", name: "〈書き換え〉", system: { miracleRewrite: over } });

    it("取得条件を書き換えないなら条件は元の神業のまま（keep）", () => {
        expect(via({ effect: "ref", refUuid: "Compendium.p.Item.x", rewriteCondition: false }).conditionMode).toBe("keep");
    });

    it("参照型で取得条件も書き換えるなら、条件は書き換え先の神業から（source）", () => {
        expect(via({ effect: "ref", refUuid: "Compendium.p.Item.x", rewriteCondition: true }).conditionMode).toBe("source");
    });

    it("独自効果型で取得条件も書き換えるなら、条件は技能が持つ文（text）", () => {
        const v = via({ effect: "own", rewriteCondition: true, condition: "<p>危機を救った</p>" });
        expect(v.conditionMode).toBe("text");
        expect(v.conditionText).toBe("<p>危機を救った</p>");
    });

    it("効果文は必ず書き換わる: 参照型なら書き換え先の神業から（source）", () => {
        expect(via({ effect: "ref", refUuid: "Compendium.p.Item.x" }).descriptionMode).toBe("source");
    });

    it("効果文は必ず書き換わる: 独自効果型なら技能が持つ文（text）＝技能の解説は使わない", () => {
        const v = via({ effect: "own", description: "<p>好きな効果が起きる</p>" });
        expect(v.descriptionMode).toBe("text");
        expect(v.descriptionText).toBe("<p>好きな効果が起きる</p>");
    });

    it("効果は書き換わるのに効果文だけ元の神業のまま、という組み合わせは作れない", () => {
        for (const effect of ["ref", "own"]) {
            expect(via({ effect, refUuid: "Compendium.p.Item.x" }).descriptionMode).not.toBe("keep");
        }
    });
});

describe("miracleCardTextPlan()（神業カードに出す効果文と取得条件の出どころ）", () => {
    it("書き換えが無ければどちらも元の神業", () => {
        expect(miracleCardTextPlan(null)).toEqual({
            description: { from: "item", text: "" }, condition: { from: "item", text: "" } });
    });

    it("従来の効果の参照・コピー（《突然変異》）はどちらも参照先（現行の挙動を変えない）", () => {
        expect(miracleCardTextPlan({ uuid: "Compendium.p.Item.x", name: "死の舞踏" })).toEqual({
            description: { from: "source", text: "" }, condition: { from: "source", text: "" } });
    });

    it("効果文は書き換え先から出しつつ、条件は元の神業のままにできる", () => {
        const asOther = { uuid: "Compendium.p.Item.x", name: "死の舞踏",
            via: { itemId: "s1", name: "〈書き換え〉", descriptionMode: "source", descriptionText: "", conditionMode: "keep", conditionText: "" } };
        expect(miracleCardTextPlan(asOther)).toEqual({
            description: { from: "source", text: "" }, condition: { from: "item", text: "" } });
    });

    it("独自効果型は効果文も条件も技能が持つ文をそのまま出す", () => {
        const asOther = { uuid: "Actor.a.Item.s1", name: "〈書き換え〉", kind: "skill",
            via: { itemId: "s1", name: "〈書き換え〉", descriptionMode: "text", descriptionText: "<p>好きな効果</p>",
                conditionMode: "text", conditionText: "<p>危機を救った</p>" } };
        expect(miracleCardTextPlan(asOther)).toEqual({
            description: { from: "text", text: "<p>好きな効果</p>" },
            condition: { from: "text", text: "<p>危機を救った</p>" } });
    });

    it("独自効果型で条件を書き換えないなら、効果文は技能の文・条件は元の神業", () => {
        const asOther = { uuid: "Actor.a.Item.s1", name: "〈書き換え〉", kind: "skill",
            via: { itemId: "s1", name: "〈書き換え〉", descriptionMode: "text", descriptionText: "<p>好きな効果</p>",
                conditionMode: "keep", conditionText: "" } };
        expect(miracleCardTextPlan(asOther)).toEqual({
            description: { from: "text", text: "<p>好きな効果</p>" }, condition: { from: "item", text: "" } });
    });
});

describe("miracleOriginOf()（書き換えの印）", () => {
    const chai = { id: "m1", type: "miracle", name: "チャイ", uuid: "Actor.a.Item.m1" };

    it("参照型の書き換えは、書き換え先の神業と書き換えた技能の両方を印に載せる", () => {
        const origin = miracleOriginOf(chai, {
            uuid: "Compendium.p.Item.x", name: "死の舞踏", kind: "miracle",
            via: { itemId: "s1", name: "〈書き換え〉", conditionMode: "keep", conditionText: "" },
        });
        expect(origin.asOther).toEqual({ uuid: "Compendium.p.Item.x", name: "死の舞踏" });
        expect(origin.rewrite).toEqual({ itemId: "s1", name: "〈書き換え〉" });
    });

    it("独自効果型は技能を「他の神業」として印に載せない（使用ログが技能を神業として拾わないため）", () => {
        const origin = miracleOriginOf(chai, {
            uuid: "Actor.a.Item.s1", name: "〈書き換え〉", kind: "skill",
            via: { itemId: "s1", name: "〈書き換え〉", conditionMode: "keep", conditionText: "" },
        });
        expect(origin.asOther).toBeUndefined();
        expect(origin.rewrite).toEqual({ itemId: "s1", name: "〈書き換え〉" });
    });

    it("独自効果型の使用は、使用ログでは元の神業として記帳される（《突然変異》のコピー元は神業）", () => {
        const origin = miracleOriginOf(chai, {
            uuid: "Actor.a.Item.s1", name: "〈書き換え〉", kind: "skill",
            via: { itemId: "s1", name: "〈書き換え〉", conditionMode: "keep", conditionText: "" },
        });
        const entry = buildMiracleUseLogEntry({ sceneNumber: 1, origin });
        expect(entry.uuid).toBe("Actor.a.Item.m1");
        expect(entry.name).toBe("チャイ");
    });
});
