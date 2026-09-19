import { SYSTEM_ID } from "../constants.mjs";

/** 準備先アイテム向けの効果を、アクターへの標準転送から除外する。 */
export class TokyoNovaActor extends Actor {
    *allApplicableEffects() {
        for (const effect of super.allApplicableEffects()) {
            // transfer はアイテム間の自動転送にも使うため、保存値は変更しない。
            if (effect.parent?.documentName === "Item"
                && effect.flags?.[SYSTEM_ID]?.applyToParent === true) continue;
            yield effect;
        }
    }
}
