import { describe, it, expect, beforeAll } from "vitest";

// buildContactSkillData は foundry.utils.randomID を使う(識別キーの一意 ID)。
// Foundry グローバルが無いテスト環境では最小の代役を置く
beforeAll(() => {
  globalThis.foundry ??= {};
  globalThis.foundry.utils ??= {};
  globalThis.foundry.utils.randomID ??= () => "abc123XYZ";
});

const load = async () => import("../../scripts/module/handout-contact.mjs");

describe("buildContactSkillData()（アクトコネクションの技能データ・2026-08-12 ユーザー指定）", () => {
  it("名前は「コネ：<相手の名前>」（入力は素の名前で、接頭はここで付く）", async () => {
    const { buildContactSkillData } = await load();
    expect(buildContactSkillData("キース・シュナイダー").name).toBe("コネ：キース・シュナイダー");
  });

  it("一般技能で、固有名詞技能・アクション技能・報酬点使用可能・初期取得の社会コネ・アクト限定", async () => {
    const { buildContactSkillData } = await load();
    const data = buildContactSkillData("エウラリア");
    expect(data.type).toBe("generalSkill");
    expect(data.system.generalSkillCategory).toBe("onomasticSkill");
    expect(data.system.isAction).toBe(true);
    expect(data.system.usesBounty).toBe(true);
    expect(data.system.onomasticSkill.isInitial).toBe(true);
    expect(data.system.isActLimited).toBe(true);
  });

  it("識別キーは名前と無関係な一意 ID（コネ小分類の判定に必要な contact_ 接頭だけ付ける）", async () => {
    const { buildContactSkillData } = await load();
    const key = buildContactSkillData("エウラリア").system.identificationKey;
    expect(key.startsWith("contact_")).toBe(true);
    expect(key).not.toContain("エウラリア");
  });
});

describe("isContactGranted()（受け取り済みの判定）", () => {
  it("granted が真のときだけ受け取り済み", async () => {
    const { isContactGranted } = await load();
    expect(isContactGranted({ granted: true })).toBe(true);
    expect(isContactGranted({ granted: false })).toBe(false);
    expect(isContactGranted({})).toBe(false);
    expect(isContactGranted(null)).toBe(false);
  });
});

describe("resolveHandoutContact()（コネの指定方法ごとの解決・2026-08-13）", () => {
  const withGame = (users) => { globalThis.game = { users: { get: (id) => users[id] ?? null } }; };

  it("自由記述は入力値をそのまま（前後の空白は落とす）", async () => {
    const { resolveHandoutContact } = await load();
    expect(resolveHandoutContact({ actConnectionType: "free", actConnection: " エウラリア " }))
      .toEqual({ type: "free", contactName: "エウラリア", itemUuid: "" });
  });

  it("指定方法が無ければ自由記述として扱う", async () => {
    const { resolveHandoutContact } = await load();
    expect(resolveHandoutContact({ actConnection: "キース" }).type).toBe("free");
  });

  it("PC は相手のハンドアウトの担当キャストの現在名を引く", async () => {
    const { resolveHandoutContact } = await load();
    withGame({ u1: { character: { name: "カブト太郎" } } });
    const handouts = [{ id: "hoA" }, { id: "hoB", userId: "u1" }];
    expect(resolveHandoutContact({ actConnectionType: "pc", actConnectionHandoutId: "hoB" }, handouts))
      .toEqual({ type: "pc", contactName: "カブト太郎", itemUuid: "" });
  });

  it("PC で相手のキャストが未設定なら名前は空（押した時点で警告して中止する）", async () => {
    const { resolveHandoutContact } = await load();
    withGame({ u1: {} });
    const handouts = [{ id: "hoB", userId: "u1" }];
    expect(resolveHandoutContact({ actConnectionType: "pc", actConnectionHandoutId: "hoB" }, handouts).contactName)
      .toBe("");
    expect(resolveHandoutContact({ actConnectionType: "pc", actConnectionHandoutId: "none" }, handouts).contactName)
      .toBe("");
  });

  it("NPC は辞典アイテムの現在名から「コネ：」の接頭を落とす（カードの見出しと二重にならない）", async () => {
    const { resolveHandoutContact } = await load();
    globalThis.fromUuidSync = () => ({ name: "コネ：キース・シュナイダー" });
    expect(resolveHandoutContact({ actConnectionType: "npc", actConnectionUuid: "Compendium.x.Item.k" }))
      .toEqual({ type: "npc", contactName: "キース・シュナイダー", itemUuid: "Compendium.x.Item.k" });
  });

  it("NPC で参照が切れていれば名前は空", async () => {
    const { resolveHandoutContact } = await load();
    globalThis.fromUuidSync = () => null;
    expect(resolveHandoutContact({ actConnectionType: "npc", actConnectionUuid: "Item.gone" }).contactName).toBe("");
  });
});
