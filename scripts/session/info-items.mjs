import { SYSTEM_ID } from "../constants.mjs";
import { runSerial } from "../core/serial-queue.mjs";

/** 情報項目配列の読み取りから保存までを直列化し、公開と判定開示の競合を防ぐ。 */
export function updateInfoItems(journal, change) {
    return runSerial(`infoItems:${journal.uuid}`, async () => {
        const items = foundry.utils.deepClone(journal.getFlag(SYSTEM_ID, "infoItems") ?? []);
        const result = await change(items);
        if (result !== false) await journal.setFlag(SYSTEM_ID, "infoItems", items);
        return result;
    });
}
