/**
 * @fileoverview システム全体で共有する識別子(2026-09-07 一本化)。
 *
 * 従来この値は各ファイルで `const SCOPE = "tokyo-nova-axleration";` と再宣言されており、
 * 名前も SCOPE / TNX_SCOPE / SCOPE_FLAGS / TNX_FLAG_SCOPE / TNX_TRANSFER_SCOPE の 5 通りに
 * 分かれ、さらに生の文字列のままの箇所も残っていた。定義を 1 箇所へ寄せる。
 *
 * テンプレートパス(`systems/tokyo-nova-axleration/templates/...`)とコンペンディウムの
 * パック ID(`tokyo-nova-axleration.general-skills` 等)はここでは扱わない——前者は
 * ファイルパスとして読めることに価値があり、後者は既に用途ごとの定数
 * (SKILL_PACKS / OUTFIT_PACKS ほか)へまとまっているため。
 */

/**
 * システム ID。フラグのスコープ・ワールド設定の名前空間・ソケットチャンネルの接頭辞・
 * パック ID の接頭辞に使われる、system.json の `id` と同じ値。
 */
export const SYSTEM_ID = "tokyo-nova-axleration";

/** システムのソケットチャンネル(`game.socket.on` / `emit` に渡す)。 */
export const SOCKET_CHANNEL = `system.${SYSTEM_ID}`;
