/**
 * @fileoverview キーごとの直列実行キュー(2026-09-02 抽出)。
 *
 * 同じ対象への非同期の書き込みが同時に走ると、「読む → 判断する → 書く」の間に別の書き込みが
 * 挟まって取りこぼす。現れ方は二つある——**最後勝ちの巻き戻し**(stale なスナップショットで
 * 全体を上書きし、間に入った変更が消える)と、**存在確認のすり抜けによる多重作成**(どちらも
 * 「まだ無い」と判断して両方が作る)。キーごとに直列化すると、後続は必ず直前の書き込みが
 * 終わった世界を見るため、どちらも起こらない。
 *
 * 利用箇所:
 * - 用途配列(`system.actions`)の書き込み(2026-07-17・`tnx-usage-sheet.mjs`)
 * - アイテム狙い AE の転送の実体化(KI-049・`tnx.mjs`)
 *
 * 注意: キューに乗せた処理の中から**同じキー**で `runSerial` を待たないこと(自分の完了を
 * 待つことになる)。フックの中から間接的に呼ばれる場合、フック側は呼び出し元に待たれていない
 * ため直列化しても止まらない。
 */

/** キー → 直近の処理の Promise。 */
const queues = new Map();

/**
 * 同じキーの処理を直列に走らせる。
 *
 * @template T
 * @param {string} key 直列化の単位(アイテムの uuid・アクターの uuid 等)
 * @param {() => (T|Promise<T>)} task 直前の処理の完了後に走らせる処理
 * @returns {Promise<T>} task の戻り値(task が投げれば呼び出し元へ伝播する)
 */
export async function runSerial(key, task) {
    const prev = queues.get(key) ?? Promise.resolve();
    // 直前が失敗しても後続は走らせる(失敗は当の呼び出し元だけが受け取る)
    const next = prev.catch(() => {}).then(() => task());
    queues.set(key, next);
    try {
        return await next;
    } finally {
        // 自分が最後尾のままなら片づける(後から積まれていれば触らない)
        if (queues.get(key) === next) queues.delete(key);
    }
}
