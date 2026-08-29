import { describe, it, expect } from "vitest";
import { TNX_BOUNDARIES, planConditionRecovery, planActionRecoveryRows, planActEndDamageCleanup } from "../../scripts/module/time-boundary-logic.mjs";

const SCOPE = "tokyo-nova-axleration";

/** BS の AE(状態のみ)。`extra` は flags 直下に載る(woundSource 等)。 */
const bs = (id, kind, extra = {}) => ({
    id, statuses: [kind], flags: { [SCOPE]: { conditionKind: kind, ...extra } },
});

/** 「治療するまで回復しない」BS（負傷 woundId に紐づく） */
const untilTreated = (id, kind, woundId) => ({
    id, statuses: [kind],
    flags: { [SCOPE]: { conditionKind: kind, woundSource: woundId, conditions: { [kind]: { durationNote: "治療まで" } } } },
});

/** 負傷そのもの（ダメージチャートの結果） */
const wound = (id, kind) => ({ id, statuses: [kind], flags: { [SCOPE]: { conditionKind: kind } } });

const plan = (effects, boundary, opts) => planConditionRecovery(effects, boundary, opts);

describe("planConditionRecovery()（BS の回復タイミング・15-4）", () => {
    describe("本人のメインプロセスに紐づく回復", () => {
        it("恐慌は本人のメインプロセスの直前に回復する", () => {
            const e = [bs("a", "panic")];
            expect(plan(e, TNX_BOUNDARIES.mainProcessStart, { isMainActor: true }).removeIds).toEqual(["a"]);
        });

        it("恐慌は他人のメインプロセスの直前では回復しない", () => {
            const e = [bs("a", "panic")];
            expect(plan(e, TNX_BOUNDARIES.mainProcessStart, { isMainActor: false }).removeIds).toEqual([]);
        });

        it("萎縮・憎悪は本人のメインプロセス終了で回復する", () => {
            const e = [bs("a", "fear"), bs("b", "hatred")];
            expect(plan(e, TNX_BOUNDARIES.mainProcessEnd, { isMainActor: true }).removeIds).toEqual(["a", "b"]);
        });

        it("萎縮・憎悪は他人のメインプロセス終了では回復しない", () => {
            const e = [bs("a", "fear"), bs("b", "hatred")];
            expect(plan(e, TNX_BOUNDARIES.mainProcessEnd, { isMainActor: false }).removeIds).toEqual([]);
        });
    });

    describe("クリンナップの回復", () => {
        it("酩酊(小)と電子妨害はクリンナップで回復する", () => {
            const e = [bs("a", "doped-minor"), bs("b", "interference")];
            expect(plan(e, TNX_BOUNDARIES.cleanup).removeIds).toEqual(["a", "b"]);
        });

        it("酩酊(大)はクリンナップで酩酊(小)に変わる", () => {
            const out = plan([bs("a", "doped-major")], TNX_BOUNDARIES.cleanup);
            expect(out.removeIds).toEqual(["a"]);
            expect(out.downgrades).toEqual([{ id: "a", toKind: "doped-minor" }]);
        });

        it("小と大を同時に受けている場合、小は回復し大が小に変わる（結果は小が1つ）", () => {
            const out = plan([bs("a", "doped-major"), bs("b", "doped-minor")], TNX_BOUNDARIES.cleanup);
            expect(out.removeIds).toEqual(["a", "b"]);
            expect(out.downgrades).toEqual([{ id: "a", toKind: "doped-minor" }]);
        });

        it("恐慌はクリンナップでは回復しない（本人のメインの直前が回復条件）", () => {
            expect(plan([bs("a", "panic")], TNX_BOUNDARIES.cleanup).removeIds).toEqual([]);
        });
    });

    describe("BS の全解除（カット進行終了・シーンが変わる＝退場）", () => {
        it("カット進行終了で BS が全部解除される", () => {
            const e = [bs("a", "panic"), bs("b", "weakness"), bs("c", "doped-major")];
            expect(plan(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual(["a", "b", "c"]);
        });

        it("全解除では酩酊(大)を小に変換しない（カットを跨がないため）", () => {
            expect(plan([bs("a", "doped-major")], TNX_BOUNDARIES.cutProgressionEnd).downgrades).toEqual([]);
        });

        it("退場でも BS が全部解除される", () => {
            expect(plan([bs("a", "weakness")], TNX_BOUNDARIES.exit).removeIds).toEqual(["a"]);
        });

        it("カット終了（次カットへ続く）では全解除しない", () => {
            expect(plan([bs("a", "weakness")], TNX_BOUNDARIES.cutEnd).removeIds).toEqual([]);
        });

        // 気絶/失神は同じ境界で回復するが、それは**自分の回復条件**による(15-5)。
        // 全解除の対象はバッドステータスだけ、という切り分けは仮死で確かめる
        it("負傷と、その境界に回復条件を持たない戦闘不能は、BS の全解除では消えない", () => {
            const e = [wound("w", "phys-10"), bs("c", "coma")];
            expect(plan(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual([]);
        });
    });

    describe("「治療するまで回復しない」BS", () => {
        it("元の負傷が残っている間は全解除でも消えない", () => {
            const e = [wound("w1", "phys-12"), untilTreated("a", "confusion", "w1")];
            expect(plan(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual([]);
        });

        it("元の負傷が治療されて消えていれば、通常どおり全解除で消える", () => {
            const e = [untilTreated("a", "confusion", "w1")];
            expect(plan(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual(["a"]);
        });

        it("元の負傷が残っていてもアクト終了では消える", () => {
            const e = [wound("w1", "phys-12"), untilTreated("a", "confusion", "w1")];
            expect(plan(e, TNX_BOUNDARIES.actEnd).removeIds).toEqual(["a"]);
        });
    });

    describe("行動を支払って回復する BS は境界では回復しない", () => {
        it("重圧・捕縛・邪毒はクリンナップでもメインプロセスでも回復しない", () => {
            const e = [bs("a", "pressure"), bs("b", "capture"), bs("c", "poison")];
            expect(plan(e, TNX_BOUNDARIES.cleanup).removeIds).toEqual([]);
            expect(plan(e, TNX_BOUNDARIES.mainProcessEnd, { isMainActor: true }).removeIds).toEqual([]);
        });

        it("ただし全解除（カット進行終了・退場）では他の BS と同じく消える", () => {
            const e = [bs("a", "pressure"), bs("b", "capture"), bs("c", "poison")];
            expect(plan(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual(["a", "b", "c"]);
        });
    });

    it("効果が無くても落ちない", () => {
        expect(planConditionRecovery(null, TNX_BOUNDARIES.exit)).toEqual({ removeIds: [], downgrades: [] });
    });
});

describe("planActionRecoveryRows()（行動を支払って回復する BS の行・15-4）", () => {
    const rows = (effects) => planActionRecoveryRows(effects);

    it("重圧を受けていれば「マイナーを使用」で回復する行が出る", () => {
        expect(rows([bs("a", "pressure")]))
            .toEqual([{ kind: "pressure", label: "重圧", count: 1, payment: "minorUse" }]);
    });

    it("捕縛は武器ごとに複数受けても行は1つ（1回のメジャー放棄で全て回復する）", () => {
        const out = rows([bs("a", "capture"), bs("b", "capture")]);
        expect(out).toEqual([{ kind: "capture", label: "捕縛", count: 2, payment: "majorAbandon" }]);
    });

    it("邪毒はマイナー・メジャー両方の放棄を一度に宣言する", () => {
        expect(rows([bs("a", "poison")]))
            .toEqual([{ kind: "poison", label: "邪毒", count: 1, payment: "minorMajorAbandon" }]);
    });

    it("受けていない BS の行は出ない", () => {
        expect(rows([bs("a", "pressure")]).map(r => r.kind)).toEqual(["pressure"]);
    });

    it("境界で回復する BS（恐慌・酩酊）の行は出ない", () => {
        expect(rows([bs("a", "panic"), bs("b", "doped-minor")])).toEqual([]);
    });

    it("狼狽は重圧と同じくマイナーの使用で回復する", () => {
        expect(rows([bs("a", "confusion")]))
            .toEqual([{ kind: "confusion", label: "狼狽", count: 1, payment: "minorUse" }]);
    });

    it("効果が無くても落ちない", () => {
        expect(planActionRecoveryRows(null)).toEqual([]);
    });
});

describe("戦闘不能の回復とアクト終了の後始末（15-5）", () => {
    it("気絶・失神はカット進行終了で回復する", () => {
        const e = [bs("a", "faint"), bs("b", "swoon")];
        expect(planConditionRecovery(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual(["a", "b"]);
    });

    it("気絶・失神はカット終了（次カットへ続く）では回復しない", () => {
        expect(planConditionRecovery([bs("a", "faint")], TNX_BOUNDARIES.cutEnd).removeIds).toEqual([]);
    });

    it("仮死・昏睡はカット進行終了では回復しない（治療が要る）", () => {
        const e = [bs("a", "coma"), bs("b", "stupor")];
        expect(planConditionRecovery(e, TNX_BOUNDARIES.cutProgressionEnd).removeIds).toEqual([]);
    });

    it("アクト終了で負傷が消える", () => {
        expect(planActEndDamageCleanup([wound("w", "phys-10")])).toEqual(["w"]);
    });

    it("負傷に紐づく戦闘不能も一緒に消える", () => {
        const e = [wound("w", "phys-11"), bs("f", "faint", { woundSource: "w" })];
        expect(planActEndDamageCleanup(e).sort()).toEqual(["f", "w"]);
    });

    it("終端状態（完全死亡・精神崩壊・抹殺）は消さない＝キャラロストは残る", () => {
        const e = [bs("a", "dead"), bs("b", "mind-break"), bs("c", "erased")];
        expect(planActEndDamageCleanup(e)).toEqual([]);
    });

    it("負傷に紐づいていても終端状態は消さない", () => {
        const e = [wound("w", "soc-21"), bs("x", "erased", { woundSource: "w" })];
        expect(planActEndDamageCleanup(e)).toEqual(["w"]);
    });

    it("負傷でも戦闘不能でもない効果は触らない", () => {
        expect(planActEndDamageCleanup([{ id: "z", flags: {} }])).toEqual([]);
    });
});

describe("仮死・昏睡の死亡判定（シーン終了＝退場・15-5）", () => {
    it("シーン終了までに治療されなければ完全死亡になる", () => {
        const out = planConditionRecovery([bs("a", "coma")], TNX_BOUNDARIES.exit);
        expect(out.removeIds).toEqual(["a"]);
        expect(out.downgrades).toEqual([{ id: "a", toKind: "dead" }]);
    });

    it("昏睡も同じく完全死亡になる（Damage_Rules の表記どおり）", () => {
        const out = planConditionRecovery([bs("a", "stupor")], TNX_BOUNDARIES.exit);
        expect(out.downgrades).toEqual([{ id: "a", toKind: "dead" }]);
    });

    it("シーンが終わる前（カット進行終了）では死なない", () => {
        expect(planConditionRecovery([bs("a", "coma")], TNX_BOUNDARIES.cutProgressionEnd).removeIds)
            .toEqual([]);
    });

    it("治療されて仮死が消えていれば何も起きない", () => {
        expect(planConditionRecovery([wound("w", "phys-15")], TNX_BOUNDARIES.exit).removeIds).toEqual([]);
    });
});
