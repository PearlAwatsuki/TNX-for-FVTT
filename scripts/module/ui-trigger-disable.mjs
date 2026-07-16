/**
 * @fileoverview クリックトリガー要素を「グレーアウト＋クリック不能」にする再利用ユーティリティ。
 *
 * Foundry のアクション発火(`data-action`)を外し、視覚的に無効(淡色・not-allowed)にする。
 * 技能の使用不可(負傷 skillBlock)・重圧の能力値判定不可など、条件で一時的にトリガーを封じる用途に使う
 * (将来の別用途でも同じ関数で「見た目＋クリック不能」を統一する)。レンダー後フックから呼ぶ純粋な DOM 操作。
 */

/** グレーアウト＋クリック不能を表す共通クラス(css/tnx2.css で淡色・not-allowed)。 */
export const DISABLED_TRIGGER_CLASS = "tnx-trigger-disabled";

/**
 * `root` 内で `selector` に一致するトリガーのうち、`evaluate` が無効化理由を返したものを
 * グレーアウト＋クリック不能にする。再レンダーのたびに呼ぶ想定(テンプレートは毎回 `data-action` を
 * 再生成するため、本関数で毎回外し直す)。
 *
 * @param {ParentNode} root 走査対象(シートの element 等)
 * @param {string} selector 対象トリガーの CSS セレクタ(例 '[data-action="startSkillCheck"][data-item-id]')
 * @param {(el:HTMLElement) => ({reason?:string}|null|false|undefined)} evaluate
 *        無効化する要素に `{reason}`(tooltip 文言)を返す。有効のままにするなら falsy を返す。
 * @returns {number} 無効化した要素数
 */
export function applyTriggerDisable(root, selector, evaluate) {
  if (!root?.querySelectorAll || typeof evaluate !== "function") return 0;
  let count = 0;
  for (const el of root.querySelectorAll(selector)) {
    const res = evaluate(el);
    if (!res) continue;
    el.classList.remove("check-trigger");     // 起動トリガーの見た目・pointer カーソルを外す
    el.classList.add(DISABLED_TRIGGER_CLASS);
    el.removeAttribute("data-action");          // Foundry のアクション発火を止める＝クリック不能
    el.setAttribute("aria-disabled", "true");
    if (res.reason) el.title = res.reason;
    count += 1;
  }
  return count;
}
