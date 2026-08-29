import { describe, it, expect } from "vitest";
import {
  PHASE_ORDER,
  SCENE_AREA_OPTIONS,
  normalizeSceneRow,
  normalizeHandoutRow,
  parseStageRef,
  findSceneRow,
  firstSceneRow,
  nextSceneRow,
  buildCombatSpeedInit,
  buildPreActInit,
  planSceneSwitchEvents,
  planActEndEvents,
  teamCreate,
  teamJoin,
  teamLeave,
  teamDelete,
  teamOf,
  teamLinkedExitTargets,
  recordSceneAppearance,

  hasBackstage,
  backstageQueue,
  nextBackstageSpot,
  isBackstageFinished,
  findDuplicateKeys,
  matchTrumpCard,
  buildSceneSwitchCardData,
  buildTrailerCardData,
  buildScenarioTextCardData,
  buildHandoutCardData,
  buildInfoCardData,
  buildInfoDiscloseCardData,
  newlyDisclosedInfo,
  HANDOUT_STYLE_COMMON,
  HANDOUT_STYLE_FREE,
  circledNumber,
  handoutTitleSuffix,
  handoutDisplayTitle,
  handoutNumberOf,
  handoutStyleDisplay,
  infoSkillKeys,
  resolveInfoSkillLabel,
  infoSkillGroups,
  withResolvedInfoSkillNames,
  infoTiers,
  infoValueLabel,
  toggleInfoDisclosure,
  SCENE_KIND_OPTIONS,
  flattenScenes,
  nextSceneTarget,
  canShowNextScene,
  rotationOrder,
  resolveRotationDefault,
  eventSceneCandidates,
  areEventScenesDone,
  stageCandidateActorIds,
  sceneSequenceNumbers,
  recordScenePlayerDone,
  SCENE_PLAYER_RULER,
  handoutPlayerLabel,
  resolveScenePlayerRef,
  contactType,
  CONTACT_TYPES,
  planActLimitedCleanup,
  discloseInfoByAchievement,
  infoDesignationRows,
  hudInfoItems,
  hudInfoTnChips,
} from "../../scripts/module/session-logic.mjs";
import { TNX_HOOKS } from "../../scripts/module/combat-events.mjs";

const SCENES = {
  opening:  [{ id: "op1", name: "オープニング1" }],
  research: [{ id: "re1", name: "リサーチ1" }, { id: "re2", name: "リサーチ2" }],
  climax:   [],
  ending:   [{ id: "ed1", name: "エンディング1" }],
};

describe("normalizeSceneRow()（シーン行の正規化・14-2）", () => {
  it("旧形式の行に新フィールドの既定値を補う（既存値は書き換えない）", () => {
    const row = normalizeSceneRow({
      id: "s1", number: 3, name: "旧シーン", player: "旧キャスト名",
      isMasterScene: true, switchMessage: "▼",
    });
    expect(row).toEqual({
      id: "s1", number: 3, name: "旧シーン", player: "旧キャスト名",
      isMasterScene: true, switchMessage: "▼",
      area: "", stage: "", playerUserId: "", playerHandoutId: "",
      kind: "normal", eventCondition: "",
      appearanceMode: "area", appearanceValue: null, appearanceSkills: [],
      appearanceActors: [],
    });
  });

  it("種別は既定 normal・未知の値も normal に丸める（14-8）", () => {
    expect(normalizeSceneRow({ id: "s1" }).kind).toBe("normal");
    expect(normalizeSceneRow({ id: "s1", kind: "unknown" }).kind).toBe("normal");
    expect(normalizeSceneRow({ id: "s1", kind: "event" }).kind).toBe("event");
  });

  it("巡回シーンはエリア・登場判定を伏せて「未設定」扱いにする（生データは書き換えない）", () => {
    const raw = { id: "s1", kind: "rotation", area: "white", appearanceMode: "fixed", appearanceValue: 14 };
    const row = normalizeSceneRow(raw);
    expect(row.area).toBe("");
    expect(row.appearanceMode).toBe("unset");
    // 種別を戻せば元の指定がそのまま生きる＝正規化は読み出し時の伏せ字であって書き換えではない
    expect(normalizeSceneRow({ ...raw, kind: "normal" }).area).toBe("white");
    expect(normalizeSceneRow({ ...raw, kind: "normal" }).appearanceMode).toBe("fixed");
  });

  it("登場判定「未設定」は通常シーンでも選べる（14-8）", () => {
    expect(normalizeSceneRow({ id: "s1", appearanceMode: "unset" }).appearanceMode).toBe("unset");
  });

  it("イベントシーンの起動条件を保つ", () => {
    expect(normalizeSceneRow({ id: "s1", kind: "event", eventCondition: "情報Aを得た" }).eventCondition)
      .toBe("情報Aを得た");
  });

  it("新フィールドが保存済みならそのまま保つ", () => {
    const row = normalizeSceneRow({ id: "s2", area: "white", stage: "scene:abc", playerUserId: "u1" });
    expect(row.area).toBe("white");
    expect(row.stage).toBe("scene:abc");
    expect(row.playerUserId).toBe("u1");
  });

  it("登場キャラクターの事前設定を正規化して保つ（14-8）", () => {
    const row = normalizeSceneRow({
      id: "s3", appearanceActors: [{ actorId: "g1", hideName: true }, { hideName: true }],
    });
    expect(row.appearanceActors).toEqual([{ actorId: "g1", hideName: true }]);
  });

  it("null・undefined は空の行として正規化する", () => {
    const row = normalizeSceneRow(null);
    expect(row.id).toBe("");
    expect(row.area).toBe("");
    expect(row.isMasterScene).toBe(false);
  });
});

describe("normalizeHandoutRow()（ハンドアウト行の正規化・14-2）", () => {
  it("旧形式の行に actorId の既定値を補う", () => {
    const row = normalizeHandoutRow({ id: "h1", pcName: "PC1", title: "HO1" });
    expect(row.actorId).toBe("");
    expect(row.pcName).toBe("PC1");
  });

  it("保存済みの actorId は保つ", () => {
    expect(normalizeHandoutRow({ id: "h2", actorId: "a9" }).actorId).toBe("a9");
  });

  it("コネの指定方法は既定が自由記述（従来の挙動が既定のまま）", () => {
    expect(normalizeHandoutRow({ id: "h3" }).actConnectionType).toBe("free");
    expect(normalizeHandoutRow({ id: "h3", actConnectionType: "bogus" }).actConnectionType).toBe("free");
    expect(contactType({ actConnectionType: "pc" })).toBe("pc");
    expect(CONTACT_TYPES.map(o => o.value)).toEqual(["free", "pc", "npc"]);
  });

  it("モードごとに値の置き場が別（切り替えても他モードの入力が消えない）", () => {
    const row = normalizeHandoutRow({
      id: "h4", actConnectionType: "pc",
      actConnection: "キース・シュナイダー", actConnectionHandoutId: "hoB", actConnectionUuid: "Item.x",
    });
    expect(row.actConnection).toBe("キース・シュナイダー");
    expect(row.actConnectionHandoutId).toBe("hoB");
    expect(row.actConnectionUuid).toBe("Item.x");
  });

  it("文字列でない値は空に落とす(旧形式は読み替えない=既存行は作り直す運用)", () => {
    expect(normalizeHandoutRow({ id: "h5", actConnection: ["contact_x"] }).actConnection).toBe("");
    expect(normalizeHandoutRow({ id: "h6", actConnectionHandoutId: 3 }).actConnectionHandoutId).toBe("");
    expect(normalizeHandoutRow({ id: "h7" }).actConnectionUuid).toBe("");
  });
});

describe("planActLimitedCleanup()（アクト終了時の後始末・2026-08-13 確認ダイアログ化）", () => {
  const entries = [
    { actorId: "a1", itemId: "i1" },
    { actorId: "a1", itemId: "i2" },
    { actorId: "a2", itemId: "i3" },
  ];

  it("チェックの無いものは全部削除（既定＝アクト限りが原則）", () => {
    const { deletes, keeps } = planActLimitedCleanup(entries, []);
    expect(deletes).toEqual({ a1: ["i1", "i2"], a2: ["i3"] });
    expect(keeps).toEqual({});
  });

  it("チェックしたものだけ維持へ回す（アクターごとに束ねる）", () => {
    const { deletes, keeps } = planActLimitedCleanup(entries, ["a1:i2", "a2:i3"]);
    expect(deletes).toEqual({ a1: ["i1"] });
    expect(keeps).toEqual({ a1: ["i2"], a2: ["i3"] });
  });

  it("全部維持なら削除は空", () => {
    const { deletes, keeps } = planActLimitedCleanup(entries, ["a1:i1", "a1:i2", "a2:i3"]);
    expect(deletes).toEqual({});
    expect(Object.keys(keeps)).toEqual(["a1", "a2"]);
  });

  it("欠けた項目は落とす・空入力は空", () => {
    expect(planActLimitedCleanup([{ actorId: "a1" }, { itemId: "i1" }], [])).toEqual({ deletes: {}, keeps: {} });
    expect(planActLimitedCleanup(null)).toEqual({ deletes: {}, keeps: {} });
  });
});

describe("parseStageRef()（舞台参照の複合値・14-2）", () => {
  it("scene:<id> を通常 Scene 参照として解く", () => {
    expect(parseStageRef("scene:abc123")).toEqual({ type: "scene", id: "abc123" });
  });

  it("subScene:<id> をサブシーン参照として解く", () => {
    expect(parseStageRef("subScene:xy")).toEqual({ type: "subScene", id: "xy" });
  });

  it("空文字・不正値は null", () => {
    expect(parseStageRef("")).toBeNull();
    expect(parseStageRef(null)).toBeNull();
    expect(parseStageRef("garbage")).toBeNull();
    expect(parseStageRef("scene:")).toBeNull();
  });
});

describe("findSceneRow()（台本からの行検索）", () => {
  it("行 id からフェイズと行を返す", () => {
    const hit = findSceneRow(SCENES, "re2");
    expect(hit.phase).toBe("research");
    expect(hit.row.id).toBe("re2");
  });

  it("見つからなければ null（欠損フェイズ配列にも頑健）", () => {
    expect(findSceneRow(SCENES, "nope")).toBeNull();
    expect(findSceneRow({}, "re2")).toBeNull();
    expect(findSceneRow(null, "re2")).toBeNull();
  });
});

describe("firstSceneRow()（アクト開始時の先頭シーン）", () => {
  it("フェイズ順（OP→リサーチ→クライマックス→ED）で最初の行を返す", () => {
    const hit = firstSceneRow(SCENES);
    expect(hit.phase).toBe("opening");
    expect(hit.row.id).toBe("op1");
  });

  it("先頭フェイズが空なら次のフェイズへ進む", () => {
    const hit = firstSceneRow({ ...SCENES, opening: [] });
    expect(hit.phase).toBe("research");
    expect(hit.row.id).toBe("re1");
  });

  it("台本が空なら null", () => {
    expect(firstSceneRow({ opening: [], research: [], climax: [], ending: [] })).toBeNull();
    expect(firstSceneRow(null)).toBeNull();
  });

  it("PHASE_ORDER はメインアクトの4フェイズ", () => {
    expect(PHASE_ORDER).toEqual(["opening", "research", "climax", "ending"]);
  });
});

describe("nextSceneRow()（「次のシーンへ」＝台本順の次の行・14-5 是正）", () => {
  it("同じフェイズ内の次の行を返す", () => {
    const hit = nextSceneRow(SCENES, "re1");
    expect(hit.phase).toBe("research");
    expect(hit.row.id).toBe("re2");
  });

  it("フェイズの末尾なら次のフェイズの先頭へ進む（空フェイズは飛ばす）", () => {
    const hit = nextSceneRow(SCENES, "re2");   // climax は空
    expect(hit.phase).toBe("ending");
    expect(hit.row.id).toBe("ed1");
  });

  it("台本の最後の行なら null（次が無い）", () => {
    expect(nextSceneRow(SCENES, "ed1")).toBeNull();
  });

  it("現在シーン未指定・不明 id は先頭行を返す（アクト開始直後のフォールバック）", () => {
    expect(nextSceneRow(SCENES, "").row.id).toBe("op1");
    expect(nextSceneRow(SCENES, "zz").row.id).toBe("op1");
  });

  it("台本が空なら null", () => {
    expect(nextSceneRow({ opening: [], research: [], climax: [], ending: [] }, "x")).toBeNull();
    expect(nextSceneRow(null, "x")).toBeNull();
  });
});

describe("buildPreActInit()（アクト開始の自動設定・報酬点＋CS）", () => {
  const system = {
    reason: { total: 5 }, passion: { total: 4 }, life: { total: 6 },
    mundane: { total: 7 },
    combatSpeed: { base: 6, baseTotal: 9 },   // オーバーレイ（AE・タップ修正等）＝+3
  };

  it("CSベース＝floor((理性+感情+生命)÷2)・CS＝ベース＋現在のオーバーレイ（プレアクト初期化と同計算）", () => {
    const patch = buildPreActInit(system);
    expect(patch["system.combatSpeed.base"]).toBe(7);   // floor(15/2)
    expect(patch["system.combatSpeed.value"]).toBe(10); // 7 + (9-6)
  });

  it("報酬点＝bountyBase←外界点実効値・bounty←0（清算を兼ねる）", () => {
    const patch = buildPreActInit(system);
    expect(patch["system.bountyBase"]).toBe(7);
    expect(patch["system.bounty"]).toBe(0);
  });

  it("欠損フィールドは0として頑健に計算する", () => {
    const patch = buildPreActInit({});
    expect(patch["system.combatSpeed.base"]).toBe(0);
    expect(patch["system.combatSpeed.value"]).toBe(0);
    expect(patch["system.bountyBase"]).toBe(0);
    expect(patch["system.bounty"]).toBe(0);
  });

  it("buildCombatSpeedInit: CS 2キーのみ（シートの「プレアクト初期化」ボタンが共用する部分）", () => {
    expect(buildCombatSpeedInit(system)).toEqual({
      "system.combatSpeed.base":  7,
      "system.combatSpeed.value": 10,
    });
  });
});

describe("planSceneSwitchEvents()（シーン切替の境界イベント列）", () => {
  it("通常の切替: 現行シーン終了→次シーン開始", () => {
    expect(planSceneSwitchEvents({ fromSceneId: "op1", sceneEnded: false, toSceneId: "re1", toPhase: "research" })).toEqual([
      { hook: TNX_HOOKS.sceneEnd,   data: { sceneId: "op1" } },
      { hook: TNX_HOOKS.sceneStart, data: { sceneId: "re1", phase: "research" } },
    ]);
  });

  it("案1で終了境界を発火済み（sceneEnded）なら終了イベントを重複発火しない", () => {
    expect(planSceneSwitchEvents({ fromSceneId: "op1", sceneEnded: true, toSceneId: "re1", toPhase: "research" })).toEqual([
      { hook: TNX_HOOKS.sceneStart, data: { sceneId: "re1", phase: "research" } },
    ]);
  });

  it("現行シーンなし（アクト開始の先頭シーン）は開始のみ", () => {
    expect(planSceneSwitchEvents({ fromSceneId: "", sceneEnded: false, toSceneId: "op1", toPhase: "opening" })).toEqual([
      { hook: TNX_HOOKS.sceneStart, data: { sceneId: "op1", phase: "opening" } },
    ]);
  });
});

describe("planActEndEvents()（アクト終了の境界イベント列）", () => {
  it("現行シーンの終了→アクト終了の順で発火する", () => {
    expect(planActEndEvents({ sceneId: "ed1", sceneEnded: false, actId: "act1" })).toEqual([
      { hook: TNX_HOOKS.sceneEnd, data: { sceneId: "ed1" } },
      { hook: TNX_HOOKS.actEnd,   data: { actId: "act1" } },
    ]);
  });

  it("終了境界を発火済みならアクト終了のみ", () => {
    expect(planActEndEvents({ sceneId: "ed1", sceneEnded: true, actId: "act1" })).toEqual([
      { hook: TNX_HOOKS.actEnd, data: { actId: "act1" } },
    ]);
  });

  it("シーンが無い（空の台本でアクト開始した）場合もアクト終了のみ", () => {
    expect(planActEndEvents({ sceneId: "", sceneEnded: false, actId: "act1" })).toEqual([
      { hook: TNX_HOOKS.actEnd, data: { actId: "act1" } },
    ]);
  });
});

describe("チーム操作（純関数・非破壊）", () => {
  const TEAMS = [
    { id: "t1", name: "チームA", memberActorIds: ["a1", "a2"] },
    { id: "t2", name: "チームB", memberActorIds: ["a3"] },
  ];

  it("teamCreate: 新しいチームを追加した配列を返す（元配列は不変）", () => {
    const next = teamCreate(TEAMS, { id: "t3", name: "チームC" });
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ id: "t3", name: "チームC", memberActorIds: [] });
    expect(TEAMS).toHaveLength(2);
  });

  it("teamJoin: 他チームから抜けて対象チームへ移る（1アクター1チーム）", () => {
    const next = teamJoin(TEAMS, "t2", "a1");
    expect(teamOf(next, "a1").id).toBe("t2");
    expect(next.find(t => t.id === "t1").memberActorIds).toEqual(["a2"]);
  });

  it("teamJoin: 既に所属済みなら重複追加しない", () => {
    const next = teamJoin(TEAMS, "t1", "a1");
    expect(next.find(t => t.id === "t1").memberActorIds).toEqual(["a1", "a2"]);
  });

  it("teamLeave: どのチームからも抜ける", () => {
    const next = teamLeave(TEAMS, "a3");
    expect(teamOf(next, "a3")).toBeNull();
    expect(next.find(t => t.id === "t2").memberActorIds).toEqual([]);
  });

  it("teamDelete: チームを削除する", () => {
    const next = teamDelete(TEAMS, "t1");
    expect(next).toHaveLength(1);
    expect(teamOf(next, "a1")).toBeNull();
  });

  it("teamOf: 未所属・空配列は null", () => {
    expect(teamOf(TEAMS, "zz")).toBeNull();
    expect(teamOf([], "a1")).toBeNull();
    expect(teamOf(null, "a1")).toBeNull();
  });

  describe("teamLinkedExitTargets()（チームの退場連動・2026-08-23）", () => {
    const appearing = (ids) => (id) => ids.includes(id);

    it("連動オフは操作対象のみ（チーム所属でも巻き込まない）", () => {
      const r = teamLinkedExitTargets(TEAMS, "a1", { linked: false, isAppearing: appearing(["a1", "a2"]) });
      expect(r.targetIds).toEqual(["a1"]);
      expect(r.others).toEqual([]);
    });

    it("連動オンで登場中のメンバー全員が対象（others に自分は入らない）", () => {
      const r = teamLinkedExitTargets(TEAMS, "a1", { linked: true, isAppearing: appearing(["a1", "a2"]) });
      expect(r.targetIds).toEqual(["a1", "a2"]);
      expect(r.others).toEqual(["a2"]);
      expect(r.teamName).toBe("チームA");
    });

    it("未登場のメンバーは巻き込まない", () => {
      const r = teamLinkedExitTargets(TEAMS, "a1", { linked: true, isAppearing: appearing(["a1"]) });
      expect(r.targetIds).toEqual(["a1"]);
      expect(r.others).toEqual([]);
    });

    it("未所属は操作対象のみ", () => {
      const r = teamLinkedExitTargets(TEAMS, "zz", { linked: true, isAppearing: appearing(["zz", "a1"]) });
      expect(r.targetIds).toEqual(["zz"]);
      expect(r.others).toEqual([]);
    });

    it("チーム名が空なら「チーム」で表示（既存表示と同じフォールバック）", () => {
      const teams = [{ id: "t9", name: "", memberActorIds: ["x1", "x2"] }];
      const r = teamLinkedExitTargets(teams, "x1", { linked: true, isAppearing: appearing(["x1", "x2"]) });
      expect(r.teamName).toBe("チーム");
    });
  });

});

describe("hasBackstage()（舞台裏があるのはリサーチシーンのみ・14-6）", () => {
  it("リサーチだけ true", () => {
    expect(hasBackstage("research")).toBe(true);
    expect(hasBackstage("opening")).toBe(false);
    expect(hasBackstage("climax")).toBe(false);
    expect(hasBackstage("ending")).toBe(false);
    expect(hasBackstage("")).toBe(false);
  });
});

describe("backstageQueue()（舞台裏で回す相手＝非登場者・14-6）", () => {
  const ACTORS = [
    { id: "a", name: "アキラ", appearing: true },
    { id: "b", name: "ベル",   appearing: false },
    { id: "c", name: "カイ",   appearing: false },
  ];

  it("非登場者だけを名前順に並べる", () => {
    expect(backstageQueue(ACTORS).map(x => x.id)).toEqual(["c", "b"]);   // カイ→ベル
  });

  it("RL の手動追加は登場中でも列に入る（登場しつつ舞台裏でも判定するスタイル技能）", () => {
    expect(backstageQueue(ACTORS, ["a"]).map(x => x.id)).toEqual(["a", "c", "b"]);
  });

  it("手動追加が非登場者と重複しても二重に並べない", () => {
    expect(backstageQueue(ACTORS, ["b"]).map(x => x.id)).toEqual(["c", "b"]);
  });

  it("空・null に頑健", () => {
    expect(backstageQueue([])).toEqual([]);
    expect(backstageQueue(null)).toEqual([]);
  });
});

describe("nextBackstageSpot()（舞台裏を回す）", () => {
  const QUEUE = [{ id: "x" }, { id: "y" }, { id: "z" }];

  it("スポット未設定なら先頭から始まる", () => {
    expect(nextBackstageSpot(QUEUE, "")).toBe("x");
  });

  it("次の人へ送る", () => {
    expect(nextBackstageSpot(QUEUE, "x")).toBe("y");
    expect(nextBackstageSpot(QUEUE, "y")).toBe("z");
  });

  it("末尾の次は null（回しきった）", () => {
    expect(nextBackstageSpot(QUEUE, "z")).toBeNull();
  });

  it("列から外れた人（その間に登場した等）がスポットだったら先頭へ戻して頑健にする", () => {
    expect(nextBackstageSpot(QUEUE, "zz")).toBe("x");
  });

  it("列が空なら null", () => {
    expect(nextBackstageSpot([], "x")).toBeNull();
  });
});

describe("isBackstageFinished()（回しきったか＝「次のシーンへ」を出せるか・14-6）", () => {
  const QUEUE = [{ id: "x" }, { id: "y" }];

  it("舞台裏に入る前（未オープン）は「回しきり」ではない", () => {
    expect(isBackstageFinished({ open: false, spotActorId: "" }, QUEUE)).toBe(false);
  });

  it("回している途中（スポットがある）は false", () => {
    expect(isBackstageFinished({ open: true, spotActorId: "x" }, QUEUE)).toBe(false);
    expect(isBackstageFinished({ open: true, spotActorId: "y" }, QUEUE)).toBe(false);
  });

  it("開いた直後（まだ誰にも回していない）は false", () => {
    expect(isBackstageFinished({ open: true, spotActorId: "", started: false }, QUEUE)).toBe(false);
  });

  it("末尾まで送ってスポットが解けたら true（回しきった）", () => {
    expect(isBackstageFinished({ open: true, spotActorId: "", started: true }, QUEUE)).toBe(true);
  });

  it("回す相手が誰もいない場合、開いた時点で回しきり扱い", () => {
    expect(isBackstageFinished({ open: true, spotActorId: "", started: false }, [])).toBe(true);
  });
});

describe("findDuplicateKeys()（キー被りチェック・14-7＝アクト開始をブロック）", () => {
  it("同じキーのスタイルを持つキャストを検出する", () => {
    expect(findDuplicateKeys([
      { name: "アキラ", keys: ["kabuki"] },
      { name: "ベル",   keys: ["kabuki", "kaze"] },
      { name: "カイ",   keys: ["vasara"] },
    ])).toEqual([{ key: "kabuki", names: ["アキラ", "ベル"] }]);
  });

  it("重複がなければ空配列", () => {
    expect(findDuplicateKeys([
      { name: "A", keys: ["kabuki"] },
      { name: "B", keys: ["vasara"] },
    ])).toEqual([]);
  });

  it("同一キャスト内の複数キーは重複と数えない・空キーは無視", () => {
    expect(findDuplicateKeys([
      { name: "A", keys: ["kabuki", "kabuki", ""] },
      { name: "B", keys: [] },
    ])).toEqual([]);
    expect(findDuplicateKeys(null)).toEqual([]);
  });
});

describe("matchTrumpCard()（キースタイル識別キー⇔ニューロカード画像ファイル名の照合・14-7）", () => {
  const CARDS = [
    { id: "c1", img: "systems/tokyo-nova-axleration/assets/cards/neuro-cards/vasara.png" },
    { id: "c2", img: "systems/tokyo-nova-axleration/assets/cards/neuro-cards/kabuto-wari.png" },
    { id: "c3", img: "systems/tokyo-nova-axleration/assets/cards/neuro-cards/kabuto.png" },
  ];

  it("識別キーと画像ファイル名（拡張子除く）の完全一致で特定する", () => {
    expect(matchTrumpCard(CARDS, "vasara")).toBe("c1");
    expect(matchTrumpCard(CARDS, "kabuto")).toBe("c3");       // kabuto-wari に誤爆しない
    expect(matchTrumpCard(CARDS, "kabuto-wari")).toBe("c2");
  });

  it("見つからない・空キーは null", () => {
    expect(matchTrumpCard(CARDS, "ayakashi")).toBeNull();
    expect(matchTrumpCard(CARDS, "")).toBeNull();
    expect(matchTrumpCard([], "vasara")).toBeNull();
  });
});

describe("buildSceneSwitchCardData()（シーン切替カード・14-3／2026-08-15 テンプレート化）", () => {
  it("番号・名前・シーンプレイヤー・切替メッセージを写す", () => {
    expect(buildSceneSwitchCardData(
      { number: 3, name: "追跡", isMasterScene: false, switchMessage: "<p>▼ RESEARCH</p>" },
      { playerLabel: "アキラ" },
    )).toEqual({
      sceneLabel: "SCENE 3",
      name: "追跡",
      rulerScene: false,
      playerLabel: "アキラ",
      message: "<p>▼ RESEARCH</p>",
      hasBody: true,
    });
  });

  it("ルーラーシーンはシーンプレイヤーを落とす（ルーラーはプレイヤーではない・14-7）", () => {
    const d = buildSceneSwitchCardData({ number: 1, name: "OP" }, { playerLabel: "誰か", rulerScene: true });
    expect(d.rulerScene).toBe(true);
    expect(d.playerLabel).toBe("");
  });

  it("旧データの isMasterScene もルーラーシーンとして読む（読み替え）", () => {
    expect(buildSceneSwitchCardData({ number: 1, name: "OP", isMasterScene: true }, {}).rulerScene).toBe(true);
  });

  it("番号なし=??・名前なし=無題のシーン・出す行が無ければ hasBody=false", () => {
    expect(buildSceneSwitchCardData({}, {})).toEqual({
      sceneLabel: "SCENE ??",
      name: "無題のシーン",
      rulerScene: false,
      playerLabel: "",
      message: "",
      hasBody: false,
    });
  });
});

describe("buildTrailerCardData()（トレーラー送信カード・14-3／2026-08-15）", () => {
  it("種別タグ・見出し（アクト名）・本文を組む", () => {
    expect(buildTrailerCardData("<p>本文</p>", { actName: "楽園の血" }))
      .toEqual({ typeLabel: "トレーラー", title: "楽園の血", content: "<p>本文</p>" });
  });

  it("アクト名なしは見出しなし（テンプレート側で行ごと省く）", () => {
    expect(buildTrailerCardData("本文").title).toBe("");
  });

  it("空は null（送信しない）", () => {
    expect(buildTrailerCardData("")).toBeNull();
    expect(buildTrailerCardData(null)).toBeNull();
  });
});

describe("buildScenarioTextCardData()（シナリオテキスト送信カード・2026-08-15）", () => {
  it("種別タグ・見出し（付けた名前）・本文を組む", () => {
    expect(buildScenarioTextCardData({ title: "導入", content: "<p>本文</p>" }))
      .toEqual({ typeLabel: "シナリオテキスト", title: "導入", content: "<p>本文</p>" });
  });

  it("名前が未入力なら見出しなし（一覧の連番「テキストn」は卓に出さない）", () => {
    expect(buildScenarioTextCardData({ content: "本文" }).title).toBe("");
  });

  it("本文が無ければ null（送信しない）", () => {
    expect(buildScenarioTextCardData({ title: "導入", content: "" })).toBeNull();
    expect(buildScenarioTextCardData(null)).toBeNull();
  });
});

describe("buildHandoutCardData()（ハンドアウト送信カードのコンテキスト・2026-08-12 テンプレート化）", () => {
  it("見出し・担当・スタイル・コネ・スートラベル・本文・PS を写す", () => {
    expect(buildHandoutCardData({
      recommendedSuit: "spade", recommendedStyle: "kabuki", content: "<p>本文</p>", ps: "<p>目的</p>",
    }, { title: "①カブキ用ハンドアウト", styleName: "カブキ", playerName: "アキラ",
         contactName: "キース・シュナイダー" })).toEqual({
      title: "①カブキ用ハンドアウト",
      contactName: "キース・シュナイダー",
      suitLabel: "スペード",
      styleName: "カブキ",
      playerName: "アキラ",
      content: "<p>本文</p>",
      ps: "<p>目的</p>",
    });
  });

  it("コネは解決済みの名前を受け取り前後の空白を落とす（「コネ：」は付けない＝カード側が見出しを付ける）", () => {
    expect(buildHandoutCardData({}, { contactName: "  エウラリア  " }).contactName).toBe("エウラリア");
  });

  it("空欄は空文字（テンプレート側で行ごと省く）", () => {
    const d = buildHandoutCardData({ content: "C" });
    expect(d).toMatchObject({ contactName: "", suitLabel: "", styleName: "", playerName: "", ps: "" });
  });

  it("スートのキー以外(旧自由テキスト)はそのままラベルにする", () => {
    expect(buildHandoutCardData({ recommendedSuit: "♠" }).suitLabel).toBe("♠");
  });

  it("見出し未指定は旧 title → 既定値の順にフォールバックする", () => {
    expect(buildHandoutCardData({ title: "旧タイトル" }).title).toBe("旧タイトル");
    expect(buildHandoutCardData({}).title).toBe("ハンドアウト");
  });
});

describe("ハンドアウト表示名（「①<スタイル名>用ハンドアウト」形式・2026-08-09 裁定）", () => {
  it("circledNumber は ①〜⑳・超過は (n)", () => {
    expect(circledNumber(1)).toBe("①");
    expect(circledNumber(20)).toBe("⑳");
    expect(circledNumber(21)).toBe("(21)");
  });

  it("接尾: スタイル指定=「用ハンドアウト」・未選択=「ハンドアウト」・共通=「ハンドアウト」・自由記述=空", () => {
    expect(handoutTitleSuffix({ recommendedStyle: "kabuki" })).toBe("用ハンドアウト");
    expect(handoutTitleSuffix({ recommendedStyle: "" })).toBe("ハンドアウト");
    expect(handoutTitleSuffix({ recommendedStyle: HANDOUT_STYLE_COMMON })).toBe("ハンドアウト");
    expect(handoutTitleSuffix({ recommendedStyle: HANDOUT_STYLE_FREE })).toBe("");
  });

  it("表示名: 番号は前置・共通=「共通ハンドアウト」(番号なし)・自由記述=title", () => {
    expect(handoutDisplayTitle({ recommendedStyle: "kabuki" }, { number: 1, styleName: "カブキ" }))
      .toBe("①カブキ用ハンドアウト");
    expect(handoutDisplayTitle({ recommendedStyle: "" }, { number: 2 })).toBe("②ハンドアウト");
    expect(handoutDisplayTitle({ recommendedStyle: HANDOUT_STYLE_COMMON })).toBe("共通ハンドアウト");
    expect(handoutDisplayTitle({ recommendedStyle: HANDOUT_STYLE_FREE, title: "特別編" })).toBe("特別編");
    expect(handoutDisplayTitle({ recommendedStyle: HANDOUT_STYLE_FREE, title: "" })).toBe("ハンドアウト");
  });

  it("通し番号は共通・自由記述を飛ばして数える", () => {
    const rows = [
      { id: "a", recommendedStyle: "kabuki" },
      { id: "b", recommendedStyle: HANDOUT_STYLE_COMMON },
      { id: "c", recommendedStyle: "kage" },
      { id: "d", recommendedStyle: HANDOUT_STYLE_FREE },
      { id: "e", recommendedStyle: "" },
    ];
    expect(handoutNumberOf(rows, "a")).toBe(1);
    expect(handoutNumberOf(rows, "c")).toBe(2);
    expect(handoutNumberOf(rows, "e")).toBe(3);
    expect(handoutNumberOf(rows, "b")).toBe(0);
    expect(handoutNumberOf(rows, "d")).toBe(0);
  });

  it("handoutStyleDisplay: 特殊値・未選択は空・キーは現在名・キー以外の旧生値はそのまま", () => {
    const choices = { "": "-", kabuki: "カブキ" };
    expect(handoutStyleDisplay("kabuki", choices)).toBe("カブキ");
    expect(handoutStyleDisplay(HANDOUT_STYLE_COMMON, choices)).toBe("");
    expect(handoutStyleDisplay(HANDOUT_STYLE_FREE, choices)).toBe("");
    expect(handoutStyleDisplay("", choices)).toBe("");
    expect(handoutStyleDisplay("カブキ", choices)).toBe("カブキ");
  });
});

describe("buildInfoCardData()（情報項目の送信カード・2026-08-15 表示の等価化）", () => {
  // 技能行は解決済み(withResolvedInfoSkillNames を通した後)の label を持つ
  const ITEM = {
    title: "黒幕の素性",
    contents: [
      { id: "c1", isDisclosed: false, text: "正体", skills: [{ label: "〈社会：N◎VA、ストリート〉", tn: 12 }] },
      { id: "c2", isDisclosed: false, text: "裏付け", skills: [{ label: "〈捜査〉", tn: 15 }] },
    ],
  };

  // 段は 2026-08-12 の新設。目標値どうしに上下関係は無い(2026-08-15 ユーザー裁定)ので、
  // 入口の目標値と段の目標値を区別せず 1 つの並びとして昇順に置く
  const TIERED = {
    title: "氷の静謐",
    contents: [{
      id: "c1", isDisclosed: false, text: "<p>組織の概要</p>",
      skills: [{ label: "〈社会：ストリート、警察〉", tn: 8 }],
      tiers: [
        { id: "t2", tn: 15, text: "<p>今回の構成</p>", isDisclosed: false },
        { id: "t1", tn: 12, text: "<p>実行犯</p>", isDisclosed: false },
      ],
    }, {
      id: "c2", isDisclosed: false, text: "<p>制御室の場所</p>",
      skills: [{ label: "〈電脳〉", tn: 21 }],
    }],
  };

  it("目標値の送信=技能行ごとに目標値を横並びで出す（本文は出さない）", () => {
    const data = buildInfoCardData(TIERED);
    expect(data.mode).toBe("targets");
    expect(data.title).toBe("氷の静謐");
    expect(data.blocks).toEqual([
      { skillLabel: "〈社会：ストリート、警察〉", tnList: "8, 12, 15", rows: [] },
      { skillLabel: "〈電脳〉", tnList: "21", rows: [] },
    ]);
  });

  it("目標値は昇順（保存順ではない）", () => {
    expect(buildInfoCardData(TIERED).blocks[0].tnList).toBe("8, 12, 15");
  });

  it("枝が複数あれば技能行も複数になる（枝ごとに 1 行）", () => {
    const data = buildInfoCardData(ITEM);
    expect(data.blocks.map(b => b.skillLabel))
      .toEqual(["〈社会：N◎VA、ストリート〉", "〈捜査〉"]);
    expect(data.blocks.map(b => b.tnList)).toEqual(["12", "15"]);
  });

  it("目標値の送信では、技能・目標値を持たず本文だけの内容は送信対象にならない", () => {
    const data = buildInfoCardData({
      title: "本文だけ",
      contents: [{ isDisclosed: false, text: "秘密", skills: [] }],
    });
    expect(data.mode).toBeNull();
    expect(data.blocks).toEqual([]);
  });

  it("送れる中身が無ければ mode=null・ブロックも空", () => {
    const data = buildInfoCardData({ title: "空", contents: [{ isDisclosed: false, text: "", skills: [{ label: "", tn: null }] }] });
    expect(data.mode).toBeNull();
    expect(data.blocks).toEqual([]);
  });

  it("開示済みの送信=開いている目標値だけを「目標値｜本文」の行で出す", () => {
    const item = structuredClone(TIERED);
    item.contents[0].isDisclosed = true;
    item.contents[0].tiers.find(t => t.id === "t1").isDisclosed = true;
    const data = buildInfoCardData(item);
    expect(data.mode).toBe("disclosed");
    expect(data.blocks).toEqual([
      {
        skillLabel: "〈社会：ストリート、警察〉",
        tnList: "",
        rows: [{ tn: 8, text: "<p>組織の概要</p>" }, { tn: 12, text: "<p>実行犯</p>" }],
      },
      // 未開示の残りは「完全に未開示の時と同様」の形式で下に併記する(2026-08-25 ユーザー指示)
      { skillLabel: "〈社会：ストリート、警察〉", tnList: "15", rows: [] },
      { skillLabel: "〈電脳〉", tnList: "21", rows: [] },
    ]);
  });

  it("開示していない目標値は出さない（下位を開けても上位は伏せる）", () => {
    const item = structuredClone(TIERED);
    item.contents[0].isDisclosed = true;
    const data = buildInfoCardData(item);
    expect(data.blocks[0].rows).toEqual([{ tn: 8, text: "<p>組織の概要</p>" }]);
  });

  it("段だけを開けても送信対象に入る（入口の本文は伏せたまま）", () => {
    const item = structuredClone(TIERED);
    item.contents[0].tiers.find(t => t.id === "t1").isDisclosed = true;
    const data = buildInfoCardData(item);
    expect(data.mode).toBe("disclosed");
    expect(data.blocks[0].rows).toEqual([{ tn: 12, text: "<p>実行犯</p>" }]);
  });

  it("本文は囲わずそのまま渡す（テンプレートが {{{ }}} で置く＝空段落を挟まない）", () => {
    const item = structuredClone(TIERED);
    item.contents[0].isDisclosed = true;
    expect(buildInfoCardData(item).blocks[0].rows[0].text).toBe("<p>組織の概要</p>");
  });

  it("全て開示済みなら未開示の併記ブロックは付かない", () => {
    const item = structuredClone(TIERED);
    item.contents[0].isDisclosed = true;
    for (const t of item.contents[0].tiers) t.isDisclosed = true;
    item.contents[1].isDisclosed = true;
    const data = buildInfoCardData(item);
    expect(data.mode).toBe("disclosed");
    expect(data.blocks.every(b => b.rows.length > 0 && b.tnList === "")).toBe(true);
  });
});

describe("newlyDisclosedInfo()（開示適用の前後差分・KI-042/フェーズ14-9）", () => {
  const BEFORE = {
    id: "c1", isDisclosed: false, text: "<p>入口</p>",
    skills: [{ label: "〈社会〉", tn: 5 }],
    tiers: [
      { id: "t1", tn: 10, text: "<p>段10</p>", isDisclosed: false },
      { id: "t2", tn: 12, text: "<p>段12</p>", isDisclosed: false },
    ],
  };

  it("入口と段が新たに開けば、その分だけを列挙する", () => {
    const after = discloseInfoByAchievement(BEFORE, { achievement: 10, entryTn: 5 });
    expect(newlyDisclosedInfo(BEFORE, after)).toEqual({ entryOpened: true, tierIds: ["t1"] });
  });

  it("変化が無ければ空（再判定の単調適用＝重複送信のゲート）", () => {
    const opened = discloseInfoByAchievement(BEFORE, { achievement: 10, entryTn: 5 });
    const again = discloseInfoByAchievement(opened, { achievement: 10, entryTn: 5 });
    expect(newlyDisclosedInfo(opened, again)).toEqual({ entryOpened: false, tierIds: [] });
  });

  it("達成値が伸びた再判定は追加分だけを列挙する", () => {
    const first = discloseInfoByAchievement(BEFORE, { achievement: 10, entryTn: 5 });
    const second = discloseInfoByAchievement(first, { achievement: 12, entryTn: 5 });
    expect(newlyDisclosedInfo(first, second)).toEqual({ entryOpened: false, tierIds: ["t2"] });
  });
});

describe("buildInfoDiscloseCardData()（判定成功の自動公開カード・フェーズ14-9）", () => {
  // 開示適用**後**の項目(判定で入口+段10 が開き、段12 と別枝は未開示のまま)
  const ITEM = {
    title: "氷の静謐",
    contents: [{
      id: "c1", isDisclosed: true, text: "<p>入口</p>",
      skills: [{ label: "〈社会〉", tn: 5 }],
      tiers: [
        { id: "t1", tn: 10, text: "<p>段10</p>", isDisclosed: true },
        { id: "t2", tn: 12, text: "<p>段12</p>", isDisclosed: false },
      ],
    }, {
      id: "c2", isDisclosed: false, text: "<p>別枝</p>", skills: [{ label: "〈電脳〉", tn: 21 }],
    }],
  };

  it("新規開示分だけを目標値｜本文で出し、未開示の残りを目標値形式で下に併記する", () => {
    const data = buildInfoDiscloseCardData(ITEM, "c1", { entryOpened: true, tierIds: ["t1"] });
    expect(data.title).toBe("氷の静謐");
    expect(data.mode).toBe("disclosed");
    expect(data.blocks).toEqual([
      { skillLabel: "〈社会〉", tnList: "", rows: [{ tn: 5, text: "<p>入口</p>" }, { tn: 10, text: "<p>段10</p>" }] },
      { skillLabel: "〈社会〉", tnList: "12", rows: [] },
      { skillLabel: "〈電脳〉", tnList: "21", rows: [] },
    ]);
  });

  it("以前に開示済みで今回開いていない行は出さない", () => {
    const data = buildInfoDiscloseCardData(ITEM, "c1", { entryOpened: false, tierIds: ["t1"] });
    expect(data.blocks[0].rows).toEqual([{ tn: 10, text: "<p>段10</p>" }]);
  });

  it("新規開示が無ければ null（カードを送らないゲート）", () => {
    expect(buildInfoDiscloseCardData(ITEM, "c1", { entryOpened: false, tierIds: [] })).toBeNull();
  });
});

describe("infoSkillGroups()（技能行ごとの表示単位・2026-08-15）", () => {
  const CONTENT = {
    id: "c1", isDisclosed: true, text: "本文",
    skills: [{ label: "〈社会：ストリート〉", tn: 8 }, { label: "〈電脳〉", tn: 10 }],
    tiers: [{ id: "t1", tn: 12, text: "段", isDisclosed: false }],
  };

  it("技能行ごとに 1 単位・目標値はその行の値＋段の値の昇順", () => {
    const groups = infoSkillGroups(CONTENT);
    expect(groups.map(g => g.skillLabel)).toEqual(["〈社会：ストリート〉", "〈電脳〉"]);
    expect(groups[0].values.map(v => v.tn)).toEqual([8, 12]);
    expect(groups[1].values.map(v => v.tn)).toEqual([10, 12]);
  });

  it("入口の値は content の開示状態と本文・段の値は段のそれを持つ", () => {
    const [group] = infoSkillGroups(CONTENT);
    expect(group.values[0]).toMatchObject({ tierId: null, isDisclosed: true, text: "本文" });
    expect(group.values[1]).toMatchObject({ tierId: "t1", isDisclosed: false, text: "段" });
  });

  it("技能を指定していない枝でも目標値だけは並ぶ", () => {
    const groups = infoSkillGroups({ id: "c", skills: [], tiers: [{ id: "t", tn: 9, text: "x" }] });
    expect(groups).toHaveLength(1);
    expect(groups[0].skillLabel).toBe("");
    expect(groups[0].values.map(v => v.tn)).toEqual([9]);
  });

  it("出す目標値が無ければ単位そのものを作らない", () => {
    expect(infoSkillGroups({ skills: [{ label: "〈医療〉", tn: null }] })).toEqual([]);
    expect(infoSkillGroups({})).toEqual([]);
  });
});

describe("infoTiers() / infoValueLabel()（情報の段・2026-08-12／表示は 2026-08-15）", () => {
  it("段が無ければ空配列（既存データは無改修で読める）", () => {
    expect(infoTiers({})).toEqual([]);
    expect(infoTiers({ tiers: null })).toEqual([]);
    expect(infoTiers(null)).toEqual([]);
  });

  it("目標値の昇順で返し、保存順は書き換えない", () => {
    const content = { tiers: [{ id: "b", tn: 16 }, { id: "a", tn: 12 }] };
    expect(infoTiers(content).map(t => t.id)).toEqual(["a", "b"]);
    expect(content.tiers.map(t => t.id)).toEqual(["b", "a"]);
  });

  it("目標値が未入力の段は末尾に置く（入力するまで足した位置に留まる）", () => {
    const tiers = [{ id: "x", tn: null }, { id: "y", tn: 12 }, { id: "z" }];
    expect(infoTiers({ tiers }).map(t => t.id)).toEqual(["y", "x", "z"]);
  });

  it("同じ目標値の段は保存順を保つ", () => {
    const tiers = [{ id: "p", tn: 12 }, { id: "q", tn: 12 }];
    expect(infoTiers({ tiers }).map(t => t.id)).toEqual(["p", "q"]);
  });

  it("段のラベルは目標値で示す（未入力は入力を促す表記）", () => {
    // 値そのものが名前(「さらに」等の上下関係を示す語を付けない・2026-08-15)
    expect(infoValueLabel(12)).toBe("目標値 12");
    expect(infoValueLabel(null)).toBe("（目標値未入力）");
    expect(infoValueLabel(undefined)).toBe("（目標値未入力）");
  });
});

describe("toggleInfoDisclosure()（開示の累積・2026-08-12）", () => {
  const content = () => ({
    id: "c1",
    isDisclosed: false,
    text: "入口",
    tiers: [
      { id: "t3", tn: 16, isDisclosed: false },
      { id: "t1", tn: 8,  isDisclosed: false },
      { id: "t2", tn: 12, isDisclosed: false },
    ],
  });
  const flags = c => [c.isDisclosed, ...c.tiers.map(t => t.isDisclosed)];

  it("入口本文の開示を切り替える（段は動かさない）", () => {
    expect(toggleInfoDisclosure(content(), null).isDisclosed).toBe(true);
  });

  it("入口本文を閉じると全ての段も閉じる（開示の累積を壊さない）", () => {
    const c = content();
    c.isDisclosed = true;
    c.tiers.forEach(t => { t.isDisclosed = true; });
    // 保存順は t3(16), t1(8), t2(12)
    expect(flags(toggleInfoDisclosure(c, null))).toEqual([false, false, false, false]);
  });

  it("段を開けると入口本文と下位段も開く", () => {
    // t2(12) を開ける → 入口 と t1(8) も開き、上位の t3(16) は閉じたまま
    expect(flags(toggleInfoDisclosure(content(), "t2"))).toEqual([true, false, true, true]);
  });

  it("段を閉じると上位段も閉じる", () => {
    const c = content();
    c.isDisclosed = true;
    c.tiers.forEach(t => { t.isDisclosed = true; });
    // t2(12) を閉じる → t3(16) も閉じ、下位の t1(8) と入口は開いたまま
    expect(flags(toggleInfoDisclosure(c, "t2"))).toEqual([true, false, true, false]);
  });

  it("複製を返し、元データも保存順も書き換えない", () => {
    const c = content();
    const next = toggleInfoDisclosure(c, "t2");
    expect(c.isDisclosed).toBe(false);
    expect(c.tiers[0].isDisclosed).toBe(false);
    expect(next.tiers.map(t => t.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("存在しない段の指定は何も変えない", () => {
    const c = content();
    expect(toggleInfoDisclosure(c, "gone")).toEqual(c);
  });
});

describe("infoSkillKeys() / resolveInfoSkillLabel() / withResolvedInfoSkillNames()（情報技能の表示解決・14-7／表記の一本化 2026-08-15）", () => {
  const NAMES = new Map([
    ["society_street", "社会：ストリート†"], ["society_police", "社会：警察"], ["medicine", "医療"],
  ]);

  it("技能行の識別キーは配列で読む（1行＝技能の集合）", () => {
    expect(infoSkillKeys({ identificationKeys: ["medicine", "society_street"] }))
      .toEqual(["medicine", "society_street"]);
    expect(infoSkillKeys({ identificationKeys: [] })).toEqual([]);
  });

  it("旧形式（identificationKey 単体）は1件の配列として読む", () => {
    expect(infoSkillKeys({ identificationKey: "medicine" })).toEqual(["medicine"]);
    expect(infoSkillKeys({ identificationKey: "" })).toEqual([]);
    expect(infoSkillKeys({})).toEqual([]);
  });

  it("配列が空でも旧キーには戻さない（外した結果を尊重する）", () => {
    expect(infoSkillKeys({ identificationKeys: [], identificationKey: "medicine" })).toEqual([]);
  });

  it("表記は登場判定と同じ規則（同じ小分類は一つに束ね・区切り無しで連結）", () => {
    expect(resolveInfoSkillLabel({ identificationKeys: ["society_street", "society_police"] }, NAMES))
      .toBe("〈社会：ストリート、警察〉");
    expect(resolveInfoSkillLabel({ identificationKeys: ["society_street", "medicine"] }, NAMES))
      .toBe("〈社会：ストリート〉〈医療〉");
  });

  it("辞典から消えたキーは表示から落とす（生キーは出さない）", () => {
    expect(resolveInfoSkillLabel({ identificationKeys: ["gone_key", "medicine"] }, NAMES))
      .toBe("〈医療〉");
  });

  it("解決できるキーが無いときだけ、旧い自由記述の name をフォールバックにする", () => {
    expect(resolveInfoSkillLabel({ identificationKeys: [], name: "〈コネ：赤羽〉" }, NAMES))
      .toBe("〈コネ：赤羽〉");
    expect(resolveInfoSkillLabel({ identificationKey: "gone_key", name: "旧名" }, NAMES)).toBe("旧名");
    expect(resolveInfoSkillLabel({ identificationKeys: ["medicine"], name: "旧名" }, NAMES))
      .toBe("〈医療〉");
    expect(resolveInfoSkillLabel({ identificationKey: "gone_key" }, NAMES)).toBe("");
  });

  it("withResolvedInfoSkillNames は複製に解決名を埋め、元データを書き換えない", () => {
    const item = { title: "T", contents: [{ skills: [{ identificationKeys: ["society_street"], tn: 10 }] }] };
    const resolved = withResolvedInfoSkillNames(item, NAMES);
    expect(resolved.contents[0].skills[0].label).toBe("〈社会：ストリート〉");
    expect(item.contents[0].skills[0].label).toBeUndefined();
  });
});

describe("TNX_HOOKS（14-2 追加分）", () => {
  it("アクト開始/終了・シーン開始のフック名を持つ（sceneEnd は13既存）", () => {
    expect(TNX_HOOKS.actStart).toBe("tnxActStart");
    expect(TNX_HOOKS.actEnd).toBe("tnxActEnd");
    expect(TNX_HOOKS.sceneStart).toBe("tnxSceneStart");
    expect(TNX_HOOKS.sceneEnd).toBe("tnxSceneEnd");
  });
});

describe("SCENE_AREA_OPTIONS（舞台エリアの選択肢）", () => {
  it("未設定＋5エリアを台本セレクトの順で持つ", () => {
    expect(SCENE_AREA_OPTIONS.map(o => o.value)).toEqual(["", "red", "yellow", "green", "white", "sanctuary"]);
  });
});

// ─── 14-8: 巡回シーン・イベントシーン ────────────────────────────────────────

// 台本: リサーチ＝[巡回1][イベントA][イベントB][巡回2][イベントC]、クライマックス＝[cl1]
const KIND_SCENES = {
  opening:  [{ id: "op1", name: "OP" }],
  research: [
    { id: "rot1", kind: "rotation", name: "リサーチ" },
    { id: "evA",  kind: "event", name: "イベントA", eventCondition: "情報Aを得た" },
    { id: "evB",  kind: "event", name: "イベントB" },
    { id: "rot2", kind: "rotation", name: "リサーチ" },
    { id: "evC",  kind: "event", name: "イベントC" },
  ],
  climax:   [{ id: "cl1", name: "クライマックス" }],
  ending:   [],
};

describe("SCENE_KIND_OPTIONS（シーン種別・14-8）", () => {
  it("通常/巡回/イベントの3種を持つ", () => {
    expect(SCENE_KIND_OPTIONS.map(o => o.value)).toEqual(["normal", "rotation", "event"]);
  });
});

describe("flattenScenes()", () => {
  it("フェイズ順→行順の一本の並びに均す", () => {
    expect(flattenScenes(KIND_SCENES).map(e => e.row.id))
      .toEqual(["op1", "rot1", "evA", "evB", "rot2", "evC", "cl1"]);
  });

  it("null は空配列", () => {
    expect(flattenScenes(null)).toEqual([]);
  });
});

describe("nextSceneTarget()（「次のシーンへ」の行き先・14-8）", () => {
  it("巡回シーンにいる間は同じ行（再入場＝シーンプレイヤーだけ次の人へ）", () => {
    expect(nextSceneTarget(KIND_SCENES, "rot1").row.id).toBe("rot1");
  });

  it("イベントシーンからは台本順の次へ", () => {
    expect(nextSceneTarget(KIND_SCENES, "evB").row.id).toBe("rot2");
  });

  it("実行済みのイベント行は読み飛ばす（消化しきった群でも送り先が残る）", () => {
    expect(nextSceneTarget(KIND_SCENES, "evA", ["evB"]).row.id).toBe("rot2");
  });

  it("未実行のイベント行では止まる（読み飛ばすのは実行済みだけ）", () => {
    expect(nextSceneTarget(KIND_SCENES, "evA", []).row.id).toBe("evB");
  });

  it("通常シーンからは台本順の次へ（オープニング→リサーチ先頭のイベント）", () => {
    expect(nextSceneTarget(KIND_SCENES, "op1").row.id).toBe("rot1");
  });

  it("末尾の行なら null", () => {
    expect(nextSceneTarget(KIND_SCENES, "cl1")).toBeNull();
  });
});

describe("canShowNextScene()（「次のシーンへ」を出すか・14-8）", () => {
  it("巡回シーンは常に出す", () => {
    expect(canShowNextScene(KIND_SCENES, "rot1")).toBe(true);
  });

  it("イベントシーンの次が未実行のイベントシーンなら出さない", () => {
    expect(canShowNextScene(KIND_SCENES, "evA")).toBe(false);
  });

  it("次のイベントが実行済みなら読み飛ばした先で判定して出す（2026-08-09 是正）", () => {
    expect(canShowNextScene(KIND_SCENES, "evA", ["evB"])).toBe(true);
  });

  it("イベントシーンの次が巡回シーンなら出す", () => {
    expect(canShowNextScene(KIND_SCENES, "evB")).toBe(true);
  });

  it("通常シーンの次がイベントシーンでも出す（オープニングから順送りで起動できる）", () => {
    expect(canShowNextScene(KIND_SCENES, "op1")).toBe(true);
  });

  it("末尾の行では出さない", () => {
    expect(canShowNextScene(KIND_SCENES, "cl1")).toBe(false);
  });
});

describe("rotationOrder()（巡回順＝ハンドアウトの並び順・14-8）", () => {
  it("ハンドアウトの並び順で対象ユーザーを並べる", () => {
    expect(rotationOrder([{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }]))
      .toEqual(["u1", "u2", "u3"]);
  });

  it("共通ハンドアウトと対象ユーザー未設定の行は順から外す", () => {
    const order = rotationOrder([
      { userId: "u1" },
      { userId: "u9", recommendedStyle: HANDOUT_STYLE_COMMON },
      { userId: "" },
      { userId: "u2" },
    ]);
    expect(order).toEqual(["u1", "u2"]);
  });

  it("同じユーザーは先に出た1件だけ", () => {
    expect(rotationOrder([{ userId: "u1" }, { userId: "u1" }])).toEqual(["u1"]);
  });
});

describe("resolveRotationDefault()（未消化の先頭・14-8）", () => {
  const ORDER = ["u1", "u2", "u3"];

  it("誰も務めていなければ先頭", () => {
    expect(resolveRotationDefault(ORDER, [])).toEqual({ userId: "u1", done: [] });
  });

  it("イベントシーンで務めた分だけ順番が飛ぶ", () => {
    expect(resolveRotationDefault(ORDER, ["u1"])).toEqual({ userId: "u2", done: ["u1"] });
  });

  it("順の途中が消化済みでも未消化の先頭を返す", () => {
    expect(resolveRotationDefault(ORDER, ["u2"])).toEqual({ userId: "u1", done: ["u2"] });
  });

  it("全員が務め終えたら記録をクリアして次の巡（先頭）へ", () => {
    expect(resolveRotationDefault(ORDER, ["u1", "u2", "u3"])).toEqual({ userId: "u1", done: [] });
  });

  it("巡回順が空なら空文字（回すものが無いので消化の記録には触れない）", () => {
    expect(resolveRotationDefault([], [])).toEqual({ userId: "", done: [] });
    expect(resolveRotationDefault([], ["u1"])).toEqual({ userId: "", done: ["u1"] });
  });
});

describe("eventSceneCandidates()（起動できるイベント・14-8）", () => {
  it("巡回シーンからは直後に続くイベント群（次の巡回行の手前まで）", () => {
    expect(eventSceneCandidates(KIND_SCENES, "rot1").map(e => e.row.id)).toEqual(["evA", "evB"]);
  });

  it("イベント行にいるときは現在地より前の未実行イベントが出る（群の末尾でも上が拾える）", () => {
    expect(eventSceneCandidates(KIND_SCENES, "evB").map(e => e.row.id)).toEqual(["evA"]);
  });

  it("末尾の巡回シーンにいても、それより上に残った未実行イベントを出す（2026-08-09 追加指示）", () => {
    expect(eventSceneCandidates(KIND_SCENES, "rot2", ["evB"]).map(e => e.row.id))
      .toEqual(["evA", "evC"]);
  });

  it("並びは台本順＝先頭がダイアログの初期選択（最も上にある未実行イベント）", () => {
    expect(eventSceneCandidates(KIND_SCENES, "rot2", [])[0].row.id).toBe("evA");
  });

  it("次の巡回シーンを越えた先のイベントは候補にしない（先の段階のため）", () => {
    expect(eventSceneCandidates(KIND_SCENES, "rot1").map(e => e.row.id)).toEqual(["evA", "evB"]);
  });

  it("実行済みのイベントは候補から外れる", () => {
    expect(eventSceneCandidates(KIND_SCENES, "rot1", ["evA"]).map(e => e.row.id)).toEqual(["evB"]);
  });

  it("同じフェイズの未実行イベントを台本順で並べる（次のフェイズは含めない）", () => {
    expect(eventSceneCandidates(KIND_SCENES, "rot2").map(e => e.row.id))
      .toEqual(["evA", "evB", "evC"]);
  });

  it("直後が通常シーンなら候補なし", () => {
    expect(eventSceneCandidates(KIND_SCENES, "op1")).toEqual([]);
  });

  it("台本にない現在シーンでは空", () => {
    expect(eventSceneCandidates(KIND_SCENES, "none")).toEqual([]);
  });
});

describe("areEventScenesDone()（「クライマックスへ」の表示条件・14-8）", () => {
  it("未実行のイベントが残っていれば false", () => {
    expect(areEventScenesDone(KIND_SCENES, ["evA"])).toBe(false);
  });

  it("リサーチのイベントが全て実行済みなら true", () => {
    expect(areEventScenesDone(KIND_SCENES, ["evA", "evB", "evC"])).toBe(true);
  });

  it("イベント行が1つも無ければ最初から true（巡回だけで進むシナリオ）", () => {
    expect(areEventScenesDone({ research: [{ id: "r1", kind: "rotation" }] }, [])).toBe(true);
  });
});

describe("stageCandidateActorIds()（舞台候補を出すキャラクター・14-8）", () => {
  const TEAMS = [{ id: "t1", memberActorIds: ["a1", "a9"] }, { id: "t2", memberActorIds: ["a5"] }];

  it("シーンプレイヤーのキャストと、そのチームのメンバー", () => {
    expect(stageCandidateActorIds({ scenePlayerActorId: "a1", teams: TEAMS })).toEqual(["a1", "a9"]);
  });

  it("登場キャラクターの事前設定も種に含める", () => {
    expect(stageCandidateActorIds({
      scenePlayerActorId: "a1", appearanceActors: [{ actorId: "a5" }], teams: TEAMS,
    })).toEqual(["a1", "a5", "a9"]);
  });

  it("種と無関係のチームは広がらない", () => {
    expect(stageCandidateActorIds({ scenePlayerActorId: "a3", teams: TEAMS })).toEqual(["a3"]);
  });

  it("何も無ければ空", () => {
    expect(stageCandidateActorIds({})).toEqual([]);
  });
});

describe("sceneSequenceNumbers()（台本順の自動採番・14-8）", () => {
  it("フェイズ順→行順の通し番号を行 id ごとに返す", () => {
    expect(sceneSequenceNumbers(KIND_SCENES)).toEqual({
      op1: 1, rot1: 2, evA: 3, evB: 4, rot2: 5, evC: 6, cl1: 7,
    });
  });

  it("台本が空・null でも落ちない", () => {
    expect(sceneSequenceNumbers(null)).toEqual({});
    expect(sceneSequenceNumbers({ opening: [], research: [] })).toEqual({});
  });
});

describe("buildSceneSwitchCardData()（上演中のシーン番号・14-8）", () => {
  it("number を渡すと台本の行番号ではなくその値を SCENE n に出す", () => {
    expect(buildSceneSwitchCardData({ number: 2, name: "リサーチ" }, { number: 7 }).sceneLabel)
      .toBe("SCENE 7");
  });

  it("number 未指定のときは従来どおり行の number（無ければ ??）", () => {
    expect(buildSceneSwitchCardData({ number: 2, name: "x" }).sceneLabel).toBe("SCENE 2");
    expect(buildSceneSwitchCardData({ name: "x" }).sceneLabel).toBe("SCENE ??");
  });
});

describe("rotationOrder()（キャスト未割当を落とす・2026-08-10 是正）", () => {
  it("キャストを割り当てていないユーザーは巡回順から外す（アクトに参加していない）", () => {
    const handouts = [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }];
    expect(rotationOrder(handouts, { hasCast: id => id !== "u2" })).toEqual(["u1", "u3"]);
  });

  it("GM かどうかは見ない（RL がキャストとハンドアウトを持てば巡回の参加者）", () => {
    expect(rotationOrder([{ userId: "gm" }, { userId: "u1" }], { hasCast: () => true }))
      .toEqual(["gm", "u1"]);
  });

  it("判定を渡さなければ従来どおり全員通す", () => {
    expect(rotationOrder([{ userId: "u1" }, { userId: "u2" }])).toEqual(["u1", "u2"]);
  });
});

describe("recordScenePlayerDone()（消化の記帳はリサーチ内だけ・2026-08-10 是正）", () => {
  const ORDER = ["u1", "u2", "u3"];

  it("リサーチのシーンだけ記帳する", () => {
    expect(recordScenePlayerDone([], { phase: "research", kind: "rotation", order: ORDER, userId: "u1" }))
      .toEqual(["u1"]);
  });

  it("オープニング・クライマックス・エンディングは記帳しない（記録に触れない）", () => {
    for (const phase of ["opening", "climax", "ending"]) {
      expect(recordScenePlayerDone(["u1"], { phase, kind: "normal", order: ORDER, userId: "u2" }))
        .toEqual(["u1"]);
    }
  });

  it("オープニングの記録がリサーチへ持ち込まれない（記録が空のまま始まる）", () => {
    let done = [];
    done = recordScenePlayerDone(done, { phase: "opening", kind: "normal", order: ORDER, userId: "u1" });
    done = recordScenePlayerDone(done, { phase: "opening", kind: "normal", order: ORDER, userId: "u2" });
    expect(done).toEqual([]);
    done = recordScenePlayerDone(done, { phase: "research", kind: "rotation", order: ORDER, userId: "u1" });
    expect(done).toEqual(["u1"]);
  });

  it("イベントシーンで務めた分も数える（順番が飛ぶ根拠）", () => {
    expect(recordScenePlayerDone([], { phase: "research", kind: "event", order: ORDER, userId: "u1" }))
      .toEqual(["u1"]);
  });

  it("巡回シーンに入る時点で全員消化なら、記録をクリアして次の巡へ", () => {
    expect(recordScenePlayerDone(["u1", "u2", "u3"],
      { phase: "research", kind: "rotation", order: ORDER, userId: "u1" })).toEqual(["u1"]);
  });

  it("ルーラーシーン（務め手なし）は記帳しない", () => {
    expect(recordScenePlayerDone(["u1"], { phase: "research", kind: "normal", order: ORDER, userId: "" }))
      .toEqual(["u1"]);
  });

  it("同じ人を二重に積まない・元の配列を書き換えない", () => {
    const done = ["u1"];
    expect(recordScenePlayerDone(done, { phase: "research", kind: "normal", order: ORDER, userId: "u1" }))
      .toEqual(["u1"]);
    expect(done).toEqual(["u1"]);
  });
});

describe("SCENE_PLAYER_RULER（ルーラーシーンの特殊値・2026-08-10）", () => {
  it("ユーザー id と衝突しない @ 前置の特殊値", () => {
    expect(SCENE_PLAYER_RULER).toBe("@ruler");
  });
});

describe("handoutPlayerLabel()（シーンプレイヤー欄のラベル・2026-08-10 指定）", () => {
  it("「①スタイル名（キャスト名）」", () => {
    expect(handoutPlayerLabel({ recommendedStyle: "kabuto" },
      { number: 1, styleName: "カブト", castName: "御堂" })).toBe("①カブト（御堂）");
  });

  it("キャスト未設定なら「①スタイル名」だけ", () => {
    expect(handoutPlayerLabel({ recommendedStyle: "kabuto" },
      { number: 2, styleName: "カブト" })).toBe("②カブト");
  });

  it("自由記述ハンドアウトは自由入力のタイトルを使う（番号もスタイルも持たない）", () => {
    expect(handoutPlayerLabel({ recommendedStyle: HANDOUT_STYLE_FREE, title: "黒幕" },
      { number: 0, castName: "御堂" })).toBe("黒幕（御堂）");
  });

  it("スタイル未選択は番号だけ", () => {
    expect(handoutPlayerLabel({ recommendedStyle: "" }, { number: 3 })).toBe("③");
  });

  it("何も無ければ「ハンドアウト」", () => {
    expect(handoutPlayerLabel({})).toBe("ハンドアウト");
  });
});

describe("resolveScenePlayerRef()（シーンプレイヤー指定の解決・2026-08-10）", () => {
  const HANDOUTS = [{ id: "h1", userId: "u1" }, { id: "h2", userId: "" }];

  it("ハンドアウト参照から担当ユーザーを解く", () => {
    expect(resolveScenePlayerRef({ playerHandoutId: "h1" }, HANDOUTS))
      .toEqual({ ruler: false, handoutId: "h1", userId: "u1" });
  });

  it("対象ユーザー未設定のハンドアウトは userId が空（呼び元が警告する）", () => {
    expect(resolveScenePlayerRef({ playerHandoutId: "h2" }, HANDOUTS))
      .toEqual({ ruler: false, handoutId: "h2", userId: "" });
  });

  it("参照切れのハンドアウトも userId が空", () => {
    expect(resolveScenePlayerRef({ playerHandoutId: "none" }, HANDOUTS).userId).toBe("");
  });

  it("@ruler はルーラーシーン", () => {
    expect(resolveScenePlayerRef({ playerHandoutId: SCENE_PLAYER_RULER }, HANDOUTS))
      .toEqual({ ruler: true, handoutId: "", userId: "" });
  });

  it("旧データ: ユーザー参照はそのまま担当として読む", () => {
    expect(resolveScenePlayerRef({ playerUserId: "u9" }, HANDOUTS))
      .toEqual({ ruler: false, handoutId: "", userId: "u9" });
  });

  it("旧データ: ユーザー欄の @ruler・isMasterScene はルーラーシーン", () => {
    expect(resolveScenePlayerRef({ playerUserId: SCENE_PLAYER_RULER }, HANDOUTS).ruler).toBe(true);
    expect(resolveScenePlayerRef({ isMasterScene: true }, HANDOUTS).ruler).toBe(true);
  });

  it("ハンドアウト参照が旧データより優先される", () => {
    expect(resolveScenePlayerRef({ playerHandoutId: "h1", playerUserId: "u9" }, HANDOUTS).userId)
      .toBe("u1");
  });

  it("未指定・null は担当なし", () => {
    expect(resolveScenePlayerRef({}, HANDOUTS)).toEqual({ ruler: false, handoutId: "", userId: "" });
    expect(resolveScenePlayerRef(null)).toEqual({ ruler: false, handoutId: "", userId: "" });
  });
});

describe("discloseInfoByAchievement()（判定成功→自動開示・2026-08-16 裁定＝抜いた目標値まで一括）", () => {
  const content = (over = {}) => ({
    id: "c1", text: "入口本文", isDisclosed: false,
    tiers: [
      { id: "t1", tn: 10, text: "段10", isDisclosed: false },
      { id: "t2", tn: 12, text: "段12", isDisclosed: false },
    ],
    ...over,
  });

  it("達成値以下の目標値を持つ入口・段を全て開く（一括開示）", () => {
    const out = discloseInfoByAchievement(content(), { achievement: 11, entryTn: 8 });
    expect(out.isDisclosed).toBe(true);
    expect(out.tiers.map(t => t.isDisclosed)).toEqual([true, false]);
  });

  it("入口の目標値に届かなければ入口は開かない（段も届かなければ何も開かない）", () => {
    const out = discloseInfoByAchievement(content(), { achievement: 7, entryTn: 8 });
    expect(out.isDisclosed).toBe(false);
    expect(out.tiers.every(t => !t.isDisclosed)).toBe(true);
  });

  it("段が開けば入口も開く（既存の累積規約を維持）", () => {
    const out = discloseInfoByAchievement(content(), { achievement: 10, entryTn: 15 });
    expect(out.tiers.map(t => t.isDisclosed)).toEqual([true, false]);
    expect(out.isDisclosed).toBe(true);
  });

  it("開くだけで閉じない（開示済みは達成値が低くても維持）", () => {
    const opened = content({ isDisclosed: true, tiers: [
      { id: "t1", tn: 10, text: "段10", isDisclosed: true },
      { id: "t2", tn: 12, text: "段12", isDisclosed: true },
    ] });
    const out = discloseInfoByAchievement(opened, { achievement: 3, entryTn: 8 });
    expect(out.isDisclosed).toBe(true);
    expect(out.tiers.every(t => t.isDisclosed)).toBe(true);
  });

  it("目標値の無い段・入口目標値なしは開かない／元データを書き換えない（イミュータブル）", () => {
    const src = content({ tiers: [{ id: "t1", tn: null, text: "x", isDisclosed: false }] });
    const out = discloseInfoByAchievement(src, { achievement: 99, entryTn: null });
    expect(out.tiers[0].isDisclosed).toBe(false);
    expect(out.isDisclosed).toBe(false);
    expect(src.isDisclosed).toBe(false);
  });
});

describe("infoDesignationRows()（判定起動の指定行＝統合応答ダイアログの入力・2026-08-26）", () => {
  const names = new Map([
    ["society_st", "社会：ストリート"], ["society_pol", "社会：警察"], ["hacking", "ハッキング"],
  ]);
  const item = {
    id: "i1", title: "氷の静謐", isPublic: true,
    contents: [
      { id: "c1", skills: [
          { identificationKeys: ["society_st", "society_pol"], tn: 8 },
          { identificationKeys: ["hacking"], tn: 12 },
        ], tiers: [] },
      { id: "c2", skills: [{ identificationKeys: [], name: "自由記述技能", tn: 10 }], tiers: [] },
      { id: "c3", skills: [], tiers: [{ id: "t", tn: 15, text: "x" }] },
    ],
  };

  it("技能行ごとに指定の行（キー集合＋目標値＋束ね表記）を組む", () => {
    expect(infoDesignationRows(item, names)).toEqual([
      { contentId: "c1", keys: ["society_st", "society_pol"], tn: 8, label: "〈社会：ストリート、警察〉" },
      { contentId: "c1", keys: ["hacking"], tn: 12, label: "〈ハッキング〉" },
      { contentId: "c2", keys: [], tn: 10, label: "自由記述技能" },
    ]);
  });

  it("技能行の無い枝は列挙しない（挑み先が無い）", () => {
    expect(infoDesignationRows(item, names).some(r => r.contentId === "c3")).toBe(false);
  });

  it("キーも表示名も無い行・contents 無しは安全に空", () => {
    expect(infoDesignationRows({ contents: [{ id: "c", skills: [{ tn: 5 }] }] }, names)).toEqual([]);
    expect(infoDesignationRows(null, names)).toEqual([]);
  });
});

describe("hudInfoItems()（HUD の情報項目一覧＝公開状態3段階の出し分け・2026-08-16 裁定）", () => {
  const items = [
    { id: "a", title: "公開済み", isPublic: true, contents: [] },
    { id: "b", title: "隠し情報", isPublic: false, contents: [] },
  ];

  it("PL: 非公開は「非公開の情報」にマスクされ、公開は項目名が見える", () => {
    expect(hudInfoItems(items, { isGM: false })).toEqual([
      { id: "a", title: "公開済み", isPublic: true, masked: false },
      { id: "b", title: "非公開の情報", isPublic: false, masked: true },
    ]);
  });

  it("RL: 非公開も項目名が見える（マスクなし・isPublic で印を出す）", () => {
    expect(hudInfoItems(items, { isGM: true })).toEqual([
      { id: "a", title: "公開済み", isPublic: true, masked: false },
      { id: "b", title: "隠し情報", isPublic: false, masked: false },
    ]);
  });

  it("題の無い項目は既定名「情報」（パネルと同じ）", () => {
    expect(hudInfoItems([{ id: "x", isPublic: true }], { isGM: false })[0].title).toBe("情報");
  });
});

describe("hudInfoTnChips()（HUD 情報プレートの目標値チップ・2026-08-17）", () => {
  it("項目内の全目標値を昇順で列挙し、開示済みフラグを付ける", () => {
    const item = { contents: [{
      id: "c1", isDisclosed: true, text: "本文",
      skills: [{ label: "〈社会〉", tn: 5 }],
      tiers: [
        { id: "t1", tn: 12, text: "x", isDisclosed: false },
        { id: "t2", tn: 10, text: "y", isDisclosed: true },
      ],
    }] };
    expect(hudInfoTnChips(item)).toEqual([
      { tn: 5, disclosed: true },
      { tn: 10, disclosed: true },
      { tn: 12, disclosed: false },
    ]);
  });

  it("技能行をまたぐ同じ目標値は1つに畳む（開示はどこかで開いていれば開示扱い）", () => {
    const item = { contents: [{
      id: "c1", isDisclosed: false, text: "本文",
      skills: [{ label: "〈A〉", tn: 8 }, { label: "〈B〉", tn: 8 }],
      tiers: [{ id: "t1", tn: 10, text: "x", isDisclosed: true }],
    }] };
    expect(hudInfoTnChips(item)).toEqual([
      { tn: 8, disclosed: false },
      { tn: 10, disclosed: true },
    ]);
  });

  it("目標値の無い値・空項目は安全に空", () => {
    expect(hudInfoTnChips({ contents: [{ id: "c", skills: [], tiers: [{ id: "t", text: "x" }] }] })).toEqual([]);
    expect(hudInfoTnChips(null)).toEqual([]);
  });
});

describe("舞台裏の列と行動不可（15-5）", () => {
  const a = (id, name, extra = {}) => ({ id, name, appearing: false, ...extra });

  it("行動不可のキャラクターには手番が回らない（列から外れる）", () => {
    const queue = backstageQueue([a("x", "あ"), a("y", "い", { incapable: true })]);
    expect(queue.map(q => q.id)).toEqual(["x"]);
  });

  it("RL が手動で足していても行動不可なら外れる（何もできないため）", () => {
    const queue = backstageQueue([a("y", "い", { incapable: true, appearing: true })], ["y"]);
    expect(queue).toEqual([]);
  });
});

describe("recordSceneAppearance()（登場シーン数の記帳＝経験点自動入力の元・2026-08-30 承認）", () => {
  it("初回の登場で 1 を数え、シーン内重複防止に載る", () => {
    const next = recordSceneAppearance({ appearanceCounts: {}, appearedThisScene: [], actorId: "a1" });
    expect(next.appearanceCounts).toEqual({ a1: 1 });
    expect(next.appearedThisScene).toEqual(["a1"]);
  });

  it("同一シーン内の再登場（退場→再登場）は数えない", () => {
    const st = { appearanceCounts: { a1: 1 }, appearedThisScene: ["a1"], actorId: "a1" };
    expect(recordSceneAppearance(st)).toBeNull();
  });

  it("シーンが変わって（重複防止クリア後）登場すれば累積する", () => {
    const next = recordSceneAppearance({ appearanceCounts: { a1: 2 }, appearedThisScene: [], actorId: "a1" });
    expect(next.appearanceCounts).toEqual({ a1: 3 });
    expect(next.appearedThisScene).toEqual(["a1"]);
  });

  it("別キャストは別に数える・元のオブジェクトは変更しない", () => {
    const counts = { a1: 1 };
    const appeared = ["a1"];
    const next = recordSceneAppearance({ appearanceCounts: counts, appearedThisScene: appeared, actorId: "a2" });
    expect(next.appearanceCounts).toEqual({ a1: 1, a2: 1 });
    expect(counts).toEqual({ a1: 1 });
    expect(appeared).toEqual(["a1"]);
  });

  it("id 無し・壊れたカウントは頑健に扱う", () => {
    expect(recordSceneAppearance({ actorId: "" })).toBeNull();
    expect(recordSceneAppearance({})).toBeNull();
    const next = recordSceneAppearance({ appearanceCounts: { a1: "x" }, appearedThisScene: [], actorId: "a1" });
    expect(next.appearanceCounts.a1).toBe(1);
  });
});
