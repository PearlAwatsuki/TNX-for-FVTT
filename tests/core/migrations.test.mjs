/**
 * @fileoverview ワールドデータ移行の適用機構のテスト(2026-09-07・フェーズ18)。
 *
 * 移行は**間違えると卓のデータが壊れて戻せない**。とくに危ないのは次の 2 つで、どちらも
 * 実機では観測しづらい(一回限りゲートの内側なので、正しく動く限り一度しか走らない)。
 *   ① 済んでいる移行を「未実行」と誤って判定して再実行する — ユーザーが手で直したデータを
 *      上書きしうる(正準名ブリッジは判定タイプを付け替えるので、戻した設定がまた変わる)。
 *   ② 失敗した移行を飛ばして版番号だけ進める — その移行は二度と走らない。
 *
 * MIGRATIONS 表そのもの(各 run の中身)は Foundry を要するのでここでは扱わず、
 * 「表をどう適用するか」を検証する。
 */

import { describe, it, expect, vi } from "vitest";
import { runMigrationList, inferAppliedVersion, MIGRATIONS } from "../../scripts/core/migrations.mjs";

/** 実行順を記録する移行を作る。 */
const mk = (version, log, { fail = false } = {}) => ({
  version,
  name: `m${version}`,
  run: async () => { log.push(version); if (fail) throw new Error(`m${version} 失敗`); },
});

describe("runMigrationList()（版番号より新しい移行を昇順に適用する）", () => {
  it("未適用のものだけを版番号の昇順で実行する", async () => {
    const log = [];
    const rec = vi.fn();
    const applied = await runMigrationList([mk(1, log), mk(2, log), mk(3, log)], 1, rec);
    expect(log).toEqual([2, 3]);
    expect(applied).toBe(3);
    // 版番号は 1 つずつ進む(まとめて最後に書かない=途中で落ちても済んだ分は残る)
    expect(rec.mock.calls.map(c => c[0])).toEqual([2, 3]);
  });

  it("すべて適用済みなら何も実行せず版番号も動かさない", async () => {
    const log = [];
    const rec = vi.fn();
    expect(await runMigrationList([mk(1, log), mk(2, log)], 2, rec)).toBe(2);
    expect(log).toEqual([]);
    expect(rec).not.toHaveBeenCalled();
  });

  it("失敗したらそこで止まり、版番号を進めない（次回その移行から再開する）", async () => {
    const log = [];
    const rec = vi.fn();
    const applied = await runMigrationList([mk(1, log), mk(2, log, { fail: true }), mk(3, log)], 0, rec);
    expect(log).toEqual([1, 2]);          // 3 は走らない
    expect(applied).toBe(1);              // 2 の分は進めない
    expect(rec.mock.calls.map(c => c[0])).toEqual([1]);
  });

  it("失敗の次のロードでは、失敗した移行から再開する（飛ばさない）", async () => {
    const log = [];
    const applied = await runMigrationList([mk(1, log), mk(2, log), mk(3, log)], 1, vi.fn());
    expect(log).toEqual([2, 3]);
    expect(applied).toBe(3);
  });

  it("版番号の保存を待ってから次へ進む（保存前に次が走らない）", async () => {
    const order = [];
    const migs = [
      { version: 1, name: "a", run: async () => { order.push("run1"); } },
      { version: 2, name: "b", run: async () => { order.push("run2"); } },
    ];
    await runMigrationList(migs, 0, async (v) => {
      await Promise.resolve();
      order.push(`rec${v}`);
    });
    expect(order).toEqual(["run1", "rec1", "run2", "rec2"]);
  });
});

describe("inferAppliedVersion()（版番号を持たない既存ワールドの取り込み）", () => {
  const legacy = (...done) => done.map((ok, i) => ({ version: i + 1, legacy: () => ok }));

  it("旧ゲートがすべて済みなら最後の版まで適用済みとみなす", () => {
    expect(inferAppliedVersion(legacy(true, true, true))).toBe(3);
  });

  it("何も済んでいなければ 0（新規ワールドは全部走る）", () => {
    expect(inferAppliedVersion(legacy(false, false))).toBe(0);
  });

  it("先頭から連続して済んでいる分まで（穴があればそこで止める）", () => {
    // v1 済み・v2 未・v3 済み → 1 とみなす。v3 を再実行するが、run は冪等なので害はない。
    // 逆に 3 とみなすと v2 が永久に走らない——安全側は「少なく見積もる」
    expect(inferAppliedVersion(legacy(true, false, true))).toBe(1);
  });

  it("旧ゲートを持たない移行(新しく足したもの)でそこで止まる", () => {
    expect(inferAppliedVersion([{ version: 1, legacy: () => true }, { version: 2 }])).toBe(1);
  });

  it("空の表なら 0", () => {
    expect(inferAppliedVersion([])).toBe(0);
  });
});

describe("MIGRATIONS 表の形", () => {
  it("version は 1 から始まる連番（途中に挿し込むと既存ワールドで飛ばされる）", () => {
    expect(MIGRATIONS.map(m => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it("各エントリは名前と実行本体を持つ", () => {
    for (const m of MIGRATIONS) {
      expect(typeof m.name).toBe("string");
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.run).toBe("function");
    }
  });

  it("表は凍結されている（実行時に書き換わらない）", () => {
    expect(Object.isFrozen(MIGRATIONS)).toBe(true);
  });
});
