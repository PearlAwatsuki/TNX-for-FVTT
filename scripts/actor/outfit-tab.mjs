/**
 * @fileoverview アウトフィットタブの行データ組み立て(2026-09-07 シート基底から移設)。
 *
 * 大分類ごとのグループ構成・1 行分の表示データ・列の値(単体/コンバイン合成)・部位占有パネルを
 * 作る。いずれもアクターのアイテムを読んで表示用の素データへ整形するだけで、シートの状態
 * (編集モード・スクロール位置・DOM)には触れない——`this` を使っていた箇所も実体は `this.actor`
 * だけだったため、アクターを引数に取る関数にした。純粋なので単体で試験できる。
 */

import { getMinorCategoryLabel, getMajorCategoryLabel, isMajorLevelSlotMajor } from "../data/item/outfit-categories.mjs";
import { formatWeaponRangeLabel } from "../ui/outfit-view.mjs";
import { formatPartDesignation, joinPartDesignations, computePartOccupancy, computeHostOccupancy, resolvePartRowsForDisplay, resolvePartAdditions, OUTFIT_NAME_SLOT_KIND } from "../data/item/part-helpers.mjs";
import { SLOT_KINDS } from "../data/item/common/extensible.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { isOutfitDestroyed, isOutfitMalfunctioning } from "../data/item/helpers.mjs";
import { HOUSING_AREA_RANKS } from "../data/item/housing-area.mjs";
import { resolveItemNameByKey } from "../core/identification.mjs";
import { residenceEffectiveValues } from "../core/residence-area.mjs";

/** 大分類ごとの表示設定（表示ラベル・列定義）。アイテム/サービスは「その他」にまとめる。 */
export const OUTFIT_GROUP_CONFIG = [
    { key: "weapon",     label: "武器",       sourceKeys: ["weapon"],
      columns: [
          { key: "hide",    label: "隠" },
          { key: "attack",  label: "攻" },
          { key: "guard",   label: "受" },
          { key: "range",   label: "射" },
          { key: "hack",    label: "電制" },
          { key: "part",    label: "部位" },
      ] },
    { key: "armor",      label: "防具",       sourceKeys: ["armor"],
      columns: [
          { key: "hide",    label: "隠" },
          { key: "defence", label: "防(S／P／I)" },
          { key: "control", label: "制" },
          { key: "hack",    label: "電制" },
          { key: "part",    label: "部位" },
      ] },
    { key: "cyberware", label: "サイバーウェア", sourceKeys: ["cyberware"],
      columns: [
          { key: "hide",    label: "隠" },
          { key: "hack",    label: "電制" },
          { key: "part",    label: "部位" },
      ] },
    { key: "tron",       label: "トロン",     sourceKeys: ["tron"],
      columns: [
          { key: "hide",    label: "隠" },
          { key: "cycle",   label: "サ" },
          { key: "soft",    label: "ソ" },
          { key: "hard",    label: "ハ" },
          { key: "cs",      label: "CS" },
          { key: "hack",    label: "電制" },
          { key: "part",    label: "部位" },
      ] },
    { key: "vehicle",    label: "ヴィークル", sourceKeys: ["vehicle"],
      columns: [
          { key: "hide",      label: "隠" },
          { key: "attack",    label: "攻" },
          { key: "sf",        label: "SF" },
          { key: "defence",   label: "防(S／P／I)" },
          { key: "control",   label: "制" },
          { key: "passenger", label: "乗員" },
          { key: "slot",      label: "ス" },
          { key: "hack",      label: "電制" },
          { key: "part",      label: "部位" },
      ] },
    { key: "housing",    label: "住居",       sourceKeys: ["housing"],
      columns: [
          { key: "appearance", label: "登" },
          { key: "security",   label: "セ" },
          { key: "part",       label: "部位" },
      ] },
    { key: "other",      label: "その他",     sourceKeys: ["item", "service"],
      columns: [
          { key: "hide",    label: "隠" },
          { key: "hack",    label: "電制" },
          { key: "part",    label: "部位" },
      ] },
];

/** OUTFIT_GROUP_CONFIG の key に対応する表示グループキーを返す。 */
export function displayGroupKey(major) {
    if (!major || major === "item" || major === "service") return "other";
    return major;
}

/**
 * オプションが装備先で消費するスロット数(部位表記の数字)。最初の option 行の slots を採る。
 * 既定 1(指定なし)。0 は非消費(武器0 等)。
 */
export function optionConsumption(sys) {
    const rows = Array.isArray(sys.part) ? sys.part : [];
    const optRow = rows.find(r =>
        r?.kind === "option" || (r?.kind === "reference" && r?.refSubKind === "option"));
    if (!optRow) return 1;
    const n = Number(optRow.slots);
    return Number.isFinite(n) ? Math.max(0, n) : 1;
}

/** 1 列分の表示値を計算する。表示は AE 込み実効値(total)。編集入力は base のまま(フェーズ9-3)。 */
export function computeColValue(key, sys, effectiveValues, partCtx = null) {
    // {mode,value,effectMod} の実効値。mode=value 以外は null
    const mvT = (f) => f?.mode === "value" ? (f.total ?? f.value) : null;
    switch (key) {
        case "hide": {
            const h = mvT(sys.hide) ?? "-";
            const d = mvT(sys.appearancePenalty) ?? "-";
            return (h === "-" && d === "-") ? "-" : `${h}／${d}`;
        }
        case "attack": {
            // 表示は実効値(AE 込み・2026-07-13): 種別=damageTypeTotal・値=total
            const dt = sys.attack?.damageTypeTotal || sys.attack?.damageType;
            return dt ? `${dt}+${sys.attack.total ?? sys.attack.value ?? 0}` : "-";
        }
        case "guard":
            return mvT(sys.guardValue) !== null ? String(mvT(sys.guardValue)) : "-";
        case "range":
            return (sys.range?.min && sys.range.min !== "none")
                ? formatWeaponRangeLabel(sys.range) : "-";
        case "hack":
            return mvT(sys.hack) !== null ? String(mvT(sys.hack)) : "-";
        case "defence":
            return sys.defence?.mode === "value"
                ? `${sys.defence.S_total ?? sys.defence.S_defence}／${sys.defence.P_total ?? sys.defence.P_defence}／${sys.defence.I_total ?? sys.defence.I_defence}` : "-";
        case "control":
            return mvT(sys.controlMod) !== null ? String(mvT(sys.controlMod)) : "-";
        case "slot": {
            const s = (sys.slots ?? []).find(s => s.kind === "normal");
            return mvT(s?.count) !== null ? String(mvT(s.count)) : "-";
        }
        case "soft": {
            const s = (sys.slots ?? []).find(s => s.kind === "software");
            return mvT(s?.count) !== null ? String(mvT(s.count)) : "-";
        }
        case "hard": {
            const s = (sys.slots ?? []).find(s => s.kind === "hardware");
            return mvT(s?.count) !== null ? String(mvT(s.count)) : "-";
        }
        case "cycle":
            return mvT(sys.cycle) !== null ? String(mvT(sys.cycle)) : "-";
        case "cs":
            return mvT(sys.combatSpeedMod) !== null ? String(mvT(sys.combatSpeedMod)) : "-";
        case "sf":
            return mvT(sys.speedFactor) !== null ? String(mvT(sys.speedFactor)) : "-";
        case "passenger":
            return mvT(sys.passenger) !== null ? String(mvT(sys.passenger)) : "-";
        // 住宅施設は effectiveValues（AE 込みの実効値＋住宅エリアの修正）が常に渡る。
        // フォールバックは住宅施設以外の行（値を持たない）のための素値読み
        case "appearance":
            return String(effectiveValues?.appearanceTarget
                ?? sys.appearanceTargetTotal ?? sys.appearanceTarget ?? 0);
        case "security": {
            const cyber  = effectiveValues?.cyberSecurity
                ?? sys.cyberSecurityTotal ?? sys.cyberSecurity ?? 0;
            const analog = effectiveValues?.analogSecurity
                ?? sys.analogSecurityTotal ?? sys.analogSecurity ?? 0;
            return `${cyber}／${analog}`;
        }
        case "part": {
            // 部位キーの逆引き＋AE 追加行の併記(フェーズ12)
            const slots = partCtx?.slots ?? [];
            return formatPartDesignation(
                resolvePartRowsForDisplay(sys.part, slots, partCtx?.resolveHostName), sys.partRelation, sys.partOptional,
                resolvePartAdditions(sys.partAdded, slots));
        }
        default:
            return "-";
    }
}

/**
 * コンバイン活性中の見た目元アイテム行の列値を merged 計算する。
 * @param {string} key 列キー
 * @param {Item} combinerItem コンバイナーアイテム
 * @param {Item} srcItem1 ソース1（combine.source1）
 * @param {Item} srcItem2 ソース2（combine.source2）
 * @returns {string}
 */
export function computeCombinedColValue(key, combinerItem, srcItem1, srcItem2, partCtx = null) {
    const csys   = combinerItem.system;
    const params = csys.combine.params ?? {};
    const s1sys  = srcItem1.system;
    const s2sys  = srcItem2.system;
    const appearIs1 = csys.combine.appearance !== "2";
    const appearSys = appearIs1 ? s1sys : s2sys;

    /** params[paramKey] に従って source1 または source2 の system を返す */
    const chosenSys = (paramKey) => (params[paramKey] === "2" ? s2sys : s1sys);

    // {mode,value,effectMod} の実効値。_computeColValue と同じ規約
    // (表示は AE 込み実効値・編集入力は base のまま)。以前はここだけ素値 .value を読んでおり、
    // コンバイン行にだけ AE が乗らなかった(KI-039 と同種・attack だけ先に是正済みだった)
    const mvT = (f) => f?.mode === "value" ? (f.total ?? f.value) : null;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const slotVal = (sys, kind) => {
        const slot = (sys.slots ?? []).find(s => s.kind === kind);
        return num(mvT(slot?.count));
    };

    switch (key) {
        case "hide": {
            // 見た目元の隠(コンバイナーの隠) ／ 選択した元の危険値
            const h  = mvT(appearSys.hide) ?? "-";
            const ch = mvT(csys.hide) ?? "-";
            const d  = mvT(chosenSys("appearancePenalty").appearancePenalty) ?? "-";
            return (h === "-" && ch === "-" && d === "-") ? "-"
                : `${h}(${ch})／${d}`;
        }
        case "attack": {
            const s = chosenSys("attack");
            // 表示は実効値(AE 込み・2026-07-13)
            const dt = s.attack?.damageTypeTotal || s.attack?.damageType;
            return dt ? `${dt}+${s.attack.total ?? s.attack.value ?? 0}` : "-";
        }
        case "guard": {
            const v = mvT(chosenSys("guardValue").guardValue);
            return v !== null ? String(v) : "-";
        }
        case "range": {
            const s = chosenSys("range");
            return (s.range?.min && s.range.min !== "none")
                ? formatWeaponRangeLabel(s.range) : "-";
        }
        case "hack": {
            const vals = [mvT(s1sys.hack), mvT(s2sys.hack)]
                .filter(v => v !== null).map(num);
            return vals.length ? String(Math.max(...vals)) : "-";
        }
        case "defence": {
            const d = chosenSys("defence").defence;
            return d?.mode === "value"
                ? `${d.S_total ?? d.S_defence}／${d.P_total ?? d.P_defence}／${d.I_total ?? d.I_defence}` : "-";
        }
        case "control": {
            const v = mvT(chosenSys("controlMod").controlMod);
            return v !== null ? String(v) : "-";
        }
        case "sf": {
            const v = mvT(chosenSys("speedFactor").speedFactor);
            return v !== null ? String(v) : "-";
        }
        case "passenger": {
            const v = mvT(chosenSys("passenger").passenger);
            return v !== null ? String(v) : "-";
        }
        case "cycle": {
            const v = mvT(chosenSys("cycle").cycle);
            return v !== null ? String(v) : "-";
        }
        case "cs": {
            const v = mvT(chosenSys("combatSpeedMod").combatSpeedMod);
            return v !== null ? String(v) : "-";
        }
        case "slot": {
            const total = slotVal(s1sys, "normal") + slotVal(s2sys, "normal");
            return total > 0 ? String(total) : "-";
        }
        case "soft": {
            const total = slotVal(s1sys, "software") + slotVal(s2sys, "software");
            return total > 0 ? String(total) : "-";
        }
        case "hard": {
            const total = slotVal(s1sys, "hardware") + slotVal(s2sys, "hardware");
            return total > 0 ? String(total) : "-";
        }
        case "part": {
            // 部位キーの逆引き＋AE 追加行の併記(フェーズ12)
            const slots = partCtx?.slots ?? [];
            const resolved = (sys) => ({
                part: resolvePartRowsForDisplay(sys.part, slots, partCtx?.resolveHostName),
                partRelation: sys.partRelation,
                partOptional: sys.partOptional,
                partAdditions: resolvePartAdditions(sys.partAdded, slots),
            });
            return joinPartDesignations([resolved(s1sys), resolved(s2sys)]);
        }
        default:
            return computeColValue(key, appearSys, null, partCtx);
    }
}

/** 1 アイテム分の行データを構築する。 */
export async function prepareOutfitRow(actor, item, optionsByParent) {
    const sys = item.system;
    const isOption = !!(sys.isOption && sys.parentItemId);

    // 表示名
    let displayName = item.name;

    // コンバイン見た目元の場合: コンバイナーと両ソースを解決して merged 列値を使う
    let combinerItem = null;
    let mergeSrc1 = null;
    let mergeSrc2 = null;
    if (sys.combineGroupId) {
        const ci = actor.items.get(sys.combineGroupId);
        if (ci?.system.isCombineActive) {
            const s1 = actor.items.find(i => i.uuid === ci.system.combine.source1) ?? null;
            const s2 = actor.items.find(i => i.uuid === ci.system.combine.source2) ?? null;
            if (s1 && s2) {
                combinerItem = ci;
                mergeSrc1    = s1;
                mergeSrc2    = s2;
                displayName  = `${item.name}（コンバイン）`;
            }
        }
    }

    // 住宅施設の実効値（AE 込み＋住宅エリアの修正）＋エリア（セキュリティ・ランク）の
    // バッジ表示用ラベル(10-4)。住宅エリアが未設定でも実効値は出す（KI-039 の是正＝
    // 以前は住宅エリアが無いと素値へフォールバックし、AE が表示に乗らなかった）
    let effectiveValues = null;
    let housingAreaRank = null;
    if (item.type === "residence") {
        const values = await residenceEffectiveValues(sys);
        effectiveValues = values;
        if (values.hasArea) {
            housingAreaRank = { key: values.area, label: HOUSING_AREA_RANKS[values.area] ?? values.area };
        }
    }

    // 列値を事前計算（コンバイン見た目元は merged 値、それ以外は通常値）
    // 入れ子オプション(実効準備済み)は移動先=ホストのグループの列で計算する(2026-07-23 是正)。
    // 元の大分類の列(搭載兵器なら攻/受/射…)ではなく、装備先の表(ヴィークル)の列に合わせる。
    const hostGroupKey = (sys.isOption && sys.parentItemId && sys.isPreparedEffective)
        ? displayGroupKey(actor.items.get(sys.parentItemId)?.system?.majorCategory)
        : null;
    const gk = hostGroupKey ?? displayGroupKey(sys.majorCategory);
    const cfg = OUTFIT_GROUP_CONFIG.find(c => c.key === gk)
        ?? OUTFIT_GROUP_CONFIG.at(-1);
    // 部位列の表示文脈(フェーズ12): 部位キーの逆引き用スロット集合(AE 追加込みの実効)＋
    // オプションのアイテム名(hostKey)→現在名の解決子(所持品の識別キー逆引き・2026-07-23)
    const partCtx = {
        slots: actor.system.partSlotsEffective ?? actor.system.partSlots ?? [],
        resolveHostName: (key) => resolveItemNameByKey(actor, key),
    };
    const colValues = cfg.columns.map(col => ({
        key:   col.key,
        value: (combinerItem)
            ? computeCombinedColValue(col.key, combinerItem, mergeSrc1, mergeSrc2, partCtx)
            : computeColValue(col.key, sys, effectiveValues, partCtx),
    }));

    // 故障/破壊(2026-07-18): 表示クラス(破壊=グレー+取消線 優先・故障=赤+取消線)と、
    // サービス/バックグラウンドの携帯/準備トグル非表示フラグ。実効値(sys=派生済み system)で判定。
    const isMalfunctioning = isOutfitMalfunctioning(sys);
    const isDestroyed = isOutfitDestroyed(sys);
    const brokenClass = isDestroyed ? "outfit-name--destroyed"
        : (isMalfunctioning ? "outfit-name--malfunction" : "");

    // 準備トグルの無効化(課題2): 携帯していない、またはオプションで装備先(親)が未準備のとき無効。
    const optionHostPrepared = isOption ? !!actor.items.get(sys.parentItemId)?.system?.isPrepared : true;
    const prepareToggleDisabled = !sys.isCarrying || (isOption && !optionHostPrepared);

    return {
        _id: item.id,
        displayName,
        img: item.img,
        system: sys,
        isOption,
        isResidence: item.system.majorCategory === "housing",
        housingAreaRank,
        hasOptions: optionsByParent.has(item.id),
        isMalfunctioning,
        isDestroyed,
        brokenClass,
        prepareToggleDisabled,
        // サービス/バックグラウンドは必ず準備・携帯(未準備にできない)=携帯/準備トグルを出さない(2026-07-18)
        hidePrepareToggles: sys.minorCategory === "background",
        colValues,
        // 展開パネルの解説はエンリッチ済みで渡す(16-x: @UUID コンテンツリンク等の解決)
        description: await foundry.applications.ux.TextEditor.enrichHTML(sys.description ?? "", { async: true }),
        combineInfo: combinerItem ? {
            combinerName:  combinerItem.name,
            source1Name:   mergeSrc1.name,
            source2Name:   mergeSrc2.name,
        } : null,
    };
}

/** 大分類でグループ化したアウトフィット行データを構築する。 */
export async function prepareOutfitGroups(actor) {
    const outfitItems = actor.items
        .filter(i => OUTFIT_ITEM_TYPES.has(i.type))
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    // コンバイン活性中は「コンバイナー本体」と「非見た目元ソース」をリストから隠す
    const combineHiddenIds = new Set();
    for (const item of outfitItems) {
        if (item.type !== "combiner" || !item.system.isCombineActive) continue;
        combineHiddenIds.add(item.id);
        const hiddenSrcKey = item.system.combine.appearance === "2" ? "source1" : "source2";
        const hiddenItem = outfitItems.find(i => i.uuid === item.system.combine[hiddenSrcKey]);
        if (hiddenItem) combineHiddenIds.add(hiddenItem.id);
    }

    // 入れ子(ホスト配下)にするのは「実効準備済み(装備対象=親も準備済み)のオプション」だけ。
    // 装備先が未準備/自身が未準備(携帯のみ)は装着されていないので、配下から外して独立行で表示する
    // (isPreparedEffective=保存 isPrepared かつ親準備済み・課題2/2026-07-23)。
    const isNestedOption = (sys) => sys.isOption && sys.parentItemId && sys.isPreparedEffective;

    // スロットゲージ(種別ごと)用: ホストの種別→容量マップ(cap>0 のみ)
    const hostCapByKind = (sys) => {
        const m = new Map();
        for (const s of (Array.isArray(sys.slots) ? sys.slots : [])) {
            if (s?.count?.mode !== "value") continue;
            // 実効値(改造・AE 込み)を読む(表示は全箇所実効値・16-4是正)
            const cap = Number(s.count.total ?? s.count.value) || 0;
            if (cap > 0) m.set(s.kind, (m.get(s.kind) ?? 0) + cap);
        }
        return m;
    };

    const optionsByParent = new Map();
    for (const item of outfitItems) {
        if (!isNestedOption(item.system)) continue;
        const pid = item.system.parentItemId;
        if (!optionsByParent.has(pid)) optionsByParent.set(pid, []);
        optionsByParent.get(pid).push(item);
    }

    const rowsById = new Map();
    for (const item of outfitItems) {
        rowsById.set(item.id, await prepareOutfitRow(actor, item, optionsByParent));
    }

    const byGroupKey = new Map();
    for (const item of outfitItems) {
        if (isNestedOption(item.system)) continue; // 準備済みオプションのみ入れ子へ回す
        if (combineHiddenIds.has(item.id)) continue;
        const gk = displayGroupKey(item.system.majorCategory);
        if (!byGroupKey.has(gk)) byGroupKey.set(gk, []);
        byGroupKey.get(gk).push(item);
    }

    return OUTFIT_GROUP_CONFIG.map(cfg => {
        const groupItems = byGroupKey.get(cfg.key) ?? [];
        const rows = [];
        for (const item of groupItems) {
            const row = rowsById.get(item.id);
            const opts = optionsByParent.get(item.id) ?? [];
            if (row) {
                // 容量>0 のスロットを1つ以上持つアウトフィットは常にゲージ表示(種別ごと)。
                // スロット:-(無スロット)も スロット:0(容量0)も非表示＝占有計算と同基準。
                // 何も準備していなくても 0/容量 を出す。種別名はツールチップ、色は種別ごと(--c)。
                const capByKind = hostCapByKind(item.system);
                const usedByKind = new Map();
                for (const o of opts) {
                    const k = o.system.parentSlotKind || "normal";
                    usedByKind.set(k, (usedByKind.get(k) ?? 0) + optionConsumption(o.system));
                }
                // 便宜スロット「アイテム名」: 名前指定オプションが載ったホスト(スロットなしを含む)は
                // 容量1のゲージを出す(占有時のみ=非占有品には出さない。占有計算 computeHostOccupancy と同基準)。
                const effCapByKind = new Map(capByKind);
                if (usedByKind.has(OUTFIT_NAME_SLOT_KIND)) effCapByKind.set(OUTFIT_NAME_SLOT_KIND, 1);
                if (effCapByKind.size) { // 実スロット(cap>0)or アイテム名占有があるホストだけゲージ表示
                    const kinds = [...new Set([...effCapByKind.keys(), ...usedByKind.keys()])];
                    row.slotGauges = kinds.map((kind) => {
                        const capacity = effCapByKind.get(kind) ?? 0;
                        const used = usedByKind.get(kind) ?? 0;
                        const total = Math.min(Math.max(capacity, used), 8); // 最大8ピップ
                        return {
                            kind, // 色分けクラス用(normal/software/hardware/surface/deep/unconscious/outfitName)
                            used, capacity, over: used > capacity,
                            pips: Array.from({ length: total }, (_, i) => ({ on: i < used, over: i >= capacity })),
                        };
                    });
                }
                rows.push(row);
            }
            // ホスト配下の準備済みオプションを視覚的入れ子で続ける(最終行フラグで接続線の枝端を制御)。
            // どのスロットに載るかは入れ子(ホスト直下)で自明のため、スロット名タグは出さない(2026-07-23 ユーザー確定)。
            opts.forEach((opt, i) => {
                const optRow = rowsById.get(opt.id);
                if (!optRow) return;
                optRow.isNested = true;
                optRow.isLastOption = (i === opts.length - 1);
                rows.push(optRow);
            });
        }
        return { key: cfg.key, label: cfg.label, columns: cfg.columns, hasItems: rows.length > 0, items: rows };
    });
}

/**
 * 部位占有を算出する(フェーズ10)。純粋関数に委ね、シートはアクターのデータを最小形へ整形して渡す。
 * - ①身体部位: キャストの部位スロット集合 vs 準備済みアウトフィットの部位(computePartOccupancy)。
 * - ②③ホストスロット: 準備済みホスト(スロット保有/スロットなし)の容量 vs 準備済みオプションの
 *   消費(parentItemId/parentSlotKind。computeHostOccupancy)。身体部位と同列に並べるチップとして返す。
 * @returns {{slots:Array, unlisted:Array, hasSlots:boolean, hasUnlisted:boolean,
 *           hostChips:Array, hasHostChips:boolean}}
 */
export function preparePartOccupancy(actor) {
    // 実効部位スロット(フェーズ12): AE(system.partSlot.<キー>)＋負傷 partSlotMod 込みの
    // partSlotsEffective を派生(character-base)から読む。base の partSlots は編集用に不変。
    // (負傷合成は旧シート内実装を派生へ一本化した・2026-07-09→フェーズ12)
    const partSlots = actor.system.partSlotsEffective ?? actor.system.partSlots ?? [];
    const outfitItems = actor.items.filter(i => OUTFIT_ITEM_TYPES.has(i.type));

    // ① 身体部位
    const outfits = outfitItems.map(i => ({
        isPrepared:   i.system.isPrepared,
        minorCategory: i.system.minorCategory,
        part:         i.system.part,
        partRelation: i.system.partRelation,
        partOptional: i.system.partOptional,
        partAdded:    i.system.partAdded,       // AE による追加部位行(フェーズ12)
        partAltChoice: i.system.partAltChoice,  // or 追加行を選んだ装備先(部位キー)
    }));
    const { slots, unlisted } = computePartOccupancy(partSlots, outfits);

    // ②③ ホストスロット(準備済みのみ。ホスト=非オプション、消費=オプション)
    const prepared = outfitItems.filter(i => i.system.isPrepared);
    const hostCandidates = prepared.filter(i => !i.system.isOption).map(i => ({
        id:   i.id,
        name: i.name,
        slots: (Array.isArray(i.system.slots) ? i.system.slots : []).map(s => ({
            kind:  s?.kind,
            // 実効値(改造・AE 込み)を読む(表示は全箇所実効値・16-4是正=改造がインジケータに反映)
            count: s?.count?.mode === "value" ? (Number(s.count.total ?? s.count.value) || 0) : 0,
        })),
    }));
    const hostOptions = prepared.filter(i => i.system.isOption && i.system.parentItemId).map(i => ({
        name:           i.name,
        parentItemId:   i.system.parentItemId,
        parentSlotKind: i.system.parentSlotKind,
        slots:          optionConsumption(i.system),
    }));
    // ②③ ホスト占有チップ: 身体部位チップと同じ列に並べる。
    // スロット名(部位名): named 種別(意識3種・soft/hard)は**その種別名のみ**(表層意識/ソフトウェア)。
    //   normal はホストのカテゴリ名(武器は大分類・他は小分類。formatOptionLabel と同方針)。
    // ホスト名は「同じスロット名が複数あるとき」だけ括弧で併記して区別する(括弧は半角)。
    //   IANUS は単一準備で常に一意のため IANUS(IANUS) のような重複表記を出さない。
    const hostRows = computeHostOccupancy(hostCandidates, hostOptions).map((r) => {
        const sys = actor.items.get(r.hostId)?.system;
        // 便宜スロット「アイテム名」はスロット名＝ホスト名(アイテムごとに変わる。2026-07-23)。
        const slotName = (r.kind === OUTFIT_NAME_SLOT_KIND)
            ? r.hostName
            : (r.kind && r.kind !== "normal")
                ? (SLOT_KINDS[r.kind] ?? r.kind)
                : (isMajorLevelSlotMajor(sys?.majorCategory)
                    ? getMajorCategoryLabel(sys?.majorCategory)
                    : (getMinorCategoryLabel(sys?.minorCategory) || getMajorCategoryLabel(sys?.majorCategory)));
        return { slotName, hostName: r.hostName, used: r.used, capacity: r.capacity, over: r.over };
    });
    const slotNameCount = new Map();
    for (const r of hostRows) slotNameCount.set(r.slotName, (slotNameCount.get(r.slotName) ?? 0) + 1);
    const hostChips = hostRows.map((r) => ({
        label: slotNameCount.get(r.slotName) > 1 ? `${r.slotName}(${r.hostName})` : r.slotName,
        used: r.used, capacity: r.capacity, over: r.over,
    }));

    return {
        slots, unlisted, hasSlots: slots.length > 0, hasUnlisted: unlisted.length > 0,
        hostChips, hasHostChips: hostChips.length > 0,
    };
}
