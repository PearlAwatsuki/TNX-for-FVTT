import { describe, it, expect, vi } from "vitest";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { captureNextCheckEffects, matchNextCheckEffects } from "../../scripts/rules/next-check-expiry.mjs";
import { expireNextCheckEffects, attackResolutionComplete, expireResolvedAttackEffects } from "../../scripts/core/next-check-expiry.mjs";
import { durationExpiresAt, planEffectExpiry, planItemGrantExpiry, durationLabelOf } from "../../scripts/rules/time-boundary.mjs";

function collection(values) {
    const map = new Map(values.map(v => [v.id, v]));
    map[Symbol.iterator] = map.values.bind(map);
    return map;
}
function effect(id, key = "system.check.all", extra = {}) {
    const data = { _id: id, transfer: false, disabled: false, flags: { [SYSTEM_ID]: { tnxDuration: "nextCheck" } },
        system: { changes: [{ key, value: "3" }] }, ...extra };
    return { ...data, id, toObject() { return structuredClone(data); } };
}
function actorWith(effects, items = []) {
    const actor = { uuid: "Actor.a", effects: collection(effects), items: collection(items), system: {} };
    actor.deleteEmbeddedDocuments = vi.fn(async (_, ids) => { for (const id of ids) actor.effects.delete(id); });
    return actor;
}

describe("次の1回の判定まで", () => {
    it("命中後はダメージ算出を待ち、対象の未解決と全対象回避を区別する", () => {
        expect(attackResolutionComplete({ isAttack: true, targets: [{ state: "hit" }] })).toBe(false);
        expect(attackResolutionComplete({ isAttack: true, targets: [{ state: "miss" }, { state: "pending" }] })).toBe(false);
        expect(attackResolutionComplete({ isAttack: true, targets: [{ state: "miss" }] })).toBe(true);
        expect(attackResolutionComplete({ isAttack: true, targets: [], state: "open" })).toBe(false);
        expect(attackResolutionComplete({ isAttack: true, damageRolled: true })).toBe(true);
        expect(attackResolutionComplete({ isAttack: true, state: "fumble" })).toBe(true);
    });
    it("保存済み攻撃から消費を再開でき、他のActorへは適用しない", async () => {
        const actor = actorWith([effect("e")]);
        actor.isOwner = true;
        const message = { flags: { [SYSTEM_ID]: { attackCheck: { attackerUuid: actor.uuid, isAttack: true, damageRolled: true,
            nextCheckExpiry: { actorUuid: actor.uuid, entries: captureNextCheckEffects(actor) } } } } };
        const old = globalThis.fromUuid;
        globalThis.fromUuid = async () => actor;
        try {
            await expireNextCheckEffects(actor, { actorUuid: "Actor.other", entries: captureNextCheckEffects(actor) });
            expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
            await expireResolvedAttackEffects(JSON.parse(JSON.stringify(message)));
            await expireResolvedAttackEffects(message);
            expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledTimes(1);
        } finally { globalThis.fromUuid = old; }
    });
    it("パッシブ・転送コピー・無効効果を候補へ含めない", () => {
        const passive = effect("passive", undefined, { transfer: true });
        const transfer = effect("copy");
        transfer.flags[SYSTEM_ID].transferredFrom = "Item.source.ActiveEffect.e";
        const actor = actorWith([effect("active"), passive, transfer, effect("off", undefined, { disabled: true })]);
        expect(captureNextCheckEffects(actor).map(e => e.effectId)).toEqual(["active"]);
    });
    it("条件の合う技能判定だけを対象とし、制御判定と区別する", () => {
        // check.melee は usageCheck(白兵攻撃バフ)になったため、技能判定 criteria では合致しない(2026-09-24)
        // 技能判定バフのテストは check.melee 以外のキーで行い、check.melee は usageCheck 向けとして確認
        const actor = actorWith([
            effect("skill", "system.check.shooting"),  // 射撃技能バフ
            effect("melee-usage", "system.check.melee"),  // 白兵攻撃usageCheckバフ
            effect("all"), effect("control", "system.controlCheck.life")]);
        const entries = captureNextCheckEffects(actor);
        // shooting 技能判定には check.shooting と check.all が合致
        expect(matchNextCheckEffects(actor, entries, { type: "skill", skills: [{ key: "shooting" }] }).map(e => e.effectId)).toEqual(["skill", "all"]);
        // 白兵攻撃判定には check.melee(usageCheck) と check.all が合致
        expect(matchNextCheckEffects(actor, entries, { type: "skill", skills: [{ key: "shooting" }], usageType: "physicalAttack", attackWeaponKind: "melee" }).map(e => e.effectId)).toEqual(["skill", "melee-usage", "all"]);
        expect(matchNextCheckEffects(actor, entries, { type: "control", ability: "life" }).map(e => e.effectId)).toEqual(["control"]);
    });
    it("開始後の新規付与・同じIDへの再付与を消費しない", async () => {
        const original = effect("e");
        original.flags[SYSTEM_ID].grantInstanceId = "first";
        const actor = actorWith([original]);
        const entries = captureNextCheckEffects(actor);
        original.flags[SYSTEM_ID].grantInstanceId = "second";
        actor.effects.set("new", effect("new"));
        await expireNextCheckEffects(actor, { actorUuid: actor.uuid, entries });
        expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    });
    it("照合や中止では消費せず、確定後の同時再実行でも削除は一度だけ", async () => {
        const actor = actorWith([effect("e")]);
        const entries = matchNextCheckEffects(actor, captureNextCheckEffects(actor), { type: "ability", ability: "life" });
        expect(actor.effects.has("e")).toBe(true);
        expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
        const snapshot = JSON.parse(JSON.stringify({ actorUuid: actor.uuid, entries }));
        await Promise.all([expireNextCheckEffects(actor, snapshot), expireNextCheckEffects(actor, snapshot)]);
        expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledTimes(1);
        expect(actor.effects.has("e")).toBe(false);
    });
    it("アウトフィットの付与実体を消し、元定義には触れない", async () => {
        const grant = effect("grant", "system.attack.value");
        grant.flags[SYSTEM_ID].grantedFrom = "Item.s.ActiveEffect.e";
        const item = { id: "w", system: {}, effects: collection([effect("definition", "system.attack.value"), grant]) };
        item.deleteEmbeddedDocuments = vi.fn(async (_, ids) => { for (const id of ids) item.effects.delete(id); });
        const actor = actorWith([], [item]);
        const entries = matchNextCheckEffects(actor, captureNextCheckEffects(actor), { type: "skill", skills: [{ key: "melee" }] });
        expect(item.effects.size).toBe(2);
        await expireNextCheckEffects(actor, { actorUuid: actor.uuid, entries });
        expect(item.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", ["grant"]);
        expect(item.effects.has("definition")).toBe(true);
    });
    it("シーン境界を越えて残り、アクト終了で実体のみ失効する", () => {
        const active = effect("active");
        const passive = effect("passive", undefined, { transfer: true });
        expect(durationLabelOf(active)).toBe("次の1回の判定まで");
        for (const boundary of ["mainProcessEnd", "cutEnd", "cutProgressionEnd", "exit", "sceneStart"]) {
            expect(durationExpiresAt("nextCheck", boundary)).toBe(false);
        }
        expect(planEffectExpiry([active, passive], "actEnd")).toEqual(["active"]);
        active.flags[SYSTEM_ID].grantInstanceId = "preset-grant";
        expect(planItemGrantExpiry([{ id: "w", effects: [active, passive] }], "actEnd")).toEqual([{ itemId: "w", effectIds: ["active"] }]);
    });
});
