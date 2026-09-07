/**
 * @fileoverview テンプレートが参照する用途フィールドが、スキーマに実在することの検査(2026-09-07)。
 *
 * Handlebars は**存在しないパスを無言で空にする**。`usage.recoveryAll` を `usage.recovery.all` に
 * 改名してテンプレートを直し忘れても、エラーは出ず、チェックボックスが常にオフに見えるだけ——
 * 実機で気づくしかなく、気づいたときには「なぜか設定が保存されない」という形で現れる。
 *
 * ここではテンプレート中の `usage.<フィールド>` を集め、用途スキーマ(common/usage.mjs)に
 * その名前が定義されているかを照合する。スキーマは Foundry の fields を使うため import できない
 * ので、宣言のソーステキストからフィールド名を読む(usage-list-wiring.test.mjs と同じ作法)。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** templates/ 配下の .hbs を再帰収集する。 */
function collectHbs(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...collectHbs(rel));
    else if (name.endsWith(".hbs")) out.push(rel);
  }
  return out;
}

const schemaSrc = readFileSync(join(root, "scripts/data/item/common/usage.mjs"), "utf8");

/**
 * 用途スキーマのフィールド名(トップレベルと、入れ子スキーマの中身)。
 * `<名前>: new fields.…` の形をすべて拾う——入れ子になっても名前は同じ形で現れるため、
 * 「usage.timing.value」のような多段パスも先頭セグメントだけ照合すれば足りる。
 */
const schemaFields = new Set(
  [...schemaSrc.matchAll(/^\s{8,}(\w+):\s*new fields\./gm)].map(m => m[1])
);

/** テンプレートが参照する usage 配下のパス → 先頭セグメント。 */
const referenced = new Map();   // 先頭セグメント → 参照元ファイルの集合
for (const f of collectHbs("templates")) {
  const src = readFileSync(join(root, f), "utf8");
  for (const m of src.matchAll(/\busage\.([a-zA-Z][\w]*)/g)) {
    if (!referenced.has(m[1])) referenced.set(m[1], new Set());
    referenced.get(m[1]).add(f);
  }
}

describe("テンプレートの用途フィールド参照", () => {
  it("スキーマのフィールドを読み取れている(検査が空振りしていない)", () => {
    expect(schemaFields.size).toBeGreaterThan(50);
    for (const k of ["type", "name", "timing", "target", "range", "consumeTargets"]) {
      expect(schemaFields.has(k)).toBe(true);
    }
  });

  it("テンプレートから用途参照を拾えている(検査が空振りしていない)", () => {
    expect(referenced.size).toBeGreaterThan(20);
  });

  it("参照されるフィールドはすべてスキーマに存在する", () => {
    const missing = [...referenced.entries()]
      .filter(([name]) => !schemaFields.has(name))
      .map(([name, files]) => `usage.${name} (${[...files].join(", ")})`);
    expect(missing).toEqual([]);
  });
});
