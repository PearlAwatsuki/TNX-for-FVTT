import { describe, it, expect } from "vitest";
import {
  appearanceCheckParams,
  hasNegativeDangerOutfit,
  isAppearanceSkillKey,
  formatAppearanceSummary,
  isAppearanceBlockedScene,
  normalizeAppearanceActors,
  sceneEntryAppearances,
  groupCharacterChoices,
  resolveSceneAppearance,
  areaTargetValue,
  DEFAULT_APPEARANCE_TARGET,
} from "../../scripts/module/appearance-logic.mjs";

describe("appearanceCheckParams()（エリア別 TN と危険値修正・Appearance_Check 正本）", () => {
  it("レッド8・イエロー10は危険値ペナルティなし", () => {
    expect(appearanceCheckParams({ area: "red", appearanceModifier: -4 }))
      .toEqual({ blocked: false, targetValue: 8, modifier: 0 });
    expect(appearanceCheckParams({ area: "yellow", appearanceModifier: -4 }))
      .toEqual({ blocked: false, targetValue: 10, modifier: 0 });
  });

  it("グリーン10は危険値合計×1・ホワイト12は×2を達成値への修正とする（2026-08-07 裁定＝達成値に加算）", () => {
    expect(appearanceCheckParams({ area: "green", appearanceModifier: -3 }))
      .toEqual({ blocked: false, targetValue: 10, modifier: -3 });
    expect(appearanceCheckParams({ area: "white", appearanceModifier: -3 }))
      .toEqual({ blocked: false, targetValue: 12, modifier: -6 });
  });

  it("サンクチュアリ12は危険値ペナルティ装備の携帯で登場不可", () => {
    expect(appearanceCheckParams({ area: "sanctuary", appearanceModifier: 0, hasNegativeDangerItem: true }))
      .toEqual({ blocked: true, targetValue: 12, modifier: 0 });
    expect(appearanceCheckParams({ area: "sanctuary", appearanceModifier: 0, hasNegativeDangerItem: false }))
      .toEqual({ blocked: false, targetValue: 12, modifier: 0 });
  });

  it("エリア未設定は目標値なし・修正なし（判定は出せる・成否は卓）", () => {
    expect(appearanceCheckParams({ area: "", appearanceModifier: -2 }))
      .toEqual({ blocked: false, targetValue: null, modifier: 0 });
  });

  it("危険値0なら修正0", () => {
    expect(appearanceCheckParams({ area: "white", appearanceModifier: 0 }))
      .toEqual({ blocked: false, targetValue: 12, modifier: 0 });
  });

  it("数値指定モード: TN は指定値・危険値係数はエリアに従う（14-7）", () => {
    expect(appearanceCheckParams({ area: "white", appearanceModifier: -2, mode: "fixed", fixedValue: 15 }))
      .toEqual({ blocked: false, targetValue: 15, modifier: -4 });
    expect(appearanceCheckParams({ area: "", appearanceModifier: -2, mode: "fixed", fixedValue: 9 }))
      .toEqual({ blocked: false, targetValue: 9, modifier: 0 });
  });

  it("登場不可モード: シーンプレイヤー以外登場できない（14-7）", () => {
    expect(appearanceCheckParams({ area: "red", mode: "none" }))
      .toEqual({ blocked: true, targetValue: null, modifier: 0 });
  });

  it("数値指定でもサンクチュアリの登場不可装備チェックは生きる", () => {
    expect(appearanceCheckParams({ area: "sanctuary", mode: "fixed", fixedValue: 15, hasNegativeDangerItem: true }))
      .toEqual({ blocked: true, targetValue: 15, modifier: 0 });
  });
});

describe("hasNegativeDangerOutfit()（サンクチュアリの装備チェック＝合計でなく個別）", () => {
  const carriedWeapon = (value) => ({
    type: "weapon",
    system: { isCarrying: true, appearancePenalty: { mode: "value", value } },
  });

  it("携帯中の危険値マイナス装備が1つでもあれば true（合計が0以上でも）", () => {
    const items = [carriedWeapon(-2), carriedWeapon(3)];
    expect(hasNegativeDangerOutfit(items)).toBe(true);
  });

  it("携帯していない・危険値なし・非アウトフィットは数えない", () => {
    expect(hasNegativeDangerOutfit([
      { type: "weapon", system: { isCarrying: false, appearancePenalty: { mode: "value", value: -2 } } },
      { type: "weapon", system: { isCarrying: true, appearancePenalty: { mode: "none" } } },
      { type: "generalSkill", system: {} },
    ])).toBe(false);
  });
});

describe("isAppearanceSkillKey()（登場判定の既定候補＝社会/コネ分類）", () => {
  it("society/contact プレフィックスの識別キーを社会/コネと判定する", () => {
    expect(isAppearanceSkillKey("society")).toBe(true);
    expect(isAppearanceSkillKey("society_nova")).toBe(true);
    expect(isAppearanceSkillKey("contact_father")).toBe(true);
    expect(isAppearanceSkillKey("melee")).toBe(false);
    expect(isAppearanceSkillKey("")).toBe(false);
  });
});

describe("formatAppearanceSummary()（パネルの「登場：」行・2026-08-09 指示）", () => {
  it("指定技能＋目標値を「〈…〉〈…〉 10」形式で並べる", () => {
    expect(formatAppearanceSummary({
      mode: "area", targetValue: 10,
      skillNames: ["〈社会：N◎VA、ストリート〉", "〈コネ：エウラリア〉"],
    })).toBe("〈社会：N◎VA、ストリート〉〈コネ：エウラリア〉\u00A010");
  });

  it("指定技能が無ければ目標値だけ・目標値が無ければ技能だけ", () => {
    expect(formatAppearanceSummary({ mode: "area", targetValue: 8, skillNames: [] })).toBe("8");
    expect(formatAppearanceSummary({ mode: "area", targetValue: null, skillNames: ["〈医療〉"] }))
      .toBe("〈医療〉");
  });

  it("登場不可のシーンは「不可」・どちらも無ければ空（行を出さない）", () => {
    expect(formatAppearanceSummary({ mode: "none", targetValue: null, skillNames: ["〈医療〉"] }))
      .toBe("不可");
    expect(formatAppearanceSummary({ mode: "area", targetValue: null, skillNames: [] })).toBe("");
    expect(formatAppearanceSummary()).toBe("");
  });

  it("目標値0は表示する（偽値の取りこぼしを作らない）", () => {
    expect(formatAppearanceSummary({ mode: "fixed", targetValue: 0 })).toBe("0");
  });
});

describe("isAppearanceBlockedScene()（登場：不可＝判定もチーム免除も塞ぐ・2026-08-09 裁定）", () => {
  it("none のシーンだけ塞ぐ（既定＝エリア準拠は塞がない）", () => {
    expect(isAppearanceBlockedScene({ appearanceMode: "none" })).toBe(true);
    expect(isAppearanceBlockedScene({ appearanceMode: "area" })).toBe(false);
    expect(isAppearanceBlockedScene({ appearanceMode: "fixed" })).toBe(false);
    expect(isAppearanceBlockedScene({})).toBe(false);
    expect(isAppearanceBlockedScene(null)).toBe(false);
  });
});

describe("normalizeAppearanceActors()（登場キャラクターの事前設定・14-8）", () => {
  it("hideName の既定は false・アクター参照の無い行は落とす", () => {
    expect(normalizeAppearanceActors([
      { actorId: "a1" },
      { actorId: "a2", hideName: true },
      { hideName: true },
      null,
    ])).toEqual([
      { actorId: "a1", hideName: false },
      { actorId: "a2", hideName: true },
    ]);
  });

  it("配列でなければ空", () => {
    expect(normalizeAppearanceActors(undefined)).toEqual([]);
    expect(normalizeAppearanceActors("a1")).toEqual([]);
  });
});

describe("sceneEntryAppearances()（シーン入場で登場させる集合・14-8）", () => {
  it("シーンプレイヤーに事前設定を重ねる", () => {
    expect(sceneEntryAppearances(
      { appearanceActors: [{ actorId: "guest1", hideName: true }, { actorId: "guest2" }] },
      { scenePlayerActorId: "cast1" },
    )).toEqual([
      { actorId: "cast1", hideName: false },
      { actorId: "guest1", hideName: true },
      { actorId: "guest2", hideName: false },
    ]);
  });

  it("シーンプレイヤーが事前設定にも居る場合は名前を伏せない（開示された主役のため）", () => {
    expect(sceneEntryAppearances(
      { appearanceActors: [{ actorId: "cast1", hideName: true }] },
      { scenePlayerActorId: "cast1" },
    )).toEqual([{ actorId: "cast1", hideName: false }]);
  });

  it("ルーラーシーン（シーンプレイヤー不在）は事前設定だけで登場する", () => {
    expect(sceneEntryAppearances({ appearanceActors: [{ actorId: "guest1" }] }))
      .toEqual([{ actorId: "guest1", hideName: false }]);
    expect(sceneEntryAppearances({}, { scenePlayerActorId: "" })).toEqual([]);
  });
});

describe("groupCharacterChoices()（キャラクター選択の type 別グループ・14-8）", () => {
  const actors = [
    { id: "c1", name: "キャスト", type: "cast" },
    { id: "g1", name: "ゲスト", type: "guest", appearing: true },
    { id: "g2", name: "ゲスト2", type: "guest" },
    { id: "e1", name: "エキストラ", type: "extra" },
    { id: "x1", name: "ヴィークル（キャラクターではない）", type: "vehicle" },
  ];
  const labelOf = type => `L:${type}`;

  it("キャラクター4種を type 順に並べ、空の群と非キャラクターは出さない", () => {
    expect(groupCharacterChoices(actors, { labelOf })).toEqual([
      { label: "L:cast",  actors: [{ id: "c1", name: "キャスト" }] },
      { label: "L:guest", actors: [{ id: "g1", name: "ゲスト" }, { id: "g2", name: "ゲスト2" }] },
      { label: "L:extra", actors: [{ id: "e1", name: "エキストラ" }] },
    ]);
  });

  it("excludeAppearing で登場中を候補から外す（パネルの追加プルダウン）", () => {
    expect(groupCharacterChoices(actors, { labelOf, excludeAppearing: true })).toEqual([
      { label: "L:cast",  actors: [{ id: "c1", name: "キャスト" }] },
      { label: "L:guest", actors: [{ id: "g2", name: "ゲスト2" }] },
      { label: "L:extra", actors: [{ id: "e1", name: "エキストラ" }] },
    ]);
  });

  it("空・未指定でも落ちない", () => {
    expect(groupCharacterChoices([], { labelOf })).toEqual([]);
    expect(groupCharacterChoices(undefined)).toEqual([]);
  });
});

describe("areaTargetValue() / DEFAULT_APPEARANCE_TARGET（14-8）", () => {
  it("エリアの固定目標値を返す", () => {
    expect(areaTargetValue("red")).toBe(8);
    expect(areaTargetValue("green")).toBe(10);
    expect(areaTargetValue("white")).toBe(12);
    expect(areaTargetValue("sanctuary")).toBe(12);
  });

  it("未設定・未知のエリアは null", () => {
    expect(areaTargetValue("")).toBeNull();
    expect(areaTargetValue("nope")).toBeNull();
  });

  it("手入力の初期値は 10（2026-08-09 ユーザー指定）", () => {
    expect(DEFAULT_APPEARANCE_TARGET).toBe(10);
  });
});

describe("resolveSceneAppearance()（行＋実行時の上書きの合成・14-8）", () => {
  it("「未設定」以外の行は上書きを見ない（台本の設定がそのまま）", () => {
    const row = { appearanceMode: "fixed", area: "white", appearanceValue: 14, appearanceSkills: ["a"] };
    expect(resolveSceneAppearance(row, { area: "red", appearanceValue: 8, appearanceSkills: ["b"] }))
      .toEqual({ area: "white", mode: "fixed", fixedValue: 14, skills: ["a"] });
  });

  it("「登場：不可」もそのまま通す（上書きで解除されない）", () => {
    const resolved = resolveSceneAppearance({ appearanceMode: "none" }, { area: "red", appearanceValue: 8 });
    expect(resolved.mode).toBe("none");
    expect(isAppearanceBlockedScene({ appearanceMode: resolved.mode })).toBe(true);
  });

  it("「未設定」の行は上書きを数値指定として使う（エリアの性質は上書きのエリアに従う）", () => {
    const row = { appearanceMode: "unset", appearanceSkills: ["a"] };
    expect(resolveSceneAppearance(row, { area: "green", appearanceValue: 12, appearanceSkills: ["b"] }))
      .toEqual({ area: "green", mode: "fixed", fixedValue: 12, skills: ["b"] });
  });

  it("住宅施設を舞台にした場合も同じ形に落ちる＝危険値係数が既存経路で効く", () => {
    const resolved = resolveSceneAppearance(
      { appearanceMode: "unset" }, { area: "white", appearanceValue: 15, appearanceSkills: [] });
    expect(appearanceCheckParams({ ...resolved, appearanceModifier: -3 }))
      .toEqual({ blocked: false, targetValue: 15, modifier: -6 });
  });

  it("上書きが無い（ダイアログを閉じた）ときは目標値を出さず、台本の指定技能を残す", () => {
    expect(resolveSceneAppearance({ appearanceMode: "unset", appearanceSkills: ["a"] }, null))
      .toEqual({ area: "", mode: "area", fixedValue: null, skills: ["a"] });
  });

  it("上書きの目標値が数値でなければ目標値なし", () => {
    expect(resolveSceneAppearance({ appearanceMode: "unset" }, { area: "red", appearanceValue: null }).fixedValue)
      .toBeNull();
  });

  it("null の行は既定（エリア準拠・指定なし）", () => {
    expect(resolveSceneAppearance(null)).toEqual({ area: "", mode: "area", fixedValue: null, skills: [] });
  });
});
