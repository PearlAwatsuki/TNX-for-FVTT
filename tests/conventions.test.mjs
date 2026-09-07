/**
 * @fileoverview 規約の回帰テスト(ソーステキスト検査・フェーズ18)。
 *
 * 経緯: 既存の仕組み(置き場・レジストリ・共通定数)が目の前の形に少し合わないとき、
 * それを広げずに**隣へ新しい答えを置く**という崩れ方が繰り返されていた。規約はコードの
 * どこにも書かれておらず、破っても何も言われないため、時間が経つと必ず失われる。
 * usage-list-wiring.test.mjs が「自前バインドの再導入をソーステキストで検知する」のと
 * 同じ作法で、規約そのものをテストに固定する。
 *
 * 各検査は**現状を上限とするラチェット**で、既知の違反は EXCEPTIONS に明示する。
 * 新しい違反は落ちる。既存の違反を直したら EXCEPTIONS からも消す(消し忘れも落ちる)。
 * 一覧はそのまま「返済すべき負債の目録」になる。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
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

const SELF = "tests/conventions.test.mjs";
const SRC = collect("scripts");
// 本ファイルは EXCEPTIONS に識別子を**文字列として**含むため、参照の集計から必ず除く
// (自分の一覧が「参照あり」に化けて、死んだ export を見逃す)
const TST = collect("tests").filter(p => p !== SELF);
const text = new Map([...SRC, ...TST].map(p => [p, readFileSync(join(root, p), "utf8")]));

const countIn = (files, re) =>
  files.reduce((n, p) => n + (text.get(p).match(re)?.length ?? 0), 0);

// ─────────────────────────────────────────────────────────────────────────────

describe("規約: ファイル名は export するクラス名と対応する", () => {
  // tnx-hud.mjs → TnxHud / cast.mjs → CastDataModel / common/base.mjs → BaseTemplate。
  // 接頭辞(Tnx/TokyoNova)と接尾辞(DataModel/Template)を除いた芯を kebab-case にしたものが
  // ファイル名になる。クラス名の Tnx は**コアの同名クラスとの衝突回避**として必要
  // (TnxCombat extends Combat・TokyoNovaItem extends Item 等が CONFIG に載る)。
  const EXCEPTIONS = new Set([
    "scripts/data/abstract.mjs",           // SystemDataModel: ファイル名は役割(抽象基底)を表す
    "scripts/data/card/common/base.mjs",   // CardBaseTemplate: common/ 配下なので base で足りる
    "scripts/module/tnx-dialog.mjs",       // 複数のダイアログをまとめる置き場(意図的な複数クラス)
    "scripts/module/tnx-subscene-panel.mjs", // TnxSubScenePanel: subscene の綴り差のみ
    "scripts/module/rl-grant.mjs",         // TODO(18-4): Tnx*App 3 つ。tnx-rl-grant-*.mjs へ分割する
  ]);

  const kebab = (n) =>
    n.replace(/^(Tnx|TokyoNova)/, "").replace(/(DataModel|Template)$/, "")
      .replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();

  it("クラスを export するファイルは名前が一致する(既知の例外を除く)", () => {
    const violations = [];
    for (const p of SRC) {
      const classes = [...text.get(p).matchAll(/^export (?:default )?class (\w+)/gm)].map(m => m[1]);
      if (!classes.length || EXCEPTIONS.has(p)) continue;
      const stem = basename(p, ".mjs").replace(/^tnx-/, "");
      if (!classes.some(c => kebab(c) === stem)) violations.push(`${p} (${classes.join(", ")})`);
    }
    expect(violations).toEqual([]);
  });

  it("EXCEPTIONS は実在するファイルだけを挙げる(直したら消す)", () => {
    expect([...EXCEPTIONS].filter(p => !SRC.includes(p))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("規約: 参照されない export を残さない", () => {
  // 2026-09-07: 死んだ export を手で洗い出したとき、tests/ を見ずに削除しかけて
  // 6 件のテストを落とした(mergeContactEntries)。以後は機械的に見る。
  const EXPORT = /^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)|class\s+(\w+)|let\s+(\w+))/gm;

  /** 全 export を {場所, 名前, 本番参照数, テスト参照数} で数える。 */
  const survey = () => {
    const rows = [];
    for (const p of SRC) {
      for (const m of text.get(p).matchAll(EXPORT)) {
        const name = m[1] ?? m[2] ?? m[3] ?? m[4];
        const re = new RegExp(`\\b${name}\\b`, "g");
        const inSrc = SRC.reduce((n, q) =>
          n + (text.get(q).match(re)?.length ?? 0) - (q === p ? 1 : 0), 0);
        const inTst = countIn(TST, re);
        rows.push({ id: `${p}::${name}`, inSrc, inTst });
      }
    }
    return rows;
  };
  const rows = survey();

  // どこからも参照されない export。撤去できないものだけを理由つきで挙げる。
  const UNREFERENCED = new Set([
    // 段の部品の JS 版。対応するパーシャル(tnxCardFold/tnxCardText)はテンプレート 8 箇所で
    // 使用中で、cardField/cardResult は JS からも使う。6 段のうち 2 段だけ JS 側に無いと
    // 次に必要になった人が自前で書くため、対称形として残す
    "scripts/module/chat-card.mjs::cardFold",
    "scripts/module/chat-card.mjs::cardText",
    // TODO(18-4): いずれも**消費側が同じ内容を直書き**している(正本のほうが浮いている)。
    // 定数を消すのではなく消費側を繋ぐ
    "scripts/module/designation-response-logic.mjs::STAND_IN_KINDS",
    "scripts/module/skill-dictionary.mjs::SKILL_PACK_LABELS",
    "scripts/module/target-condition.mjs::TARGET_CONDITION_KINDS",
    "scripts/module/target-condition.mjs::TARGET_CONDITION_MODES",
  ]);

  // 本番から呼ばれず、テストだけが生かしている export。
  // テストが**使われていない実装の仕様を固定し続ける**状態なので、増やさない。
  const TEST_ONLY = new Set([
    "scripts/data/item/helpers.mjs::computeCheckBonus",
    "scripts/module/appearance-logic.mjs::isAppearanceBlockedScene",
    "scripts/module/combat-progression.mjs::isValidProcessTransition",
    "scripts/module/exp-award-logic.mjs::calcRlExpTotal",
    "scripts/module/miracle-logic.mjs::asOtherSelection",
    "scripts/module/session-logic.mjs::nextSceneRow",
    "scripts/module/skill-chain-resolution.mjs::singleComboSkillName",
    "scripts/module/usage-target-plan.mjs::usageCardForm",
  ]);

  it("どこからも参照されない export が増えていない", () => {
    const found = rows.filter(r => r.inSrc === 0 && r.inTst === 0).map(r => r.id);
    expect(found.filter(id => !UNREFERENCED.has(id))).toEqual([]);
  });

  it("テストからしか参照されない export が増えていない", () => {
    const found = rows.filter(r => r.inSrc === 0 && r.inTst > 0).map(r => r.id);
    expect(found.filter(id => !TEST_ONLY.has(id))).toEqual([]);
  });

  it("除外リストは現存する export だけを挙げる(直したら消す)", () => {
    const ids = new Set(rows.map(r => r.id));
    expect([...UNREFERENCED, ...TEST_ONLY].filter(id => !ids.has(id))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("規約: 共通の置き場を迂回しない(ラチェット=増やさない)", () => {
  // ダイアログは tnx-dialog.mjs が置き場だが、既存の抽象(TargetSelectionDialog は <select>)が
  // 目の前の形(ラジオ行)に合わなかったとき、広げずにその場で DialogV2 を書く、が繰り返された。
  // 同じ形のダイアログが 5 箇所に複製され、意匠クラス名まで一緒に運ばれている。
  // TODO(18-4): ListSelectionDialog を置き場に足して差し替える。
  const DIALOG_LIMIT = 30;
  it(`DialogV2 を直接呼ぶファイルが ${DIALOG_LIMIT} を超えない`, () => {
    const files = SRC.filter(p => !p.endsWith("tnx-dialog.mjs")
      && /DialogV2\.(wait|prompt|confirm)\s*\(/.test(text.get(p)));
    expect(files.length).toBeLessThanOrEqual(DIALOG_LIMIT);
  });

  // フラグスコープはファイルごとに SCOPE / TNX_SCOPE / SCOPE_FLAGS / TNX_FLAG_SCOPE /
  // TNX_TRANSFER_SCOPE と 5 通りの名前で再宣言され、生文字列も残っている。
  // TODO(18-4): constants.mjs へ一本化する。
  const SCOPE_LITERAL_LIMIT = 100;
  it(`フラグスコープの生文字列が ${SCOPE_LITERAL_LIMIT} 箇所を超えない`, () => {
    const n = countIn(SRC, /(?:get|set|unset)Flag\(\s*"tokyo-nova-axleration"/g)
      + countIn(SRC, /flags\.tokyo-nova-axleration/g);
    expect(n).toBeLessThanOrEqual(SCOPE_LITERAL_LIMIT);
  });
});
