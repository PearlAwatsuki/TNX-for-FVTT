/**
 * @fileoverview アウトフィットの閲覧表示ビルダー(フェーズ16-2 で共通化)。
 *
 * ルルブ表記順のサマリ({label, value} 行=「購／隠／攻／受…」の略号行)を組み立てる。
 * 元は TokyoNovaOutfitSheet._prepareView 内のローカル実装だったが、辞典ブラウザの
 * アウトフィットカードとアクターシートのアイテム・ツールチップが同じ行を必要とする
 * ため、単体関数へ切り出した(シート・ブラウザ・ツールチップの3読者が共用)。
 *
 * 表示は AE 込み実効値(total)を優先して読む(表示は全箇所実効値の規約)。辞典アイテム
 * (AE 未適用)では total が無く base がそのまま出る=辞典の素値表示になる。
 *
 * 概要表記順の正本: llm-wiki/01_Wiki/Game_Rules/Outfits.md
 */

import { WEAPON_RANGES } from "../data/item/weapon.mjs";
import { SHIKI_TYPES } from "../data/item/common/outfit-base.mjs";
import { readFlag } from "../data/item/helpers.mjs";
import { formatPartDesignation, resolvePartRowsForDisplay, resolvePartAdditions } from "../data/item/part-helpers.mjs";

/**
 * 射程の表記(略号「射」)。
 * - min が "none" または未設定: "-"
 * - min が値で max が "none" または未設定: 単一表記(例: "至近")
 * - min と max が両方値: 範囲表記(例: "近～超遠")
 * @param {{min: string, max: string}|string|null} range
 * @returns {string}
 */
export function formatWeaponRangeLabel(range) {
    if (!range || typeof range !== "object") return range ?? "-";
    if (!range.min || range.min === "none") return "-";
    const min = WEAPON_RANGES[range.min] ?? "-";
    if (!range.max || range.max === "none") return min;
    const max = WEAPON_RANGES[range.max] ?? "-";
    return `${min}～${max}`;
}

/**
 * 攻撃力の表記(「攻：I+4」相当)。ダメージ種別＋符号付き値。
 * @param {{damageType: string, damageTypeTotal?: string, value: number, total?: number}} attack
 * @returns {string}
 */
/**
 * 隠匿値の表示文字列。
 *
 * 「制御値」(2026-09-07 ユーザー裁定): 隠匿値はキャラクターの制御値**そのもの**になる。ただし
 * **どの**制御値かは、知覚判定で相手が使用したスートで決まるため、アイテム単体では確定しない
 * ——静的な表示では「解説参照」と同じくラベルで示す。
 *
 * @param {{mode?:string, value?:number, total?:number}|null|undefined} hide
 * @returns {string} 表示文字列(なし= "-")
 */
export function hideLabel(hide) {
    if (hide?.mode === "reference") return "解説参照";
    if (hide?.mode === "control")   return "制御値";
    if (hide?.mode === "value") {
        const v = hide.total ?? hide.value;
        return Number.isFinite(v) ? String(v) : "0";
    }
    return "-";
}

export function attackLabel(attack) {
    const type = attack?.damageTypeTotal || attack?.damageType || "";
    const value = attack?.total ?? attack?.value ?? 0;
    if (!type && !value) return "-";
    const sign = value >= 0 ? `+${value}` : String(value);
    return `${type}${sign}`;
}

/**
 * ルルブ表記順のサマリ行({label, value} 配列)を生成する。
 * @param {Object} system 正規化済み system データ(シートは deepClone 済みを渡す)
 * @param {string} type Item type
 * @param {Object} [opts]
 * @param {Object|null} [opts.areaMods] 住宅施設の場合、紐づけた住宅エリアの system(合算用)
 * @param {?(hostKey:string)=>string} [opts.resolveHostName] オプション部位ラベルの hostKey→現在名
 * @param {Array|null} [opts.partSlotsCtx] 部位スロット集合(アクター所属時は実効値・辞典はプリセット)
 * @param {Array} [opts.partAdded] AE による追加部位行(アクター所属時のみ)
 * @returns {Array<{label: string, value: string, full?: boolean, third?: boolean}>}
 */
export function buildOutfitSummaryRows(system, type, { areaMods = null, resolveHostName = null, partSlotsCtx = null, partAdded = [] } = {}) {
    const num = (v) => (Number.isFinite(v) ? String(v) : "0");
    // 住宅エリアの修正値を加算するヘルパー(住宅施設のみ。エリア未設定時は加算 0)
    const am = (key) => (areaMods?.[key] ?? 0);
    // {mode,value} フィールドを文字列に変換。mode が "none" なら "-"
    const mv = (field) => field?.mode === "value" ? num(field.total ?? field.value) : "-";

    // オプション時: 正の数値に + を付ける
    const isOption = system.isOption === true;
    const numSigned = (v) => {
        if (!Number.isFinite(v)) return "0";
        return v > 0 ? `+${v}` : String(v);
    };
    const mvOpt = (field) => {
        if (field?.mode !== "value") return "-";
        const v = field.total ?? field.value;
        return isOption ? numSigned(v) : num(v);
    };
    const fmtNum = (v) => isOption ? numSigned(v) : num(v);

    // 常備化経験点ラベル(除外対象: 符号なし)
    const expLabel = mv(system.preserveExp);

    // 購：購入値／常備化経験点(解説参照時は常備化経験点を表記しない)
    let buy;
    if (system.buy.mode === "reference") buy = "解説参照";
    else if (system.buy.mode === "value") buy = `${num(system.buy.total ?? system.buy.value)}／${expLabel}`;
    else buy = `-／${expLabel}`;

    // 隠匿値／危険値(住宅オプション・住宅アクセサリは危険値なし=隠匿値のみ・2026-07-09)
    const hideVal = hideLabel(system.hide);
    const penaltyVal = mvOpt(system.appearancePenalty);
    const noPenaltyCategory = system.minorCategory === "housingOption" || system.minorCategory === "housingAccessory";
    const hideFull = noPenaltyCategory ? `${hideVal}` : `${hideVal}／${penaltyVal}`;

    const hack = mv(system.hack);
    // 部位表記: 部位キーの逆引きで現在ラベルへ解決し、AE 追加行(partAdded)も併記する(フェーズ12)
    const part = formatPartDesignation(
        resolvePartRowsForDisplay(system.part, partSlotsCtx, resolveHostName),
        system.partRelation, system.partOptional,
        resolvePartAdditions(partAdded, partSlotsCtx));
    const defence = () => {
        const d = system.defence;
        if (d?.mode !== "value") return "-";
        return `${fmtNum(d.S_total ?? d.S_defence)}／${fmtNum(d.P_total ?? d.P_defence)}／${fmtNum(d.I_total ?? d.I_defence)}`;
    };
    const slots = Array.isArray(system.slots) ? system.slots : [];
    const countOf = (kind) => {
        const slot = slots.find((s) => s.kind === kind);
        if (!slot?.count || slot.count.mode !== "value") return "-";
        return fmtNum(slot.count.total ?? slot.count.value);
    };

    // 型ごとに概要の項目と順序が異なる(2026-06-12〜13 ユーザー確定)
    // width: 各行のセル幅。ルルブ実紙面の配置を型ごとに固定で踏襲する(2026-08-31 提供
    // p34/62/88/91/120/126/129/145/171/241)——"full"=1行1セル(防(S／P／I)等の複合値と
    // 単独行)、"third"=1/3幅3連(タップのソ|ハ|CS・最小単位の購|隠|電制)、省略=1/2幅ペア。
    // スラッシュ区切りの複合値を途中で割らないための配置(幅不足の実測昇格は表示側 fit が担う)
    const rows = [];
    const push = (label, value, width = null) => {
        const row = { label, value };
        if (width === "full") row.full = true;
        else if (width === "third") row.third = true;
        rows.push(row);
    };
    switch (type) {
        case "weapon":
            push("購", buy); push("隠", hideFull);
            push("攻", attackLabel(system.attack));
            push("受", mvOpt(system.guardValue));
            push("射", formatWeaponRangeLabel(system.range));
            push("ス", countOf("normal"));
            push("電制", hack); push("部位", part);
            break;
        case "armor":
            push("購", buy); push("隠", hideFull);
            push("防(S／P／I)", defence(), "full");
            push("制", mvOpt(system.controlMod));
            push("電制", hack); push("部位", part, "full");
            break;
        case "cyborg":
            push("購", buy); push("隠", hideFull);
            push("防(S／P／I)", defence(), "full");
            push("攻", attackLabel(system.attack));
            push("受", mvOpt(system.guardValue));
            push("電制", hack); push("部位", part);
            break;
        case "ianus":
            // 電制なし
            push("購", buy); push("隠", hideFull);
            push("ス", countOf("normal"));
            push("表", countOf("surface"));
            push("深", countOf("deep"));
            push("無", countOf("unconscious"));
            push("制", mvOpt(system.controlMod));
            push("部位", part);
            break;
        case "tron":
            push("購", buy); push("隠", hideFull);
            push("ス", countOf("normal"));
            push("電制", hack); push("部位", part, "full");
            break;
        case "tap": {
            push("購", buy); push("隠", hideFull);
            push("サ", mvOpt(system.cycle), "full");
            push("ソ", countOf("software"), "third");
            push("ハ", countOf("hardware"), "third");
            // ゴースト時読み飛ばしフラグONのCS修正は原作の括弧書き「CS：（-20）」を再現(2026-07-02)
            const csLabel = mvOpt(system.combatSpeedMod);
            push("CS", (system.combatSpeedModGhostIgnore && csLabel !== "-") ? `（${csLabel}）` : csLabel, "third");
            push("電制", hack); push("部位", part);
            break;
        }
        case "vehicle":
            push("購", buy); push("隠", hideFull);
            push("攻", attackLabel(system.attack));
            push("SF", mvOpt(system.speedFactor));
            push("防(S／P／I)", defence(), "full");
            push("制", mvOpt(system.controlMod));
            push("乗員", mvOpt(system.passenger));
            push("ス", countOf("normal"));
            push("電制", hack); push("部位", part, "full");
            break;
        case "residence": {
            // 危険値・電制なし。隠は隠匿値のみ。住宅エリアの修正値を合算して表示する
            const expBase = system.preserveExp?.mode === "value" ? (system.preserveExp.total ?? system.preserveExp.value ?? 0) : null;
            const preserveR = expBase !== null ? String(expBase + am("preserveExpMod")) : "-";
            let buyR;
            if (system.buy.mode === "reference") buyR = "解説参照";
            else if (system.buy.mode === "value") buyR = `${(system.buy.total ?? system.buy.value ?? 0) + am("buyRatingMod")}／${preserveR}`;
            else buyR = `-／${preserveR}`;
            const hideR = hideLabel(system.hide);
            push("購", buyR); push("隠", hideR);
            push("登場", fmtNum((system.appearanceTargetTotal ?? system.appearanceTarget ?? 0) + am("appearanceTargetMod")), "full");
            push("セ(電／ア)", `${fmtNum((system.cyberSecurityTotal ?? system.cyberSecurity ?? 0) + am("cyberSecurityMod"))}／${fmtNum((system.analogSecurityTotal ?? system.analogSecurity ?? 0) + am("analogSecurityMod"))}`, "full");
            const slotBase = slots.find((s) => s.kind === "normal");
            const slotCount = slotBase?.count?.mode === "value" ? (slotBase.count.total ?? slotBase.count.value ?? 0) : 0;
            push("ス", fmtNum(slotCount + am("slotMod")));
            push("部位", part);
            break;
        }
        default: // general / combiner(最小単位=購|隠|電制の1/3幅3連＋部位単独行。ルルブ p91)
            push("購", buy, "third"); push("隠", hideFull, "third");
            push("電制", hack, "third"); push("部位", part, "full");
    }
    // 式神装備: タイプを「部位」の1つ前に挿入する(10-2)。実効フラグで判定(フェーズ12)。
    // タイプ・部位とも単独行(ルルブ p241=STYLE SECTION の式神カードの配置)
    if (readFlag(system, "isShiki")) {
        const typeRow = { label: "タイプ", value: SHIKI_TYPES[system.shikiType] ?? "-", full: true };
        const partIdx = rows.findIndex((r) => r.label === "部位");
        if (partIdx >= 0) {
            rows.splice(partIdx, 0, typeRow);
            rows[partIdx + 1].full = true;
            delete rows[partIdx + 1].third;
        } else rows.push(typeRow);
    }
    return rows;
}
