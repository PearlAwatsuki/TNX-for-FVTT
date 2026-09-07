/**
 * @fileoverview 用途データの導出と正規化(2026-09-07 用途シートから移設)。
 *
 * 参加技能からの自動入力・組み合わせ既定値の適用・用途配列の直列書き込みなど、用途の
 * **データそのもの**を作る処理。従来は用途シート(app/tnx-usage-sheet.mjs)に同居していたが、
 * インポート時の正規化はシステム起動側(tnx.mjs)から、自動入力はアイテムシートから呼ばれており、
 * データの導出を得るために 2,328 行のシートを読み込む形になっていた。
 */
import { runSerial } from "./serial-queue.mjs";

import { resolveUsageSkills } from "../rules/skill-chain-resolution.mjs";
import { deriveConsumeTargets } from "../flow/usage-consumption.mjs";
import { resolveAttackWeapons, resolveAttackRangeSpan } from "../rules/attack-weapons.mjs";
import { loadSkillUsageTypeIndex, loadDictionarySkillItems } from "../dictionary/skill-dictionary.mjs";
import { mergeConfrontationRows } from "../rules/confrontation.mjs";
import { findItemByIdentificationKey } from "./identification.mjs";
import { isAttackType, attackCategoryOf, isReactionType, executionFormOf, defaultConfrontationForType, effectiveBaseSkillId } from "../rules/usage-types.mjs";
import { resolveTarget, resolveRange, resolveTargetValue, resolveTiming, normalizeUsageExplanation } from "../rules/usage-autofill.mjs";

export const CHAIN_SKILL_TYPES = ["generalSkill", "styleSkill"];

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

// ─── system.actions の直列書き込み(2026-07-17・直列化は serial-queue へ統合=2026-09-02) ───
// 用途は1フィールドの配列(system.actions)に同居するため、並行する全配列書き込み
// (用途シートの submitOnChange/必須コンボ enforcement と、一覧の追加/削除)が最後勝ちで
// 互いを巻き戻す——削除した用途が in-flight の書き込みで復活する等。アイテムごとに
// 書き込みを直列化し、mutate は**直前の書き込み完了後の最新 actions** を受け取って
// 新しい配列(null=変更なし)を返す。これで stale スナップショットの全配列上書きが消える。

/**
 * system.actions を直列に書き換える(全書き込み経路はこれを通す)。
 * @param {Item} item 用途を持つアイテム
 * @param {(actions: Array<object>) => (Array<object>|null|Promise<Array<object>|null>)} mutate
 *        最新の actions(ディープコピー)を受け取り、新配列を返す(null=変更なし・書き込みしない)
 */
export async function updateUsageActions(item, mutate) {
    await runSerial(item.uuid ?? item.id, async () => {
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
}

/**
 * 使用武器の射程を解決する(射程「武器」の実体解決・2026-07-13 再設計)。
 * 一本目=シートの「攻撃で使用」武器・以降=用途の追加分(resolveAttackWeapons)。
 * 武器が無い(生身)・射程を持たない場合は至近(close)=生身の射程(ユーザー確定)。
 * 2026-07-16: 「近〜遠」等の幅を単一値に潰さず {range, rangeMax} で返す(rangeMax="none"=単点)。
 */
export function resolveWeaponRangeSpan(usage, item, actor) {
    const span = resolveAttackRangeSpan(resolveAttackWeapons(actor, usage, item));
    return { range: span.min, rangeMax: span.max };
}

/** actor 技能アイテムをチェーン解決用に正規化する(モジュール共通・インスタンス版は委譲) */
export function normalizeSkillItemDoc(it) {
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

    // 用途に保存済みの「解説参照」→「その他」の冪等正規化(KI-033・2026-07-19 裁定: 用途において
    // 解説参照は不自然=自己参照。辞典/ワールドで設定済みのデータもアクターへのインポート時に揃える)
    let changed = false;
    for (const usage of actions) changed = normalizeUsageExplanation(usage) || changed;

    // 親が技能でない(アウトフィット等)場合も、ベース技能を持つ用途があれば連鎖を解決する
    // (2026-07-18 ユーザー確定: ベース技能の連鎖も自動解決)。持たなければ正規化分のみ書き込む
    if (!CHAIN_SKILL_TYPES.includes(item.type)
        && !actions.some(a => a.baseSkillRef?.itemId)) {
        if (changed) await updateUsageActions(item, () => actions);
        return;
    }

    const skillItems = actor.items
        .filter(i => CHAIN_SKILL_TYPES.includes(i.type))
        .map(normalizeSkillItemDoc);
    const isActionSkill = (id) => {
        const it = id === item.id ? item : actor.items.get(id);
        return it?.system?.isAction === true;
    };
    const parentIsAction = item.system.isAction === true;

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
    // 解説参照/その他は優先度最下位のフォールバック(KI-033・2026-07-19 裁定): 勝者になるのは
    // 有効値が無いときだけで、そのとき用途へは「その他」として写す(親が「その他」なら自由記入欄も複写)
    const t = resolveTarget(skillItems.map(s => ({
        target: s.system.target, isFixed: !!s.system.isFixedTarget, otherText: s.system.targetOther,
    })));
    if (t) {
        patch.target = t.target;
        patch.isFixedTarget = t.isFixed;
        if (t.target === "other") patch.targetOther = t.otherText ?? "";
    }

    // 精神攻撃・社会攻撃は武器を持たない(2026-07-18 ユーザー確定): 「射程：武器」は解決できないため
    // 射程候補から除外する。従来は resolveWeaponRangeSpan が武器不在時に至近へ落としており、
    // 精神/社会攻撃の射程が裏で生身(至近)に化けていた。除外すると、残る参加技能の実射程
    // =最も上流のベース技能の射程が採られる(どれも「武器」だけなら射程は未設定のまま=至近にしない)。
    const isNonPhysicalAttack = isAttackType(usage.type) && attackCategoryOf(usage.type) !== "physical";
    const rangeEntries = skillItems.map(s => ({
        range: s.system.range, isFixed: !!s.system.isFixedRange, otherText: s.system.rangeOther,
    }));
    const r = resolveRange(isNonPhysicalAttack ? rangeEntries.filter(e => e.range !== "weapon") : rangeEntries);
    if (r) {
        patch.range = r.range;
        patch.rangeMax = "none"; // 技能由来の射程は単点
        patch.isFixedRange = r.isFixed;
        if (r.range === "other") patch.rangeOther = r.otherText ?? "";
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
        const tv = resolveTargetValue(skillItems.map(s => ({
            targetValue: s.system.targetValue, number: s.system.targetValueNumber, otherText: s.system.targetValueOther,
        })));
        if (tv) {
            patch.targetValue = tv.targetValue;
            if (tv.targetValueNumber !== undefined) patch.targetValueNumber = tv.targetValueNumber;
            if (tv.targetValueOther !== undefined) patch.targetValueOther = tv.targetValueOther;
        }
    }

    // タイミング: ベース技能の最初の実値 timing を採用（best-effort・非技能ベースはスキップ。
    // 解説参照/その他はフォールバック=実値が無いときだけ「その他」として写す・KI-033）
    const baseSkill = skillItems.find(s => s.id === baseId) ?? null;
    const bt = resolveTiming(baseSkill?.system.timing);
    if (bt) {
        patch["timing.value"]       = bt.value;
        patch["timing.actionName"]  = bt.actionName;
        patch["timing.processName"] = bt.processName;
        patch["timing.timingOther"] = bt.timingOther;
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
export function deriveWeaponRangeLive(item, usage) {
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
