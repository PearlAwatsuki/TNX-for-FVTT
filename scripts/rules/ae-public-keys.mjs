/** AEの公開キーと既存の適用パスの対応。保存データの構造には依存しない。 */
const ABILITIES = ["reason", "passion", "life", "mundane"];

/** 条件式を保持してキー本体だけを変換する。 */
function mapKey(key, convert) {
    if (typeof key !== "string") return key;
    const condition = key.match(/\[[^\]]*\]/)?.[0] ?? "";
    const bare = condition ? key.replace(condition, "") : key;
    const next = convert(bare);
    // 条件の元の位置に意味はない。末尾ならどの名前空間でも復元できる。
    return next === bare ? key : next + condition;
}

/** 識別キーによるアウトフィット指定はここで自己付与へ変換しない。 */
export function toPublicEffectKey(key) {
    return mapKey(key, k => {
        if (/^(check|controlCheck|damage|ignore)\./.test(k)) return `system.${k}`;
        if (k === "name") return "system.name";
        if (k === "system.slot.normal.capacity") return "system.slot.capacity";
        const ability = k.match(/^system\.(ability|control)\.(reason|passion|life|mundane)$/);
        if (ability) return `system.abilities.${ability[2]}.${ability[1] === "ability" ? "value" : "control"}`;
        const body = k.match(/^system\.partSlot\.(.+)$/);
        if (body) return `system.bodySlot.${body[1]}.capacity`;
        if (/^system\.guardValue(?:\.(?:value|total))?$/.test(k)) return "system.guard.value";
        if (k === "system.guardValue.mode") return "system.guard.mode";
        if (/^system\.attack(?:\.total)?$/.test(k)) return "system.attack.value";
        return k;
    });
}

/** 新公開キーを既存の適用処理へ橋渡しする。旧キーは移行互換として受理。 */
export function toRuntimeEffectKey(key) {
    return mapKey(key, k => {
        if (/^system\.(check|controlCheck|damage|ignore)\./.test(k)) return k.slice(7);
        if (k === "system.name") return "name";
        const ability = k.match(/^system\.abilities\.(reason|passion|life|mundane)\.(value|control)$/);
        if (ability) return `system.${ability[2] === "value" ? "ability" : "control"}.${ability[1]}`;
        const body = k.match(/^system\.bodySlot\.(.+)\.capacity$/);
        if (body) return `system.partSlot.${body[1]}`;
        if (k === "system.guard.value") return "system.guardValue";
        if (k === "system.guard.mode") return "system.guardValue.mode";
        return k;
    });
}

/** 所持技能の識別キーから、入力可能な実キーと検索ラベルを生成する。 */
export function actorEffectKeySuggestions(actor) {
    const entries = new Map();
    const add = (key, label) => { if (!entries.has(key)) entries.set(key, { key, label }); };
    const group = (kind, key, name) => {
        if (!key) return;
        add(`system.check.${kind}.${key}`, `${name} 判定補正 ${key}`);
        const title = kind === "style" ? "Style" : "Works";
        for (const direction of ["vs", "from"]) add(`system.damage.${direction}${title}.${key}`, `${name} ダメージ補正 ${key}`);
    };
    for (const item of (actor?.items ?? [])) {
        const sys = item.system ?? {};
        const key = String(sys.identificationKey ?? "").trim();
        if (["generalSkill", "styleSkill"].includes(item.type)) {
            if (key) {
                for (const attr of ["level", "usesBounty", "suits.spade", "suits.heart", "suits.diamond", "suits.club"]) {
                    add(`system.skill.${key}.${attr}`, `${item.name} ${attr === "level" ? "技能レベル" : attr} ${key}`);
                }
                add(`system.check.${key}`, `${item.name} 判定補正 ${key}`);
            }
            group("style", sys.style, sys.style);
            group("works", sys.special?.works?.organization, sys.special?.works?.organization);
        }
        if (item.type === "style") group("style", key, item.name);
    }
    return [...entries.values()];
}

/** 計算用辞書。実効値の参照と素値の参照を分離する。 */
export function publicAbilityData(system = {}) {
    return Object.fromEntries(ABILITIES.map(k => [k, {
        value: system[k]?.total, base: system[k]?.value,
        control: system[k]?.totalControl,
    }]));
}
