/**
 * @fileoverview 経験点配布の純ロジック(フェーズ14-7・正本 Scenario_Progress「経験点取得条件」)。
 *
 * アクト終了後の**半自動配布**(2026-08-08 ユーザー裁定): チェック項目と数値カウントを RL が
 * 入力→合計を自動計算→確定で各ユーザーの履歴(User flag)へ行を自動追加する。取得条件には
 * 主観的判断が多いため、判定そのものは RL の入力に委ね、集計と記帳だけを自動化する。
 */

/** PL のチェック項目(配点は Scenario_Progress の経験点表)。 */
export const EXP_AWARD_CHECKS = Object.freeze([
    { key: "request",  label: "ルーラーの依頼を果たした",       points: 1 },
    { key: "venue",    label: "会場の手配・連絡などを行った",   points: 1 },
    { key: "fullPlay", label: "アクトに最後まで参加した",       points: 5 },
    { key: "roleplay", label: "良いロールプレイを行った",       points: 5 },
    { key: "ps",       label: "PS を果たした",                  points: 5 },
    { key: "sps",      label: "SPS を果たした",                 points: 5 },
    { key: "assist",   label: "他のプレイヤーを助ける言動を行った", points: 5 },
    { key: "progress", label: "アクトの進行を助けた",           points: 5 },
]);

/** 登場シーン(1シーン1点)の上限。 */
export const SCENE_EXP_CAP = 5;

/**
 * PL 1人の経験点合計(チェック合計＋神業×1＋登場シーン×1[上限5])。
 * @param {{checks?:Record<string,boolean>, miracleCount?:number, sceneCount?:number}} row
 * @returns {number}
 */
export function calcPlayerExpTotal({ checks = {}, miracleCount = 0, sceneCount = 0 } = {}) {
    const checkTotal = EXP_AWARD_CHECKS
        .reduce((sum, c) => sum + ((checks ?? {})[c.key] === true ? c.points : 0), 0);
    const miracles = Math.max(0, Math.trunc(Number(miracleCount) || 0));
    const scenes = Math.min(SCENE_EXP_CAP, Math.max(0, Math.trunc(Number(sceneCount) || 0)));
    return checkTotal + miracles + scenes;
}

/**
 * RL の経験点の内訳(2026-08-30 ユーザー是正)。
 *
 * 会場手配(1点)＋「プレイヤーの取得経験点の合計 ÷『3かプレイヤー人数の小さいほう』」(切り捨て)。
 * 従来の「min(PL合計÷3, PL人数)」は誤読(除数が min(3, 人数)であり、商と人数を比べるのではない)。
 *
 * @param {{venue?:boolean, playerTotal?:number, playerCount?:number}} args
 * @returns {{playerTotal:number, divisor:number, share:number, total:number}}
 */
export function calcRlExpBreakdown({ venue = false, playerTotal = 0, playerCount = 0 } = {}) {
    const total = Math.max(0, Math.trunc(Number(playerTotal) || 0));
    const count = Math.max(0, Math.trunc(Number(playerCount) || 0));
    const divisor = Math.min(3, count);
    const share = divisor > 0 ? Math.floor(total / divisor) : 0;
    return {
        playerTotal: total,
        divisor,
        share,
        total: (venue === true ? 1 : 0) + share,
    };
}

/**
 * RL の経験点合計。内訳は calcRlExpBreakdown を参照。
 * @param {{venue?:boolean, playerTotal?:number, playerCount?:number}} args
 * @returns {number}
 */
export function calcRlExpTotal(args = {}) {
    return calcRlExpBreakdown(args).total;
}

/**
 * 神業アイテムの消費済み回数(`uses.spent`)の合算。「全て自動で入力する」の神業欄の元
 * (2026-08-30 ユーザー承認)。消費の記帳であって「上手く使った」の判断ではない——上手く
 * なかった分は RL が減らす(半自動の枠内・§4.2)。
 * @param {Array<{type?:string, system?:object}>} items アクターのアイテム(神業以外は無視)
 * @returns {number}
 */
export function sumMiracleSpent(items) {
    return (items ?? [])
        .filter(item => item?.type === "miracle")
        .reduce((sum, item) => sum + Math.max(0, Math.trunc(Number(item.system?.uses?.spent) || 0)), 0);
}

/**
 * 「全て自動で入力する」の1行分。チェックは8種全て ON(よほど厳密に裁定しない限り取得条件は
 * 全て満たされたものとして配布するのがほとんど・2026-08-30 ユーザー言明)。登場シーン数は
 * 実数のまま入れる——合計側の上限5(SCENE_EXP_CAP)は calcPlayerExpTotal が掛ける。
 * @param {{miracleCount?:number, sceneCount?:number}} [auto] 採取済みの実測値
 * @returns {{checks:Record<string,boolean>, miracleCount:number, sceneCount:number}}
 */
export function buildAutoFilledRow({ miracleCount = 0, sceneCount = 0 } = {}) {
    return {
        checks: Object.fromEntries(EXP_AWARD_CHECKS.map(c => [c.key, true])),
        miracleCount: Math.max(0, Math.trunc(Number(miracleCount) || 0)),
        sceneCount: Math.max(0, Math.trunc(Number(sceneCount) || 0)),
    };
}

/**
 * 深夜の記帳を前日として扱う境界(時)。深夜=22時〜翌5時(労働基準法の深夜業と同じ区切り)に合わせ、
 * 5時より前を前日とする。日をまたいで続いたアクトの記帳がその日付になるのを防ぐ。
 */
const LATE_NIGHT_CUTOFF_HOUR = 5;

/**
 * 経験点を記帳する日付を `YYYY-MM-DD` で返す(2026-08-15 ユーザー指示・KI-041)。
 *
 * **手元(ローカル)の日付**を使う——`toISOString()` は UTC を返すため、JST の午前中の確定が
 * 前日で記帳されていた。記帳は基本的に日付が変わる前に行われるので、通常はその日の日付で正しい。
 * ただし**深夜(5時より前)の確定は前日として扱う**——その時刻の記帳は前日から続いている
 * アクトのものだから。
 *
 * @param {Date} [now]  判定する時刻(既定は現在時刻)
 * @returns {string}  `YYYY-MM-DD`
 */
export function awardEntryDate(now = new Date()) {
    const d = new Date(now.getTime());
    if (d.getHours() < LATE_NIGHT_CUTOFF_HOUR) d.setDate(d.getDate() - 1);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day   = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}
