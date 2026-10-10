import { describe, expect, it, vi } from "vitest";
import { EffectsSheetMixin, buildNewEffectData } from "../../scripts/ui/effects-sheet-mixin.mjs";
import { MIGRATIONS } from "../../scripts/core/migrations.mjs";
import { SYSTEM_ID } from "../../scripts/constants.mjs";

describe("AE 型分離撤回後の既存データ", () => {
    it("保存済み enchantment も従来の自動適用・転送・非表示の分類に従う", () => {
        const effect = (id, flags = {}, transfer = true) => ({
            id, uuid: `Item.i.ActiveEffect.${id}`, type: "enchantment", transfer,
            flags: { [SYSTEM_ID]: flags },
        });
        const passive = effect("passive", { applyToParent: true });
        const payload = effect("payload", {}, false);
        const transferred = effect("copy", { transferredFrom: "Item.source.ActiveEffect.e" }, false);
        const hidden = effect("hidden", { hideFromList: true });
        const document = { documentName: "Item", effects: [passive, payload, transferred, hidden] };
        const before = structuredClone(document);
        const context = {};
        EffectsSheetMixin.prepareEffectsContext(document, context);
        expect(context.allEffects).toEqual([passive]);
        expect(context.effects.payload).toEqual([payload]);
        expect(context.effects.transferred.map(e => e.id)).toEqual(["copy"]);
        expect(document).toEqual(before);
    });

    it("通常AEの作成データは型を指定しない", () => {
        const data = buildNewEffectData({ uuid: "Item.i" }, "normal");
        expect(data.name).toBe("新規効果");
        expect(data).not.toHaveProperty("type");
        expect(data).not.toHaveProperty("system");
    });

    it("付与AEは作成時点で type と system を同時に指定する", () => {
        const data = buildNewEffectData({ uuid: "Item.i" }, "enchantment");
        expect(data.type).toBe("enchantment");
        expect(data.system).toEqual({});
        expect(data.transfer).toBe(true);
        expect(data.flags[SYSTEM_ID]).toEqual({ applyToParent: false, applyToSelf: true });
    });

    it("移行 v6 はワールドデータに触れず、版番号の枠だけ保持する", async () => {
        const migration = MIGRATIONS.find(m => m.version === 6);
        const oldGame = globalThis.game;
        try {
            globalThis.game = new Proxy({}, { get() { throw new Error("撤回済み移行がワールドにアクセスした"); } });
            await expect(migration.run()).resolves.toBeUndefined();
        } finally {
            globalThis.game = oldGame;
        }
    });
});
