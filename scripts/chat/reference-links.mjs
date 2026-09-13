/**
 * @fileoverview リファレンス・リンク埋め込みの共有ヘルパー(16-x・2026-08-31 ユーザー承認)。
 *
 * 参照の土台は Foundry コアの @UUID コンテンツリンク(エディタへのドキュメントドラッグで挿入・
 * クリックでシート表示)。本サブフェーズの仕事は「リッチテキストを**読む**全表示面で確実に
 * 解決(エンリッチ)されること」——エンリッチ漏れ面(辞典カード・展開パネル・情報カード・
 * アクトコントロール送信カード・シナリオシート閲覧ビュー)を塞ぐ。
 * 辞典アイテムへのリンクのホバー・ツールチップは item-card-tooltips.mjs 側
 * (applyContentLinkCardTooltips)が担う。
 */

/** リッチテキストのエンリッチ(空安全・async)。 */
export function enrichText(text, options = {}) {
    return foundry.applications.ux.TextEditor.enrichHTML(text ?? "", { async: true, ...options });
}

/**
 * 情報カード(info-card.hbs)の描画コンテキストの本文をエンリッチする。
 * buildInfoCardData / buildInfoDiscloseCardData(純関数)の出力を描画直前に通す
 * (純関数側を Foundry に依存させないための描画シーム)。
 * @param {?{blocks?: Array<{rows?: Array<{text: string}>}>}} data
 * @returns {Promise<?object>} 同形のデータ(本文のみエンリッチ済み)
 */
export async function enrichInfoCardData(data, options = {}) {
    if (!data || !Array.isArray(data.blocks)) return data;
    return {
        ...data,
        blocks: await Promise.all(data.blocks.map(async (b) => ({
            ...b,
            rows: await Promise.all((b.rows ?? []).map(async (r) => ({ ...r, text: await enrichText(r.text, options) }))),
        }))),
    };
}
