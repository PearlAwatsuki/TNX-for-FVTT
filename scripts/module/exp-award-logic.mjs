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
 * RL の経験点合計(会場手配＋min(PL合計÷3[切り捨て], PL人数))。
 * @param {{venue?:boolean, playerTotal?:number, playerCount?:number}} args
 * @returns {number}
 */
export function calcRlExpTotal({ venue = false, playerTotal = 0, playerCount = 0 } = {}) {
    const share = Math.min(
        Math.floor(Math.max(0, Number(playerTotal) || 0) / 3),
        Math.max(0, Math.trunc(Number(playerCount) || 0)),
    );
    return (venue === true ? 1 : 0) + share;
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
