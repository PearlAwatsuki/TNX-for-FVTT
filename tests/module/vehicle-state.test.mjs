import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { requestVehicleOperation, prepareVehicleAppearance, syncVehicleTokens, vehicleDefenceItems, crewTarget, ghostCanInteract } from "../../scripts/session/vehicle-state.mjs";
import { vehicleDamageCategory, validateCrew } from "../../scripts/rules/vehicle.mjs";
import { aggregateDefence } from "../../scripts/rules/damage.mjs";
import { syncTokensForActor } from "../../scripts/session/appearance-state.mjs";

describe("ヴィークル登場と乗員", () => {
    let documents, actors, owner, item;
    function actor(id) {
        const a = { id, uuid: `Actor.${id}`, name: id, type: "cast", system: { isGhost: false }, items: [], ownership: {},
            isOwner: true, testUserPermission: () => true, getFlag: () => true, getActiveTokens: () => [],
            update: vi.fn(async patch => { for (const [key, value] of Object.entries(patch)) a.system[key.replace("system.", "")] = value; }) };
        documents.set(a.uuid, a); actors.push(a); return a;
    }
    beforeEach(() => {
        documents = new Map(); actors = []; actors.contents = actors;
        vi.stubGlobal("game", { user: { id: "gm", isGM: true }, actors });
        vi.stubGlobal("fromUuidSync", uuid => documents.get(uuid));
        vi.stubGlobal("canvas", { scene: { tokens: [] } });
        vi.stubGlobal("Actor", { TYPES: ["cast", "guest", "troop", "extra", "vehicle"], create: vi.fn(async data => {
            const v = actor(`v${actors.length}`);
            Object.assign(v, data, { system: { ...data.system, crew: [] } });
            v.getTokenDocument = vi.fn(async pos => ({ toObject: () => ({ actorId: v.id, ...pos }) }));
            return v;
        }) });
        owner = actor("owner");
        item = { id: "car", uuid: `${owner.uuid}.Item.car`, name: "車", type: "vehicle", actor: owner,
            system: { isPrepared: true, isCarrying: true, classifications: [{ major: "vehicle", minor: "groundVehicle" }],
                passenger: { mode: "value", value: 2 }, defence: { mode: "value", S_total: 3, P_total: 4, I_total: 5 } },
            update: vi.fn(async patch => { for (const [key, value] of Object.entries(patch)) item.system[key.replace("system.", "")] = value; }) };
        owner.items.push(item); documents.set(item.uuid, item);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("未登場者の手動搭乗を拒否し、乗員一覧を変更しない", async () => {
        const vehicleUuid = await prepareVehicleAppearance(owner);
        const passenger = actor("offstage");
        passenger.getFlag = () => false;
        await expect(requestVehicleOperation("board", { vehicleUuid, actorUuid: passenger.uuid, role: "passenger" })).rejects.toThrow("未登場");
        expect(documents.get(vehicleUuid).system.crew).toHaveLength(1);
    });
    it("退場すると乗員から外れるが、車両の準備は維持して次の登場に使える", async () => {
        const vehicleUuid = await prepareVehicleAppearance(owner);
        owner.getFlag = () => false;
        await requestVehicleOperation("exit", { actorUuid: owner.uuid });
        expect(documents.get(vehicleUuid).system.crew).toEqual([]);
        expect(item.system.isPrepared).toBe(true);
        owner.getFlag = () => true;
        await prepareVehicleAppearance(owner);
        expect(documents.get(vehicleUuid).system.crew).toHaveLength(1);
    });

    function sceneWithTokens(tokens = []) {
        const scene = { id: "scene", width: 1000, height: 1000, tokens,
            createEmbeddedDocuments: vi.fn(async (_type, rows) => {
                const created = rows.map((row, index) => ({ ...row, id: `new${index}`, parent: scene }));
                scene.tokens.push(...created); return created;
            }),
            deleteEmbeddedDocuments: vi.fn(async (_type, ids) => { scene.tokens = scene.tokens.filter(t => !ids.includes(t.id)); }) };
        game.scenes = { active: scene }; canvas.scene = scene;
        owner.getTokenDocument = vi.fn(async () => ({ toObject: () => ({ actorId: owner.id }) }));
        return scene;
    }
    it("同乗者がいても操縦者の退場で車両が消え、同乗者同期では再配置しない", async () => {
        const vehicleUuid = await prepareVehicleAppearance(owner);
        const passenger = actor("passenger");
        await requestVehicleOperation("board", { vehicleUuid, actorUuid: passenger.uuid, role: "passenger" });
        const scene = sceneWithTokens();
        await syncVehicleTokens(owner, scene);
        expect(scene.tokens).toHaveLength(1);
        owner.getFlag = () => false;
        await requestVehicleOperation("exit", { actorUuid: owner.uuid });
        expect(scene.tokens).toHaveLength(0);
        await syncVehicleTokens(passenger, scene);
        expect(scene.tokens).toHaveLength(0);
        expect(item.system.isPrepared).toBe(true);
    });
    it("搭乗中は車両だけを置き、本人コマの削除前に戦闘参加をActorへ引き継ぐ", async () => {
        const vehicleUuid = await prepareVehicleAppearance(owner);
        const scene = sceneWithTokens([{ id: "original", actorId: owner.id, actor: owner, x: 100, y: 200 }]);
        const combatant = { id: "c", tokenId: "original", sceneId: scene.id, initiative: 15 };
        const combat = { combatants: [combatant], updateEmbeddedDocuments: vi.fn(async (_type, rows) => Object.assign(combatant, rows[0])) };
        game.combats = [combat];
        await syncTokensForActor(owner);
        expect(scene.tokens.map(t => t.actorId)).toEqual([documents.get(vehicleUuid).id]);
        expect(combatant).toMatchObject({ actorId: owner.id, tokenId: null, initiative: 15 });
        expect(combat.updateEmbeddedDocuments.mock.invocationCallOrder[0]).toBeLessThan(scene.deleteEmbeddedDocuments.mock.invocationCallOrder[0]);
        expect(scene.deleteEmbeddedDocuments).toHaveBeenCalledWith("Token", ["original"], { tnxAppearanceSync: true });
        expect(owner.getTokenDocument).not.toHaveBeenCalled();
    });
    it("降車は車両と重ならない近傍へ配置し、高度は維持する", async () => {
        await prepareVehicleAppearance(owner);
        const scene = sceneWithTokens();
        await syncTokensForActor(owner);
        expect(scene.tokens).toHaveLength(1);
        Object.assign(scene.tokens[0], { x: 700, y: 300, elevation: 2 });
        await requestVehicleOperation("leave", { actorUuid: owner.uuid });
        await syncTokensForActor(owner);
        const own = scene.tokens.find(t => t.actorId === owner.id);
        expect(own).toMatchObject({ elevation: 2 });
        expect(own.x === 700 && own.y === 300).toBe(false);
        expect(Math.abs(own.x - 700)).toBeLessThanOrEqual(100);
        expect(Math.abs(own.y - 300)).toBeLessThanOrEqual(100);
    });
    it("遠隔操縦の終了後に操縦者の肉体コマを生成しない", async () => {
        item.system.classifications[0].minor = "drone";
        await prepareVehicleAppearance(owner);
        const scene = sceneWithTokens();
        await syncTokensForActor(owner);
        await requestVehicleOperation("leave", { actorUuid: owner.uuid });
        await syncTokensForActor(owner);
        expect(scene.tokens.some(t => t.actorId === owner.id)).toBe(false);
        expect(owner.getTokenDocument).not.toHaveBeenCalled();
    });

    it("サーバーのActor型が旧定義なら、作成前に再起動を案内する", async () => {
        Actor.TYPES = ["cast", "guest", "troop", "extra"];
        await expect(prepareVehicleAppearance(owner)).rejects.toThrow("Foundry本体（サーバー）");
        expect(Actor.create).not.toHaveBeenCalled();
        expect(owner.update).not.toHaveBeenCalled();
        expect(item.update).not.toHaveBeenCalled();
    });
    it("作成が中止されてもuuid参照や搭乗処理へ進まず、次の再試行は成功する", async () => {
        Actor.create.mockResolvedValueOnce(undefined);
        await expect(prepareVehicleAppearance(owner)).rejects.toThrow("アクターを作成できませんでした");
        expect(owner.update).not.toHaveBeenCalled();
        expect(item.update).not.toHaveBeenCalled();
        await expect(prepareVehicleAppearance(owner)).resolves.toMatch(/^Actor\./);
    });
    it("直接の作成要求も、中止を成功扱いしない", async () => {
        Actor.create.mockResolvedValueOnce(undefined);
        await expect(requestVehicleOperation("create", { itemUuid: item.uuid })).rejects.toThrow("アクターを作成できませんでした");
    });

    it("準備済みで登場すると一台だけ作り、再試行でも操縦者を重複登録しない", async () => {
        const [first, second] = await Promise.all([prepareVehicleAppearance(owner), prepareVehicleAppearance(owner)]);
        expect(first).toBe(second);
        expect(Actor.create).toHaveBeenCalledTimes(1);
        expect(documents.get(first).system.crew).toEqual([{ actorUuid: owner.uuid, tokenUuid: "", role: "driver", operationMode: "onboard" }]);
    });
    it("同時の登場更新でも車両コマは一つだけ配置する", async () => {
        await prepareVehicleAppearance(owner);
        const scene = { id: "s", width: 1000, height: 1000, tokens: [], createEmbeddedDocuments: vi.fn(async (_type, rows) => {
            scene.tokens.push(...rows); return rows;
        }) };
        await Promise.all([syncVehicleTokens(owner, scene), syncVehicleTokens(owner, scene)]);
        expect(scene.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
    });
    it("同乗者の防御に車両を加算し、操縦者では二重加算しない。定員超過は拒否", async () => {
        const uuid = await prepareVehicleAppearance(owner);
        const passenger = actor("passenger");
        await requestVehicleOperation("board", { vehicleUuid: uuid, actorUuid: passenger.uuid, role: "passenger" });
        expect(aggregateDefence(vehicleDefenceItems(owner))).toEqual({ S: 3, P: 4, I: 5 });
        expect(aggregateDefence(vehicleDefenceItems(passenger))).toEqual({ S: 3, P: 4, I: 5 });
        await expect(requestVehicleOperation("board", { vehicleUuid: uuid, actorUuid: actor("third").uuid, role: "passenger" })).rejects.toThrow("乗員数");
        expect(documents.get(uuid).system.crew).toHaveLength(2);
    });
    it("ドローン登場はゴーストになり、ドローン経由の対象だけ精神適用する", async () => {
        item.system.classifications[0].minor = "drone";
        const uuid = await prepareVehicleAppearance(owner);
        const vehicle = documents.get(uuid);
        expect(owner.system.isGhost).toBe(true);
        expect(ghostCanInteract(owner)).toBe(false);
        canvas.scene.tokens.push({ actorId: vehicle.id, uuid: "Scene.s.Token.drone" });
        expect(ghostCanInteract(owner)).toBe(true);
        const target = crewTarget(vehicle, vehicle.system.crew[0]);
        expect(target.uuid).toBe(owner.uuid);
        expect(vehicleDamageCategory(target, "physical")).toBe("mental");
        expect(vehicleDamageCategory({ uuid: "Actor.other" }, "physical")).toBe("physical");
        await requestVehicleOperation("leave", { actorUuid: owner.uuid });
        expect(owner.system.isGhost).toBe(true);
        expect(ghostCanInteract(owner)).toBe(false);
    });
    it("壊れた準備車両では作成しない", async () => {
        item.system.isDestroyed = true;
        await expect(prepareVehicleAppearance(owner)).rejects.toThrow("破壊");
        expect(Actor.create).not.toHaveBeenCalled();
    });
    it("RL不在では未完了を成功扱いせず、明示的に失敗する", async () => {
        game.user.isGM = false;
        game.users = { activeGM: null };
        await expect(requestVehicleOperation("appear", { actorUuid: owner.uuid })).rejects.toThrow("RL");
    });
    it("遠隔操縦者を物理的な定員として数えない", () => {
        expect(validateCrew([{ actorUuid: "a", role: "driver", operationMode: "remote" }], { mode: "value", value: 0 })).toBeNull();
    });
});
