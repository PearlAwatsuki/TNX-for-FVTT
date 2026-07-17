/**
 * @fileoverview TnxUsageSheet - 用途エントリの編集シート
 *
 * 用途データはアイテムの system.actions[] に格納されている。
 * このシートは item と usageId を受け取り、対象エントリを
 * 読み書きする疑似ドキュメントシートとして機能する。
 *
 * D&D 5e の Activity Sheet を参考に設計:
 *   - タブ構成: 基本 / 発動 / 効果
 *   - 発動タブ: タイミング・対象・射程・目標値・対決不可（＋参加技能からの自動入力）
 *   - 効果タブ: 種別固有設定（コンボ・武器・ダメージ・改造）＋適用される ActiveEffect
 *   - タイプは作成時に固定（UI 上で変更不可）
 */

import { TnxSkillUtils } from "./tnx-skill-utils.mjs";
import { getComboSuits } from "./tnx-check-engine.mjs";
import { resolveUsageSkills, comboLockAnalysis, isComboRequired } from "./skill-chain-resolution.mjs";
import { deriveConsumeTargets } from "./usage-consumption.mjs";
import { CONDITION_KINDS } from "./conditions.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { readFlag } from "../data/item/helpers.mjs";
import { resolveAttackWeapons, attackWeaponDisplayName, resolveAttackRangeSpan, attackWeaponKindEligible } from "./attack-weapons.mjs";
import { WEAPON_RANGE_MAX_OPTIONS } from "../data/item/weapon.mjs";
import { loadSkillChoices, loadCascadeData, buildSkillCascadeSteps, loadSkillUsageTypeIndex, loadDictionarySkillItems, SKILL_PACKS } from "./skill-dictionary.mjs";
import {
    USAGE_TYPE_LABELS, isAttackType, attackCategoryOf, isReactionType, usesVehicle,
    executionFormOf, defaultConfrontationForType, usageDisplayName, effectiveBaseSkillId,
} from "./usage-types.mjs";
import { USAGE_CONFRONTATION_OPTIONS, mergeConfrontationRows } from "./confrontation-logic.mjs";
import { findItemByIdentificationKey, formatSkillName, itemDisplayName } from "./identification.mjs";
import { hasAmmoTracking } from "./weapon-ammo.mjs";

const CHAIN_SKILL_TYPES = ["generalSkill", "styleSkill"];

/**
 * 用途の技能参照(ベース・組み合わせ)を解決する「同輩」技能一覧(2026-07-18 ユーザー是正)。
 * アクター所持=アクターの技能・辞典(コンペンディウム)アイテム=同じパックの技能・
 * ワールド直下=ワールドの技能。従来はアクター所持しか見ておらず、辞典/ワールド直下の
 * 用途ではベース技能・組み合わせが解決されなかった。パックは getDocument(キャッシュ優先=
 * 差し替えを起こさない)で個別に読む——getDocuments の一括再取得は開いているシートを
 * 孤児化させるため使わない(KI-026)。
 * @param {Item} item 用途を持つアイテム
 * @returns {Promise<Item[]>} 同輩の技能(generalSkill/styleSkill。item 自身が技能なら含む)
 */
export async function resolveUsageSiblingSkills(item) {
    const isSkill = (t) => CHAIN_SKILL_TYPES.includes(t);
    if (item.actor) return item.actor.items.filter(i => isSkill(i.type));
    // アクター非所持(ワールド直下・辞典内を問わず)は**技能辞典**を参照する(2026-07-18 統一)。
    // 旧実装の「辞典=同パック限定／ワールド直下=game.items」という区別を撤去——プルダウンが
    // 辞典を参照する以上、ワールド直下からも辞典を参照できてしかるべき(ユーザー確定)。
    const dict = await loadDictionarySkillItems();
    // 編集中アイテム自身が技能なら live 版で辞典エントリを上書きする(未保存の編集を反映)
    if (isSkill(item.type)) return [item, ...dict.filter(s => s.id !== item.id)];
    return dict;
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ─── system.actions の直列書き込みキュー(2026-07-17) ─────────────────────────────
// 用途は1フィールドの配列(system.actions)に同居するため、並行する全配列書き込み
// (用途シートの submitOnChange/必須コンボ enforcement と、一覧の追加/削除)が最後勝ちで
// 互いを巻き戻す——削除した用途が in-flight の書き込みで復活する等。アイテムごとに
// 書き込みを直列化し、mutate は**直前の書き込み完了後の最新 actions** を受け取って
// 新しい配列(null=変更なし)を返す。これで stale スナップショットの全配列上書きが消える。
const actionsWriteQueues = new Map(); // item.uuid → Promise

/**
 * system.actions を直列に書き換える(全書き込み経路はこれを通す)。
 * @param {Item} item 用途を持つアイテム
 * @param {(actions: Array<object>) => (Array<object>|null|Promise<Array<object>|null>)} mutate
 *        最新の actions(ディープコピー)を受け取り、新配列を返す(null=変更なし・書き込みしない)
 */
export async function updateUsageActions(item, mutate) {
    const key = item.uuid ?? item.id;
    const prev = actionsWriteQueues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
        // コンペンディウム文書は、パックの一括再取得(getDocuments)等でコレクションの
        // インスタンスが差し替わり得る——シートが掴んだままの旧インスタンスは以後の更新を
        // 受け取らない「孤児」になる(2026-07-17 特定: 辞典アイテムの用途削除が画面に残る
        // 実因)。書き込み直前に正準(現行キャッシュ)の文書へ解決してから読み書きすることで、
        // 孤児経由の stale 全配列上書き(並行編集の巻き戻し)を封じる
        const doc = (item.pack ? await fromUuid(item.uuid).catch(() => null) : null) ?? item;
        const actions = foundry.utils.deepClone(doc.system.actions ?? []);
        const result = await mutate(actions);
        if (result) await doc.update({ "system.actions": result });
    });
    actionsWriteQueues.set(key, next);
    try {
        await next;
    } finally {
        if (actionsWriteQueues.get(key) === next) actionsWriteQueues.delete(key);
    }
}

// 用途タイプ=行動種別16種(2026-07-17 ユーザー確定)。正本は usage-types.mjs の USAGE_TYPE_DEFS。
// 旧 check/declaration 一本化(2026-07-13)からの移行は usage.mjs の migrateData。
export const USAGE_TYPES = USAGE_TYPE_LABELS;

/**
 * NPC取得のモード(取得類型・フェーズ11-6・Troops.md「NPC取得」)。
 * 参照先の種類からの導出はしない=モードは明示選択(2026-07-04 ユーザー裁定)。
 * extra=判定なしで派生取得+場に出す / troop・enigma=判定して達成値=人数・ポイント /
 * bunshin=判定・目標値10(達成値10以上で成功)
 */
export const ACQUIRE_MODES = Object.freeze({
    extra:   "エキストラ",
    troop:   "トループ",
    enigma:  "エニグマ",
    bunshin: "分身",
});

/** 回復範囲の大分類ラベル(group=CONDITION_KINDS の group 値・2026-07-13)。 */
const RECOVERY_GROUP_LABELS = Object.freeze({
    bs:             "BS",
    incapacitation: "戦闘不能",
    physical:       "負傷（肉体）",
    mental:         "負傷（精神）",
    social:         "負傷（社会）",
});

// ─── 発動パラメータ優先度（自動入力で使用） ───────────────────────────────────
// ルール正本: llm-wiki/01_Wiki/Game_Rules/Check_Rules.md（対象優先度・射程優先度）

/** 対象優先度（高→低）: 自身 > 単体※ > チーム > シーン(選択) > シーン > 範囲(選択) > 範囲 > 単体 */
function targetRank(target, isFixed) {
    switch (target) {
        case "self":        return 8;
        case "single":      return isFixed ? 7 : 1;
        case "team":        return 6;
        case "sceneSelect": return 5;
        case "scene":       return 4;
        case "areaSelect":  return 3;
        case "area":        return 2;
        default:            return 0; // blank / other / explanation は無視
    }
}

/** 射程の物理的な短さ順（小さいほど近い）。※複数時の「短い方を優先」に使用 */
const RANGE_PHYSICAL = { close: 0, short: 1, middle: 2, long: 3, superLong: 4, weapon: 5 };

/** 幅(最長射程)を持てる射程値=物理射程。武器/なし/解説参照/その他/blank は単点のみ */
const RANGE_SPAN_CAPABLE = new Set(["close", "short", "middle", "long", "superLong"]);

/** 射程優先度（高→低）: 至近※ > 武器 > 超遠 > 遠 > 中 > 近 > 至近 */
function rangeRank(range, isFixed) {
    if (range === "close" && isFixed) return 7;
    switch (range) {
        case "weapon":    return 6;
        case "superLong": return 5;
        case "long":      return 4;
        case "middle":    return 3;
        case "short":     return 2;
        case "close":     return 1;
        default:          return 0;
    }
}

/** 参加技能群の対象を優先度で解決。null=有効な対象なし */
function resolveTarget(entries) {
    let best = null, bestRank = 0;
    for (const e of entries) {
        const r = targetRank(e.target, e.isFixed);
        if (r > bestRank) { bestRank = r; best = e; }
    }
    return best ? { target: best.target, isFixed: best.isFixed } : null;
}

/** 参加技能群の射程を優先度で解決。変更不可（※）が複数なら最短を優先 */
function resolveRange(entries) {
    const valid = entries.filter(e => rangeRank(e.range, e.isFixed) > 0);
    if (!valid.length) return null;
    const fixed = valid.filter(e => e.isFixed);
    if (fixed.length >= 2) {
        const shortest = fixed.reduce((a, b) =>
            (RANGE_PHYSICAL[b.range] ?? 99) < (RANGE_PHYSICAL[a.range] ?? 99) ? b : a);
        return { range: shortest.range, isFixed: true };
    }
    const best = valid.reduce((a, b) =>
        rangeRank(b.range, b.isFixed) > rangeRank(a.range, a.isFixed) ? b : a);
    return { range: best.range, isFixed: best.isFixed };
}

/**
 * 使用武器の射程を解決する(射程「武器」の実体解決・2026-07-13 再設計)。
 * 一本目=シートの「攻撃で使用」武器・以降=用途の追加分(resolveAttackWeapons)。
 * 武器が無い(生身)・射程を持たない場合は至近(close)=生身の射程(ユーザー確定)。
 * 2026-07-16: 「近〜遠」等の幅を単一値に潰さず {range, rangeMax} で返す(rangeMax="none"=単点)。
 */
function resolveWeaponRangeSpan(usage, item, actor) {
    const span = resolveAttackRangeSpan(resolveAttackWeapons(actor, usage, item));
    return { range: span.min, rangeMax: span.max };
}

/** 参加技能群の目標値を解決。数値があれば最大、なければ最初の非blank型を採用 */
function resolveTargetValue(entries) {
    const numerics = entries.filter(e => e.targetValue === "number");
    if (numerics.length) {
        return { targetValue: "number", targetValueNumber: Math.max(...numerics.map(e => e.number ?? 0)) };
    }
    const typed = entries.find(e => e.targetValue && e.targetValue !== "blank" && e.targetValue !== "none");
    return typed ? { targetValue: typed.targetValue } : null;
}

/** actor 技能アイテムをチェーン解決用に正規化する(モジュール共通・インスタンス版は委譲) */
function normalizeSkillItemDoc(it) {
    return {
        id: it.id,
        identificationKey: it.system?.identificationKey ?? "",
        isAction: it.system?.isAction === true,
        isSubstitute: it.system?.isSubstitute === true,
        substituteTarget: Array.isArray(it.system?.substituteTarget) ? it.system.substituteTarget : [],
        comboSkill: it.system?.comboSkill ?? [],
    };
}

/**
 * アイテムの判定系用途に技能チェーンの既定(ベース技能・必須コンボ)を適用する(冪等)。
 * 用途シートを開いたときの _enforceComboRequirements と同じ規則を、**アクターへの
 * インポート(作成)直後に一括適用**する(2026-07-08 修正)。辞典/ワールドで用途を設定してから
 * インポートすると、用途シートを開くまでベース技能の自動設定が効かなかった問題への対処。
 * あわせて、別コレクション時代の解決不能な参照(ベース・コンボの itemId)を掃除する。
 * @param {Item} item アクター直下の generalSkill / styleSkill
 */
export async function enforceUsageChainDefaultsOnImport(item) {
    const actor = item?.actor;
    if (!actor) return;
    const actions = foundry.utils.deepClone(item.system.actions ?? []);
    if (!actions.length) return;
    // 親が技能でない(アウトフィット等)場合も、ベース技能を持つ用途があれば連鎖を解決する
    // (2026-07-18 ユーザー確定: ベース技能の連鎖も自動解決)。持たなければ従来どおり何もしない
    if (!CHAIN_SKILL_TYPES.includes(item.type)
        && !actions.some(a => a.baseSkillRef?.itemId)) return;

    const skillItems = actor.items
        .filter(i => CHAIN_SKILL_TYPES.includes(i.type))
        .map(normalizeSkillItemDoc);
    const isActionSkill = (id) => {
        const it = id === item.id ? item : actor.items.get(id);
        return it?.system?.isAction === true;
    };
    const parentIsAction = item.system.isAction === true;

    let changed = false;
    for (const usage of actions) {
        // 判定を行う用途すべて(攻撃・リアクション・移動等の行動種別タイプを含む・2026-07-17 再編)
        if (executionFormOf(usage) !== "check") continue;

        // 参照の掃除: アクター上で解決できない itemId(辞典/ワールド時代の別コレクション ID)を落とす
        const cleanedRefs = (usage.skillRefs ?? [])
            .map(r => r.itemId)
            .filter(id => id && actor.items.has(id));
        let baseId = usage.baseSkillRef?.itemId ?? "";
        if (baseId && baseId !== item.id && !actor.items.has(baseId)) baseId = "";

        // 用途の「無視する指定技能」を反映(該当技能の指定技能を必須補完で再追加しない)。
        // ベース技能も seed に含める(2026-07-18): ベース技能自身の連鎖の必須参加技能を補完する
        const ignoreKeys = (usage.ignoreComboSkills ?? []).filter(Boolean);
        const seedIds = [
            ...(baseId && baseId !== item.id ? [baseId] : []),
            ...cleanedRefs,
        ].filter(Boolean);
        const res = resolveUsageSkills(normalizeSkillItemDoc(item), skillItems, seedIds, ignoreKeys);
        // 実効ベースを解決して**常に永続化**する(2026-07-18 統一。_enforceComboRequirements と同じ規則)。
        // 自己ベース(親自身)もここで item.id へ張り直す=インポートで親 id が変わっても陳腐化しない
        const parentIsChainSkill = CHAIN_SKILL_TYPES.includes(item.type);
        if (res && !res.defect) {
            const baseCandidates = parentIsAction ? [item.id]
                : (res.baseLocked ? (res.baseCandidateItemIds ?? []) : null);
            if (parentIsAction) baseId = item.id;
            else if (baseCandidates) baseId = baseCandidates.includes(baseId) ? baseId : (res.baseItemId || baseCandidates[0] || "");
            else if (res.manual) { /* & グループ=ベース曖昧: 自動設定しない */ }
            else if (parentIsChainSkill) baseId = baseId || res.baseItemId || item.id;
            // アウトフィット親等: baseId はユーザー設定のまま
        }

        // ベース・アクション技能を除外し、必須コンボ(クロージャ)を補完する
        const refs = cleanedRefs.filter(id => id !== baseId && !isActionSkill(id));
        if (res && !res.defect) {
            const have = new Set(refs);
            for (const id of (res.mandatoryItemIds ?? [])) {
                if (id !== baseId && id !== item.id && !have.has(id) && !isActionSkill(id)) {
                    refs.push(id);
                    have.add(id);
                }
            }
        }

        const prevBase = usage.baseSkillRef?.itemId ?? "";
        const prevRefs = (usage.skillRefs ?? []).map(r => r.itemId);
        if (baseId !== prevBase || refs.length !== prevRefs.length || refs.some((id, i) => id !== prevRefs[i])) {
            usage.baseSkillRef = { ...(usage.baseSkillRef ?? {}), itemId: baseId };
            usage.skillRefs = refs.map(id => ({ itemId: id }));
            changed = true;
        }
    }
    // 直列キュー経由(2026-07-17): シート側の書き込みと競合しないよう actions 書き込みを一元化
    if (changed) await updateUsageActions(item, () => actions);
}

/**
 * 参加技能の固有値から発動パラメータと消費行を導出する(11-6 追補・2026-07-06 承認)。
 * 用途作成時の一回適用と「参加技能から自動入力」ボタンの両方で使う。**ライブ追従はしない**
 * (コンボ変更で設定を黙って書き換えない)。消費行は可視の入力補助であり、実行時の権威は
 * consumeTargets のまま(導出規則=親×1+isLimit つき参加技能×1・deriveConsumeTargets)。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage 用途エントリ(平データで可)
 * @returns {Promise<object>} _patchUsage 形式のパッチ(ドットパスキーを含む)
 */
export async function deriveUsageAutoFill(item, usage) {
    const actor = item.actor;
    const baseId = effectiveBaseSkillId(usage, item);
    const ids = new Set([item.id, baseId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean));
    // 参照解決は同輩コレクション(2026-07-18 是正: 辞典/ワールド直下でもベース・組み合わせを解決)
    const siblings = await resolveUsageSiblingSkills(item);
    const siblingById = new Map(siblings.map(i => [i.id, i]));
    const skills = [...ids].map(id => (id === item.id ? item : siblingById.get(id))).filter(Boolean);
    // 発動パラメータ(target/range/timing/targetValue/confrontation)は**技能**の固有値から導出する。
    // アウトフィット(式神符等)への NPC取得用途など非技能ベースでは、これらは技能形でないため対象外
    // (2026-07-09 修正: 旧実装は item.system.timing 等を無条件に読み .find で TypeError)。
    const skillItems = skills.filter(s => s.type === "generalSkill" || s.type === "styleSkill");

    const patch = {};
    const t = resolveTarget(skillItems.map(s => ({ target: s.system.target, isFixed: !!s.system.isFixedTarget })));
    if (t) { patch.target = t.target; patch.isFixedTarget = t.isFixed; }

    // 精神攻撃・社会攻撃は武器を持たない(2026-07-18 ユーザー確定): 「射程：武器」は解決できないため
    // 射程候補から除外する。従来は resolveWeaponRangeSpan が武器不在時に至近へ落としており、
    // 精神/社会攻撃の射程が裏で生身(至近)に化けていた。除外すると、残る参加技能の実射程
    // =最も上流のベース技能の射程が採られる(どれも「武器」だけなら射程は未設定のまま=至近にしない)。
    const isNonPhysicalAttack = isAttackType(usage.type) && attackCategoryOf(usage.type) !== "physical";
    const rangeEntries = skillItems.map(s => ({ range: s.system.range, isFixed: !!s.system.isFixedRange }));
    const r = resolveRange(isNonPhysicalAttack ? rangeEntries.filter(e => e.range !== "weapon") : rangeEntries);
    if (r) {
        patch.range = r.range;
        patch.rangeMax = "none"; // 技能由来の射程は単点
        patch.isFixedRange = r.isFixed;
        // 射程「武器」(2026-07-13 再設計): 優先度はそのまま(武器=至近※に次ぐ)で、「武器」が
        // 勝った場合に使用武器(一本目=シートの「攻撃で使用」・以降=用途の追加分)の実射程へ解決する。
        // 武器が無い(生身)なら至近=生身の射程(ユーザー確定)。幅のある武器は幅のまま(2026-07-16)。
        // ※非物理攻撃は上で「武器」を除外済みなのでここには来ない
        if (r.range === "weapon") {
            Object.assign(patch, resolveWeaponRangeSpan(usage, item, actor));
        }
    }

    // 目標値: NPC取得はモードで確定する(トループ/エニグマ=なし・分身=10固定)ため導出しない
    if (usage.npcAcquire !== true) {
        const tv = resolveTargetValue(skillItems.map(s => ({ targetValue: s.system.targetValue, number: s.system.targetValueNumber })));
        if (tv) {
            patch.targetValue = tv.targetValue;
            if (tv.targetValueNumber !== undefined) patch.targetValueNumber = tv.targetValueNumber;
        }
    }

    // タイミング: ベース技能の最初の非 blank timing を採用（best-effort・非技能ベースはスキップ）
    const baseSkill = skillItems.find(s => s.id === baseId) ?? null;
    const bt = (Array.isArray(baseSkill?.system.timing) ? baseSkill.system.timing : []).find(x => x?.value && x.value !== "blank");
    if (bt) {
        patch["timing.value"]       = bt.value;
        patch["timing.actionName"]  = bt.actionName ?? "blank";
        patch["timing.processName"] = bt.processName ?? "blank";
        patch["timing.timingOther"] = bt.timingOther ?? "";
    }

    // 対決欄の合算(2026-07-17 ユーザー確定): 用途の既存行(手入力・タイプ既定)を保持したまま、
    // タイプの系統既定＋参加技能(スタイル技能)の対決行を追記合算する。完全一致は吸収し、
    // 無印技能名行は「既にある手段行の用途タイプをその技能が持つ」なら吸収(既定技能でなく
    // 技能の能力で判定=リアクション用途タイプの所持)。不可はマスクとして下地と並存する
    if (isReactionType(usage.type)) {
        // リアクション系タイプの対決は「なし」(2026-07-18 ユーザー裁定: リアクションされる側に
        // ならない)。参加技能の対決行は合算しない——既存行が無ければ「なし」を敷くだけ
        patch.confrontation = (usage.confrontation ?? []).length
            ? usage.confrontation
            : defaultConfrontationForType(usage.type);
    } else {
        // 吸収の技能参照(2026-07-18 是正): 従来はアクター所持アイテムしか見ておらず、辞典アイテム
        // 上の編集(actor 無し)では吸収が一切働かなかった。アクター所持ならその実体(手元の編集が正)、
        // 未所持なら技能辞典の用途タイプ索引で判定する
        const dictTypes = await loadSkillUsageTypeIndex();
        const skillHasReactionType = (key, typeKey) => {
            const it = actor ? findItemByIdentificationKey(actor, key) : null;
            if (it) return (it.system?.actions ?? []).some(a => a.type === typeKey);
            return dictTypes.get(key)?.has(typeKey) === true;
        };
        patch.confrontation = mergeConfrontationRows(
            usage.confrontation ?? [],
            [
                ...defaultConfrontationForType(usage.type),
                ...skillItems.filter(s => s.type === "styleSkill").flatMap(s => s.system.confrontation ?? []),
            ],
            { skillHasReactionType }
        );
    }

    // 消費行: 導出結果で置き換え(既存自動入力と同じ「明示的な上書き」の意味論)
    patch.consumeTargets = deriveConsumeTargets(item.id, skills);

    return patch;
}

/**
 * 射程「武器」のライブ再解決(2026-07-13 ユーザー指摘で追加)。使用武器の変更時に、参加技能の
 * 射程優先度の勝者が「武器」である用途に限り、射程を武器の実射程へ解決したパッチを返す
 * (勝者が武器でない=手動設定や他射程が勝つ用途には触らない・武器未解決は「武器」表示に戻す)。
 * 自動入力の「ライブ追従はしない」原則の例外——射程「武器」は値の実体が使用武器に委譲されて
 * おり、武器の選択に追従しないと値が成立しないため。
 * @param {Item} item 用途を持つアイテム
 * @param {object} usage 用途エントリ(weaponRefs 更新後の状態)
 * @returns {?{range:string, rangeMax:string, isFixedRange:boolean}}
 */
function deriveWeaponRangeLive(item, usage) {
    // 精神/社会攻撃は武器を持たない=武器射程の追従対象外(2026-07-18)。weaponRefs UI 自体が物理攻撃
    // 限定のため通常ここに来ないが、念のためガードする
    if (isAttackType(usage.type) && attackCategoryOf(usage.type) !== "physical") return null;
    const actor = item.actor;
    const baseId = effectiveBaseSkillId(usage, item);
    const ids = new Set([item.id, baseId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean));
    const skills = [...ids]
        .map(id => (id === item.id ? item : actor?.items.get(id)))
        .filter(s => s && (s.type === "generalSkill" || s.type === "styleSkill"));
    const r = resolveRange(skills.map(s => ({ range: s.system.range, isFixed: !!s.system.isFixedRange })));
    if (!r || r.range !== "weapon") return null;
    return { ...resolveWeaponRangeSpan(usage, item, actor), isFixedRange: r.isFixed };
}

export class TnxUsageSheet extends HandlebarsApplicationMixin(ApplicationV2) {

    constructor(item, usageId, options = {}) {
        super(options);
        this._item = item;
        this._usageId = usageId;
    }

    static DEFAULT_OPTIONS = {
        classes: ["tokyo-nova", "tnx-usage-sheet"],
        position: { width: 640, height: 560 },
        window: { resizable: true },
        tag: "form",
        form: {
            handler: TnxUsageSheet._onSubmit,
            submitOnChange: true,
            closeOnSubmit: false,
        },
        actions: {
            skillRefDelete:        TnxUsageSheet._onSkillRefDelete,
            ignoreComboDelete:     TnxUsageSheet._onIgnoreComboDelete,
            weaponRefDelete:       TnxUsageSheet._onWeaponRefDelete,
            checkBonusAdd:         TnxUsageSheet._onCheckBonusAdd,
            checkBonusDelete:      TnxUsageSheet._onCheckBonusDelete,
            damageBonusAdd:        TnxUsageSheet._onDamageBonusAdd,
            damageBonusDelete:     TnxUsageSheet._onDamageBonusDelete,
            effectRemove:          TnxUsageSheet._onEffectRemove,
            autoFill:              TnxUsageSheet._onAutoFill,
            incrementTargetValue:  TnxUsageSheet._onTvIncrement,
            decrementTargetValue:  TnxUsageSheet._onTvDecrement,
            incrementFixedResult:  TnxUsageSheet._onFixedIncrement,
            decrementFixedResult:  TnxUsageSheet._onFixedDecrement,
            consumeRowAdd:         TnxUsageSheet._onConsumeRowAdd,
            consumeRowDelete:      TnxUsageSheet._onConsumeRowDelete,
            confrontRowAdd:        TnxUsageSheet._onConfrontRowAdd,
            confrontRowDelete:     TnxUsageSheet._onConfrontRowDelete,
            recoveryRowAdd:        TnxUsageSheet._onRecoveryRowAdd,
            recoveryRowDelete:     TnxUsageSheet._onRecoveryRowDelete,
            recoveryExcludeDelete: TnxUsageSheet._onRecoveryExcludeDelete,
            incrementRecoveryCount: TnxUsageSheet._onRecoveryCountInc,
            decrementRecoveryCount: TnxUsageSheet._onRecoveryCountDec,
            incrementConsumeAmount: TnxUsageSheet._onConsumeAmountInc,
            decrementConsumeAmount: TnxUsageSheet._onConsumeAmountDec,
            acquireRefDelete:      TnxUsageSheet._onAcquireRefDelete,
            acquireActorClear:     TnxUsageSheet._onAcquireActorClear,
            incrementAcquireCount: TnxUsageSheet._onAcquireCountInc,
            decrementAcquireCount: TnxUsageSheet._onAcquireCountDec,
        },
    };

    static PARTS = {
        main: { template: "systems/tokyo-nova-axleration/templates/app/usage-sheet.hbs" },
    };

    tabGroups = { primary: "identity" };

    // ─── ゲッター ──────────────────────────────────────────────────────────────

    get usage() {
        return this._item.system.actions?.find(a => a._id === this._usageId) ?? null;
    }

    get title() {
        // 名前が空のときの実効名=「タイプ名（親アイテム名）」(2026-07-17 ユーザー確定)。
        // 用途名の技能名部分は〈〉で囲わない(2026-07-18)=親アイテム名は素の名前
        const name = usageDisplayName(this.usage, this._item?.name);
        return name ? `用途: ${name}` : "用途";
    }

    /** 用途の参加技能（親＋ベース＋コンボ）を Item 配列で返す（check / attack 用） */
    _gatherParticipatingSkills(usage) {
        const actor = this._item.actor;
        const baseId = effectiveBaseSkillId(usage, this._item);
        const ids = new Set([this._item.id, baseId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));
        return [...ids]
            .map(id => (id === this._item.id ? this._item : actor?.items.get(id)))
            .filter(Boolean);
    }

    // ─── コンテキスト準備 ───────────────────────────────────────────────────────

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const usage = this.usage;
        if (!usage) {
            this.close();
            return context;
        }

        context.usage      = foundry.utils.deepClone(usage);
        context.item       = this._item;
        context.noCombo    = this._item.system?.noCombo === true; // 組み合わせ不可: コンボ(組み合わせ技能)の設定を抑止
        context.editable   = this._item.isOwner;
        context.skillOpts  = TnxSkillUtils.getSkillOptions();
        // 用途名の既定は空(2026-07-17 ユーザー確定): placeholder は空のときの実効名
        // 「タイプ名（親アイテム名）」(usageDisplayName と同一形式・技能名部分は〈〉なし=素の名前)
        context.namePlaceholder = usageDisplayName({ type: usage.type }, this._item.name);
        // 射程の幅(2026-07-16): 物理射程のときのみ最長射程セレクトを出す(武器エディタの min〜max と同形)
        context.showRangeMax    = RANGE_SPAN_CAPABLE.has(usage.range);
        context.rangeMaxOptions = WEAPON_RANGE_MAX_OPTIONS;

        // タイプ判定フラグ(2026-07-17 行動種別再編): isCheckType=「判定を行う用途」(攻撃・
        // リアクション・移動等の判定系タイプを含む。治療は実行形式の設定に従う)
        context.isCheckType        = executionFormOf(usage) === "check";
        // 固定値判定(フェーズ11-5・2026-07-04 確定): fixedResult が設定された判定用途。
        // スート・レベル・カード・能力値を読まないため、発動タブは固定達成値のみ・効果タブは出さない
        context.isFixedCheck       = context.isCheckType && Number.isFinite(usage.fixedResult);
        // 攻撃=攻撃タイプ(物理/精神/社会・2026-07-17 再編。系統はタイプが持つ)
        context.isAttack           = isAttackType(usage.type);
        // 物理攻撃の白兵/射撃選択(2026-07-17): 射撃攻撃は生身では行えない(武器候補の絞り込みと実行時ブロック)
        context.isPhysicalAttack   = usage.type === "physicalAttack";
        context.attackWeaponKind   = usage.attackWeaponKind === "ranged" ? "ranged" : "melee";
        // ダメージを修正(2026-07-11→2026-07-17): 汎用の判定タイプのみの使用の仕方フラグ(攻撃はタイプ化で分離)
        context.isModifyDamage     = usage.type === "check" && usage.modifyDamage === true;
        // 判定モードのラジオ値(2026-07-11/12): 通常/再判定を付与/判定を修正/スートを変更
        // (判定用途に「なし」は無い)
        context.checkMode          = usage.grantRecheck === true ? "grant"
            : (usage.modifyCheck === true ? "modify"
                : (usage.grantSuitChange === true ? "suitChange" : "normal"));
        // 宣言(declaration)の判定/ダメージ修正(2026-07-12 ユーザー確定): バフ宣言の表現。
        // 判定用途とレイアウトを揃えた〈判定〉〈ダメージ〉fieldset・チェックボックス2つは独立
        // (排他 UI にしない。両方 ON の運用は想定せず、使用時は「判定を修正」が先に振られる)
        context.isDeclarationType  = usage.type === "declaration";
        if (context.isDeclarationType) {
            context.checkBonusSelf  = usage.checkBonusSelf ?? "";
            context.damageBonusSelf = usage.damageBonusSelf ?? "";
        }
        // リアクションタイプ(2026-07-17): リアクション設定(範囲/攻撃を失敗させる/対決不可無視)を出す
        context.isReactionUsage    = isReactionType(usage.type);
        // 治療タイプ(2026-07-17): 実行形式(判定/宣言)は用途の設定で固定・回復範囲の設定を持つ
        context.isTreatment        = usage.type === "treatment";
        if (context.isTreatment) {
            context.executionFormOptions = [
                { value: "check",       label: "判定",  selected: executionFormOf(usage) === "check" },
                { value: "declaration", label: "宣言",  selected: executionFormOf(usage) === "declaration" },
            ];
        }
        // 使用ヴィークル(2026-07-17): 移動/リアクション（移動妨害）は準備済みヴィークルの単一参照。
        // 空=実行時に準備済みヴィークルを自動解決(準備済みが無ければ判定不可=実行時ブロック)
        context.showVehicleRef = usesVehicle(usage.type);
        if (context.showVehicleRef) {
            const vehicles = (this._item.actor?.items ?? [])
                .filter(i => i.type === "vehicle" && i.system.isPrepared);
            const selId = usage.vehicleRef?.itemId ?? "";
            context.vehicleOptions = [
                { value: "", label: "自動（準備済みヴィークル）", selected: !selId },
                ...vehicles.map(v => ({ value: v.id, label: v.name, selected: v.id === selId })),
                ...(selId && !vehicles.some(v => v.id === selId)
                    ? [{ value: selId, label: `(解決不能: ${selId})`, selected: true }] : []),
            ];
        }

        // 回復範囲(2026-07-13→2026-07-17): 治療タイプの設定(旧 recovery トグルはタイプへ移行)。
        // 範囲=大分類(グループ)→小分類(タグ)の行(OR)・
        // 除外=タグ(タグ自身+そのタグを与える負傷を除く=「指定タグを含むもの以外すべて」)
        context.isRecoveryCapable = context.isTreatment;
        if (context.isRecoveryCapable) {
            context.isRecovery      = true;
            context.recoveryAll     = usage.recoveryAll === true;
            context.recoveryCountValue   = Math.max(1, usage.recoveryCount ?? 1);
            const kindOptionsFor = (group) => Object.entries(CONDITION_KINDS)
                .filter(([, def]) => def.group === group)
                .map(([value, def]) => ({ value, label: def.label }));
            context.recoveryRows = (usage.recoveryTargets ?? []).map((r, idx) => ({
                idx,
                groupOptions: Object.entries(RECOVERY_GROUP_LABELS)
                    .map(([value, label]) => ({ value, label, selected: value === r.group })),
                kindOptions: [
                    { value: "", label: "（グループ全体）", selected: !r.kind },
                    ...kindOptionsFor(r.group).map(o => ({ ...o, selected: o.value === r.kind })),
                ],
            }));
            // 除外タグ: 負傷以外(BS/戦闘不能)のタグから選ぶ(負傷は「そのタグを与える」経由で除外される)
            const excludeSet = new Set(usage.recoveryExcludes ?? []);
            context.recoveryExcludeRows = [...excludeSet]
                .map(k => ({ key: k, label: CONDITION_KINDS[k]?.label ?? k }));
            context.recoveryExcludeChoices = Object.entries(CONDITION_KINDS)
                .filter(([k, def]) => def.type !== "wound" && !excludeSet.has(k))
                .map(([value, def]) => ({ value, label: def.label }));
        }

        // NPC取得(11-6・Troops.md/2026-07-13 タイプ→フラグへ移管): check/declaration のどちらにも
        // 設定できる。設定 UI は効果タブ・設定できるのはトループ取得技能とアウトフィット
        // (旧タイプの作成ゲートを移管)。モードは明示選択・実行はモード駆動で従来どおり
        // (エキストラ=判定なし・トループ/エニグマ/分身=判定。目標値はモードで決まるため入力欄を出さない)
        context.canNpcAcquire = (this._item.type === "styleSkill" && this._item.system.unique === "troopAcquire")
            || OUTFIT_ITEM_TYPES.has(this._item.type);
        context.isNpcAcquireType = usage.npcAcquire === true;
        context.isAcquireExtraMode = false;
        if (context.isNpcAcquireType) {
            const mode = usage.acquireMode || "extra";
            context.isAcquireExtraMode = mode === "extra";
            context.acquireModeOptions = Object.entries(ACQUIRE_MODES)
                .map(([value, label]) => ({ value, label, selected: value === mode }));
            // 取得アイテム参照(エキストラモード)は fromUuid でライブ解決(削除済みは name フォールバック)
            context.acquireItemRows = await Promise.all((usage.acquireItemRefs ?? []).map(async (r, idx) => {
                const doc = r.uuid ? await fromUuid(r.uuid).catch(() => null) : null;
                return { idx, uuid: r.uuid, name: doc?.name ?? (r.name ? `${r.name}（削除済み）` : "(不明)"), missing: !doc };
            }));
            // 取得アクター参照(トループ/エニグマのみ・2026-07-07 裁定=対象は用途側で設定)。ライブ解決。
            // 分身は対象を設定せずそのまま召喚(2026-07-08 裁定)＝参照欄の代わりに召喚数を設定する
            context.isAcquireBunshinMode = mode === "bunshin";
            context.isAcquireRefMode = mode === "troop" || mode === "enigma";
            const aRef = usage.acquireActorRef ?? {};
            const aDoc = aRef.uuid ? await fromUuid(aRef.uuid).catch(() => null) : null;
            context.hasAcquireActor = !!aRef.uuid;
            context.acquireActorName = aDoc?.name ?? (aRef.name ? `${aRef.name}（削除済み）` : "");
            context.acquireModeLabel = ACQUIRE_MODES[mode] ?? "";
            context.acquireCount = Math.max(1, usage.acquireCount ?? 1);
        }
        context.isAcquireCheckMode = context.isNpcAcquireType && !context.isAcquireExtraMode;

        // 技能ベースの用途（コンボ・対決表示・自動入力の対象）。攻撃は check なのでここに含まれる
        context.showSkillParams    = context.isCheckType || context.isAcquireCheckMode;

        // ベース技能・組み合わせ技能候補（check / attack）
        if (context.showSkillParams) {
            const parentIsAction = this._item.system.isAction === true;

            // 同輩技能(2026-07-18 是正): アクター所持だけでなく辞典/ワールド直下でも、同じ
            // コレクションの技能でベース・組み合わせを解決する。アクションハンドラ(チェーン
            // enforcement 等)からも使うため直近レンダーのキャッシュとして持つ
            const siblingSkills = await resolveUsageSiblingSkills(this._item);
            this._siblingSkills = siblingSkills;
            const skillById = new Map(siblingSkills.map(i => [i.id, i]));

            // 技能チェーン解決: アクション技能がチェーンにあると、ベースは「指定技能＋その代用」に限定する
            // (他の無関係な技能はベースになれない)。候補が1つなら固定表示、代用が増えれば選択可能(ハードロックにしない)。
            const parentItemId = this._item.id;
            const chainRes = this._resolveComboChain();
            const lockedByChain = !!chainRes && !chainRes.defect && chainRes.baseLocked;
            // baseCandidates: null=全技能から選択(非ロック)、配列=その候補に限定(本体優先で先頭)
            let baseCandidates = null;
            if (parentIsAction) baseCandidates = [parentItemId];
            else if (lockedByChain) baseCandidates = (chainRes.baseCandidateItemIds ?? []).slice();

            const parentIsChainSkill = CHAIN_SKILL_TYPES.includes(this._item.type);
            const defaultBaseId = parentIsAction ? parentItemId : (chainRes && !chainRes.defect ? chainRes.baseItemId : null);
            let baseId = parentIsAction ? parentItemId : (usage.baseSkillRef?.itemId ?? "");
            // ロック時、現ベースが候補外(未設定含む)なら既定(指定技能・本体優先)へ寄せる
            if (baseCandidates && !baseCandidates.includes(baseId)) baseId = defaultBaseId ?? baseCandidates[0] ?? "";
            // 非ロック・未設定は連鎖の解決ベース(指定技能があれば末端・無ければ親自身)を既定に(2026-07-18 統一)。
            // 親が技能のときのみ自己ベースを既定にする(アウトフィット親はユーザーがベース技能を明示設定)
            else if (!baseCandidates && !baseId && !chainRes?.manual && parentIsChainSkill) {
                baseId = defaultBaseId || parentItemId;
            }

            const baseItem = skillById.get(baseId) ?? (baseId === parentItemId ? this._item : null);
            // 技能名の表示は 〈〉 整形(2026-07-18 ユーザー確定: 名前欄・アクターシートの技能リスト以外)
            context.baseSkillName  = baseItem ? formatSkillName(baseItem.name) : (baseId ? `(削除済み: ${baseId})` : "");
            context.baseSkillId    = baseId;
            // 候補が1つだけ(代用なし)なら固定表示、複数(代用あり)なら選択可能
            context.baseSkillFixed = !!baseCandidates && baseCandidates.length <= 1;

            // 非ロック候補: 親が技能なら自己(＝親をベース)を先頭に含める(2026-07-18: base=親を明示選択可能に)。
            // 指定技能があるスタイル技能の既定ベースは末端だが、自己選択の余地は残す(手動上書き)
            const selfBaseOption = parentIsChainSkill
                ? [{ id: parentItemId, name: formatSkillName(this._item.name) }] : [];
            context.availableBaseSkills = baseCandidates
                ? baseCandidates.map(id => {
                    const s = skillById.get(id) ?? (id === parentItemId ? this._item : null);
                    return { id, name: s ? formatSkillName(s.name) : `(削除済み: ${id})` };
                })
                : [
                    ...selfBaseOption,
                    ...siblingSkills
                        .filter(i => i.id !== parentItemId)
                        .map(i => ({ id: i.id, name: formatSkillName(i.name) }))
                        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
                ];

            const parentIsComboMember = !!baseId && parentItemId !== baseId;

            const usedIds = new Set([baseId, parentItemId, ...usage.skillRefs.map(r => r.itemId)].filter(Boolean));

            // 現在の参加技能(ベース＋親がコンボ＋既存コンボ)のスート積。組み合わせは共通スートで成立するため、
            // 追加すると共通スートが空になる技能は候補から除外する。
            const currentSystems = [
                baseItem?.system,
                ...(parentIsComboMember ? [this._item.system] : []),
                ...usage.skillRefs.map(r => skillById.get(r.itemId)?.system),
            ].filter(Boolean);
            const currentSuits = getComboSuits(currentSystems);

            // 組み合わせ候補: アクション技能(必ずベース)・組み合わせ不可技能(単独判定のみ)・
            // 現在の構成と共通スートを持たない技能 は除外する。
            context.availableSkills = siblingSkills
                .filter(i => !usedIds.has(i.id)
                    && i.system.isAction !== true && i.system.noCombo !== true
                    && currentSuits.some(suit => readFlag(i.system, `suits.${suit}`)))
                .map(i => ({ id: i.id, name: formatSkillName(i.name) }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));

            // 技能チェーン: 「、」候補制限(どれか1つ登録まで候補をその代替に絞る)・必須コンボの削除不可表示
            if (chainRes?.alternativeItemIds?.length
                && !usage.skillRefs.some(r => chainRes.alternativeItemIds.includes(r.itemId))) {
                const altSet = new Set(chainRes.alternativeItemIds);
                context.availableSkills = context.availableSkills.filter(s => altSet.has(s.id));
            }
            // 削除不可(ロック)判定: ベース連鎖、または他の組み合わせ技能が要求する技能のみロックする。
            // 単に組み合わせに居る(seed)だけでは外せる(自身が seed＝必須 で全ロックになるのを防ぐ)。
            const allComboIds = [...(parentIsComboMember ? [parentItemId] : []), ...usage.skillRefs.map(r => r.itemId)];
            let lockOf = () => false;
            const lockSkillItems = this._actorSkillItems();
            if (lockSkillItems) {
                const { rootMandatoryIds, comboChains } = comboLockAnalysis(this._normalizeSkillItem(this._item), lockSkillItems, allComboIds);
                lockOf = (id) => isComboRequired(id, allComboIds, rootMandatoryIds, comboChains);
            }

            context.skillRefItems = [
                ...(parentIsComboMember ? [{ idx: -1, itemId: parentItemId, name: itemDisplayName(this._item), isLocked: true }] : []),
                ...usage.skillRefs.map((r, idx) => {
                    const skillItem = skillById.get(r.itemId);
                    return { idx, itemId: r.itemId, name: skillItem ? formatSkillName(skillItem.name) : `(削除済み: ${r.itemId})`, isLocked: lockOf(r.itemId) };
                }),
            ];

            // 識別キー→技能名の逆引き(無視する指定技能の表示用。未収載キーはそのまま表示)
            const skillNames = await loadSkillChoices([SKILL_PACKS.general, SKILL_PACKS.style, SKILL_PACKS.works]);
            const nameOf = (key) => skillNames[key] || key;

            // 無視する指定技能(2026-07-10): この用途で設定した技能を指定「技能」とするスタイル技能は、
            // 指定技能を自動追加せず単体で組み合わせに参加できる(〈技能AⅡ〉系の効果)。
            // 保存は辞典の識別キー・表示は逆引きした技能名(未収載キーはそのまま)
            const ignoreKeys = this._ignoreComboKeys();
            context.ignoreComboRows = ignoreKeys.map(key => ({ key, name: formatSkillName(nameOf(key)) || key }));
            const usedIgnore = new Set(ignoreKeys);
            context.ignoreComboChoices = Object.entries(skillNames)
                .filter(([key]) => key && !usedIgnore.has(key))
                .sort((a, b) => a[1].localeCompare(b[1], "ja"))
                .map(([key, name]) => ({ key, name: formatSkillName(name) }));
        }

        // 対決欄: **全タイプが持つ**(2026-07-18 ユーザー裁定: リアクション用途でも対決「なし」で
        // 設定自体はされる。旧「判定・攻撃・移動・離脱のみ」のゲートは撤回)。行の見た目・構造は
        // スタイル技能シートの対決セクション(tnx-combo-card/grid)を踏襲し、値は用途独自の選択肢
        // (手段行=リアクション用途タイプと1:1)。「不可」はマスクで下地の行と並存保存する
        context.showConfrontation = !context.isFixedCheck;
        if (context.showConfrontation) {
            const cascadeData = await loadCascadeData();
            // スタイル技能と同じく最低1行を表示する(空=blank 行。保存されても無効行で無害)
            const confRows = (usage.confrontation ?? []).length
                ? usage.confrontation
                : [{ value: "blank", name: "", skillDict: "", skillGroup: "", skillSub: "" }];
            context.confrontationRows = confRows.map((c, idx) => {
                const isSkill = c.value === "skillName" || c.value === "skillNameAsterisk";
                const cascadeSteps = isSkill
                    ? buildSkillCascadeSteps(cascadeData,
                        { dict: c.skillDict, group: c.skillGroup, sub: c.skillSub, skill: c.name })
                    : [];
                // 2列グリッドの敷き方はスタイル技能シートと同じ: 技能名系以外は種別セレクトが全幅、
                // 技能名系は種別+段で埋め、(1+段数)が奇数なら最後の段を全幅にする
                const typeFull = !isSkill;
                if (cascadeSteps.length && (1 + cascadeSteps.length) % 2 === 1) {
                    cascadeSteps[cascadeSteps.length - 1].full = true;
                }
                return {
                    idx,
                    typeFull,
                    valueOptions: Object.entries(USAGE_CONFRONTATION_OPTIONS)
                        .map(([value, label]) => ({ value, label, selected: value === (c.value || "blank") })),
                    cascadeSteps,
                };
            });
        }

        // 攻撃プロファイル(2026-07-17 再編: 攻撃は行動種別タイプ)。物理攻撃のみ武器・ダメージ種別を
        // 持ち、白兵/射撃の選択(attackWeaponKind)で使用武器の候補を区分フラグで絞り込む
        // (射撃攻撃は生身では行えない=射撃武器フラグの武器が無ければ実行時ブロック)
        if (context.isPhysicalAttack && !context.isFixedCheck) {
            const actorItems = this._item.actor?.items ?? [];
            const refs = usage.weaponRefs ?? [];
            const refIds = new Set(refs.map(r => r.itemId).filter(Boolean));
            const kindFlag = context.attackWeaponKind === "ranged" ? "isRangedWeapon" : "isMeleeWeapon";
            // 一本目の武器=シートの「攻撃で使用」(戦闘タブ・空欄=生身。2026-07-13 ユーザー確定)。
            // 用途の weaponRefs は2本目以降の追加分。表示もこの実体に合わせる
            const sheetActor = this._item.actor;
            const sheetWeaponId = sheetActor?.system?.weaponRefs?.attackItemId || "";
            const sheetWeapon = sheetWeaponId ? sheetActor?.items.get(sheetWeaponId) : null;
            const atkLabel = (w) => {
                const atk = w?.system.attack ?? {};
                const val = Number(atk.total ?? atk.value) || 0;
                return `${atk.damageTypeTotal || atk.damageType || ""}${val >= 0 ? `+${val}` : val}`;
            };
            const base = sheetActor?.system?.baseAttack ?? {};
            // 生身は白兵武器(2026-07-17 ユーザー確定)。一本目も区分の適格判定(攻撃フローと同じ
            // attackWeaponKindEligible)を通す——射撃では生身・白兵専用武器は使えず「武器なし」、
            // 白兵では射撃専用武器が選ばれていれば生身フォールバック(実行時と同じ解決)
            const sheetEligible = attackWeaponKindEligible(sheetWeapon, context.attackWeaponKind);
            context.sheetAttackWeapon = sheetEligible
                ? { name: attackWeaponDisplayName(sheetWeapon), attackLabel: atkLabel(sheetWeapon) }
                : (context.attackWeaponKind === "ranged"
                    ? { name: "武器なし", attackLabel: "" }
                    : { name: "生身", attackLabel: `${base.damageTypeTotal || base.damageType || "I"}+${(base.value ?? 0) + (base.mod ?? 0)}` });
            // 選択済みの追加武器(表示行・攻撃力ラベル付き)。攻撃力はシート武器と合算される(2026-07-09)
            context.selectedWeapons = refs.map((r, idx) => {
                const w = sheetActor?.items.get(r.itemId);
                return {
                    idx, id: r.itemId,
                    name: w ? attackWeaponDisplayName(w) : "（不明な武器）",
                    attackLabel: w ? atkLabel(w) : "",
                };
            });
            // 追加候補: 白兵/射撃の区分フラグで絞り込む(2026-07-17。ヴィークル等もフラグがあれば候補)
            context.availableWeapons = actorItems
                .filter(i => (i.type === "weapon" || i.type === "vehicle")
                    && i.system[kindFlag] === true
                    && !refIds.has(i.id) && i.id !== sheetWeaponId)
                .map(i => ({ id: i.id, name: i.name }));
            context.attackWeaponKindOptions = [
                { value: "melee",  label: "白兵攻撃", selected: context.attackWeaponKind === "melee" },
                { value: "ranged", label: "射撃攻撃", selected: context.attackWeaponKind === "ranged" },
            ];
        }

        // 判定ボーナス/ダメージ修正の行: 判定を行う用途すべて(2026-07-17 再編)
        if (context.isCheckType && !context.isFixedCheck) {
            // 判定ボーナス/ダメージ修正の行(式＋供給元)。供給元はチャットの帰属表示専用(識別キーを保存し
            // 表示は逆引きした現在名)。式は @system.*・@item.<識別キー>.system.* を参照可(2026-07-10)。
            // 供給元候補(グループ化): 組み合わせスタイル技能(一般技能除外)＋使用武器。値=識別キー・
            // 表示=現在のアイテム名。識別キーを持つものだけ(帰属できる供給元)を出す
            // 技能は同輩キャッシュ(辞典/ワールド直下でも解決・2026-07-18)・武器はアクター所持のみ
            const getItem = (id) => this._siblingSkills?.find(i => i.id === id) ?? this._item.actor?.items.get(id);
            const skillItemIds = [...new Set([usage.baseSkillRef?.itemId, ...(usage.skillRefs ?? []).map(r => r.itemId)].filter(Boolean))];
            const styleSourceOpts = skillItemIds
                .map(getItem)
                .filter(it => it && it.type === "styleSkill" && it.system.identificationKey)
                .map(it => ({ value: it.system.identificationKey, label: formatSkillName(it.name) }));
            const weaponSourceOpts = (usage.weaponRefs ?? [])
                .map(r => getItem(r.itemId))
                .filter(it => it && it.system.identificationKey)
                .map(it => ({ value: it.system.identificationKey, label: it.name }));
            const sourceGroups = [];
            if (styleSourceOpts.length)  sourceGroups.push({ label: "組み合わせ技能", options: styleSourceOpts });
            if (weaponSourceOpts.length) sourceGroups.push({ label: "使用武器", options: weaponSourceOpts });
            // 行ごとに selected 付きの供給元グループを作る(テンプレートの深いネスト回避)
            const rowGroups = (source) => sourceGroups.map(g => ({
                label: g.label,
                options: g.options.map(o => ({ value: o.value, label: o.label, selected: o.value === source })),
            }));
            context.checkBonusRows  = (usage.checkBonuses  ?? []).map((r, idx) => ({ idx, formula: r.formula, source: r.source, sourceGroups: rowGroups(r.source) }));
            context.damageBonusRows = (usage.damageBonuses ?? []).map((r, idx) => ({ idx, formula: r.formula, source: r.source, sourceGroups: rowGroups(r.source) }));
            // 用途自身の修正値(専用欄・供給元つきの追加行とは別枠。式で @item.self=親アイテムを参照可)
            context.checkBonusSelf  = usage.checkBonusSelf ?? "";
            context.damageBonusSelf = usage.damageBonusSelf ?? "";
        }

        // 消費先設定(11-6・全用途タイプ共通。固定値判定は消費 UI を出さない=エキストラは消費なし)。
        // 全ての使用回数消費はこの設定からのみ発生する(自動スキャン全廃・D&D Consumption 踏襲)
        if (!context.isFixedCheck) {
            const actor = this._item.actor;
            const CONSUME_TYPE_LABELS = {
                parent:      "親アイテムの使用回数",
                itemUses:    "アイテムの使用回数",
                miracleUses: "神業の使用回数",
                actionRank:  "AR（アクションランク）",
                ammo:        "武器の残弾",
            };
            const usesOptions = (actor?.items ?? [])
                .filter(i => i.system?.uses?.isLimit === true && i.id !== this._item.id)
                .map(i => ({ id: i.id, name: itemDisplayName(i) })) // 技能は 〈〉 整形(2026-07-18)
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
            const miracleOptions = (actor?.items ?? [])
                .filter(i => i.type === "miracle")
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
            // 残弾(2026-07-17): 残弾管理(数字/任意)のある武器。親アイテム自身も選べる(武器のリロード
            // 用途=自分の残弾へのマイナス消費、をアイテム単体で設定できるように)
            const ammoOptions = (actor?.items ?? [])
                .filter(i => i.type === "weapon" && hasAmmoTracking(i.system?.ammo))
                .map(i => ({ id: i.id, name: i.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
            context.consumeRows = (usage.consumeTargets ?? []).map((t, idx) => {
                const type = t.type || "parent";
                const options = type === "miracleUses" ? miracleOptions
                    : (type === "ammo" ? ammoOptions : usesOptions);
                const known = options.some(o => o.id === t.itemId);
                const amount = Number(t.amount);
                return {
                    idx,
                    type,
                    // 対象アイテム選択を持たない種別(親=自明・AR=アクター自身のリソース)
                    noTarget: type === "parent" || type === "actionRank",
                    // 負値=回復(残弾のリロード表現・2026-07-17)。残弾以外は従来どおり1以上
                    amount: type === "ammo"
                        ? (Number.isFinite(amount) && amount !== 0 ? amount : 1)
                        : Math.max(1, amount || 1),
                    isAmmo: type === "ammo",
                    itemId: t.itemId ?? "",
                    typeOptions: Object.entries(CONSUME_TYPE_LABELS)
                        .map(([value, label]) => ({ value, label, selected: value === type })),
                    targetOptions: [
                        ...options.map(o => ({ ...o, selected: o.id === t.itemId })),
                        // 参照切れ(削除済み等)は選択状態を失わせず可視化する
                        ...(!known && t.itemId ? [{ id: t.itemId, name: `(解決不能: ${t.itemId})`, selected: true }] : []),
                    ],
                };
            });
            context.hasConsumeActor = !!actor;
        }

        // エフェクト: 用途使用時に適用する ActiveEffect の参照。供給元は親アイテム(空 itemId)＋参加技能
        // (ベース＋組み合わせ)＋使用武器(2026-07-10)。保存は {itemId, effectId}(親は itemId 空で互換)。
        const parentId = this._item.id;
        const effActor = this._item.actor;
        const getEffItem = (id) => (!id || id === parentId ? this._item : effActor?.items.get(id));
        const contribIds = [];
        for (const id of [parentId, usage.baseSkillRef?.itemId, ...(usage.skillRefs ?? []).map(r => r.itemId),
                          ...(usage.weaponRefs ?? []).map(r => r.itemId)].filter(Boolean)) {
            if (!contribIds.includes(id)) contribIds.push(id);
        }
        const contribItems = contribIds.map(id => (id === parentId ? this._item : effActor?.items.get(id))).filter(Boolean);
        const addedKey = (itemId, effectId) => `${itemId || parentId}:${effectId}`;
        const addedSet = new Set((usage.effects ?? []).map(e => addedKey(e.itemId, e.effectId)));
        // 追加済み: 保存値(itemId 空=親)をそのまま remove ハンドラへ渡す
        context.addedEffects = (usage.effects ?? []).map(e => {
            const host = getEffItem(e.itemId);
            const eff = host?.effects.get(e.effectId);
            const fromParent = !e.itemId || e.itemId === parentId;
            return {
                itemId: e.itemId ?? "", effectId: e.effectId,
                name: eff?.name ?? `(削除済み: ${e.effectId})`,
                sourceName: fromParent ? "" : (host?.name ?? ""),   // 親由来は帰属表示を省く
                // 付与先(AE 設定・2026-07-13 再設計)。既定の「対象」は表示せず「自分」だけタグを出す
                grantSelf: eff?.flags?.["tokyo-nova-axleration"]?.grantTarget === "self",
            };
        });
        // 未追加の効果を供給元アイテムごとにグループ化(選択値=`itemId|effectId`・親は itemId 空)
        context.availableEffectGroups = contribItems
            .map(it => ({
                label: it.name,
                options: [...it.effects]
                    .filter(e => !addedSet.has(addedKey(it.id, e.id)))
                    .map(e => ({ value: `${it.id === parentId ? "" : it.id}|${e.id}`, name: e.name })),
            }))
            .filter(g => g.options.length);
        context.hasAnyEffect = contribItems.some(it => it.effects.size > 0);

        return context;
    }

    /** @override */
    _onRender(context, _options) {
        // タブ初期化: DOM に active クラスを付与する
        for (const [group, tab] of Object.entries(this.tabGroups)) {
            if (tab) {
                try { this.changeTab(tab, group, { force: true, updatePosition: false }); }
                catch { /* そのタブが存在しない場合は無視 */ }
            }
        }

        // 条件付きサブ入力（timing/target/range/targetValue）の表示同期
        this._syncConditionalSubFields();
        for (const name of ["timing.value", "target", "range", "targetValue"]) {
            this.element.querySelector(`select[name='${name}']`)
                ?.addEventListener("change", () => {
                    // 制御 select を変えたら、対応しないサブ入力欄の値をリセット（submitOnChange 前に DOM を掃除）
                    this._resetHiddenSubFields();
                    this._syncConditionalSubFields();
                });
        }

        if (context.editable) {
            // 組み合わせ技能: ドロップダウン選択で即時追加
            for (const select of this.element.querySelectorAll("select.skill-ref-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止(actions 全配列の後勝ち上書きを防ぐ)
                    const itemId = ev.target.value;
                    if (!itemId) return;
                    const usage = this.usage;
                    if (!usage || usage.skillRefs.some(r => r.itemId === itemId)) return;
                    // 追加可否: アクション技能の重複(組み合わせ不可)・個数上限を事前に判定してブロック。
                    // 「無視する指定技能」設定済みの技能は指定技能を引き込まないため、ここで弾かれない
                    const chk = this._addComboCheck(itemId);
                    if (!chk.allowed) {
                        ui.notifications.warn(chk.reason === "action"
                            ? "アクション技能同士は組み合わせできません（その技能の指定「技能」がアクション技能です。組み合わせを可能にする効果がある場合は、参加技能の「無視する指定技能」に指定技能を設定してください）。"
                            : `組み合わせ技能は最大 ${chk.limit} 個までです（ベース技能のレベル＋1個）。`);
                        ev.target.value = "";
                        return;
                    }
                    await this._patchUsage({ skillRefs: [...usage.skillRefs, { itemId }] });
                    this.render({ force: true });
                });
            }

            // 回復の除外タグ: ドロップダウン選択で即時追加(2026-07-13)
            for (const select of this.element.querySelectorAll("select.recovery-exclude-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // フォームの submitOnChange を発火させない(actions 全配列書き込みの競合防止)
                    const key = ev.target.value;
                    if (!key) return;
                    const usage = this.usage;
                    if (!usage || (usage.recoveryExcludes ?? []).includes(key)) { ev.target.value = ""; return; }
                    await this._patchUsage({ recoveryExcludes: [...(usage.recoveryExcludes ?? []), key] });
                    this.render({ force: true });
                });
            }

            // 無視する指定技能: ドロップダウン選択で即時追加(2026-07-10)
            for (const select of this.element.querySelectorAll("select.ignore-combo-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止
                    const key = ev.target.value;
                    if (!key) return;
                    const usage = this.usage;
                    if (!usage || (usage.ignoreComboSkills ?? []).includes(key)) { ev.target.value = ""; return; }
                    await this._patchUsage({ ignoreComboSkills: [...(usage.ignoreComboSkills ?? []), key] });
                    this.render({ force: true });
                });
            }

            // 使用武器(攻撃プロファイル): ドロップダウン選択で即時追加(複数選ぶと攻撃力を合算)
            for (const select of this.element.querySelectorAll("select.weapon-ref-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止
                    const itemId = ev.target.value;
                    if (!itemId) return;
                    const usage = this.usage;
                    const refs = usage?.weaponRefs ?? [];
                    if (!usage || refs.some(r => r.itemId === itemId)) { ev.target.value = ""; return; }
                    await this._patchUsage({ weaponRefs: [...refs, { itemId }] });
                    // 射程「武器」の用途は、武器の変更に射程を追従させる(2026-07-13)
                    const rangePatch = deriveWeaponRangeLive(this._item, this.usage);
                    if (rangePatch) await this._patchUsage(rangePatch);
                    this.render({ force: true });
                });
            }

            // エフェクト: ドロップダウン選択で即時追加。選択値=`itemId|effectId`(親は itemId 空)
            for (const select of this.element.querySelectorAll("select.effect-select")) {
                select.addEventListener("change", async (ev) => {
                    ev.stopPropagation(); // submitOnChange との競合防止
                    const raw = ev.target.value;
                    if (!raw) return;
                    const sep = raw.indexOf("|");
                    const itemId = sep >= 0 ? raw.slice(0, sep) : "";
                    const effectId = sep >= 0 ? raw.slice(sep + 1) : raw;
                    if (!effectId) return;
                    const usage = this.usage;
                    if (!usage || usage.effects.some(e => (e.itemId || "") === itemId && e.effectId === effectId)) { ev.target.value = ""; return; }
                    await this._patchUsage({ effects: [...usage.effects, { itemId, effectId }] });
                    this.render({ force: true });
                });
            }
        }

        // NPC取得(エキストラモード): 取得アイテムのドロップ欄(フェーズ10 の取得アクター欄と同方式)。
        // 小分類「エキストラ」のアウトフィットのみ受け付ける(Troops.md「エキストラの二重表現」)
        if (context.editable) {
            const zone = this.element.querySelector(".usage-acquire-dropzone");
            if (zone) {
                zone.addEventListener("dragover", (ev) => ev.preventDefault());
                zone.addEventListener("drop", (ev) => this._onAcquireDrop(ev));
            }
            // NPC取得(判定系モード): 取得アクターのドロップ欄(2026-07-07 裁定=対象は用途側で設定)
            const actorZone = this.element.querySelector(".usage-acquire-actor-dropzone");
            if (actorZone) {
                actorZone.addEventListener("dragover", (ev) => ev.preventDefault());
                actorZone.addEventListener("drop", (ev) => this._onAcquireActorDrop(ev));
            }
        }

        // 技能チェーンの既定ベース設定・必須コンボの自動付与(冪等。変更があるときだけ update→再レンダリングで収束)
        if (context.editable) this._enforceComboRequirements();

        // 再描画後にスクロール位置を復元する(行の追加/削除等の操作でリセットされるのを防ぐ・2026-07-10)
        const scrollTop = this._usageScrollTop ?? 0;
        if (scrollTop) requestAnimationFrame(() => {
            const body = this.element?.querySelector(".usage-sheet-body");
            if (body) body.scrollTop = scrollTop;
        });
    }

    /** @override — 再描画前にスクロール位置を保存する(操作でスクロールが飛ぶのを防ぐ・2026-07-10) */
    async _preRender(context, options) {
        await super._preRender?.(context, options);
        this._usageScrollTop = this.element?.querySelector(".usage-sheet-body")?.scrollTop ?? 0;
    }

    /** NPC取得(エキストラモード)の取得アイテムドロップ: 小分類「エキストラ」のアウトフィットのみ */
    async _onAcquireDrop(event) {
        event.preventDefault();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Item" || doc.system?.minorCategory !== "extra") {
            ui.notifications?.warn("ここには小分類「エキストラ」のアウトフィットをドロップしてください。");
            return;
        }
        const usage = this.usage;
        if (!usage) return;
        const refs = [...(usage.acquireItemRefs ?? [])];
        if (refs.some(r => r.uuid === doc.uuid)) return; // 重複追加しない
        refs.push({ uuid: doc.uuid, name: doc.name });
        await this._patchUsage({ acquireItemRefs: refs });
        this.render({ force: true });
    }

    /** 制御 select が指す状態に合わない条件付きサブ入力の DOM 値をリセットする */
    _resetHiddenSubFields() {
        const sel = (name) => this.element.querySelector(`select[name='${name}']`)?.value;
        const setVal = (name, v) => {
            const el = this.element.querySelector(`[name='${name}']`);
            if (el) el.value = v;
        };
        const t = sel("timing.value");
        if (t !== "action")  setVal("timing.actionName", "blank");
        if (t !== "process") setVal("timing.processName", "blank");
        if (t !== "other")   setVal("timing.timingOther", "");
        if (sel("target") !== "other") setVal("targetOther", "");
        if (sel("range")  !== "other") setVal("rangeOther", "");
        const tvv = sel("targetValue");
        if (tvv !== "number") setVal("targetValueNumber", "0");
        // 自由記入欄(式)は「その他」「解説参照」の両方で使う(2026-07-13)
        if (tvv !== "other" && tvv !== "explanation") setVal("targetValueOther", "");
    }

    /** timing / target / range / targetValue のサブ入力欄の表示を選択値に追従させる */
    _syncConditionalSubFields() {
        const val = (name) => this.element.querySelector(`select[name='${name}']`)?.value;
        const toggle = (sel, show) => this.element.querySelector(sel)?.classList.toggle("hidden", !show);

        const tv = val("timing.value");
        toggle(".timing-action-sub",  tv === "action");
        toggle(".timing-process-sub", tv === "process");
        toggle(".timing-other-sub",   tv === "other");

        toggle(".target-other-sub", val("target") === "other");
        toggle(".range-other-sub",  val("range")  === "other");

        const tvv = val("targetValue");
        toggle(".tv-number-sub", tvv === "number");
        // 「解説参照」「その他」は式を入力できる自由記入欄を出す(2026-07-13 ユーザー確定)
        toggle(".tv-other-sub",  tvv === "other" || tvv === "explanation");
    }

    // ─── フォーム送信（auto-submit on change） ─────────────────────────────────

    static async _onSubmit(event, form, formData) {
        const usage = this.usage;
        if (!usage) return;

        const raw = formData.object;
        const update = {
            name:        raw["name"]        ?? usage.name,
            description: raw["description"]  ?? usage.description,

            "timing.value":       raw["timing.value"]       ?? usage.timing.value,
            "timing.actionName":  raw["timing.actionName"]  ?? usage.timing.actionName,
            "timing.processName": raw["timing.processName"] ?? usage.timing.processName,
            "timing.timingOther": raw["timing.timingOther"] ?? usage.timing.timingOther,

            target:        raw["target"]        ?? usage.target,
            targetOther:   raw["targetOther"]   ?? usage.targetOther,
            isFixedTarget: raw["isFixedTarget"] ?? usage.isFixedTarget,

            range:        raw["range"]        ?? usage.range,
            rangeMax:     raw["rangeMax"]     ?? usage.rangeMax ?? "none",
            rangeOther:   raw["rangeOther"]   ?? usage.rangeOther,
            isFixedRange: raw["isFixedRange"] ?? usage.isFixedRange,

            targetValue:       raw["targetValue"]       ?? usage.targetValue,
            targetValueNumber: raw["targetValueNumber"] ?? usage.targetValueNumber,
            targetValueOther:  raw["targetValueOther"]  ?? usage.targetValueOther,

            // リアクション用途の追加挙動(2026-07-15・全用途で保持)
            reactionAreaAttack:  raw["reactionAreaAttack"]  ?? usage.reactionAreaAttack,
            reactionFailsAttack: raw["reactionFailsAttack"] ?? usage.reactionFailsAttack,
        };

        // 対決不可にもリアクション可(2026-07-17): リアクションタイプの設定
        if (isReactionType(usage.type)) {
            update.ignoresUnopposable = raw["ignoresUnopposable"] ?? (usage.ignoresUnopposable === true);
        }

        // 使用ヴィークル(2026-07-17): 移動/リアクション（移動妨害）の単一参照(空=準備済みを自動解決)
        if (usesVehicle(usage.type)) {
            update["vehicleRef.itemId"] = raw["vehicleRefItemId"] ?? usage.vehicleRef?.itemId ?? "";
        }

        // 判定ボーナス/ダメージ修正の行(式＋供給元)を indexed 入力から再構成する(consumeTargets と同型)。
        // 判定を行う用途すべてで行 UI を描画する(2026-07-17 再編)。空式の行は捨てる
        let modeUiChanged = false; // 判定モード/ダメージを修正の切替=式欄等の出し入れがあるため再描画する
        if (executionFormOf(usage) === "check" && !Number.isFinite(usage.fixedResult)) {
            update.checkBonuses = TnxUsageSheet._collectBonusRows(raw, "checkBonus");
            update.checkBonusSelf = raw["checkBonusSelf"] ?? usage.checkBonusSelf ?? "";
            // 判定モード(ラジオ・2026-07-11/12): normal/grant/modify/suitChange。排他はラジオが保証。
            // 再判定可能(allowRecheck)・スート変更可能(allowSuitChange)は「判定を行う用途」の性質の
            // ため通常モードでのみ保持
            const prevCheckMode = usage.grantRecheck === true ? "grant"
                : (usage.modifyCheck === true ? "modify"
                    : (usage.grantSuitChange === true ? "suitChange" : "normal"));
            const checkMode = raw["checkMode"] ?? prevCheckMode;
            update.grantRecheck    = checkMode === "grant";
            update.modifyCheck     = checkMode === "modify";
            update.grantSuitChange = checkMode === "suitChange";
            update.allowRecheck = checkMode === "normal"
                ? (raw["allowRecheck"] ?? usage.allowRecheck ?? false) : false;
            update.allowSuitChange = checkMode === "normal"
                ? (raw["allowSuitChange"] ?? usage.allowSuitChange ?? false) : false;
            // 攻撃タイプ(2026-07-17): ダメージ修正行は攻撃のみ。「ダメージを修正」は汎用の判定タイプ
            // のみの使用の仕方フラグ(攻撃タイプ化で排他ラジオは廃止)
            const isAtk = isAttackType(usage.type);
            const isModD = usage.type === "check" && (raw["modifyDamage"] ?? usage.modifyDamage) === true;
            if (usage.type === "check") update.modifyDamage = isModD;
            update.damageBonuses  = isAtk ? TnxUsageSheet._collectBonusRows(raw, "damageBonus") : [];
            // damageBonusSelf は攻撃の「ダメージ修正値」/ダメージを修正の「修正値」を兼ねる(2026-07-11)
            update.damageBonusSelf = (isAtk || isModD) ? (raw["damageBonusSelf"] ?? usage.damageBonusSelf ?? "") : "";
            // スタン可能は物理攻撃のみの能力ゲート(精神は説得が常時可・社会は無)
            update.canStun = usage.type === "physicalAttack"
                ? (raw["canStun"] ?? usage.canStun ?? false) : false;
            // 「ダメージを修正」のオン/オフ=式欄の出し入れ・判定モード切替=サブトグルの出し入れ
            modeUiChanged = (usage.type === "check" && isModD !== (usage.modifyDamage === true))
                || checkMode !== prevCheckMode;
        }

        // 宣言(declaration)の判定/ダメージ修正(2026-07-12): チェックボックスは独立(排他にしない)。
        // OFF にした側の式はクリアする(check 用途の非選択側クリアと同じ扱い)。
        // 表示切り替え(式欄の出し入れ)があるためフラグ変更時は再描画する
        let declModifyChanged = false;
        if (usage.type === "declaration") {
            const prevMC = usage.modifyCheck === true;
            const prevMD = usage.modifyDamage === true;
            update.modifyCheck  = raw["modifyCheck"]  ?? prevMC;
            update.modifyDamage = raw["modifyDamage"] ?? prevMD;
            update.checkBonusSelf  = update.modifyCheck  ? (raw["checkBonusSelf"]  ?? usage.checkBonusSelf  ?? "") : "";
            update.damageBonusSelf = update.modifyDamage ? (raw["damageBonusSelf"] ?? usage.damageBonusSelf ?? "") : "";
            // 再判定を付与(2026-07-13): 宣言は組み合わせなしの素の再判定権を事後付与する。
            // 式欄を持たないため再描画は不要
            update.grantRecheck = raw["grantRecheck"] ?? (usage.grantRecheck === true);
            // スートを変更(次の判定・2026-07-12): 式欄を持たないため再描画は不要
            update.grantSuitChange = raw["grantSuitChange"] ?? (usage.grantSuitChange === true);
            declModifyChanged = update.modifyCheck !== prevMC || update.modifyDamage !== prevMD;
        }

        // 治療(2026-07-17 再編): 実行形式(判定/宣言)は用途の設定で固定・回復範囲の行
        // (recoveryGroup-N/recoveryKind-N)は indexed 入力から再構成(consumeTargets 同型)。
        // 実行形式・該当すべて・グループ変更は表示項目が変わるため再描画する
        let recoveryUiChanged = false;
        if (usage.type === "treatment") {
            const prevForm = executionFormOf(usage);
            update.executionForm = (raw["executionForm"] ?? usage.executionForm) === "declaration"
                ? "declaration" : "check";
            recoveryUiChanged ||= update.executionForm !== prevForm;
            const prevAll = usage.recoveryAll === true;
            const recIdxs = Object.keys(raw)
                .map(k => k.match(/^recoveryGroup-(\d+)$/)?.[1])
                .filter(v => v !== undefined)
                .map(Number)
                .sort((a, b) => a - b);
            if (recIdxs.length || this.element?.querySelector(".usage-recovery-rows")) {
                update.recoveryTargets = recIdxs.map(i => ({
                    group: raw[`recoveryGroup-${i}`] || "bs",
                    kind:  raw[`recoveryKind-${i}`] ?? "",
                }));
                const prevGroups = (usage.recoveryTargets ?? []).map(t => t.group);
                recoveryUiChanged ||= update.recoveryTargets.length === prevGroups.length
                    && update.recoveryTargets.some((t, i) => t.group !== prevGroups[i]);
            }
            update.recoveryAll = raw["recoveryAll"] ?? prevAll;
            update.recoveryCount = Math.max(1, Number(raw["recoveryCount"]) || (usage.recoveryCount ?? 1));
            recoveryUiChanged ||= update.recoveryAll !== prevAll;
        }

        // 固定達成値(フェーズ11-5・エキストラの技能判定)。固定値用途のマーカーを兼ねるため、
        // 入力が空にされても null に戻さず 0 に留める(通常判定 UI へ化けるのを防ぐ)。負値は 0 clamp
        if (Number.isFinite(usage.fixedResult)) {
            update.fixedResult = Number.isFinite(raw["fixedResult"]) ? Math.max(0, raw["fixedResult"]) : 0;
        }

        // 消費先設定(11-6): 行入力(consumeType-N / consumeItem-N / consumeAmount-N)から再構成する。
        // 消費 UI が描画されているときのみ(固定値判定ビュー等では既存値を保持)
        const consumeIdxs = Object.keys(raw)
            .map(k => k.match(/^consumeType-(\d+)$/)?.[1])
            .filter(v => v !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        let consumeTypeChanged = false;
        if (consumeIdxs.length || this.element?.querySelector(".usage-consume-section")) {
            update.consumeTargets = consumeIdxs.map(i => {
                const type = raw[`consumeType-${i}`] || "parent";
                const rawAmount = Number(raw[`consumeAmount-${i}`]);
                return {
                    type,
                    // 親・AR は対象アイテムを持たない
                    itemId: (type === "parent" || type === "actionRank") ? "" : (raw[`consumeItem-${i}`] ?? ""),
                    // 残弾は負値=回復(リロード表現・2026-07-17)を許容。他は従来どおり1以上
                    amount: type === "ammo"
                        ? (Number.isFinite(rawAmount) && rawAmount !== 0 ? rawAmount : 1)
                        : Math.max(1, rawAmount || 1),
                };
            });
            // 種別の変更は対象アイテム選択の出し入れを伴うため再描画する(親/AR は選択欄なし)
            const prevTypes = (usage.consumeTargets ?? []).map(t => t.type || "parent");
            consumeTypeChanged = update.consumeTargets.length === prevTypes.length
                && update.consumeTargets.some((t, i) => t.type !== prevTypes[i]);
        }

        // 発動タブ: 制御 select が別の選択肢に変わったら、対応しないサブ値を残骸として残さずリセットする
        if (update.target !== "other")            update.targetOther = "";
        if (update.range !== "other")             update.rangeOther = "";
        // 物理射程以外は幅を持たない(最長射程の残骸を残さない)
        if (!RANGE_SPAN_CAPABLE.has(update.range)) update.rangeMax = "none";
        // 最長射程セレクトの出し入れ(物理射程⇄それ以外)は再描画が要る(submitOnChange は再描画しない)
        const rangeUiChanged = RANGE_SPAN_CAPABLE.has(update.range) !== RANGE_SPAN_CAPABLE.has(usage.range);
        if (update.targetValue !== "number")      update.targetValueNumber = 0;
        if (update.targetValue !== "other" && update.targetValue !== "explanation") update.targetValueOther = "";
        if (update["timing.value"] !== "action")  update["timing.actionName"]  = "blank";
        if (update["timing.value"] !== "process") update["timing.processName"] = "blank";
        if (update["timing.value"] !== "other")   update["timing.timingOther"] = "";

        // NPC取得(2026-07-13 フラグ化): check/declaration 共通。OFF はモード・参照・召喚数を
        // リセットする(再 ON でまっさらから=回復と同じ意味論)。モード変更は表示項目が変わるため再描画。
        // 召喚数は分身モードでのみ描画されるため、入力が無いときは既存値を保持する
        if ((usage.type === "check" && !Number.isFinite(usage.fixedResult)) || usage.type === "declaration") {
            const prevNA = usage.npcAcquire === true;
            update.npcAcquire = raw["npcAcquire"] ?? prevNA;
            if (update.npcAcquire) {
                const defMode = this._item.type === "styleSkill" ? "troop" : "extra";
                update.acquireMode = raw["acquireMode"] ?? (prevNA ? (usage.acquireMode || defMode) : defMode);
                update.acquireCount = raw["acquireCount"] !== undefined
                    ? Math.max(1, Number(raw["acquireCount"]) || 1)
                    : (usage.acquireCount ?? 1);
                recoveryUiChanged ||= update.acquireMode !== usage.acquireMode;
            } else if (prevNA) {
                update.acquireMode = "extra";
                update.acquireItemRefs = [];
                update.acquireActorRef = { uuid: "", name: "" };
                update.acquireCount = 1;
            }
            recoveryUiChanged ||= update.npcAcquire !== prevNA;
        }

        // ベース技能（アクション技能は常に自身に固定）: 判定を行う用途すべて(2026-07-17 再編)
        if (executionFormOf(usage) === "check") {
            update["baseSkillRef.itemId"] = this._item.system.isAction === true
                ? this._item.id
                : (raw["baseSkillRef.itemId"] ?? usage.baseSkillRef?.itemId ?? "");
        }

        // 物理攻撃の白兵/射撃(2026-07-17): 変更時は武器候補の絞り込みが変わるため再描画する。
        // 非物理の攻撃タイプは武器・ダメージ種別を持たない
        let attackKindChanged = false;
        if (usage.type === "physicalAttack") {
            const prevKind = usage.attackWeaponKind === "ranged" ? "ranged" : "melee";
            update.attackWeaponKind = (raw["attackWeaponKind"] ?? prevKind) === "ranged" ? "ranged" : "melee";
            update.damageType = raw["damageType"] ?? usage.damageType;
            attackKindChanged = update.attackWeaponKind !== prevKind;
        } else if (isAttackType(usage.type)) {
            update.weaponRefs = [];
            update.damageType = "";
        }

        // 対決欄(2026-07-17): 行入力(confrontValue-N / confront-N-<field>)から再構成する。
        // 上流カスケードの変更は下流をリセット(スタイル技能の対決カスケードと同じ規則)。
        // 種別・カスケードの変更は段の出し入れがあるため再描画する
        let confrontationUiChanged = false;
        const confIdxs = Object.keys(raw)
            .map(k => k.match(/^confrontValue-(\d+)$/)?.[1])
            .filter(v => v !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        if (confIdxs.length || this.element?.querySelector(".usage-confrontation-section")) {
            const prev = usage.confrontation ?? [];
            update.confrontation = confIdxs.map(i => {
                const p = prev[i] ?? {};
                const value = raw[`confrontValue-${i}`] || "blank";
                const row = { value, name: "", skillDict: "", skillGroup: "", skillSub: "" };
                if (value === "skillName" || value === "skillNameAsterisk") {
                    // 種別が技能名系に変わった直後はカスケード初期状態(空)から始める
                    const wasSkill = p.value === "skillName" || p.value === "skillNameAsterisk";
                    row.skillDict  = raw[`confront-${i}-skillDict`]  ?? (wasSkill ? p.skillDict  : "") ?? "";
                    row.skillGroup = raw[`confront-${i}-skillGroup`] ?? (wasSkill ? p.skillGroup : "") ?? "";
                    row.skillSub   = raw[`confront-${i}-skillSub`]   ?? (wasSkill ? p.skillSub   : "") ?? "";
                    row.name       = raw[`confront-${i}-name`]       ?? (wasSkill ? p.name       : "") ?? "";
                    if (row.skillDict !== (p.skillDict ?? "")) { row.skillGroup = ""; row.skillSub = ""; row.name = ""; }
                    else if (row.skillGroup !== (p.skillGroup ?? "")) { row.skillSub = ""; row.name = ""; }
                    else if (row.skillSub !== (p.skillSub ?? "")) { row.name = ""; }
                }
                confrontationUiChanged ||= value !== (p.value ?? "blank")
                    || row.skillDict !== (p.skillDict ?? "") || row.skillGroup !== (p.skillGroup ?? "")
                    || row.skillSub !== (p.skillSub ?? "") || row.name !== (p.name ?? "");
                return row;
            });
        }

        // ベース変更の検知(取り消し用に変更前のベースを保持)
        const prevBaseRef = usage.baseSkillRef?.itemId ?? "";
        const baseChanged = executionFormOf(usage) === "check"
            && this._item.system.isAction !== true
            && (update["baseSkillRef.itemId"] ?? prevBaseRef) !== prevBaseRef;

        await this._patchUsage(update);
        // ベース変更等を即反映: 必須コンボの移動・ベースのコンボ除去を enforcement で行い再レンダリング(冪等)
        await this._enforceComboRequirements();
        // ベースを別技能に変えて個数上限を超えたら、トリムダイアログで調整(取り消しで元のベースへ戻す)
        if (baseChanged) await this._promptTrimCombos(prevBaseRef);

        // 白兵/射撃の変更(武器候補の絞り込み)・判定モード/ダメージを修正の切替・宣言の修正フラグ変更・
        // 消費種別の変更・治療設定の変更・射程の幅・対決欄の種別/カスケード変更は入力欄の出し入れが
        // あるため即再描画する(submitOnChange は再描画しない・2026-07-09)
        if (attackKindChanged || modeUiChanged || declModifyChanged || consumeTypeChanged
            || recoveryUiChanged || rangeUiChanged || confrontationUiChanged) {
            this.render({ force: true });
        }
    }

    // ─── 自動入力（参加技能の固有値を優先度で合成） ─────────────────────────────

    static async _onAutoFill(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        const patch = await deriveUsageAutoFill(this._item, usage);
        await this._patchUsage(patch);
        this.render({ force: true });
        ui.notifications.info("発動パラメータ・対決・使用回数の消費を自動入力しました。手編集で上書きできます。");
    }

    // ─── 目標値スピナー ────────────────────────────────────────────────────────

    static async _onTvIncrement(_event, _target) { await this._stepTargetValue(1); }
    static async _onTvDecrement(_event, _target) { await this._stepTargetValue(-1); }

    async _stepTargetValue(delta) {
        const usage = this.usage;
        if (!usage) return;
        const next = Math.max(0, (usage.targetValueNumber ?? 0) + delta);
        await this._patchUsage({ targetValueNumber: next });
        this.render({ force: true });
    }

    // ─── 固定達成値スピナー(フェーズ11-5・固定値判定) ─────────────────────────

    static async _onFixedIncrement(_event, _target) { await this._stepFixedResult(1); }
    static async _onFixedDecrement(_event, _target) { await this._stepFixedResult(-1); }

    async _stepFixedResult(delta) {
        const usage = this.usage;
        if (!usage) return;
        const next = Math.max(0, (usage.fixedResult ?? 0) + delta);
        await this._patchUsage({ fixedResult: next });
        this.render({ force: true });
    }

    // ─── 消費先設定(11-6) ──────────────────────────────────────────────────────

    static async _onConsumeRowAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ consumeTargets: [...(usage.consumeTargets ?? []), { type: "parent", itemId: "", amount: 1 }] });
        this.render({ force: true });
    }

    static async _onConsumeRowDelete(_event, target) {
        const idx = Number(target.dataset.rowIndex);
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ consumeTargets: (usage.consumeTargets ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    static async _onConsumeAmountInc(_event, target) { await this._stepConsumeAmount(Number(target.dataset.rowIndex), 1); }
    static async _onConsumeAmountDec(_event, target) { await this._stepConsumeAmount(Number(target.dataset.rowIndex), -1); }

    async _stepConsumeAmount(idx, delta) {
        const usage = this.usage;
        if (!usage || !(usage.consumeTargets ?? [])[idx]) return;
        const rows = foundry.utils.deepClone(usage.consumeTargets);
        // 残弾は負値=回復(リロード表現・2026-07-17)を許容(0 は飛ばす)。他は従来どおり1以上
        if (rows[idx].type === "ammo") {
            let next = (rows[idx].amount ?? 1) + delta;
            if (next === 0) next += delta;
            rows[idx].amount = next;
        } else {
            rows[idx].amount = Math.max(1, (rows[idx].amount ?? 1) + delta);
        }
        await this._patchUsage({ consumeTargets: rows });
        this.render({ force: true });
    }

    // ─── 対決欄の行(2026-07-17) ─────────────────────────────────────────────────

    static async _onConfrontRowAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ confrontation: [
            ...(usage.confrontation ?? []),
            { value: "blank", name: "", skillDict: "", skillGroup: "", skillSub: "" },
        ] });
        this.render({ force: true });
    }

    static async _onConfrontRowDelete(_event, target) {
        const usage = this.usage;
        const idx = Number(target.dataset.rowIndex);
        if (!usage || !Number.isFinite(idx)) return;
        await this._patchUsage({ confrontation: (usage.confrontation ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    // ─── 判定ボーナス/ダメージ修正の行(式＋供給元・2026-07-10) ─────────────────────

    /** indexed 入力(<prefix>Formula-N / <prefix>Source-N)から行配列を再構成(空式は捨てる)。 */
    static _collectBonusRows(raw, prefix) {
        const re = new RegExp(`^${prefix}Formula-(\\d+)$`);
        const idxs = Object.keys(raw)
            .map(k => k.match(re)?.[1])
            .filter(v => v !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        return idxs
            .map(i => ({ formula: (raw[`${prefix}Formula-${i}`] ?? "").trim(), source: raw[`${prefix}Source-${i}`] ?? "" }))
            .filter(r => r.formula);
    }

    static async _onCheckBonusAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ checkBonuses: [...(usage.checkBonuses ?? []), { formula: "", source: "" }] });
        this.render({ force: true });
    }
    static async _onCheckBonusDelete(_event, target) {
        const usage = this.usage;
        if (!usage) return;
        const idx = Number(target.dataset.idx);
        await this._patchUsage({ checkBonuses: (usage.checkBonuses ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }
    static async _onDamageBonusAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ damageBonuses: [...(usage.damageBonuses ?? []), { formula: "", source: "" }] });
        this.render({ force: true });
    }
    static async _onDamageBonusDelete(_event, target) {
        const usage = this.usage;
        if (!usage) return;
        const idx = Number(target.dataset.idx);
        await this._patchUsage({ damageBonuses: (usage.damageBonuses ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    // ─── NPC取得: 取得アイテム参照(11-6) ───────────────────────────────────────

    static async _onAcquireRefDelete(_event, target) {
        const idx = Number(target.dataset.index);
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ acquireItemRefs: (usage.acquireItemRefs ?? []).filter((_, i) => i !== idx) });
        this.render({ force: true });
    }

    // ─── NPC取得: 取得アクター参照(判定系モード・2026-07-07 裁定) ─────────────────

    /** 取得アクターのドロップ: 取得類型と一致するトループ級アクターのみ受け付ける */
    async _onAcquireActorDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
        if (!data?.uuid) return;
        const usage = this.usage;
        if (!usage) return;
        const mode = usage.acquireMode || "extra";
        const doc = await fromUuid(data.uuid).catch(() => null);
        if (!doc || doc.documentName !== "Actor" || doc.type !== "troop" || doc.system.troopMode !== mode) {
            ui.notifications.warn(`ここには${ACQUIRE_MODES[mode] ?? ""}のアクター（種別が一致するトループ級）をドロップしてください。`);
            return;
        }
        await this._patchUsage({ acquireActorRef: { uuid: doc.uuid, name: doc.name } });
        this.render({ force: true });
    }

    static async _onAcquireActorClear(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ acquireActorRef: { uuid: "", name: "" } });
        this.render({ force: true });
    }

    static async _onAcquireCountInc(_event, _target) { await this._stepAcquireCount(1); }
    static async _onAcquireCountDec(_event, _target) { await this._stepAcquireCount(-1); }

    async _stepAcquireCount(delta) {
        const usage = this.usage;
        if (!usage) return;
        const next = Math.max(1, (usage.acquireCount ?? 1) + delta);
        await this._patchUsage({ acquireCount: next });
        this.render({ force: true });
    }

    // ─── skillRefs 管理 ────────────────────────────────────────────────────────

    static async _onSkillRefDelete(_event, target) {
        const idx = Number(target.dataset.idx);
        const usage = this.usage;
        if (!usage) return;

        const skillRefs = usage.skillRefs.filter((_, i) => i !== idx);
        await this._patchUsage({ skillRefs });
        this.render({ force: true });
    }

    // ─── 回復設定(2026-07-13) ───────────────────────────────────────────────

    static async _onRecoveryRowAdd(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ recoveryTargets: [...(usage.recoveryTargets ?? []), { group: "bs", kind: "" }] });
        this.render({ force: true });
    }

    static async _onRecoveryRowDelete(_event, target) {
        const idx = Number(target.dataset.rowIndex);
        const usage = this.usage;
        if (!usage) return;
        const rows = [...(usage.recoveryTargets ?? [])];
        if (idx < 0 || idx >= rows.length) return;
        rows.splice(idx, 1);
        await this._patchUsage({ recoveryTargets: rows });
        this.render({ force: true });
    }

    static async _onRecoveryExcludeDelete(_event, target) {
        const key = target.dataset.key;
        const usage = this.usage;
        if (!usage || !key) return;
        await this._patchUsage({ recoveryExcludes: (usage.recoveryExcludes ?? []).filter(k => k !== key) });
        this.render({ force: true });
    }

    static async _onRecoveryCountInc(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ recoveryCount: Math.max(1, (usage.recoveryCount ?? 1) + 1) });
        this.render({ force: true });
    }

    static async _onRecoveryCountDec(_event, _target) {
        const usage = this.usage;
        if (!usage) return;
        await this._patchUsage({ recoveryCount: Math.max(1, (usage.recoveryCount ?? 1) - 1) });
        this.render({ force: true });
    }

    /** 「無視する指定技能」の行を削除する(2026-07-10)。解除で指定技能(アクション)が引き込まれて
     * アクション重複になる場合は解除できない(先に該当の参加技能を外す)。 */
    static async _onIgnoreComboDelete(_event, target) {
        const key = target.dataset.key;
        const usage = this.usage;
        if (!usage || !key) return;
        const next = (usage.ignoreComboSkills ?? []).filter(k => k !== key);
        if (this._comboActionConflict(next)) {
            ui.notifications.warn("この設定を外すと指定「技能」(アクション技能)が引き込まれ、アクション技能同士になるため外せません。先に該当の組み合わせ技能を外してください。");
            return;
        }
        await this._patchUsage({ ignoreComboSkills: next });
        this.render({ force: true });
    }

    /** 指定の「無視する指定技能」構成でアクション技能が2つ以上参加になるか(現ベース込み)。 */
    _comboActionConflict(ignoreKeys) {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return false;
        const baseId = this.usage.baseSkillRef?.itemId;
        const seedIds = [
            ...(baseId && baseId !== this._item.id ? [baseId] : []),
            ...this.usage.skillRefs.map(r => r.itemId),
        ].filter(Boolean);
        const res = resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seedIds, ignoreKeys.filter(Boolean));
        const actionIds = new Set(res.mandatoryItemIds.filter(id => this._isActionSkillId(id)));
        const curBase = this._effectiveBaseId();
        if (this._isActionSkillId(curBase)) actionIds.add(curBase);
        return actionIds.size > 1;
    }

    // ─── weaponRefs 管理(攻撃プロファイル・複数武器の合算) ────────────────────────

    static async _onWeaponRefDelete(_event, target) {
        const idx = Number(target.dataset.idx);
        const usage = this.usage;
        if (!usage) return;
        const weaponRefs = (usage.weaponRefs ?? []).filter((_, i) => i !== idx);
        await this._patchUsage({ weaponRefs });
        // 射程「武器」の用途は、武器の変更に射程を追従させる(2026-07-13)
        const rangePatch = deriveWeaponRangeLive(this._item, this.usage);
        if (rangePatch) await this._patchUsage(rangePatch);
        this.render({ force: true });
    }

    // ─── effects 管理 ──────────────────────────────────────────────────────────

    static async _onEffectRemove(_event, target) {
        const effectId = target.dataset.effectId;
        const itemId = target.dataset.itemId ?? "";
        const usage = this.usage;
        if (!usage || !effectId) return;

        // itemId＋effectId で1件だけ外す(供給元アイテムが異なる同名/同IDの取り違えを避ける)
        const effects = usage.effects.filter(e => !((e.itemId || "") === itemId && e.effectId === effectId));
        await this._patchUsage({ effects });
        this.render({ force: true });
    }

    // ─── 内部ユーティリティ ────────────────────────────────────────────────────

    /**
     * usage エントリの一部フィールドをパッチ更新する。
     * @param {object} patch  ドット記法キーを含むパッチオブジェクト
     */
    async _patchUsage(patch) {
        // 直列キュー経由(2026-07-17): 常に最新の actions に対して自分の用途だけを書き換える
        // (削除済みなら何もしない=stale 上書きで消えた用途を復活させない)
        await updateUsageActions(this._item, (actions) => {
            const idx = actions.findIndex(a => a._id === this._usageId);
            if (idx === -1) return null;
            for (const [key, value] of Object.entries(patch)) {
                foundry.utils.setProperty(actions[idx], key, value);
            }
            return actions;
        });
    }

    // ─── 技能チェーン解決・必須コンボの enforcement ──────────────────────────────

    /** actor 技能アイテムを解決用に正規化する(モジュール共通関数へ委譲)。 */
    _normalizeSkillItem(it) {
        return normalizeSkillItemDoc(it);
    }

    /**
     * 同輩の技能アイテム(判定を行う用途=攻撃・リアクション等を含む・連鎖対象)を正規化して返す。対象外は null。
     * アクター所持はアクターの技能・辞典/ワールド直下は直近レンダーの同輩キャッシュ
     * (resolveUsageSiblingSkills・2026-07-18 是正=アクター外でもベース技能・連鎖を解決する)
     */
    _actorSkillItems() {
        const usage = this.usage;
        if (!usage || executionFormOf(usage) !== "check") return null;
        // 親が技能でなくても(アウトフィット等)、ベース技能が設定されていればその連鎖を解決する
        // (2026-07-18 ユーザー確定: 「ベース技能として設定された技能のベース技能」も自動解決)
        if (!CHAIN_SKILL_TYPES.includes(this._item.type) && !usage.baseSkillRef?.itemId) return null;
        const actor = this._item.actor;
        const skills = actor
            ? actor.items.filter(i => CHAIN_SKILL_TYPES.includes(i.type))
            : this._siblingSkills;
        if (!skills) return null;
        return skills.map(i => this._normalizeSkillItem(i));
    }

    /**
     * 用途の「技能」欄チェーンを actor アイテムに解決する(現コンボ＋ベース技能を seed に含めて推移的に)。
     * ベース技能を seed に含めるのは 2026-07-18 ユーザー確定: **ベース技能自身に「技能」連鎖がある場合、
     * その必須参加技能を組み合わせへ自動解決する**(ベース技能をそのシートで直接編集したときと同じ)。
     * seed の連鎖は resolveUsageSkills が推移的に必須クロージャへ畳み込む。
     */
    _resolveComboChain() {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return null;
        const baseId = this.usage.baseSkillRef?.itemId;
        const seedComboIds = [
            ...(baseId && baseId !== this._item.id ? [baseId] : []),
            ...this.usage.skillRefs.map(r => r.itemId),
        ].filter(Boolean);
        return resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seedComboIds,
            this._ignoreComboKeys());
    }

    /** 用途の「無視する指定技能」(識別キー配列・空要素除去)。 */
    _ignoreComboKeys() {
        return (this.usage?.ignoreComboSkills ?? []).filter(Boolean);
    }

    /** 現在の実効ベース技能 id(共通リゾルバ effectiveBaseSkillId に集約・2026-07-18)。 */
    _effectiveBaseId() {
        return effectiveBaseSkillId(this.usage, this._item);
    }

    /** ベース技能のレベル(＝組み合わせ技能の上限個数。ベース込みで level+1)。 */
    _baseSkillLevel(baseId) {
        const it = this._item.actor?.items.get(baseId) ?? (baseId === this._item.id ? this._item : null);
        return Number(it?.system?.level ?? 0);
    }

    /** アイテム id がアクション技能か(アクション技能はベース専用で組み合わせ技能の欄には絶対に入らない)。 */
    _isActionSkillId(id) {
        const it = this._item.actor?.items.get(id) ?? (id === this._item.id ? this._item : null);
        return it?.system?.isAction === true;
    }

    /** ベース・必須クロージャから、あるべき skillRefs を組み立てる(ベース自身＆アクション技能を除外し、必須を補完)。 */
    _targetSkillRefs(baseId, currentRefIds, res) {
        const parentItemId = this._item.id;
        // アクション技能はベース専用＝コンボに絶対入れない。ベース自身も除外する。
        const target = currentRefIds.filter(id => id !== baseId && !this._isActionSkillId(id));
        const have = new Set(target);
        for (const id of res.mandatoryItemIds) {
            if (id !== baseId && id !== parentItemId && !have.has(id) && !this._isActionSkillId(id)) { target.push(id); have.add(id); }
        }
        return target;
    }

    /** 用途シート上の組み合わせ技能数(暗黙の親＋skillRefs)と上限・ベース。 */
    _comboCountInfo() {
        const baseId = this._effectiveBaseId();
        const parentIsComboMember = baseId !== this._item.id;
        return {
            baseId,
            limit: this._baseSkillLevel(baseId),
            count: this.usage.skillRefs.length + (parentIsComboMember ? 1 : 0),
            parentIsComboMember,
        };
    }

    /** res(追加後の解決結果)を踏まえた実効ベース id。アクション連れ込みでのベース入れ替わりを反映する。 */
    _resolvedBaseId(res) {
        const parentItemId = this._item.id;
        if (this._item.system.isAction === true) return parentItemId;
        if (res?.baseLocked) return res.baseItemId;                                       // アクション連れ込み→入れ替わり
        const current = this.usage.baseSkillRef?.itemId ?? "";
        if (current) return current;
        if (res?.baseItemId && res.baseItemId !== parentItemId) return res.baseItemId;    // 既定ベース
        return parentItemId;
    }

    /**
     * 技能 itemId を組み合わせに追加できるか判定する。
     * - アクション技能の重複(参加にアクションが2つ以上＝組み合わせ不可) → reason "action"
     * - 個数上限超過(追加後のベース入れ替わりを反映) → reason "limit"
     * @returns {{allowed:boolean, reason?:string, limit?:number}}
     */
    _addComboCheck(itemId) {
        const skillItems = this._actorSkillItems();
        if (!skillItems) return { allowed: true }; // 解決不能なら制限しない
        const parentItemId = this._item.id;
        const currentRefIds = this.usage.skillRefs.map(r => r.itemId);
        const baseId = this.usage.baseSkillRef?.itemId;
        // 用途の「無視する指定技能」を反映して判定する(該当技能は指定技能を引き込まず単体参加
        // ＝指定技能がアクションでもここで弾かれない)。ベース技能も seed=その連鎖の必須も見込む
        const seeds = [
            ...(baseId && baseId !== parentItemId ? [baseId] : []),
            ...currentRefIds, itemId,
        ].filter(Boolean);
        const res = resolveUsageSkills(this._normalizeSkillItem(this._item), skillItems, seeds, this._ignoreComboKeys());

        // アクション技能の重複: 参加技能(クロージャ＋現ベース)にアクションが2つ以上 → 組み合わせ不可
        const actionIds = new Set(res.mandatoryItemIds.filter(id => this._isActionSkillId(id)));
        const curBase = this._effectiveBaseId();
        if (this._isActionSkillId(curBase)) actionIds.add(curBase);
        if (actionIds.size > 1) return { allowed: false, reason: "action" };

        // 個数上限(追加後のベース入れ替わりを反映)
        const newBaseId = this._resolvedBaseId(res);
        const limit = this._baseSkillLevel(newBaseId);
        const projected = this._targetSkillRefs(newBaseId, [...currentRefIds, itemId], res).length
            + (newBaseId !== parentItemId ? 1 : 0);
        if (projected > limit) return { allowed: false, reason: "limit", limit };
        return { allowed: true };
    }

    /**
     * 個数上限を超えているとき、外す技能をユーザーに選ばせて調整する(ベース変更で上限が下がった等)。
     * チェック状態に応じてロックを再計算し、削除予定の技能が連れ込んでいた必須技能は外せるようになる。
     * 取り消し時は prevBaseRef にベースを戻す。必須だけで超過する場合は救えないので警告して戻す。
     */
    async _promptTrimCombos(prevBaseRef) {
        const info = this._comboCountInfo();
        if (info.count <= info.limit) return;
        const needToRemove = info.count - info.limit;
        const skillItems = this._actorSkillItems();
        if (!skillItems) return;

        const actor = this._item.actor;
        const entries = [];
        if (info.parentIsComboMember) entries.push({ id: this._item.id, name: this._item.name });
        for (const r of this.usage.skillRefs) entries.push({ id: r.itemId, name: actor?.items.get(r.itemId)?.name ?? `(削除済み: ${r.itemId})` });
        const comboIds = entries.map(e => e.id);
        const { rootMandatoryIds, comboChains } = comboLockAnalysis(this._normalizeSkillItem(this._item), skillItems, comboIds);

        // 救えない: 外せる(必須でない)技能が不足
        if (comboIds.filter(id => !rootMandatoryIds.includes(id)).length < needToRemove) {
            ui.notifications.warn(`組み合わせが上限(${info.limit}個)を超えますが、必須技能だけで超過しているため調整できません。ベース技能を元に戻します。`);
            await this._patchUsage({ "baseSkillRef.itemId": prevBaseRef });
            await this._enforceComboRequirements();
            return;
        }

        const locked0 = (id) => isComboRequired(id, comboIds, rootMandatoryIds, comboChains);
        const rows = entries.map(e =>
            `<button type="button" class="tnx-trim-item" data-action="trimToggle" data-id="${e.id}" aria-pressed="false"${locked0(e.id) ? " disabled" : ""} style="text-align:left;">${e.name}${locked0(e.id) ? "（必須）" : ""}</button>`
        ).join("");
        const content = `<p>組み合わせ技能が上限(${info.limit}個)を <b>${needToRemove}</b> 個超えています。外す技能を選んで「確定」してください（必須技能は外せません）。</p>
            <div class="tnx-trim-list" style="display:flex;flex-direction:column;gap:4px;">${rows}</div>`;

        const result = await foundry.applications.api.DialogV2.wait({
            window:   { title: "組み合わせの個数調整" },
            classes:  ["tokyo-nova"],
            position: { width: 400 },
            content,
            actions: {
                trimToggle: (_event, target) => {
                    const pressed = target.getAttribute("aria-pressed") === "true";
                    target.setAttribute("aria-pressed", String(!pressed));
                    target.style.textDecoration = !pressed ? "line-through" : "";
                    target.style.opacity = !pressed ? "0.6" : "";
                    const items = [...target.closest(".tnx-trim-list").querySelectorAll(".tnx-trim-item")];
                    const toRemove = items.filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.id);
                    const kept = comboIds.filter(id => !toRemove.includes(id));
                    for (const b of items) {
                        const locked = isComboRequired(b.dataset.id, kept, rootMandatoryIds, comboChains);
                        if (locked && b.getAttribute("aria-pressed") === "true") {
                            b.setAttribute("aria-pressed", "false");
                            b.style.textDecoration = ""; b.style.opacity = "";
                        }
                        b.disabled = locked;
                    }
                },
            },
            buttons: [
                { action: "ok", icon: "fas fa-check", label: "確定", default: true,
                  callback: (_e, _b, dialog) => [...dialog.element.querySelectorAll('.tnx-trim-item[aria-pressed="true"]')].map(b => b.dataset.id) },
                { action: "cancel", icon: "fas fa-times", label: "取り消し", callback: () => "cancel" },
            ],
            rejectClose: false,
        });

        if (!Array.isArray(result)) {
            // 取り消し/閉じる: ベース変更を元に戻す
            await this._patchUsage({ "baseSkillRef.itemId": prevBaseRef });
            await this._enforceComboRequirements();
            return;
        }
        // 選択した技能を skillRefs から外す(暗黙の親は skillRefs に無いので影響なし)
        const toRemove = new Set(result);
        await this._patchUsage({ skillRefs: this.usage.skillRefs.filter(r => !toRemove.has(r.itemId)) });
        await this._enforceComboRequirements();
        // まだ超過していれば再調整(外せる技能は足りる前提なのでいずれ収束)
        const after = this._comboCountInfo();
        if (after.count > after.limit) await this._promptTrimCombos(prevBaseRef);
    }

    /**
     * 技能チェーンに基づき、用途のベース既定値と必須コンボを保つ(冪等)。
     * - ベース未設定かつ非manual → 既定ベースを設定。
     * - ベースが決まっているとき、mandatory のうちベース・親(暗黙コンボ)以外を全て skillRefs に自動追加
     *   (指定技能がベースでなくなった/別アクションがベースになった場合のはじき出し対応)。
     * 変更があったときだけ update し、true を返す。
     */
    async _enforceComboRequirements() {
        const usage = this.usage;
        if (!usage) return false;
        const res = this._resolveComboChain();
        if (!res || res.defect) return false; // 解決不能/不備のときは自動設定しない

        const parentIsAction = this._item.system.isAction === true;
        const parentItemId = this._item.id;
        const parentIsChainSkill = CHAIN_SKILL_TYPES.includes(this._item.type);
        // アクション技能がチェーンにあると、ベースは「指定技能＋その代用」に限定する(他はベースになれない)
        const baseCandidates = parentIsAction ? [parentItemId]
            : (res.baseLocked ? (res.baseCandidateItemIds ?? []) : null);
        const curBase = usage.baseSkillRef?.itemId ?? "";

        // 実効ベースを決めて**常に永続化**する(2026-07-18 統一・アクション/非アクション共通)。
        // 空フォールバック依存を廃し baseSkillRef を単一の真実にする。
        // - アクション → 親自身
        // - ロック(チェーンにアクション) → 現ベースが候補内ならユーザー選択尊重・候補外/未設定は既定へ
        // - & グループ(全員非アクション)=ベース曖昧(manual) → 自動設定しない(ユーザーが選ぶ)
        // - 非ロック → ユーザー設定尊重・未設定は連鎖の解決ベース(指定技能があれば末端・無ければ親自身)
        let baseId;
        if (parentIsAction) baseId = parentItemId;
        else if (baseCandidates) baseId = baseCandidates.includes(curBase) ? curBase : (res.baseItemId || baseCandidates[0] || "");
        else if (res.manual) baseId = curBase;
        else if (parentIsChainSkill) baseId = curBase || res.baseItemId || parentItemId;
        else baseId = curBase; // アウトフィット親等: ユーザーが設定したベースのみ

        const patch = {};
        if (baseId && baseId !== curBase) patch["baseSkillRef.itemId"] = baseId;

        // ベースが決まっているときのみ: ベース自身はコンボから外し、必須コンボ(クロージャ)を補完する
        if (baseId) {
            const current = usage.skillRefs.map(r => r.itemId);
            const target = this._targetSkillRefs(baseId, current, res); // ベース除外＋必須補完
            if (target.length !== current.length || target.some((id, i) => id !== current[i])) {
                patch.skillRefs = target.map(id => ({ itemId: id }));
            }
        }

        if (!Object.keys(patch).length) return false; // 変更なし(冪等で収束)
        await this._patchUsage(patch);
        this.render({ force: true }); // 反映のため即時再レンダリング(シートの開き直し不要)
        return true;
    }
}
