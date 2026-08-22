import { describe, it, expect } from "vitest";
import {
  appearanceCheckParams,
  appearanceCardInfo,
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
  pickTokenDropPosition,
  tokenDeletionImpliesExit,
} from "../../scripts/module/appearance-logic.mjs";

describe("appearanceCardInfo()（登場判定の専用チャットカード表示・2026-08-16）", () => {
  it("登場文脈が無ければ null（通常の判定カードは無改変）", () => {
    expect(appearanceCardInfo(null, { success: true })).toBeNull();
    expect(appearanceCardInfo(undefined, { success: true })).toBeNull();
  });

  it("エリアは設定されているときだけ出す（未設定で「未定」を出さない＝ユーザー指示）", () => {
    expect(appearanceCardInfo({ actorId: "a", areaLabel: "ホワイト" }, { success: false }))
      .toEqual({ areaLabel: "ホワイト", ghost: false, appeared: false, hasInfo: true });
    expect(appearanceCardInfo({ actorId: "a", areaLabel: "" }, { success: false }))
      .toEqual({ areaLabel: "", ghost: false, appeared: false, hasInfo: false });
    expect(appearanceCardInfo({ actorId: "a" }, { success: false }))
      .toEqual({ areaLabel: "", ghost: false, appeared: false, hasInfo: false });
  });

  it("ゴースト宣言は情報行として出す（エリア未設定でも hasInfo）", () => {
    expect(appearanceCardInfo({ actorId: "a", ghost: true }, { success: false }))
      .toEqual({ areaLabel: "", ghost: true, appeared: false, hasInfo: true });
  });

  it("帰結（シーンに登場）は success===true のときだけ（null=目標値なしは自動登場しない）", () => {
    expect(appearanceCardInfo({ actorId: "a" }, { success: true }).appeared).toBe(true);
    expect(appearanceCardInfo({ actorId: "a" }, { success: null }).appeared).toBe(false);
    expect(appearanceCardInfo({ actorId: "a" }, {}).appeared).toBe(false);
    expect(appearanceCardInfo({ actorId: "a" }, null).appeared).toBe(false);
  });
});

describe("appearanceCheckParams()（エリア別 TN と危険値修正・Appearance_Check 正本）", () => {
  it("レッド8・イエロー10は危険値ペナルティなし", () => {
    expect(appearanceCheckParams({ area: "red", appearanceModifier: -4 }))
      .toEqual({ forcedFailure: null, targetValue: 8, modifier: 0 });
    expect(appearanceCheckParams({ area: "yellow", appearanceModifier: -4 }))
      .toEqual({ forcedFailure: null, targetValue: 10, modifier: 0 });
  });

  it("グリーン10は危険値合計×1・ホワイト12は×2を達成値への修正とする（2026-08-07 裁定＝達成値に加算）", () => {
    expect(appearanceCheckParams({ area: "green", appearanceModifier: -3 }))
      .toEqual({ forcedFailure: null, targetValue: 10, modifier: -3 });
    expect(appearanceCheckParams({ area: "white", appearanceModifier: -3 }))
      .toEqual({ forcedFailure: null, targetValue: 12, modifier: -6 });
  });

  it("サンクチュアリ12は危険値ペナルティ装備の携帯で強制失敗（判定は行える・2026-08-15 裁定）", () => {
    expect(appearanceCheckParams({ area: "sanctuary", appearanceModifier: 0, hasNegativeDangerItem: true }))
      .toEqual({ forcedFailure: "sanctuary", targetValue: 12, modifier: 0 });
    expect(appearanceCheckParams({ area: "sanctuary", appearanceModifier: 0, hasNegativeDangerItem: false }))
      .toEqual({ forcedFailure: null, targetValue: 12, modifier: 0 });
  });

  it("エリア未設定は目標値なし・修正なし（判定は出せる・成否は卓）", () => {
    expect(appearanceCheckParams({ area: "", appearanceModifier: -2 }))
      .toEqual({ forcedFailure: null, targetValue: null, modifier: 0 });
  });

  it("危険値0なら修正0", () => {
    expect(appearanceCheckParams({ area: "white", appearanceModifier: 0 }))
      .toEqual({ forcedFailure: null, targetValue: 12, modifier: 0 });
  });

  it("数値指定モード: TN は指定値・危険値係数はエリアに従う（14-7）", () => {
    expect(appearanceCheckParams({ area: "white", appearanceModifier: -2, mode: "fixed", fixedValue: 15 }))
      .toEqual({ forcedFailure: null, targetValue: 15, modifier: -4 });
    expect(appearanceCheckParams({ area: "", appearanceModifier: -2, mode: "fixed", fixedValue: 9 }))
      .toEqual({ forcedFailure: null, targetValue: 9, modifier: 0 });
  });

  it("登場不可モード: 判定は行えるが強制失敗（2026-08-15 裁定＝判定そのものはブロックしない）", () => {
    expect(appearanceCheckParams({ area: "red", mode: "none" }))
      .toEqual({ forcedFailure: "none", targetValue: null, modifier: 0 });
  });

  it("数値指定でもサンクチュアリの強制失敗装備チェックは生きる", () => {
    expect(appearanceCheckParams({ area: "sanctuary", mode: "fixed", fixedValue: 15, hasNegativeDangerItem: true }))
      .toEqual({ forcedFailure: "sanctuary", targetValue: 15, modifier: 0 });
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
      .toEqual({ forcedFailure: null, targetValue: 15, modifier: -6 });
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

describe("pickTokenDropPosition()（登場トークンの配置位置・2026-08-23）", () => {
  it("盤面中央にグリッドスナップで置く", () => {
    expect(pickTokenDropPosition({
      center: { x: 1000, y: 1000 }, size: { width: 100, height: 100 }, gridSize: 100,
    })).toEqual({ x: 1000, y: 1000 });
  });

  it("同じ位置が埋まっていればグリッド単位で右へずらす（連鎖も追う）", () => {
    const args = { center: { x: 1000, y: 1000 }, size: { width: 100, height: 100 }, gridSize: 100 };
    expect(pickTokenDropPosition({ ...args, occupied: [{ x: 1000, y: 1000 }] }))
      .toEqual({ x: 1100, y: 1000 });
    expect(pickTokenDropPosition({ ...args, occupied: [{ x: 1000, y: 1000 }, { x: 1100, y: 1000 }] }))
      .toEqual({ x: 1200, y: 1000 });
  });

  it("別の座標のトークンには干渉されない", () => {
    expect(pickTokenDropPosition({
      center: { x: 1000, y: 1000 }, size: { width: 100, height: 100 }, gridSize: 100,
      occupied: [{ x: 900, y: 1000 }, { x: 1000, y: 1100 }],
    })).toEqual({ x: 1000, y: 1000 });
  });

  it("大型トークン（2×2）は自身の寸法ぶん中央から引いてスナップする", () => {
    expect(pickTokenDropPosition({
      center: { x: 1000, y: 1000 }, size: { width: 200, height: 200 }, gridSize: 100,
    })).toEqual({ x: 900, y: 900 });
  });

  it("グリッドサイズが不正でも 1px 刻みで動く（防御）", () => {
    expect(pickTokenDropPosition({
      center: { x: 10, y: 10 }, size: { width: 4, height: 4 }, gridSize: 0,
    })).toEqual({ x: 8, y: 8 });
  });
});

describe("tokenDeletionImpliesExit()（トークン削除＝退場の判定・2026-08-23）", () => {
  it("登場中アクターの最後の1体の削除は退場", () => {
    expect(tokenDeletionImpliesExit({ appearing: true, sameActorTokenCount: 1 })).toBe(true);
  });

  it("分身コピーが残る削除は退場ではない（トループ等）", () => {
    expect(tokenDeletionImpliesExit({ appearing: true, sameActorTokenCount: 2 })).toBe(false);
    expect(tokenDeletionImpliesExit({ appearing: true, sameActorTokenCount: 5 })).toBe(false);
  });

  it("未登場アクターのトークン削除は退場ではない（残置トークンの整理）", () => {
    expect(tokenDeletionImpliesExit({ appearing: false, sameActorTokenCount: 1 })).toBe(false);
  });
});
