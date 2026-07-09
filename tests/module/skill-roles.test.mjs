import { describe, it, expect } from "vitest";
import "../setup.mjs";

const { SKILL_ROLES, SKILL_ROLE_KEYS, getSkillRoles, actorSkillsWithRole } =
  await import("../../scripts/module/skill-roles.mjs");

describe("SKILL_ROLES 定義", () => {
  it("9 役割・各役割は kind を持つ", () => {
    expect(SKILL_ROLE_KEYS).toHaveLength(9);
    for (const [k, def] of Object.entries(SKILL_ROLES)) {
      expect(["reaction", "attack", "treatment"], k).toContain(def.kind);
    }
  });
});

describe("getSkillRoles()（フィールドが権威・未設定は正準名の既定）", () => {
  it("skillRoles を設定していればそれを返す(未知役割は除外)", () => {
    const skill = { name: "何か", system: { skillRoles: ["dodge", "bogus", "treatment"] } };
    expect(getSkillRoles(skill)).toEqual(["dodge", "treatment"]);
  });

  it("skillRoles 未設定の既定技能は正準名で既定役割(白兵=パリー+白兵攻撃)", () => {
    expect(getSkillRoles({ name: "白兵", system: { skillRoles: [] } })).toEqual(["parry", "meleeAttack"]);
    expect(getSkillRoles({ name: "医療", system: {} })).toEqual(["treatment"]);
    expect(getSkillRoles({ name: "回避", system: { skillRoles: [] } })).toEqual(["dodge"]);
  });

  it("既定にない技能で未設定なら空", () => {
    expect(getSkillRoles({ name: "無関係技能", system: { skillRoles: [] } })).toEqual([]);
  });

  it("設定は既定より優先(医療を治療でなく別役割に上書き可)", () => {
    expect(getSkillRoles({ name: "医療", system: { skillRoles: ["mentalReaction"] } })).toEqual(["mentalReaction"]);
  });
});

describe("actorSkillsWithRole()（役割を持つ技能を sort 順で検出）", () => {
  const mkActor = (items) => ({ items });

  it("該当役割の一般・スタイル技能のみ・sort 順", () => {
    const actor = mkActor([
      { type: "generalSkill", name: "医療",   sort: 20, system: { skillRoles: ["treatment"] } },
      { type: "generalSkill", name: "白兵",   sort: 10, system: { skillRoles: [] } }, // 既定=parry+meleeAttack
      { type: "styleSkill",   name: "特殊治療", sort: 5,  system: { skillRoles: ["treatment"] } },
      { type: "generalSkill", name: "無関係", sort: 1,  system: { skillRoles: [] } },
      { type: "armor",        name: "防具",   sort: 0,  system: { skillRoles: ["treatment"] } }, // 技能でない=除外
    ]);
    const treat = actorSkillsWithRole(actor, "treatment").map(i => i.name);
    expect(treat).toEqual(["特殊治療", "医療"]); // sort 5, 20
    const parry = actorSkillsWithRole(actor, "parry").map(i => i.name);
    expect(parry).toEqual(["白兵"]);
  });

  it("既定の正準名フォールバックも検出に効く", () => {
    const actor = mkActor([{ type: "generalSkill", name: "回避", sort: 0, system: { skillRoles: [] } }]);
    expect(actorSkillsWithRole(actor, "dodge").map(i => i.name)).toEqual(["回避"]);
  });
});
