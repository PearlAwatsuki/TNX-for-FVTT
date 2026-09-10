import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { SYSTEM_ID } from "../../scripts/constants.mjs";
import { getUserFlagData } from "../../scripts/core/user-flag-schema.mjs";
import { recordCastOwnerUser } from "../../scripts/core/cast-ownership.mjs";

// 所有者記録・初回履歴同期・ready のフックは実物を通す。
// 描画と、この不具合に関係しない起動処理のみ代替する。
vi.mock("../../scripts/actor/tnx-cast-sheet.mjs", () => ({
  TokyoNovaCastSheet: { updateCastExp: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../scripts/app/tnx-hud.mjs", () => ({ TnxHud: class { render() {} } }));
vi.mock("../../scripts/core/usage-derivation.mjs", () => ({ enforceUsageChainDefaultsOnImport: vi.fn() }));
vi.mock("../../scripts/core/tnx-socket-handler.mjs", () => ({ TnxSocketHandler: { onMessage: vi.fn() } }));
vi.mock("../../scripts/flow/tnx-check-flow.mjs", () => ({ TnxCheckFlow: {} }));
vi.mock("../../scripts/app/tnx-check-dialog.mjs", () => ({ TnxCheckDialog: class {} }));
vi.mock("../../scripts/core/effect-authoring.mjs", () => ({ sweepEffectScratchItems: vi.fn() }));
vi.mock("../../scripts/core/style-skill-acquisition.mjs", () => ({
  autoAcquireForStyleSkill: vi.fn(), autoImportDerivedData: vi.fn(),
}));
vi.mock("../../scripts/core/migrations.mjs", () => ({ applyPendingMigrations: vi.fn() }));

const { onSystemReady } = await import("../../scripts/core/register-ready.mjs");

/** 今回使用する Foundry のドット区切り更新をデータへ反映する。 */
function applyUpdate(document, update) {
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split(".");
    const leaf = keys.pop();
    let target = document;
    for (const key of keys) target = target[key] ??= {};
    target[leaf] = value;
  }
}

let gm, cast, hooks, recordSheet;
beforeEach(() => {
  vi.useFakeTimers();
  hooks = new Map();
  vi.stubGlobal("Hooks", { on: (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  } });
  vi.stubGlobal("document", { body: { classList: { add: vi.fn() } } });
  gm = { id: "gm1", uuid: "User.gm1", isGM: true, flags: {} };
  gm.update = vi.fn(async update => applyUpdate(gm, update));
  cast = {
    type: "cast", uuid: "Actor.cast1", ownership: { gm1: 3 },
    system: {
      ownerUserId: "", syncWithOwner: true, exp: { spent: 0, additional: 0 },
      history: { h1: { id: "h1", exp: 12, origin: "Actor.cast1", castUuid: "Actor.cast1" } },
    },
  };
  cast.update = vi.fn(async update => applyUpdate(cast, update));
  const users = [gm];
  users.get = id => users.find(user => user.id === id);
  vi.stubGlobal("game", {
    user: gm, users, actors: [cast],
    settings: { get: () => false }, socket: { on: vi.fn() },
  });
  foundry.utils.isEmpty = value => Object.keys(value).length === 0;
  recordSheet = { rendered: true, render: vi.fn() };
  foundry.applications.instances = new Map([["tnx-record-sheet-gm1", recordSheet]]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GM 所有キャストの経験点同期", () => {
  it("GM のまま所有者を記録し、再評価でも書き込みを繰り返さない", async () => {
    await recordCastOwnerUser(cast);
    expect(cast.system.ownerUserId).toBe(gm.uuid);
    await recordCastOwnerUser(cast);
    expect(cast.update).toHaveBeenCalledOnce();
    expect(gm.isGM).toBe(true);
  });

  it("起動時に未連携の GM 所有キャストの既存履歴をレコードへ取り込む", async () => {
    await onSystemReady();
    expect(cast.system.ownerUserId).toBe(gm.uuid);
    expect(getUserFlagData(gm).history.h1.exp).toBe(12);
    expect(getUserFlagData(gm).exp.total).toBe(12);
  });

  it("初回同期の通知でもレコードを再描画し、データ同期は再帰させない", async () => {
    await onSystemReady();
    cast.update.mockClear();
    gm.update.mockClear();
    for (const hook of hooks.get("updateUser")) {
      await hook(gm, { flags: { [SYSTEM_ID]: { history: { h1: { exp: 12 } } } } }, { syncing: true });
    }
    expect(recordSheet.render).toHaveBeenCalledOnce();
    expect(cast.update).not.toHaveBeenCalled();
    expect(gm.update).not.toHaveBeenCalled();
  });
});
