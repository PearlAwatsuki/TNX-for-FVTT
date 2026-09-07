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
    "scripts/ui/tnx-dialog.mjs",       // 複数のダイアログをまとめる置き場(意図的な複数クラス)
    "scripts/app/tnx-subscene-panel.mjs", // TnxSubScenePanel: subscene の綴り差のみ
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
    "scripts/chat/chat-card.mjs::cardFold",
    "scripts/chat/chat-card.mjs::cardText",
  ]);

  // 本番から呼ばれず、テストだけが生かしている export。
  // テストが**使われていない実装の仕様を固定し続ける**状態なので、増やさない。
  const TEST_ONLY = new Set([
    "scripts/data/item/helpers.mjs::computeCheckBonus",
    "scripts/rules/appearance.mjs::isAppearanceBlockedScene",
    "scripts/rules/combat-progression.mjs::isValidProcessTransition",
    "scripts/rules/exp-award.mjs::calcRlExpTotal",
    "scripts/rules/miracle.mjs::asOtherSelection",
    "scripts/rules/session.mjs::nextSceneRow",
    "scripts/rules/skill-chain-resolution.mjs::singleComboSkillName",
    "scripts/rules/usage-target-plan.mjs::usageCardForm",
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

  // 「直したら除外リストからも消す」を強制する。片方向(新しい違反だけ)の検査では、繋いだ後も
  // 一覧に残り続けて負債の目録として嘘をつく(2026-09-07 に実際そうなりかけた)
  it("除外リストに、既に解消したものが残っていない", () => {
    const stillUnreferenced = new Set(rows.filter(r => r.inSrc === 0 && r.inTst === 0).map(r => r.id));
    const stillTestOnly     = new Set(rows.filter(r => r.inSrc === 0 && r.inTst > 0).map(r => r.id));
    expect([...UNREFERENCED].filter(id => !stillUnreferenced.has(id))).toEqual([]);
    expect([...TEST_ONLY].filter(id => !stillTestOnly.has(id))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("規約: 共通の置き場を迂回しない(ラチェット=増やさない)", () => {
  // ダイアログは tnx-dialog.mjs が置き場だが、既存の抽象(TargetSelectionDialog は <select>)が
  // 目の前の形(ラジオ行)に合わなかったとき、広げずにその場で DialogV2 を書く、が繰り返された。
  // 2026-09-07 に ListSelectionDialog を置き場へ足し、修理・改造(対象/ドラッグ)・使用回数の
  // 消費を差し替えた。回復の2群選択は形が違う(独立した2つの複数選択＋全選択の強制)ため
  // 無理に寄せていない。
  const DIALOG_LIMIT = 28;
  it(`DialogV2 を直接呼ぶファイルが ${DIALOG_LIMIT} を超えない`, () => {
    const files = SRC.filter(p => !p.endsWith("tnx-dialog.mjs")
      && /DialogV2\.(wait|prompt|confirm)\s*\(/.test(text.get(p)));
    expect(files.length).toBeLessThanOrEqual(DIALOG_LIMIT);
  });

  // システム ID はファイルごとに SCOPE / TNX_SCOPE / SCOPE_FLAGS / TNX_FLAG_SCOPE /
  // TNX_TRANSFER_SCOPE と 5 通りの名前で再宣言され、生文字列も 100 箇所残っていた。
  // 2026-09-07 に scripts/constants.mjs へ一本化したので、以後はラチェットでなく**規則**として
  // 0 件を保つ。テンプレートパス(systems/…/templates/…)とパック ID は対象外
  // (前者はファイルパスとして読めることに価値があり、後者は用途ごとの定数へまとまっている)。
  /** 行頭がコメントの行を落とす(説明文中の記述は違反ではない)。 */
  const codeOf = (src) => src.split(/\r?\n/)
    .filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join(" ");

  it("システム ID を生の文字列で書かない(constants.mjs の SYSTEM_ID を通す)", () => {
    const offenders = [];
    for (const p of SRC) {
      if (p === "scripts/constants.mjs") continue;
      const code = codeOf(text.get(p));
      if (/"tokyo-nova-axleration"/.test(code)
        || /"system\.tokyo-nova-axleration"/.test(code)
        || /flags\.tokyo-nova-axleration/.test(code)) offenders.push(p);
    }
    expect(offenders).toEqual([]);
  });

  // チャットカードの描画は renderChatMessageHTML を 15 回登録しており、メッセージ 1 枚の描画ごとに
  // 15 個のコールバックが走っていた。さらに「上の checkRequest 描画の**後**に登録し…」のように
  // 登録順への依存がコメントでしか表現されておらず、行を並べ替えるだけで壊れた。
  // 2026-09-07 に表(CHAT_CARD_RENDERERS)＋1 回の登録へ寄せたので、再分裂を禁じる。
  // DialogV2 はコールバックの戻り値が nullish だとボタンの action 文字列で解決するため、
  // `callback: () => null` はキャンセルを文字列 "cancel" として届けてしまう(truthy)。
  // 2026-08-14・2026-09-07(KI-052)の 2 度、実機で事故になっている。false を返させる。
  it("キャンセルボタンのコールバックが null を返さない", () => {
    const re = /action: "cancel"[^}]*callback: \(\) => null/;
    expect(SRC.filter(p => re.test(text.get(p)))).toEqual([]);
  });

  it("renderChatMessageHTML の登録は 1 回だけ(表で順序を表す)", () => {
    const n = countIn(SRC, /Hooks\.on\("renderChatMessageHTML"/g);
    expect(n).toBe(1);
    expect(text.get("scripts/tnx.mjs")).toContain("const CHAT_CARD_RENDERERS = [");
  });

  it("システム ID をファイルごとに再宣言しない", () => {
    const offenders = SRC.filter(p => p !== "scripts/constants.mjs"
      && /const \w+ = "tokyo-nova-axleration";/.test(text.get(p)));
    expect(offenders).toEqual([]);
  });
});
