/**
 * @fileoverview 用途シートのフォーム送信(2026-09-07 用途シートから移設)。
 *
 * 変更のたびに走る自動送信。フォームの生値を用途の形へ組み直し、組み合わせの必須条件と
 * 整合させてからアイテムへ書き戻す。項目数に比例して長くなる処理で、シート本体の骨格とは
 * 読む理由が違うため分けてある。
 */

import { isAttackType, isReactionType, executionFormOf } from "../rules/usage-types.mjs";
import { RANGE_SPAN_CAPABLE } from "../rules/usage-autofill.mjs";
import { TARGET_CONDITION_KINDS, TARGET_CONDITION_MODES } from "../rules/target-condition.mjs";

export async function submitUsageForm(sheet, event, form, formData) {
    const usage = sheet.usage;
    if (!usage) return;

    const raw = formData.object;
    const update = {
        name:        raw["name"]        ?? usage.name,
        description: raw["description"]  ?? usage.description,

        "timing.value":       raw["timing.value"]       ?? usage.timing.value,
        "timing.actionName":  raw["timing.actionName"]  ?? usage.timing.actionName,
        "timing.processName": raw["timing.processName"] ?? usage.timing.processName,
        "timing.timingOther": raw["timing.timingOther"] ?? usage.timing.timingOther,
        // 戦闘タブに表示しない(2026-07-20): 戦闘タブの再表示からこの用途を除外する
        hideInCombatTab: raw["hideInCombatTab"] ?? usage.hideInCombatTab,
        // 「ウェットの対象には効果がない」(2026-09-01 承認): ダメージ全体+適用効果の付与を
        // ウェットの対象に対して無効化する(適用される効果セクションのトグル)
        noEffectVsWet: raw["noEffectVsWet"] ?? (usage.noEffectVsWet === true),

        target:        raw["target"]        ?? usage.target,
        targetOther:   raw["targetOther"]   ?? usage.targetOther,
        isFixedTarget: raw["isFixedTarget"] ?? usage.isFixedTarget,
        // 自身に適用できない(2026-07-18): 自動セルフ解決の抑止フラグ
        cannotTargetSelf: raw["cannotTargetSelf"] ?? usage.cannotTargetSelf,

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

    // ヴィークル準備時(2026-07-18 一般化): 判定を行う用途で「ヴィークル準備時」トグル+使用ヴィークル
    // 単一参照(空=準備済みを自動解決)。トグルの切替は使用ヴィークル欄の出し入れを伴うため再描画する
    let vehicleUiChanged = false;
    if (executionFormOf(usage) === "check" && !Number.isFinite(usage.fixedResult)) {
        const prevReq = usage.requiresVehicle === true;
        update.requiresVehicle = raw["requiresVehicle"] ?? prevReq;
        if (update.requiresVehicle) {
            update["vehicleRef.itemId"] = raw["vehicleRefItemId"] ?? usage.vehicleRef?.itemId ?? "";
        }
        vehicleUiChanged = update.requiresVehicle !== prevReq;
    }

    // 判定ボーナス/ダメージ修正の行(式＋供給元)を indexed 入力から再構成する(consumeTargets と同型)。
    // 判定を行う用途すべてで行 UI を描画する(2026-07-17 再編)。空式の行は捨てる
    let modeUiChanged = false; // 判定モード/ダメージを修正の切替=式欄等の出し入れがあるため再描画する
    let condUiChanged = false; // ダメージ修正の対象条件の種類変更=サブセレクトの出し入れ(2026-09-01)
    if (executionFormOf(usage) === "check" && !Number.isFinite(usage.fixedResult)) {
        update.checkBonuses = collectBonusRows(raw, "checkBonus");
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
        update.damageBonuses  = isAtk ? collectBonusRows(raw, "damageBonus", { withCondition: true }) : [];
        // damageBonusSelf は攻撃の「ダメージ修正値」/ダメージを修正の「修正値」を兼ねる(2026-07-11)
        update.damageBonusSelf = (isAtk || isModD) ? (raw["damageBonusSelf"] ?? usage.damageBonusSelf ?? "") : "";
        // 自身の修正値の対象条件(2026-09-01 承認・UI は攻撃のみ。非攻撃は残骸をリセット)
        update.damageBonusSelfCondition = isAtk
            ? normalizeTargetCondition({
                kind: raw["damageBonusSelfCondKind"] ?? usage.damageBonusSelfCondition?.kind,
                mode: raw["damageBonusSelfCondMode"] ?? usage.damageBonusSelfCondition?.mode,
                key:  raw["damageBonusSelfCondKey"]  ?? usage.damageBonusSelfCondition?.key,
            })
            : { kind: "none", mode: "exclude", key: "" };
        // 条件の種類の変更=キー/極性セレクトの出し入れがあるため再描画する
        const prevRowKinds = (usage.damageBonuses ?? []).map(r => r.targetCondition?.kind ?? "none");
        condUiChanged = isAtk && (
            update.damageBonuses.some((r, i) => (r.targetCondition?.kind ?? "none") !== (prevRowKinds[i] ?? "none"))
            || update.damageBonusSelfCondition.kind !== (usage.damageBonusSelfCondition?.kind ?? "none"));
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
    // 防御タイプ(17-2): 動作の切替は治療設定・範囲・系統の出し入れを伴うため再描画する。
    // 系統チェックはフォームに描画されているときだけ再構成する(未描画の送信で全消しにしない)
    const isCureDefence = usage.type === "miracleDefence" && (usage.defenceAction || "prevent") === "cure";
    // 即死・社会戦(17-3)の設定
    if (usage.type === "miracleKill") update.killCategory = raw["killCategory"] ?? usage.killCategory ?? "physical";
    if (usage.type === "miracleSocial") update.socialDecide = raw["socialDecide"] ?? usage.socialDecide ?? "choose";
    // 宣言の効果(17-4/17-6)
    if (usage.type === "miracleDeclaration") update.miracleEffect = raw["miracleEffect"] ?? usage.miracleEffect ?? "";
    if (usage.type === "miracleDefence") {
        const prevAct = usage.defenceAction || "prevent";
        update.defenceAction = raw["defenceAction"] ?? prevAct;
        update.defenceScope  = raw["defenceScope"] ?? usage.defenceScope ?? "all";
        if (sheet.element?.querySelector(".usage-defence-categories")) {
            update.defenceCategories = ["physical", "mental", "social"]
                .filter(c => raw[`defenceCategory-${c}`] === true);
        }
        update.recoveryEffects    = raw["recoveryEffects"] ?? (usage.recoveryEffects === true);
        update.recoverySceneLimit = raw["recoverySceneLimit"] ?? usage.recoverySceneLimit ?? "none";
        recoveryUiChanged ||= update.defenceAction !== prevAct;
    }
    if (usage.type === "treatment" || isCureDefence) {
        if (usage.type === "treatment") {
            const prevForm = executionFormOf(usage);
            update.executionForm = (raw["executionForm"] ?? usage.executionForm) === "declaration"
                ? "declaration" : "check";
            recoveryUiChanged ||= update.executionForm !== prevForm;
        }
        const prevAll = usage.recoveryAll === true;
        const recIdxs = Object.keys(raw)
            .map(k => k.match(/^recoveryGroup-(\d+)$/)?.[1])
            .filter(v => v !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        if (recIdxs.length || sheet.element?.querySelector(".usage-recovery-rows")) {
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

    // 割り込み許可(13-5): 宣言/判定用途のトグル。オンにすると、この用途を使ったとき対象の
    // combatant に「割り込み許可」を立て、トラッカーの割り込み入口が開く(行使で消費)。
    // トグルが描画されるのは check(通常モード)/declaration のときだけ——未描画時は既存値を維持
    if (usage.type === "check" || usage.type === "declaration") {
        update.grantsInterrupt = raw["grantsInterrupt"] ?? (usage.grantsInterrupt === true);
        // 割り込みで AR を消費(consumesAr・2026-07-26): トグルは grantsInterrupt が真のときだけ
        // 描画される。未描画(オフ／同一送信でオンにした直後)は既定/既存値を維持(既定=真)。
        update.interruptConsumesAr = raw["interruptConsumesAr"] ?? (usage.interruptConsumesAr !== false);
    }

    // 固定達成値(フェーズ11-5・エキストラの技能判定)。固定値用途のマーカーを兼ねるため、
    // 入力が空にされても null に戻さず 0 に留める(通常判定 UI へ化けるのを防ぐ)。負値は 0 clamp
    if (Number.isFinite(usage.fixedResult)) {
        update.fixedResult = Number.isFinite(raw["fixedResult"]) ? Math.max(0, raw["fixedResult"]) : 0;
    }

    // 消費(2026-07-18 再編): 行入力(consumeType-N / consumeItem-N / consumeAmount-N)
    // から再構成する。消費 UI が描画されているときのみ(固定値判定ビュー等では既存値を保持)
    const consumeIdxs = Object.keys(raw)
        .map(k => k.match(/^consumeType-(\d+)$/)?.[1])
        .filter(v => v !== undefined)
        .map(Number)
        .sort((a, b) => a - b);
    let consumeUiChanged = false;
    if (consumeIdxs.length || sheet.element?.querySelector(".usage-consume-section")) {
        update.consumeTargets = consumeIdxs.map(i => {
            const type = raw[`consumeType-${i}`] || "item";
            const isItem = type === "item";
            const rawAmount = Number(raw[`consumeAmount-${i}`]);
            // 資源セレクトは2択以上のときだけ描画される(使用回数のみのアイテムでは出ない)。
            // 未描画のときは保存済みの値を維持する(勝手に書き換えない)
            const rawResource = raw[`consumeResource-${i}`];
            const resource = isItem
                ? (rawResource ?? usage.consumeTargets?.[i]?.resource ?? "uses")
                : "uses";
            return {
                type,
                // AR は対象アイテムを持たない。item は空="このアイテム自身"
                itemId: isItem ? (raw[`consumeItem-${i}`] ?? "") : "",
                resource,
                // 消費数はロックしない(2026-07-18): 0/負値(=回復)も許容。未入力(NaN)のみ 1
                amount: Number.isFinite(rawAmount) ? rawAmount : 1,
            };
        });
        // 種別/対象/資源の変更は選択欄の出し入れ(資源セレクトの有無)を伴うため再描画する
        const prev = usage.consumeTargets ?? [];
        consumeUiChanged = update.consumeTargets.length !== prev.length
            || update.consumeTargets.some((t, i) => t.type !== (prev[i]?.type ?? "item")
                || t.itemId !== (prev[i]?.itemId ?? "") || t.resource !== (prev[i]?.resource ?? "uses"));
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
            const defMode = sheet._item.type === "styleSkill" ? "troop" : "extra";
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

    // 改造して入手(16-4): 購入タイプの任意属性
    if (usage.type === "purchase") {
        update.acquireModified = raw["acquireModified"] ?? (usage.acquireModified === true);
    }

    // ベース技能（アクション技能は常に自身に固定）: 判定を行う用途すべて(2026-07-17 再編)
    if (executionFormOf(usage) === "check") {
        update["baseSkillRef.itemId"] = sheet._item.system.isAction === true
            ? sheet._item.id
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
    if (confIdxs.length || sheet.element?.querySelector(".usage-confrontation-section")) {
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
        && sheet._item.system.isAction !== true
        && (update["baseSkillRef.itemId"] ?? prevBaseRef) !== prevBaseRef;

    await sheet._patchUsage(update);
    // ベース変更等を即反映: 必須コンボの移動・ベースのコンボ除去を enforcement で行い再レンダリング(冪等)
    await sheet._enforceComboRequirements();
    // ベースを別技能に変えて個数上限を超えたら、トリムダイアログで調整(取り消しで元のベースへ戻す)
    if (baseChanged) await sheet._promptTrimCombos(prevBaseRef);

    // 白兵/射撃の変更(武器候補の絞り込み)・判定モード/ダメージを修正の切替・宣言の修正フラグ変更・
    // 消費種別の変更・治療設定の変更・射程の幅・対決欄の種別/カスケード変更は入力欄の出し入れが
    // あるため即再描画する(submitOnChange は再描画しない・2026-07-09)
    if (attackKindChanged || modeUiChanged || condUiChanged || declModifyChanged || consumeUiChanged
        || recoveryUiChanged || rangeUiChanged || confrontationUiChanged || vehicleUiChanged) {
        sheet.render({ force: true });
    }
}

/**
 * indexed 入力(<prefix>Formula-N / <prefix>Source-N)から行配列を再構成(空式は捨てる)。
 * withCondition(ダメージ修正行・2026-09-01)は対象条件(<prefix>CondKind/Mode/Key-N)も拾う。
 * kind=none は条件なし=mode/key の残骸をリセット・wet は key を持たない。
 */
export function collectBonusRows(raw, prefix, { withCondition = false } = {}) {
    const re = new RegExp(`^${prefix}Formula-(\\d+)$`);
    const idxs = Object.keys(raw)
        .map(k => k.match(re)?.[1])
        .filter(v => v !== undefined)
        .map(Number)
        .sort((a, b) => a - b);
    return idxs
        .map(i => {
            const row = { formula: (raw[`${prefix}Formula-${i}`] ?? "").trim(), source: raw[`${prefix}Source-${i}`] ?? "" };
            if (withCondition) {
                row.targetCondition = normalizeTargetCondition({
                    kind: raw[`${prefix}CondKind-${i}`],
                    mode: raw[`${prefix}CondMode-${i}`],
                    key:  raw[`${prefix}CondKey-${i}`],
                });
            }
            return row;
        })
        .filter(r => r.formula);
}

/** 対象条件の入力値を正規化する(kind=none は mode/key をリセット・wet は key を持たない)。 */
export function normalizeTargetCondition({ kind, mode, key } = {}) {
    const k = TARGET_CONDITION_KINDS.includes(kind) ? kind : "none";
    if (k === "none") return { kind: "none", mode: "exclude", key: "" };
    return {
        kind: k,
        mode: TARGET_CONDITION_MODES.includes(mode) ? mode : "exclude",
        key:  k === "wet" ? "" : (key ?? ""),
    };
}
