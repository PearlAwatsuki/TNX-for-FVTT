import { describe, it, expect } from "vitest";
import { MockArrayField, MockBooleanField, MockSchemaField, MockStringField } from "../../../setup.mjs";

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

    it("スタン可能（canStun・2026-07-11）は BooleanField で initial false", () => {
      expect(entryFields.canStun).toBeInstanceOf(MockBooleanField);
      expect(entryFields.canStun.options.initial).toBe(false);
    });

    it("ダメージを修正（modifyDamage・2026-07-11＝アイテムロール使用・旧 boostDamage を置換）は BooleanField で initial false", () => {
      expect(entryFields.modifyDamage).toBeInstanceOf(MockBooleanField);
      expect(entryFields.modifyDamage.options.initial).toBe(false);
      expect(entryFields).not.toHaveProperty("boostDamage");
    });

    it("旧 damageCategory は攻撃タイプへ移行済み(2026-07-17 再編)・旧 formula(効果量)も廃止済み", () => {
      expect(entryFields).not.toHaveProperty("damageCategory");
      expect(entryFields).not.toHaveProperty("formula");
      // 物理攻撃の白兵/射撃選択(2026-07-17・既定=白兵)
      expect(entryFields.attackWeaponKind).toBeInstanceOf(MockStringField);
      expect(entryFields.attackWeaponKind.options.initial).toBe("melee");
    });

    it("対決欄(confrontation・2026-07-17)はスタイル技能と同形の行配列", () => {
      expect(entryFields.confrontation).toBeInstanceOf(MockArrayField);
      expect(Object.keys(entryFields.confrontation.element.fields))
        .toEqual(["value", "name", "skillDict", "skillGroup", "skillSub"]);
      expect(entryFields.confrontation.element.fields.value.options.initial).toBe("blank");
      // 対決不可トグルは行「不可」へ一本化(2026-07-17)
      expect(entryFields).not.toHaveProperty("isUnopposable");
    });

    it("対決不可にもリアクション可(ignoresUnopposable・2026-07-17)は BooleanField で initial false", () => {
      expect(entryFields.ignoresUnopposable).toBeInstanceOf(MockBooleanField);
      expect(entryFields.ignoresUnopposable.options.initial).toBe(false);
    });

    it("治療の実行形式(executionForm・2026-07-17)は StringField で initial 'check'", () => {
      expect(entryFields.executionForm).toBeInstanceOf(MockStringField);
      expect(entryFields.executionForm.options.initial).toBe("check");
    });

    it("使用ヴィークル(vehicleRef・2026-07-17)は単一参照 SchemaField{itemId}", () => {
      expect(Object.keys(entryFields.vehicleRef.fields)).toEqual(["itemId"]);
    });

    it("旧 modifiableParams は撤去されている(フェーズ16-1・改造可能項目は分類から導出)", () => {
      expect(entryFields).not.toHaveProperty("modifiableParams");
    });

    it("NPC取得（npcAcquire・2026-07-13 タイプ→フラグ化）は BooleanField で initial false", () => {
      expect(entryFields.npcAcquire).toBeInstanceOf(MockBooleanField);
      expect(entryFields.npcAcquire.options.initial).toBe(false);
    });

    it("無視する指定技能（ignoreComboSkills・2026-07-10）は StringField の ArrayField", () => {
      expect(entryFields.ignoreComboSkills).toBeInstanceOf(MockArrayField);
      expect(entryFields.ignoreComboSkills.element).toBeInstanceOf(MockStringField);
    });

    it("skillRefs の要素は itemId のみ（per-row の無視フラグは持たない＝用途側設定に一本化）", () => {
      expect(Object.keys(entryFields.skillRefs.element.fields)).toEqual(["itemId"]);
    });

    it("再判定可能（allowRecheck・2026-07-11）は BooleanField で initial false", () => {
      expect(entryFields.allowRecheck).toBeInstanceOf(MockBooleanField);
      expect(entryFields.allowRecheck.options.initial).toBe(false);
    });

    it("回復範囲の設定フィールド群が存在する（旧 recovery フラグは治療タイプへ移行・2026-07-17）", () => {
      expect(entryFields).not.toHaveProperty("recovery");
      expect(entryFields.recoveryTargets).toBeInstanceOf(MockArrayField);
      expect(Object.keys(entryFields.recoveryTargets.element.fields)).toEqual(["group", "kind"]);
      expect(entryFields.recoveryExcludes).toBeInstanceOf(MockArrayField);
      expect(entryFields.recoveryExcludes.element).toBeInstanceOf(MockStringField);
      expect(entryFields.recoveryAll.options.initial).toBe(false);
      expect(entryFields.recoveryCount.options.initial).toBe(1);
      // 回復専用の目標値式は廃止(2026-07-13・発動タブの目標値へ一本化)
      expect(entryFields).not.toHaveProperty("recoveryTargetFormula");
    });

    it("スート変更可能（allowSuitChange）／スートを変更（grantSuitChange・2026-07-12）は BooleanField で initial false", () => {
      expect(entryFields.allowSuitChange).toBeInstanceOf(MockBooleanField);
      expect(entryFields.allowSuitChange.options.initial).toBe(false);
      expect(entryFields.grantSuitChange).toBeInstanceOf(MockBooleanField);
      expect(entryFields.grantSuitChange.options.initial).toBe(false);
    });

    it("再判定を付与（grantRecheck・2026-07-11）は BooleanField で initial false", () => {
      expect(entryFields.grantRecheck).toBeInstanceOf(MockBooleanField);
      expect(entryFields.grantRecheck.options.initial).toBe(false);
    });

    it("判定を修正（modifyCheck・2026-07-11）は BooleanField で initial false", () => {
      expect(entryFields.modifyCheck).toBeInstanceOf(MockBooleanField);
      expect(entryFields.modifyCheck.options.initial).toBe(false);
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
  it.each([
    ["Compendium.miracles.a", ["Compendium.miracles.a"]],
    ["", []],
    [["Compendium.miracles.a", "Compendium.miracles.b"], ["Compendium.miracles.a", "Compendium.miracles.b"]],
    [[], []],
  ])("打消し対象の旧指定を移行し、配列を維持する: %j", (before, expected) => {
    const source = { actions: [{ _id: "negate", type: "defence", negateMiracle: before }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].negateMiracle).toEqual(expected);
    expect(UsageTemplate.migrateData(result).actions[0].negateMiracle).toEqual(expected);
  });

  it("旧 damageBoost/damageReduce は declaration(宣言)へ変換される(2026-07-11 廃止)", () => {
    const source = { actions: [
      { _id: "a", type: "damageBoost", name: "増加" },
      { _id: "b", type: "damageReduce", name: "軽減" },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("declaration");
    expect(result.actions[1].type).toBe("declaration");
  });

  it("旧 boostDamage=true は modifyDamage=true へ変換される(2026-07-11 置換)", () => {
    const source = { actions: [{ _id: "a", type: "check", boostDamage: true }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].modifyDamage).toBe(true);
  });

  it("modifyDamage が既に設定済みなら boostDamage で上書きしない", () => {
    const source = { actions: [{ _id: "a", type: "check", boostDamage: true, modifyDamage: false }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].modifyDamage).toBe(false);
  });

  it("改造(modification)は行動種別タイプとして保持される(2026-07-17 再編・旧 check 変換は削除)", () => {
    const source = { actions: [{ _id: "a", type: "modification" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("modification");
  });

  it("旧 npcAcquire タイプはフラグ化: エキストラ=宣言・判定系モード=判定", () => {
    const source = { actions: [
      { _id: "a", type: "npcAcquire", acquireMode: "extra" },
      { _id: "b", type: "npcAcquire", acquireMode: "troop" },
      { _id: "c", type: "npcAcquire", acquireMode: "bunshin" },
      { _id: "d", type: "npcAcquire" },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("declaration");
    expect(result.actions[1].type).toBe("check");
    expect(result.actions[2].type).toBe("check");
    expect(result.actions[3].type).toBe("declaration"); // モード未設定はエキストラ既定
    for (const a of result.actions) expect(a.npcAcquire).toBe(true);
  });

  it("旧 recoveryTargetFormula は目標値「その他」へ移送される(2026-07-13 一本化)", () => {
    const source = { actions: [{ _id: "a", type: "check", recoveryTargetFormula: "10 + @condition.magnitude" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].targetValueOther).toBe("10 + @condition.magnitude");
    expect(result.actions[0].targetValue).toBe("other");
  });

  it("recoveryTargetFormula の移送は既存の目標値設定を上書きしない", () => {
    const source = { actions: [{ _id: "a", type: "check", recoveryTargetFormula: "5", targetValue: "number", targetValueOther: "既存" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].targetValueOther).toBe("既存");
    expect(result.actions[0].targetValue).toBe("number");
  });

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

  it("旧攻撃(type=attack / check+damageCategory)は攻撃タイプへ移行する(2026-07-17 再編)", () => {
    const source = { actions: [
      { _id: "a", type: "attack", damageCategory: "mental" },
      { _id: "b", type: "check", damageCategory: "social" },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("mentalAttack");
    expect(result.actions[1].type).toBe("socialAttack");
  });

  it("系統未設定の旧攻撃は物理攻撃タイプとみなす", () => {
    const source = { actions: [{ _id: "a", type: "attack" }] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("physicalAttack");
  });

  it("カバー/回復フラグはタイプへ移行(2026-07-17): covering→カバー・recovery→治療(実行形式は旧タイプ)", () => {
    const source = { actions: [
      { _id: "a", type: "check", covering: true },
      { _id: "b", type: "check", recovery: true },
      { _id: "c", type: "declaration", recovery: true },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].type).toBe("covering");
    expect(result.actions[1].type).toBe("treatment");
    expect(result.actions[1].executionForm).toBe("check");
    expect(result.actions[2].type).toBe("treatment");
    expect(result.actions[2].executionForm).toBe("declaration");
  });

  it("対決欄の系統既定を敷く(2026-07-17): 旧攻撃に物理=ドッジ+パリー等・既存の対決欄は触らない", () => {
    const source = { actions: [
      { _id: "a", type: "check", damageCategory: "physical" },
      { _id: "b", type: "check", damageCategory: "mental", confrontation: [] },
      { _id: "c", type: "check" },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].confrontation.map(r => r.value)).toEqual(["dodge", "parry"]);
    expect(result.actions[1].confrontation).toEqual([]); // 既存(空で確定済み)は上書きしない
    expect(result.actions[2].confrontation).toBeUndefined(); // 判定タイプは既定なし
  });

  it("リアクション系の対決欄: 未設定/空配列に「なし」を敷く(2026-07-18 裁定=対決欄は全タイプが持つ)", () => {
    const source = { actions: [
      { _id: "a", type: "dodge" },
      { _id: "b", type: "parry", confrontation: [] },
      { _id: "c", type: "mentalReaction", confrontation: [{ value: "none", name: "", skillDict: "", skillGroup: "", skillSub: "" }] },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].confrontation.map(r => r.value)).toEqual(["none"]);
    expect(result.actions[1].confrontation.map(r => r.value)).toEqual(["none"]);
    expect(result.actions[2].confrontation.map(r => r.value)).toEqual(["none"]);
  });

  it("対決不可トグルの一本化(2026-07-17): isUnopposable=true → 対決欄の「不可」行(重複追加しない)", () => {
    const source = { actions: [
      { _id: "a", type: "check", isUnopposable: true },
      { _id: "b", type: "check", isUnopposable: true, confrontation: [{ value: "cannot", name: "", skillDict: "", skillGroup: "", skillSub: "" }] },
    ] };
    const result = UsageTemplate.migrateData(source);
    expect(result.actions[0].confrontation.map(r => r.value)).toEqual(["cannot"]);
    expect(result.actions[1].confrontation.map(r => r.value)).toEqual(["cannot"]);
  });
});

describe("isAttackUsage()（攻撃=攻撃タイプ・2026-07-17 再編）", () => {
  it("攻撃タイプ3種のみ攻撃", () => {
    expect(isAttackUsage({ type: "physicalAttack" })).toBe(true);
    expect(isAttackUsage({ type: "mentalAttack" })).toBe(true);
    expect(isAttackUsage({ type: "socialAttack" })).toBe(true);
    expect(isAttackUsage({ type: "check" })).toBe(false);
    expect(isAttackUsage({ type: "declaration" })).toBe(false);
    expect(isAttackUsage({ type: "dodge" })).toBe(false);
  });
});
