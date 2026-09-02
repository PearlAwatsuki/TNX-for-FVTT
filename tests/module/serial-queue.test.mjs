import { describe, it, expect } from "vitest";
import { runSerial } from "../../scripts/module/serial-queue.mjs";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("runSerial()（キーごとの直列実行・KI-049）", () => {
    // 直列化していなければ、3つとも「まだ無い」と判断して3つ作る＝多重作成。
    // これが転送コピーが個数分できていた仕組みそのもの。
    it("同じキーの「探す→無ければ作る」が重ならない", async () => {
        const store = [];
        const createIfMissing = async () => {
            const exists = store.length > 0;
            await tick();
            if (!exists) store.push("copy");
        };
        await Promise.all([
            runSerial("actor-1", createIfMissing),
            runSerial("actor-1", createIfMissing),
            runSerial("actor-1", createIfMissing),
        ]);
        expect(store).toEqual(["copy"]);
    });

    it("別のキーは互いを待たない", async () => {
        const order = [];
        const slow = async () => { await tick(); await tick(); order.push("slow"); };
        const fast = async () => { order.push("fast"); };
        await Promise.all([runSerial("a", slow), runSerial("b", fast)]);
        expect(order).toEqual(["fast", "slow"]);
    });

    it("直前の処理が失敗しても後続は走る", async () => {
        const done = [];
        const failing = runSerial("a", async () => { throw new Error("boom"); });
        const after = runSerial("a", async () => { done.push("ok"); });
        await expect(failing).rejects.toThrow("boom");
        await after;
        expect(done).toEqual(["ok"]);
    });

    it("処理の戻り値をそのまま返す", async () => {
        await expect(runSerial("a", async () => 42)).resolves.toBe(42);
    });
});
