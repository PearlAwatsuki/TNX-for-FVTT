import { describe, it, expect } from "vitest";
import {
    SUIT_TO_ABILITY,
    getCardCheckValue,
    getAbilityBySuit,
    calcSkillCheck,
    calcControlCheck,
    getComboSuits,
    comboUsesBounty,
    normalizeSuit,
} from "../../scripts/rules/tnx-check-engine.mjs";

// ─── スート対応表 ─────────────────────────────────────────────────────────────

describe("SUIT_TO_ABILITY", () => {
    it("spade → reason", () => expect(SUIT_TO_ABILITY.spade).toBe("reason"));
    it("club → passion",  () => expect(SUIT_TO_ABILITY.club).toBe("passion"));
    it("heart → life",    () => expect(SUIT_TO_ABILITY.heart).toBe("life"));
    it("diamond → mundane", () => expect(SUIT_TO_ABILITY.diamond).toBe("mundane"));
});

// ─── getCardCheckValue ─────────────────────────────────────────────────────

describe("getCardCheckValue()", () => {
    describe("通常カード（2〜10）", () => {
        it("数字そのまま",    () => expect(getCardCheckValue({ numericValue: 7 })).toBe(7));
        it("2 も正しく返す",  () => expect(getCardCheckValue({ numericValue: 2 })).toBe(2));
        it("10 は 10",        () => expect(getCardCheckValue({ numericValue: 10 })).toBe(10));
    });

    describe("絵札（J=11, Q=12, K=13）", () => {
        it("手札判定では 10", () => expect(getCardCheckValue({ numericValue: 11 })).toBe(10));
        it("Q も 10",          () => expect(getCardCheckValue({ numericValue: 12 })).toBe(10));
        it("K も 10",          () => expect(getCardCheckValue({ numericValue: 13 })).toBe(10));
        it("山札判定では FUMBLE", () => {
            expect(getCardCheckValue({ numericValue: 11, isFromDeck: true })).toBe("FUMBLE");
        });
    });

    describe("A（numericValue=1）", () => {
        it("通常: 11",            () => expect(getCardCheckValue({ numericValue: 1 })).toBe(11));
        it("fixedAt21: FIXED_21", () => expect(getCardCheckValue({ numericValue: 1, fixedAt21: true })).toBe("FIXED_21"));
    });

    describe("Joker / 宣言値", () => {
        it("isJoker=true かつ declaredValue=9 → 9",  () => {
            expect(getCardCheckValue({ numericValue: 0, isJoker: true, declaredValue: 9 })).toBe(9);
        });
        it("declaredValue のみ指定でも有効",          () => {
            expect(getCardCheckValue({ numericValue: 5, declaredValue: 3 })).toBe(3);
        });
    });
});

// ─── getAbilityBySuit ─────────────────────────────────────────────────────────

describe("getAbilityBySuit()", () => {
    const abilities = {
        reason:  { totalValue: 10, totalControl: 4 },
        passion: { totalValue:  8, totalControl: 3 },
        life:    { totalValue:  6, totalControl: 5 },
        mundane: { totalValue: 12, totalControl: 2 },
    };

    it("spade → reason の totalValue を返す",   () => {
        expect(getAbilityBySuit("spade", abilities).totalValue).toBe(10);
    });
    it("heart → life の totalControl を返す",   () => {
        expect(getAbilityBySuit("heart", abilities).totalControl).toBe(5);
    });
    it("abilityKey が正しい",                   () => {
        expect(getAbilityBySuit("diamond", abilities).abilityKey).toBe("mundane");
    });
    it("abilities が undefined でも 0 を返す",  () => {
        expect(getAbilityBySuit("spade", undefined).totalValue).toBe(0);
    });
});

// ─── calcSkillCheck ───────────────────────────────────────────────────────────

describe("calcSkillCheck()", () => {
    const abilities = {
        reason:  { totalValue: 5, totalControl: 3 },
        passion: { totalValue: 4, totalControl: 2 },
        life:    { totalValue: 6, totalControl: 4 },
        mundane: { totalValue: 7, totalControl: 1 },
    };

    it("通常: cardValue + abilityVal + bountyUsed", () => {
        const r = calcSkillCheck({ cardCheckValue: 8, suit: "spade", abilitiesCtx: abilities, bountyUsed: 2, targetValue: 12 });
        expect(r.achievement).toBe(15); // 8+5+2
        expect(r.diff).toBe(3);
        expect(r.success).toBe(true);
        expect(r.fumble).toBe(false);
    });

    it("目標値以下で失敗", () => {
        const r = calcSkillCheck({ cardCheckValue: 3, suit: "spade", abilitiesCtx: abilities, bountyUsed: 0, targetValue: 12 });
        expect(r.achievement).toBe(8);
        expect(r.success).toBe(false);
    });

    it("FUMBLE → fumble=true", () => {
        const r = calcSkillCheck({ cardCheckValue: "FUMBLE", suit: "spade", abilitiesCtx: abilities });
        expect(r.fumble).toBe(true);
        expect(r.achievement).toBeNull();
    });

    it("FIXED_21 → achievement=21・bountyUsed=0で固定", () => {
        const r = calcSkillCheck({ cardCheckValue: "FIXED_21", suit: "club", abilitiesCtx: abilities, bountyUsed: 3, targetValue: 18 });
        expect(r.achievement).toBe(21);
        expect(r.bountyUsed).toBe(0);
        expect(r.fixedAt21).toBe(true);
        expect(r.success).toBe(true);
    });

    it("targetValue=null のとき success=null・diff=null", () => {
        const r = calcSkillCheck({ cardCheckValue: 7, suit: "heart", abilitiesCtx: abilities });
        expect(r.success).toBeNull();
        expect(r.diff).toBeNull();
        expect(r.achievement).toBe(13); // 7+6
    });

    it("手動修正(manualMod): 達成値に加算・負値=ペナルティ(代用判定・2026-07-09)", () => {
        const plus = calcSkillCheck({ cardCheckValue: 8, suit: "spade", abilitiesCtx: abilities, manualMod: 2, targetValue: 12 });
        expect(plus.achievement).toBe(15); // 8+5+2
        expect(plus.manualMod).toBe(2);
        const minus = calcSkillCheck({ cardCheckValue: 8, suit: "spade", abilitiesCtx: abilities, manualMod: -3, targetValue: 12 });
        expect(minus.achievement).toBe(10); // 8+5-3
        expect(minus.success).toBe(false);
    });

    it("手動修正は FUMBLE と 21固定に影響しない", () => {
        const f = calcSkillCheck({ cardCheckValue: "FUMBLE", suit: "spade", abilitiesCtx: abilities, manualMod: 5 });
        expect(f.fumble).toBe(true);
        expect(f.achievement).toBeNull();
        const fx = calcSkillCheck({ cardCheckValue: "FIXED_21", suit: "club", abilitiesCtx: abilities, manualMod: 5, targetValue: 18 });
        expect(fx.achievement).toBe(21); // 21固定は完全固定(能力値・報酬点・修正を無視)
    });

    it("達成値は 0 未満にならない(下限クランプ・2026-07-15 ユーザー確定)", () => {
        // 大きなペナルティで計算途中は負でも、最終達成値は 0 まで戻す
        const r = calcSkillCheck({ cardCheckValue: 2, suit: "spade", abilitiesCtx: abilities, manualMod: -20, targetValue: 12 });
        expect(r.achievement).toBe(0); // 2+5-20 = -13 → 0
        expect(r.success).toBe(false);
        // 負の能力値実効値(AE ペナルティ)でも 0 下限
        const negAbility = { reason: { totalValue: -30, totalControl: 0 } };
        const r2 = calcSkillCheck({ cardCheckValue: 3, suit: "spade", abilitiesCtx: negAbility });
        expect(r2.achievement).toBe(0); // 3+(-30) = -27 → 0
    });
});

// ─── calcControlCheck ─────────────────────────────────────────────────────────

describe("calcControlCheck()", () => {
    const abilities = {
        reason:  { totalValue: 5, totalControl: 6 },
        passion: { totalValue: 4, totalControl: 3 },
        life:    { totalValue: 6, totalControl: 8 },
        mundane: { totalValue: 7, totalControl: 2 },
    };

    it("cardValue ≤ controlVal → success=true",  () => {
        const r = calcControlCheck({ cardCheckValue: 5, suit: "spade", abilitiesCtx: abilities });
        expect(r.success).toBe(true);
        expect(r.cardValue).toBe(5);
        expect(r.controlVal).toBe(6);
    });

    it("cardValue > controlVal → success=false", () => {
        const r = calcControlCheck({ cardCheckValue: 7, suit: "spade", abilitiesCtx: abilities });
        expect(r.success).toBe(false);
    });

    it("絵札（cardCheckValue=10）の判定",     () => {
        const r = calcControlCheck({ cardCheckValue: 10, suit: "heart", abilitiesCtx: abilities });
        expect(r.controlVal).toBe(8);
        expect(r.success).toBe(false); // 10 > 8
    });

    it("状況修正（手動・2026-07-14）は制御値へ加算され成功条件が緩む", () => {
        const r = calcControlCheck({ cardCheckValue: 7, suit: "spade", abilitiesCtx: abilities, manualMod: 2 });
        expect(r.effectiveControl).toBe(8); // 6 + 2
        expect(r.success).toBe(true);       // 7 ≤ 8
    });

    it("負の状況修正は成功条件を厳しくする（制御値素値は不変）", () => {
        const r = calcControlCheck({ cardCheckValue: 5, suit: "spade", abilitiesCtx: abilities, manualMod: -2 });
        expect(r.controlVal).toBe(6);
        expect(r.effectiveControl).toBe(4); // 6 - 2
        expect(r.success).toBe(false);      // 5 > 4
    });

    it("A は 11 として扱う（FIXED_21 は適用しない）", () => {
        const r = calcControlCheck({ cardCheckValue: "FIXED_21", suit: "spade", abilitiesCtx: abilities });
        expect(r.cardValue).toBe(11);
    });

    it("FUMBLE → fumble=true", () => {
        const r = calcControlCheck({ cardCheckValue: "FUMBLE", suit: "spade", abilitiesCtx: abilities });
        expect(r.fumble).toBe(true);
        expect(r.success).toBe(false);
    });
});

// ─── getComboSuits ────────────────────────────────────────────────────────────

describe("getComboSuits()", () => {
    it("空配列 → 全スート使用可能", () => {
        expect(getComboSuits([])).toEqual(["spade", "club", "heart", "diamond"]);
    });

    it("1技能 → その技能のスートのみ", () => {
        const skill = { suits: { spade: true, club: false, heart: true, diamond: false } };
        expect(getComboSuits([skill])).toEqual(["spade", "heart"]);
    });

    it("積集合: 共通スートのみ残る", () => {
        const a = { suits: { spade: true, club: true,  heart: false, diamond: false } };
        const b = { suits: { spade: true, club: false, heart: true,  diamond: false } };
        expect(getComboSuits([a, b])).toEqual(["spade"]); // ♠のみ共通
    });

    it("共通スートなし → 空配列（組み合わせ不可）", () => {
        const a = { suits: { spade: true,  club: false, heart: false, diamond: false } };
        const b = { suits: { spade: false, club: true,  heart: false, diamond: false } };
        expect(getComboSuits([a, b])).toEqual([]);
    });
});

describe("normalizeSuit()（スート正規化・Foundry標準デッキは複数形・2026-07-11）", () => {
    it("単数/複数どちらも正規形に揃える", () => {
        expect(normalizeSuit("spades")).toBe("spade");
        expect(normalizeSuit("spade")).toBe("spade");
        expect(normalizeSuit("Hearts")).toBe("heart");
        expect(normalizeSuit("diamonds")).toBe("diamond");
        expect(normalizeSuit("clubs")).toBe("club");
    });

    it("未知・空・joker は null", () => {
        expect(normalizeSuit("joker")).toBeNull();
        expect(normalizeSuit("")).toBeNull();
        expect(normalizeSuit(undefined)).toBeNull();
    });
});

describe("comboUsesBounty()（報酬点: 参加技能のいずれかが usesBounty なら可・2026-07-10）", () => {
    it("ベースでなくても、組み合わせに usesBounty 技能が居れば true", () => {
        const base  = { usesBounty: false };
        const combo = { usesBounty: true };
        expect(comboUsesBounty([base, combo])).toBe(true);
    });

    it("全員 usesBounty なし（スタイル技能の undefined 含む）は false", () => {
        expect(comboUsesBounty([{ usesBounty: false }, {}])).toBe(false);
        expect(comboUsesBounty([])).toBe(false);
        expect(comboUsesBounty(null)).toBe(false);
    });
});
