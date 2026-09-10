import { describe, it, expect, vi, afterEach } from "vitest";
import { editTokenImage } from "../../scripts/actor/sheet-images.mjs";

afterEach(() => vi.unstubAllGlobals());

function setup(isToken = false) {
    let options;
    const browse = vi.fn();
    vi.stubGlobal("foundry", { applications: { apps: { FilePicker: { implementation: class {
        constructor(value) { options = value; }
        browse = browse;
    } } } } });
    const token = { texture: { src: "old-token.webp" }, update: vi.fn() };
    const actor = { isToken, img: "portrait.webp", token, prototypeToken: token, update: vi.fn() };
    const sheet = { actor, isEditable: true, _isEditMode: true, position: { top: 0, left: 0 } };
    const target = { src: "old-token.webp" };
    return { sheet, actor, token, target, browse, options: () => options };
}

describe("コマ画像の直接選択", () => {
    it.each([false, true])("画像選択から対象の画像だけを保存する（合成アクター: %s）", async isToken => {
        const t = setup(isToken);
        await editTokenImage.call(t.sheet, { preventDefault() {} }, t.target);
        expect(t.browse).toHaveBeenCalledOnce();
        expect(t.options()).toMatchObject({ type: "image", current: "old-token.webp" });
        expect(t.actor.update).not.toHaveBeenCalled();
        expect(t.token.update).not.toHaveBeenCalled();
        await t.options().callback("new-token.webp");
        if (isToken) {
            expect(t.token.update).toHaveBeenCalledWith({ "texture.src": "new-token.webp" });
            expect(t.actor.update).not.toHaveBeenCalled();
        } else {
            expect(t.actor.update).toHaveBeenCalledWith({ "prototypeToken.texture.src": "new-token.webp" });
            expect(t.token.update).not.toHaveBeenCalled();
        }
        expect(t.actor.img).toBe("portrait.webp");
        expect(t.target.src).toBe("new-token.webp");
    });
    it.each(["isEditable", "_isEditMode"])("%s が無効なら選択も保存もしない", async field => {
        const t = setup();
        t.sheet[field] = false;
        await editTokenImage.call(t.sheet, { preventDefault() {} }, t.target);
        expect(t.browse).not.toHaveBeenCalled();
        t.sheet[field] = true;
        await editTokenImage.call(t.sheet, { preventDefault() {} }, t.target);
        t.sheet[field] = false;
        await t.options().callback("new-token.webp");
        expect(t.actor.update).not.toHaveBeenCalled();
    });
});
