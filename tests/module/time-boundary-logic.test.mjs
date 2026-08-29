import { describe, it, expect } from "vitest";
import {
    TNX_BOUNDARIES, TNX_DURATIONS,
    readEffectDuration, durationLabelOf, durationExpiresAt, planEffectExpiry,
} from "../../scripts/module/time-boundary-logic.mjs";

const SCOPE = "tokyo-nova-axleration";
const withDuration = (id, duration) => ({ id, flags: { [SCOPE]: { tnxDuration: duration } } });

describe("TNX_DURATIONS（TNX の持続時間の選択肢・15-1）", () => {
    it("Time_Management の時間単位＋無期限だけを持つ", () => {
        expect(Object.keys(TNX_DURATIONS)).toEqual([
            "", "mainProcess", "cut", "scene", "act",
        ]);
    });

    // 「治療まで」は選択肢に置かない(2026-08-29 ユーザー指摘)。挙動が「アクト中」と完全に
    // 同一なうえ、RL が手で組んだ効果に「治療する」操作は存在しない。本来の「治療するまで
    // 回復しない」BS は元の負傷 AE の生存から導出する(設計判断7)ため、この欄を使わない。
    it("「治療まで」は選択肢に無い", () => {
        expect(TNX_DURATIONS).not.toHaveProperty("untilTreated");
        expect(durationExpiresAt("untilTreated", TNX_BOUNDARIES.actEnd)).toBe(false);
    });

    it("空文字は「なし」＝無期限を表す", () => {
        expect(TNX_DURATIONS[""]).toBe("なし");
    });
});

describe("readEffectDuration()（効果に載った持続の読み取り）", () => {
    it("フラグに保存された持続を返す", () => {
        expect(readEffectDuration(withDuration("a", "cut"))).toBe("cut");
    });

    it("未設定は無期限（空文字）", () => {
        expect(readEffectDuration({ id: "a", flags: {} })).toBe("");
        expect(readEffectDuration(null)).toBe("");
    });

    it("未知の値は無期限として扱う（勝手に失効させない）", () => {
        expect(readEffectDuration(withDuration("a", "rounds"))).toBe("");
    });
});

describe("durationLabelOf()（一覧の「効果時間」列に出す表示）", () => {
    it("持続を持つ効果はそのラベルを返す", () => {
        expect(durationLabelOf(withDuration("a", "scene"))).toBe("シーン中");
    });

    it("持続を持たない効果は空文字（「なし」と書いて列を埋めない）", () => {
        expect(durationLabelOf({ id: "a", flags: {} })).toBe("");
    });
});

describe("durationExpiresAt()（境界でその持続が失効するか）", () => {
    it("メインプロセス中はメインプロセスの終了で失効する", () => {
        expect(durationExpiresAt("mainProcess", TNX_BOUNDARIES.mainProcessEnd)).toBe(true);
    });

    it("カット中はメインプロセスの終了では失効しない", () => {
        expect(durationExpiresAt("cut", TNX_BOUNDARIES.mainProcessEnd)).toBe(false);
    });

    it("カット中はカット終了・カット進行終了のどちらでも失効する", () => {
        expect(durationExpiresAt("cut", TNX_BOUNDARIES.cutEnd)).toBe(true);
        expect(durationExpiresAt("cut", TNX_BOUNDARIES.cutProgressionEnd)).toBe(true);
    });

    it("上位の境界は下位の単位も畳む（カット終了でメインプロセス中も失効）", () => {
        expect(durationExpiresAt("mainProcess", TNX_BOUNDARIES.cutEnd)).toBe(true);
    });

    it("シーン中はカット進行終了では失効しない（カット進行終了とシーン終了は非連動）", () => {
        expect(durationExpiresAt("scene", TNX_BOUNDARIES.cutProgressionEnd)).toBe(false);
    });

    it("シーン中は退場で失効する（退場＝そのキャラのシーンの終わり）", () => {
        expect(durationExpiresAt("scene", TNX_BOUNDARIES.exit)).toBe(true);
    });

    it("アクト中は退場では失効せず、アクト終了で失効する", () => {
        expect(durationExpiresAt("act", TNX_BOUNDARIES.exit)).toBe(false);
        expect(durationExpiresAt("act", TNX_BOUNDARIES.actEnd)).toBe(true);
    });

    it("無期限（未設定）はアクト終了でも失効しない", () => {
        expect(durationExpiresAt("", TNX_BOUNDARIES.actEnd)).toBe(false);
    });

    it("クリンナップとシーン開始は持続の境界ではない（状態別の回復・発火だけを担う）", () => {
        expect(durationExpiresAt("mainProcess", TNX_BOUNDARIES.cleanup)).toBe(false);
        expect(durationExpiresAt("scene", TNX_BOUNDARIES.sceneStart)).toBe(false);
    });
});

describe("planEffectExpiry()（境界で失効させる効果の抽出）", () => {
    it("その境界で失効する持続を持つ効果の id だけを返す", () => {
        const effects = [
            withDuration("a", "cut"),
            withDuration("b", "scene"),
            withDuration("c", "mainProcess"),
        ];
        expect(planEffectExpiry(effects, TNX_BOUNDARIES.cutEnd)).toEqual(["a", "c"]);
    });

    it("持続を持たない効果は残す", () => {
        expect(planEffectExpiry([{ id: "a", flags: {} }], TNX_BOUNDARIES.actEnd)).toEqual([]);
    });

    it("効果が無くても落ちない", () => {
        expect(planEffectExpiry(null, TNX_BOUNDARIES.actEnd)).toEqual([]);
    });
});
