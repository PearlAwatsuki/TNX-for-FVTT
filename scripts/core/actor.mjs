import { SYSTEM_ID } from "../constants.mjs";
import { isEnchantment } from "../rules/ae-kind.mjs";
import { normalEffectSourceIsAvailable } from "../data/item/helpers.mjs";

/** 準備先アイテム向けの効果を、アクターへの標準転送から除外する。 */
export class TokyoNovaActor extends Actor {
    *allApplicableEffects() {
        for (const effect of super.allApplicableEffects()) {
            if (isEnchantment(effect)) continue;
            // transfer はアイテム間の自動転送にも使うため、保存値は変更しない。
            if (effect.parent?.documentName === "Item") {
                if (effect.flags?.[SYSTEM_ID]?.applyToParent === true) continue;
                // Foundry の標準列挙経路でも未準備アウトフィット由来の通常AEを除外する。
                if (!normalEffectSourceIsAvailable(effect, effect.parent)) continue;
            }
            yield effect;
        }
    }
}
