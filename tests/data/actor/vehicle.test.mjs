import { describe, it, expect } from "vitest";
import { VehicleDataModel } from "../../../scripts/data/actor/vehicle.mjs";

describe("車両Actorの保存責務", () => {
    it("正本参照と乗員を持ち、性能・手札・CS・ARのコピーは持たない", () => {
        const schema = VehicleDataModel.defineSchema();
        expect(Object.keys(schema).sort()).toEqual(["crew", "description", "outfitUuid"]);
        expect(Object.keys(schema.crew.element.fields).sort()).toEqual(["actorUuid", "operationMode", "role", "tokenUuid"]);
    });
});
