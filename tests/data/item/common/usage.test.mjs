import { describe, it, expect } from "vitest";
import { MockArrayField, MockSchemaField, MockStringField } from "../../../setup.mjs";

const { UsageTemplate, isAttackUsage } = await import("../../../../scripts/data/item/common/usage.mjs");

describe("UsageTemplate.defineSchema()", () => {
  const schema = UsageTemplate.defineSchema();
  const entryFields = schema.actions.element.fields;

  it("スキーマを取得できる", () => {
    expect(schema).toBeDefined();
  });

  it("actions フィールドが存在する", () => {
    expect(schema).toHaveProperty("actions");
  });

  it("actions は ArrayField である", () => {
    expect(schema.actions).toBeInstanceOf(MockArrayField);
  });

  describe("actions 要素スキーマの構造が正しい", () => {
    it("要素は SchemaField である", () => {
      expect(schema.actions.element).toBeInstanceOf(MockSchemaField);
    });

    it("共通フィールドが存在する", () => {
      expect(entryFields).toHaveProperty("_id");
      expect(entryFields).toHaveProperty("type");
      expect(entryFields).toHaveProperty("name");
      expect(entryFields).toHaveProperty("description");
      expect(entryFields).toHaveProperty("timing");
      expect(entryFields).toHaveProperty("target");
      expect(entryFields).toHaveProperty("effects");
      expect(entryFields).toHaveProperty("baseSkillRef");
      expect(entryFields).toHaveProperty("skillRefs");
    });

    it("固定達成値（fixedResult・フェーズ11-5）は nullable で initial null（空欄=通常判定）", () => {
      expect(entryFields).toHaveProperty("fixedResult");
      expect(entryFields.fixedResult.options.initial).toBe(null);
      expect(entryFields.fixedResult.options.nullable).toBe(true);
    });

    it("attack 固有フィールドが存在する", () => {
      expect(entryFields).toHaveProperty("weaponRefs");
      expect(entryFields).toHaveProperty("damageType");
    });

    it("damageBoost/damageReduce 固有フィールドが存在する", () => {
      expect(entryFields).toHaveProperty("formula");
      expect(entryFields).toHaveProperty("damageCategory");
    });

    it("modification 固有フィールドが存在する", () => {
      expect(entryFields).toHaveProperty("modifiableParams");
    });

    it("無視する指定技能（ignoreComboSkills・2026-07-10）は StringField の ArrayField", () => {
      expect(entryFields.ignoreComboSkills).toBeInstanceOf(MockArrayField);
      expect(entryFields.ignoreComboSkills.element).toBeInstanceOf(MockStringField);
    });

    it("skillRefs の要素は itemId のみ（per-row の無視フラグは持たない＝用途側設定に一本化）", () => {
      expect(Object.keys(entryFields.skillRefs.element.fields)).toEqual(["itemId"]);
    });

    it("用途自身の修正値（専用欄・checkBonusSelf / damageBonusSelf）が StringField・initial 空", () => {
      expect(entryFields.checkBonusSelf).toBeInstanceOf(MockStringField);
      expect(entryFields.checkBonusSelf.options.initial).toBe("");
      expect(entryFields.damageBonusSelf).toBeInstanceOf(MockStringField);
      expect(entryFields.damageBonusSelf.options.initial).toBe("");
    });

    it("effects 要素は itemId ＋ effectId を持つ（供給元アイテムを明示）", () => {
      const effFields = entryFields.effects.element.fields;
      expect(effFields).toHaveProperty("itemId");
      expect(effFields).toHaveProperty("effectId");
      expect(effFields.itemId.options.initial).toBe("");
      expect(effFields.effectId.options.initial).toBe("");
    });

    it("type / name / description は StringField である", () => {
      expect(entryFields.type).toBeInstanceOf(MockStringField);
      expect(entryFields.name).toBeInstanceOf(MockStringField);
      expect(entryFields.description).toBeInstanceOf(MockStringField);
    });

    it("type の initial は 'check'", () => {
      expect(entryFields.type.options.initial).toBe("check");
    });

    it("name / description の initial は空文字", () => {
      expect(entryFields.name.options.initial).toBe("");
      expect(entryFields.description.options.initial).toBe("");
    });

    describe("skillRefs の構造が正しい", () => {
      it("skillRefs は ArrayField である", () => {
        expect(entryFields.skillRefs).toBeInstanceOf(MockArrayField);
      });

      it("skillRefs の要素は SchemaField である", () => {
        expect(entryFields.skillRefs.element).toBeInstanceOf(MockSchemaField);
      });

      it("skillRefs の要素に itemId が存在する", () => {
        expect(entryFields.skillRefs.element.fields).toHaveProperty("itemId");
      });

      it("skillRefs.itemId は StringField で initial が空文字", () => {
        const itemId = entryFields.skillRefs.element.fields.itemId;
        expect(itemId).toBeInstanceOf(MockStringField);
        expect(itemId.options.initial).toBe("");
      });
    });

    describe("baseSkillRef の構造が正しい", () => {
      it("baseSkillRef は SchemaField である", () => {
        expect(entryFields.baseSkillRef).toBeInstanceOf(MockSchemaField);
      });

      it("baseSkillRef に itemId が存在する", () => {
        expect(entryFields.baseSkillRef.fields).toHaveProperty("itemId");
      });

      it("baseSkillRef.itemId は StringField で initial が空文字", () => {
        const itemId = entryFields.baseSkillRef.fields.itemId;
        expect(itemId).toBeInstanceOf(MockStringField);
        expect(itemId.options.initial).toBe("");
      });
    });

    describe("timing の構造が正しい", () => {
      it("timing は SchemaField である", () => {
        expect(entryFields.timing).toBeInstanceOf(MockSchemaField);
      });

      it("timing に value / actionName / processName / timingOther が存在する", () => {
        const t = entryFields.timing.fields;
        expect(t).toHaveProperty("value");
        expect(t).toHaveProperty("actionName");
        expect(t).toHaveProperty("processName");
        expect(t).toHaveProperty("timingOther");
      });

      it("timing.value の initial は 'blank'", () => {
        expect(entryFields.timing.fields.value.options.initial).toBe("blank");
      });
    });
  });
});

describe("UsageTemplate.migrateData()", () => {
  it("_id が無いエントリに randomID を付与する", () => {
    const source = { actions: [{ type: "check", name: "テスト", description: "" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0]._id).toBeDefined();
    expect(typeof result.actions[0]._id).toBe("string");
    expect(result.actions[0]._id.length).toBeGreaterThan(0);
  });

  it("_id が既に存在するエントリは変更しない", () => {
    const source = { actions: [{ _id: "existingId", type: "check", name: "テスト", description: "" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0]._id).toBe("existingId");
  });

  it("baseSkillRef が無いエントリに { itemId: '' } を付与する", () => {
    const source = { actions: [{ _id: "abc", type: "check", name: "テスト" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].baseSkillRef).toEqual({ itemId: "" });
  });

  it("baseSkillRef が既に存在するエントリは変更しない", () => {
    const source = { actions: [{ _id: "abc", type: "check", baseSkillRef: { itemId: "skillXyz" } }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].baseSkillRef.itemId).toBe("skillXyz");
  });

  it("actions が undefined のとき何もしない", () => {
    const source = {};
    expect(() => UsageTemplate.migrateData(source)).not.toThrow();
  });

  it("攻撃は判定に統合(2026-07-09): type=attack → check(damageCategory 保持)", () => {
    const source = { actions: [{ _id: "a", type: "attack", damageCategory: "mental" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("check");
    expect(result.actions[0].damageCategory).toBe("mental");
  });

  it("系統未設定の旧攻撃は物理とみなす", () => {
    const source = { actions: [{ _id: "a", type: "attack" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("check");
    expect(result.actions[0].damageCategory).toBe("physical");
  });
});

describe("isAttackUsage()（攻撃=damageCategory 付きの check・2026-07-09）", () => {
  it("check かつ damageCategory 設定=攻撃", () => {
    expect(isAttackUsage({ type: "check", damageCategory: "physical" })).toBe(true);
    expect(isAttackUsage({ type: "check", damageCategory: "" })).toBe(false);
    expect(isAttackUsage({ type: "check" })).toBe(false);
  });
  it("check 以外は damageCategory があっても攻撃でない(damageBoost 等)", () => {
    expect(isAttackUsage({ type: "damageBoost", damageCategory: "physical" })).toBe(false);
    expect(isAttackUsage({ type: "declaration", damageCategory: "physical" })).toBe(false);
  });
});
