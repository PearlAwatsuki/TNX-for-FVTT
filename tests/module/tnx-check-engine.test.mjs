import { describe, it, expect } from "vitest";
import {
    SUIT_TO_ABILITY,
    getCardCheckValue,
    getAbilityBySuit,
    calcSkillCheck,
    calcControlCheck,
    getComboSuits,
} from "../../scripts/module/tnx-check-engine.mjs";

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
