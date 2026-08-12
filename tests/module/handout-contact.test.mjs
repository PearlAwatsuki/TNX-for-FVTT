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
  it("名前は「コネ：<NPC名>」（入力は素の名前で、接頭はここで付く）", async () => {
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
