import { SYSTEM_ID } from "./constants.mjs";
import { registerInfoLinks, bindInfoLinks } from "./chat/info-links.mjs";
import { fitCardTags, renderCardOutcome } from './chat/chat-card.mjs';
import { TnxCombat } from './combat/tnx-combat.mjs';
import { renderAttackCard, renderReactionCard } from './flow/attack-flow.mjs';
import { renderDamageCard } from './flow/damage-flow.mjs';
import { renderUsageEffectButton } from './flow/usage-effects.mjs';
import { renderMiracleCard } from './flow/miracle-flow.mjs';
import { renderRecheckButton } from './flow/tnx-check-flow.mjs';
import { renderCheckRequestCard } from './app/tnx-rl-request-app.mjs';
import { renderBountyGrantCard } from './flow/bounty-grant.mjs';
import { renderHandoutCard } from './session/handout-contact.mjs';
import { advanceFocusCuts } from './focus-system/state.mjs';
import { renderFocusProgressButton, renderFocusSupportNote } from './focus-system/result.mjs';
import { autoSendFocusChecks } from './focus-system/request.mjs';
import { bindConditionChatButtons, renderConditionDrawCard } from "./flow/condition-resolution.mjs";
import { injectDictionaryBrowserButton } from './app/tnx-dictionary-browser.mjs';
import { applyContentLinkCardTooltips } from './chat/item-card-tooltips.mjs';
import { registerEffectConfigInjection } from "./core/effect-config-inject.mjs";
import { registerItemTransferHooks } from "./core/item-transfer.mjs";
import { registerTroopNameSync } from "./core/troop-name.mjs";
import { registerSystemConfig } from "./core/register-config.mjs";
import { registerSheets } from "./core/register-sheets.mjs";
import { registerSettings } from "./core/register-settings.mjs";
import { registerUiInjections } from "./core/register-ui-injections.mjs";
import { registerDocumentHooks } from "./core/register-document-hooks.mjs";
import { onSystemReady } from "./core/register-ready.mjs";
import { handleRefreshSheets } from "./core/sheet-refresh.mjs";

// ─── 抽出したまとまりのフック登録(2026-09-07 分割)。**トップレベルで呼ぶ**——元は
// ここで直接 Hooks.on していたため、登録の時機を変えないこと
registerEffectConfigInjection();
registerItemTransferHooks();
registerTroopNameSync();

Hooks.on("renderCompendiumDirectory", (_app, html) => injectDictionaryBrowserButton(html));

// ─── チャットカードの描画(2026-09-07 一本化) ───────────────────────────────
// 従来は renderChatMessageHTML を 15 回登録しており、メッセージ 1 枚の描画ごとに 15 個の
// コールバックが走っていた。さらに「上の checkRequest 描画の**後**に登録し…」のように
// **登録順への依存がコメントでしか表現されておらず**、行を並べ替えるだけで壊れる状態だった。
// 表にして 1 回だけ登録する。**この表の並び順が実行順**。
//
// - flag  : そのフラグを持つメッセージにだけ適用(省略=全メッセージ)
// - when  : 追加条件(フラグの値を受け取る)
// - render: (message, html, root) を受ける描画関数
//
// チャットログの初期描画(既存メッセージの一括レンダリング)は ready 発火前に走るため、
// 登録は**トップレベル**で行う(ready 内で登録するとリロード直後の表示分に効かない=
// ダメージカードの本文が殻のまま「内容がすべて消える」ように見えていた・2026-07-14 是正)。
const CHAT_CARD_RENDERERS = [
    // チャットの受付ボタン(ドロー/制御判定)を解決処理に配線する(フェーズ9-4)。
    // 効果決定カード(conditionDraw フラグ)は状態領域をライブ描画する(ボタン→結果の置換・2026-07-12)
    { render: (message, _html, root) => {
        bindConditionChatButtons(root);
        renderConditionDrawCard(message, root);
    } },
    // @UUID コンテンツリンクのカード・ツールチップ(16-x): チャット内の辞典アイテムリンクに
    // ホバーで辞典カードを出す。クリック挙動はコアのまま
    { render: (_message, _html, root) => { if (root) applyContentLinkCardTooltips(root); } },
    { render: (_message, _html, root) => { if (root) bindInfoLinks(root); } },
    // 攻撃カード(12-2): 状態領域のライブ描画(未解決=系統別リアクションボタン/解決後=成否表示に置換)
    { flag: "attackCheck",    render: renderAttackCard },
    // 個別リアクションカード(12・複数対象一括・2026-07-15): GM＋対象所有者に whisper・解決で全体公開
    { flag: "attackReaction", render: renderReactionCard },
    // 報酬点の配布カード(12・2026-07-20): 対象行に受け取りボタン/受け取り済みをライブ描画
    { flag: "bountyGrant",    render: renderBountyGrantCard },
    // ハンドアウト送信カード(2026-08-12): コネの受け取りボタン/取得済みをライブ描画
    { flag: "handoutContact", render: renderHandoutCard },
    // ダメージ・カード(12-3): 台帳+状態領域のライブ描画(カード追加・適用で更新)
    { flag: "damageRoll",     render: renderDamageCard },
    // 神業カード(17-1/17-2): 打ち消された神業は中身が消える・見出しは打ち消しの発動点。
    // **効果トレイ(usageEffects)より前**に置く(打ち消し済みは効果エリアごと消すため)
    { flag: "miracle",        render: renderMiracleCard },
    // 用途の帰結行(2026-09-07): 治療・修理・改造の結果は帰結だけの短いカードを別に出さず、
    // その使用を表しているカードへ刻む
    { flag: "cardOutcome",    render: renderCardOutcome },
    // 用途の適用効果(2026-07-10): 対象所有者/GM が押すと対象へ AE を複製付与する
    { flag: "usageEffects",   render: renderUsageEffectButton },
    // 再判定(2026-07-11→2026-07-14 置き換え着地): 達成値を装飾する
    // (モード外クリック=allowRecheck の素の再判定・モード中=付与/修正の発動)
    { flag: "checkRecheck",   render: renderRecheckButton },
    // 種別タグを幅の上限に収める(入りきらない種別名は横に縮める・2026-09-06)。
    // **描画フックの時点ではまだ DOM に入っていない**(幅が 0 で測れない)ので次のフレームで当てる
    { render: (_message, html) => requestAnimationFrame(() => fitCardTags(html)) },
    // 判定要求カード(8-5): 目標値の可視性制御・「判定する」ボタン・結果の注入
    { flag: "checkRequest",   render: renderCheckRequestCard },
    // FS 進行判定(13-7): 成功した対象行に RL(=GM)へ「進行値に加算」ボタンを足す。
    // **上の checkRequest 描画(結果を statusEl に置く)の後**に置き、その結果表示に足す形にする
    { flag: "checkRequest", when: (f) => f.focusSystemKind === "progress",
      render: renderFocusProgressButton },
    // FS 支援判定: 結果確定で自動適用される(autoApplyFocusSupport が _onCheckResult で実行)。
    // ここは適用済みの表示(支援成立→対象の進行+1／支援失敗)のみ描画する
    { flag: "checkRequest", when: (f) => f.focusSystemKind === "support",
      render: renderFocusSupportNote },
];

Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    for (const { flag, when, render } of CHAT_CARD_RENDERERS) {
        if (!flag) { render(message, html, root); continue; }
        const data = message.getFlag(SYSTEM_ID, flag);
        if (!data) continue;
        if (when && !when(data)) continue;
        render(message, html, root);
    }
});

// @UUID コンテンツリンクのカード・ツールチップ: ジャーナルページも同じ扱いにする
Hooks.on("renderJournalEntryPageSheet", (_app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (root) applyContentLinkCardTooltips(root);
});

// FS判定のカット進行への合流(13-7③④): プロセス開始で進行/支援判定を自動送信する。
// メイン開始→その手番のキャストへ進行判定(ルール14)・イニシアチブ開始→AR残の参加者へ支援判定
// (ルール15)を、各実行中 FS について送る(境界イベントは GM 側発火＝autoSendFocusChecks が GM 実行)。
Hooks.on("tnxProcessStart", (combat, data) => {
    autoSendFocusChecks(combat, data?.phase);
});

// FS判定のカット連動(13-7⑥): カット境界(カットが1つ終わった=tnxCutEnd)で、実行中 FS(cut 型敗北)の
// 経過カットを +1 する。パネルのカット表示は cutLimit−経過 のカウントダウンで自動更新される。
Hooks.on("tnxCutEnd", () => {
    advanceFocusCuts();
});

Hooks.once("init", async function() {
    game.tnx = game.tnx || {}
    game.tnx.refreshSheets = handleRefreshSheets;
    registerInfoLinks();

    // 登録は節ごとにモジュールへ分けてある(2026-09-07)。**この並びが実行順**——
    // シートは DataModel の後、設定は UI 注入より前でなければならない。並べ替えないこと。
    await registerSystemConfig();
    registerSheets();
    registerSettings();
    registerUiInjections();
    registerDocumentHooks();

});

Hooks.once("ready", async function() {
    await onSystemReady();
});
// ─── CS・AR のカット進行連動(フェーズ10-5 / 11 → 13-2〜13-4 で TnxCombat へ集約) ─────
// シートの「CS」「AR」表示は自動制御(カット進行中=カレント・現在AR/それ以外=CS・付与値)。
// カット進行の終了・参加/離脱で該当アクターを再準備(reset)し、開いているシートを再描画する。
// カット進行の開始は TnxCombat.startCombat の override が一括処理する(core の combatStart フックは
// update の**前**に発火するため、フック内からの別 update は本体更新に上書きされ競合する＝実機で発覚。
// フェーズ状態・turn・シードを単一フローにまとめた)。
// 以後の進行はサブターンモデル(nextTurn 1本=advanceCut・トラッカー UI から起動)。
// 途中参加(createCombatant)は開始済みカットへの参加としてそのアクターだけシードする。

// round の変わる combat 更新(カット進行の開始・次カット)で全クライアントのアクターを再準備する。
// core の updateCombatantActors は render のみで派生(inCombat)を再計算しないため、開始前に
// シードされた値の表示切替(CS=カレント表示・AR 数値表示)がここで追随する
Hooks.on("updateCombat", (combat, changed) => {
    if ("round" in (changed ?? {})) {
        TnxCombat.refreshDisplays(combat.combatants.map(c => c.actor).filter(Boolean));
    }
});

Hooks.on("deleteCombat", (combat) => {
    TnxCombat.refreshDisplays(combat.combatants.map(c => c.actor).filter(Boolean));
});

Hooks.on("createCombatant", async (combatant) => {
    if (!combatant.parent?.started || !combatant.actor) return;
    await TnxCombat.seedStartValues([combatant.actor]);
    TnxCombat.refreshDisplays([combatant.actor]);
});

Hooks.on("deleteCombatant", (combatant) => {
    if (combatant.actor) TnxCombat.refreshDisplays([combatant.actor]);
});
