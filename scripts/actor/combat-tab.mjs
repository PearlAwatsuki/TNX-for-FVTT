/**
 * @fileoverview 戦闘タブの表示データ組み立て(2026-09-07 シート基底から移設)。
 *
 * 用途の timing(タイミング)で節に分け、行動可否・警告・神業の表示形を作る。アクターの
 * アイテムと状態を読むだけで、シートの状態(編集モード・DOM)には触れない。
 */

import { TnxSkillUtils } from "../core/tnx-skill-utils.mjs";
import { OUTFIT_ITEM_TYPES } from "../data/helpers.mjs";
import { readFlag } from "../data/item/helpers.mjs";
import { effectiveUsageTiming } from "../data/item/modification-params.mjs";
import { usesMaxTotalOf, usesMaxBaseOf } from "../data/item/uses.mjs";
import { aggregateDefence } from "../rules/damage.mjs";
import { usageDisplayName } from "../rules/usage-types.mjs";

/**
 * 戦闘タブの表示データ(フェーズ10-6・表示中心)。正本は Outfits.md「生身・パラメータの適用宣言・
 * 携帯/準備の適用範囲」「生身の変更」(2026-07-02)と Combat_Flow.md・Damage_Rules.md。
 * 一覧は置かない(武器/防具の一覧はアウトフィットタブの仕事・2026-07-02 ユーザー確定)。出すのは——
 * - 生身ライン: 攻撃用/パリー用それぞれの「現在の生身」。既定は未変更の生身
 *   (アクターの baseAttack/baseGuard=攻I+0/受0)で、準備済みの全身義体・生身変更装備
 *   (isFleshChange)を書き換え元として選択できる(便宜的事前設定・非強制)。
 *   通常武器の使用は攻撃判定の用途に移管(案2)。〈二刀流〉等の合算は12の判定フロー側。
 * - 防御力: 全ての義体を含む種別ごとの合計(S/P/I)。物理ダメージ算出の減算項(消費は12)。
 * - タイミングごとの使用技能・アウトフィットの再表示(検索補助)。
 * - 効果系(負傷・BS)は状態タブの領分で、戦闘タブには置かない(2026-07-02 ユーザー確定)。
 */
export function prepareCombatData(actor, context) {
    const items = actor.items;
    const sys = actor.system;
    // 実効準備(isPreparedEffective)で使用可否を見る: オプション武器(搭載兵器等)は装備先が
    // 準備済みでないと使用候補に出さない(課題2)。非オプションは isPrepared と同値。
    const usable = (i) => !!((i.system.isPreparedEffective ?? i.system.isPrepared) || readFlag(i.system, "noPrepareRequired"));
    const refs = sys.weaponRefs ?? {};
    const mvT = (f) => f?.mode === "value" ? (f.total ?? f.value) : null;
    const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);

    // 選択候補: 準備済みの武器全体＋全身義体(2026-07-02 再改修)。〈二刀流〉〈黒羽の矢〉等は
    // その技能の判定時に扱うため、ここでは「基本として選択している武器」を事前設定する。
    // 生身変更装備(isFleshChange)・全身義体は生身のデータを書き換えていることを示すため
    // 「生身（アウトフィット名）」と表記する(例: 全身義体セイバーセンス→「生身（セイバーセンス）」)。
    const candidates = items
        .filter(i => usable(i) && (i.type === "weapon" || i.type === "cyborg"))
        .sort(bySort);
    const displayName = (i) =>
        (i.type === "cyborg" || readFlag(i.system, "isFleshChange")) ? `生身（${i.name}）` : i.name;

    // 攻撃用/パリー用それぞれの参照先を解決する。未選択(空)＝未変更の生身(アクターのデータ)。
    const fleshAttack = () => {
        const a = sys.baseAttack ?? {};
        return `${a.damageTypeTotal || a.damageType || "I"}+${(a.value ?? 0) + (a.mod ?? 0)}`;
    };
    const fleshGuard = () => String((sys.baseGuard?.value ?? 0) + (sys.baseGuard?.mod ?? 0));
    const attackSrc = refs.attackItemId ? candidates.find(i => i.id === refs.attackItemId) : null;
    const parrySrc  = refs.parryItemId  ? candidates.find(i => i.id === refs.parryItemId)  : null;
    context.combatAttackRef = attackSrc ? {
        _id: attackSrc.id, name: displayName(attackSrc),
        attack: (attackSrc.system.attack?.damageTypeTotal || attackSrc.system.attack?.damageType)
            ? `${attackSrc.system.attack.damageTypeTotal || attackSrc.system.attack.damageType}+${attackSrc.system.attack.total ?? attackSrc.system.attack.value ?? 0}` : "-",
    } : { _id: null, name: "生身", attack: fleshAttack() };
    context.combatParryRef = parrySrc ? {
        _id: parrySrc.id, name: displayName(parrySrc),
        guard: mvT(parrySrc.system.guardValue) !== null ? String(mvT(parrySrc.system.guardValue)) : "-",
    } : { _id: null, name: "生身", guard: fleshGuard() };
    // 編集モードの選択肢(空=未変更の生身が既定)
    const choices = { "": "生身" };
    for (const c of candidates) choices[c.id] = displayName(c);
    context.combatWeaponChoices = choices;

    // 防御力: 種別ごとの合計(準備済みの armor/cyborg/vehicle。防具・義体は合算適用・搭乗中
    // ヴィークルの防御力も加算する・2026-07-09 ユーザー確定)。ダメージ算出でも同じ値を使うため、
    // 合算はダメージ算出と同一の aggregateDefence に一本化する(2026-07-16 ユーザー指摘=戦闘タブの合計)。
    context.combatDefenceTotal = aggregateDefence(items);

    // タイミングごとの使用技能・アウトフィット(2026-07-02 確定→2026-07-17 用途駆動化):
    // **アイテムの timing でなく用途の timing で束ね、各行はその用途を直接起動するボタン**にする
    // (ユーザー確定)。行の実効名=用途名(空なら親アイテム名)。旧・合成アクション(移動・リロード)は
    // オミット——移動=〈操縦〉の移動タイプ用途・リロード=射撃武器のリロード用途(マイナー+使用回数への
    // マイナス消費)に一本化。
    // - 標準のプロセス/アクション(下記7つ)は空でも常に表示する。
    // - リアクションだけは**該当する用途があるときのみ**表示する(2026-07-20 ユーザー確定)。
    //   表示条件は差し込みタイミングと同じだが、位置はアクションの並び(メジャー→リアクション
    //   →オート)を保つ——ルール上の行動順から外れると読み取れなくなるため末尾送りにはしない。
    // - 差し込みタイミングは「タイミング」選択肢そのものの値(「ダメージ算出の直前」等の
    //   名前つき enum)と、「その他」の自由記述テキストの二通りある。**どちらも**項目がある
    //   場合のみ標準群の後ろに表示する(2026-07-20 是正: classify が action/process/other しか
    //   見ておらず、名前つき enum の用途は該当があっても丸ごと落ちていた)。
    // - 自由記述なしの「その他」と「解説参照」は「その他」群へ(項目がある場合のみ・末尾)。
    // - 用途の「戦闘タブに表示しない」が立つ行は全群から除外する(2026-07-20)。
    const timingLabels = TnxSkillUtils.getSkillOptions().timing;
    const fixedBuckets = [
        { kind: "process", key: "setup",      label: "セットアップ" },
        { kind: "process", key: "initiative", label: "イニシアチブ" },
        { kind: "action",  key: "move",       label: "ムーブ" },
        { kind: "action",  key: "minor",      label: "マイナー" },
        { kind: "action",  key: "major",      label: "メジャー" },
        { kind: "action",  key: "reaction",   label: "リアクション", onlyWhenFilled: true },
        { kind: "action",  key: "auto",       label: "オート" },
        { kind: "process", key: "clean-up",   label: "クリンナップ" },
    ].map(b => ({ ...b, entries: [] }));
    const byKey = new Map(fixedBuckets.map(b => [`${b.kind}:${b.key}`, b]));
    // 差し込みタイミング(名前つき enum・自由記述テキストの双方) → グループ。
    // 挿入順=選択肢の定義順(名前つき)→ 初出順(自由記述)で安定させる
    const inserted = new Map();
    const misc = { label: "その他", entries: [] };
    const pushEntry = (entries, item, usage) => {
        if (entries.some(e => e._id === item.id && e.usageId === usage._id)) return;
        entries.push({
            _id: item.id, usageId: usage._id,
            name: usageDisplayName(usage, item.name),
            sort: item.sort ?? 0,
        });
    };
    // 差し込みグループの取得/生成。**ラベルで束ねる**——自由記述に「ダメージ算出の直前」と
    // 手入力した用途と、同名の選択肢を選んだ用途は同じタイミングなので同じ群に入れる
    // (キーを分けると同じ見出しの群が二つ並ぶ)。rank=表示順(名前つき=選択肢の定義順・
    // 自由記述=その後ろ。同ラベルが両方から来たら小さい方=選択肢の位置を採る)
    const insertedGroup = (label, rank) => {
        const g = inserted.get(label) ?? { label, entries: [], rank };
        g.rank = Math.min(g.rank, rank);
        inserted.set(label, g);
        return g;
    };
    const timingOrder = Object.keys(timingLabels);
    const classify = (t, item, usage) => {
        if (!t || !t.value || t.value === "blank") return;
        if (t.value === "action" || t.value === "process") {
            const name = t.value === "action" ? t.actionName : t.processName;
            if (!name || name === "blank") return;
            const fixed = byKey.get(`${t.value}:${name}`);
            if (fixed) return pushEntry(fixed.entries, item, usage);
            // 解説参照(explanation)・その他(other)は「その他」群へ
            if (name === "explanation" || name === "other") return pushEntry(misc.entries, item, usage);
            return;
        }
        if (t.value === "other") {
            const label = (t.timingOther ?? "").trim();
            if (!label) return pushEntry(misc.entries, item, usage);
            return pushEntry(insertedGroup(label, timingOrder.length).entries, item, usage);
        }
        // 解説参照は「その他」群へ
        if (t.value === "explanation") return pushEntry(misc.entries, item, usage);
        // 名前つきの差し込みタイミング(「ダメージ算出の直前」「常時」「登場判定」等)。
        // ラベルは選択肢の正本(getSkillOptions().timing)から引く
        const label = timingLabels[t.value];
        if (!label) return;
        return pushEntry(insertedGroup(label, timingOrder.indexOf(t.value)).entries, item, usage);
    };
    for (const i of items) {
        const isSkill = i.type === "generalSkill" || i.type === "styleSkill";
        if (!isSkill && !(OUTFIT_ITEM_TYPES.has(i.type) && usable(i))) continue;
        for (const usage of (i.system.actions ?? [])) {
            if (usage.hideInCombatTab === true) continue;
            // ドラッグ改造(マイナーアクション化・16-4)は実効タイミングで分類する
            classify(effectiveUsageTiming(usage, i.system), i, usage);
        }
    }
    // 各タイミング内は他タブでの手動並び順(item.sort)を尊重する
    const insertedGroups = [...inserted.values()]
        .filter(g => g.entries.length)
        .sort((a, b) => a.rank - b.rank);
    const allGroups = [
        // onlyWhenFilled(リアクション)は空なら出さない。位置は並びのまま
        ...fixedBuckets.filter(b => !b.onlyWhenFilled || b.entries.length),
        ...insertedGroups,
        ...(misc.entries.length ? [misc] : []),
    ];
    for (const g of allGroups) g.entries.sort((a, c) => a.sort - c.sort);
    context.combatTimings = allGroups;
}

/**
 * 神業のボタン(枠)を組む。**枠の数は母数(uses.max の土台)**で、使用回数を増やす効果
 * (《ファイト！》の AE)では増やさない——枠はキャラクターが持つ神業の数を表すもので、
 * 合計 3 が上限だから(2026-09-06 ユーザー指示「ボタンの総数が3で最大になるように」)。
 * 増えた回数は**枠の有効/無効**に効く(使い切った枠が再び押せるようになる)。
 * @param {Item[]} miracles 神業アイテム
 * @returns {object[]} 枠(合計 3 まで)
 */
export function prepareMiraclesForDisplay(miracles) {
    const MAX_SLOTS = 3;
    const items = [...miracles];
    // 枠の配り方: **まず各神業に1枠**、余りを母数の大きい順ではなく並び順に配る。
    // こうしないと、ある神業の回数が増えたときに他の神業の枠を食い潰してしまう
    // (2026-09-06 ユーザー指摘「別の神業のボタンだったものが置き換えられてしまう」)
    const counts = items.map(() => 0);
    let budget = MAX_SLOTS;
    for (let i = 0; i < items.length && budget > 0; i++) { counts[i] = 1; budget--; }
    for (let i = 0; i < items.length && budget > 0; i++) {
        // 神業も汎用 uses(残り = max − spent)に一本化(2026-07-18)。枠の数は母数(AE を数えない)
        const want = Math.max(1, usesMaxBaseOf(items[i].system));
        const add = Math.min(want - counts[i], budget);
        if (add > 0) { counts[i] += add; budget -= add; }
    }
    const slots = [];
    items.forEach((item, idx) => {
        const itemData = item.toObject(false);
        const uses = item.system.uses ?? {};
        // 残りは実効 max(AE 込み)。増えた回数は枠を増やさず、枠の有効/無効に効く
        const remainingUses = Math.max(0, usesMaxTotalOf(item.system) - (Number(uses.spent) || 0));
        for (let i = 0; i < counts[idx]; i++) {
            slots.push({ ...itemData, isPlaceholder: false, instanceIndex: i, isDisabled: i >= remainingUses });
        }
    });
    return slots;
}
