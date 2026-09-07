/**
 * @fileoverview import 整合性テスト(恒久テスト・2026-09-07)。
 *
 * 相対 import が指すファイルが実在し、**名前つき import の名前がその先で実際に export
 * されている**ことを検証する。
 *
 * 経緯: システム ID の一本化で `export const TNX_FLAG_SCOPE` を削除したとき、他ファイルの
 * `import { TNX_FLAG_SCOPE }` が残って壊れた。ESLint は import の解決をしない(解決プラグインを
 * 入れていない)ため素通りし、たまたま該当モジュールにテストがあったから発覚しただけだった。
 * これから置き場の階層化と大きいファイルの分割が続くので、機械的に検証できるようにする。
 *
 * template-integrity.test.mjs と同じく Foundry ランタイムに依存しない(Node.js 単体で完結)。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** ディレクトリ配下の .mjs を再帰収集する(パス区切りは / に正規化)。 */
function collect(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...collect(rel));
    else if (name.endsWith(".mjs")) out.push(rel);
  }
  return out;
}

const FILES = [...collect("scripts"), ...collect("tests")];
const text = new Map(FILES.map(p => [p, readFileSync(join(root, p), "utf8")]));

/** そのファイルが export している名前の集合。 */
function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s+default\s+class\s+(\w+)/gm)) names.add(m[1]);
  // 再エクスポート: export { a, b as c };
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*;?/gm)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      names.add((t.split(/\s+as\s+/)[1] ?? t).trim());
    }
  }
  return names;
}

/** そのファイルの相対 import を {from(相対指定), names[]} で返す。 */
function relativeImports(src) {
  const out = [];
  // 名前つき: import { a, b as c } from "./x.mjs" / export { a } from "./x.mjs"
  for (const m of src.matchAll(/^(?:import|export)\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/gm)) {
    const names = m[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    out.push({ from: m[2], names });
  }
  // 副作用のみ: import "./x.mjs"
  for (const m of src.matchAll(/^import\s*["'](\.[^"']+)["']/gm)) out.push({ from: m[1], names: [] });
  return out;
}

describe("import 整合性", () => {
  it("相対 import の指す先が実在する", () => {
    const missing = [];
    for (const p of FILES) {
      for (const { from } of relativeImports(text.get(p))) {
        const target = relative(root, resolve(dirname(join(root, p)), from)).replace(/\\/g, "/");
        if (!existsSync(join(root, target))) missing.push(`${p} -> ${from}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("名前つき import の名前が、その先で実際に export されている", () => {
    const broken = [];
    for (const p of FILES) {
      for (const { from, names } of relativeImports(text.get(p))) {
        if (!names.length) continue;
        const target = relative(root, resolve(dirname(join(root, p)), from)).replace(/\\/g, "/");
        const src = text.get(target);
        if (src === undefined) continue;          // 実在チェックは上のテストの担当
        const exported = exportedNames(src);
        for (const n of names) {
          if (!exported.has(n)) broken.push(`${p}: { ${n} } <- ${from}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("検証が空振りしていない(相対 import と名前を実際に拾えている)", () => {
    const imports = FILES.flatMap(p => relativeImports(text.get(p)));
    expect(imports.length).toBeGreaterThan(700);
    expect(imports.reduce((n, i) => n + i.names.length, 0)).toBeGreaterThan(1500);
  });
});
