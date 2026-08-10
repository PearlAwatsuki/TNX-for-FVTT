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
  teamHasAppearing,
  hasBackstage,
  backstageQueue,
  nextBackstageSpot,
  isBackstageFinished,
  findDuplicateKeys,
  matchTrumpCard,
  buildSceneSwitchMessage,
  buildTrailerMessage,
  buildHandoutMessage,
  buildInfoMessage,
  HANDOUT_STYLE_COMMON,
  HANDOUT_STYLE_FREE,
  circledNumber,
  handoutTitleSuffix,
  handoutDisplayTitle,
  handoutNumberOf,
  handoutStyleDisplay,
  infoSkillKeys,
  resolveInfoSkillNames,
  withResolvedInfoSkillNames,
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
      area: "", stage: "", playerUserId: "",
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

  it("actConnection(単一キー)は保存値を保つ・未設定は空", () => {
    expect(normalizeHandoutRow({ id: "h3", actConnection: "contact_father" }).actConnection).toBe("contact_father");
    expect(normalizeHandoutRow({ id: "h4" }).actConnection).toBe("");
  });

  it("旧配列 actConnections は先頭の文字列キーを actConnection へ読み替える({uuid} 形式は無視)", () => {
    const row = normalizeHandoutRow({
      id: "h5",
      actConnections: [{ uuid: "Compendium.x.y" }, "contact_father", "contact_boss"],
    });
    expect(row.actConnection).toBe("contact_father");
  });

  it("actConnection が明示されていれば旧配列より優先する(空文字も意図的な選択として保つ)", () => {
    expect(normalizeHandoutRow({ id: "h6", actConnection: "", actConnections: ["contact_x"] }).actConnection).toBe("");
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

  it("teamHasAppearing: 登場中メンバーが1人でもいれば true（チーム免除・後から加入の自動登場ゲート）", () => {
    const appearing = new Set(["a2"]);
    expect(teamHasAppearing(TEAMS, "t1", appearing)).toBe(true);
    expect(teamHasAppearing(TEAMS, "t2", appearing)).toBe(false);
    expect(teamHasAppearing(TEAMS, "zz", appearing)).toBe(false);
    expect(teamHasAppearing(null, "t1", appearing)).toBe(false);
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

describe("buildSceneSwitchMessage()（シーン切替の見出しチャット・14-3）", () => {
  it("番号・名前・シーンプレイヤー・切替メッセージを既存書式で組む", () => {
    const html = buildSceneSwitchMessage(
      { number: 3, name: "追跡", isMasterScene: false, switchMessage: "▼ RESEARCH" },
      { playerLabel: "アキラ" },
    );
    expect(html).toBe("<h2>SCENE 3 : 追跡</h2><p><strong>シーンプレイヤー:</strong> アキラ</p><hr>▼ RESEARCH");
  });

  it("ルーラーシーンは「ルーラーシーン」とだけ表示（シーンプレイヤーはいない・14-7）", () => {
    const html = buildSceneSwitchMessage({ number: 1, name: "OP" }, { playerLabel: "誰か", rulerScene: true });
    expect(html).toContain("<p>ルーラーシーン</p>");
    expect(html).not.toContain("シーンプレイヤー");
  });

  it("旧データの isMasterScene もルーラーシーンとして表示（読み替え）", () => {
    const html = buildSceneSwitchMessage({ number: 1, name: "OP", isMasterScene: true }, {});
    expect(html).toContain("<p>ルーラーシーン</p>");
  });

  it("番号なし=??・名前なし=無題のシーン・詳細/メッセージなしは見出しのみ", () => {
    expect(buildSceneSwitchMessage({}, {})).toBe("<h2>SCENE ?? : 無題のシーン</h2>");
  });
});

describe("buildTrailerMessage()（トレーラー送信・14-3）", () => {
  it("既存書式で組む", () => {
    expect(buildTrailerMessage("本文")).toBe("<h3>シナリオトレーラー</h3><hr>本文");
  });

  it("空は null（送信しない）", () => {
    expect(buildTrailerMessage("")).toBeNull();
    expect(buildTrailerMessage(null)).toBeNull();
  });
});

describe("buildHandoutMessage()（ハンドアウト送信・14-3／見出し=表示名・ユーザー参照化は 2026-08-09 是正）", () => {
  it("見出し(解決済み表示名)・コネ・スートラベル・スタイル・PS を条件付きで含める", () => {
    const html = buildHandoutMessage({
      recommendedSuit: "spade", recommendedStyle: "kabuki", content: "本文", ps: "目的",
    }, { title: "①カブキ用ハンドアウト", connectionName: "〈コネ：父〉", styleName: "カブキ" });
    expect(html).toBe(
      "<h3>①カブキ用ハンドアウト</h3>"
      + "<p><strong>コネ:</strong> 〈コネ：父〉</p>"
      + "<p><strong>推奨スート:</strong> スペード</p>"
      + "<p><strong>スタイル:</strong> カブキ</p>"
      + "<hr>本文<hr><h4>PS</h4><p>目的</p>",
    );
  });

  it("コネ表示名が無ければ旧自由テキスト connections をフォールバック表示する", () => {
    const html = buildHandoutMessage({ connections: "父", content: "C" }, { title: "HO1" });
    expect(html).toBe("<h3>HO1</h3><p><strong>コネ:</strong> 父</p><hr>C");
  });

  it("スートのキー以外(旧自由テキスト)はそのまま表示する", () => {
    const html = buildHandoutMessage({ recommendedSuit: "♠", content: "C" }, { title: "HO1" });
    expect(html).toContain("<p><strong>推奨スート:</strong> ♠</p>");
  });

  it("空欄は行ごと省き、見出し未指定は旧 title→既定値の順にフォールバックする", () => {
    expect(buildHandoutMessage({ title: "旧タイトル", content: "C" }))
      .toBe("<h3>旧タイトル</h3><hr>C");
    expect(buildHandoutMessage({ content: "C" })).toBe("<h3>ハンドアウト</h3><hr>C");
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

describe("buildInfoMessage()（情報項目送信・14-3）", () => {
  // 技能行は解決済み(withResolvedInfoSkillNames を通した後)の names を持つ
  const ITEM = {
    title: "黒幕の素性",
    contents: [
      { isDisclosed: false, text: "正体", skills: [{ names: ["〈社会〉"], tn: 12 }, { names: ["〈コネ〉"], tn: 12 }] },
      { isDisclosed: false, text: "裏付け", skills: [{ names: ["〈捜査〉"], tn: 15 }] },
    ],
  };

  it("開示済みが無ければ全内容の技能/目標値を送る（mode=targets・同TNは / 連結）", () => {
    const { html, mode } = buildInfoMessage(ITEM);
    expect(mode).toBe("targets");
    expect(html).toContain("<h3>黒幕の素性</h3>");
    expect(html).toContain("<strong>〈社会〉 / 〈コネ〉 &gt; 12</strong>");
    expect(html).toContain("<hr>");
    expect(html).toContain("正体");
  });

  it("開示済みがあればその内容だけを送る（mode=disclosed）", () => {
    const item = { ...ITEM, contents: [{ ...ITEM.contents[0], isDisclosed: true }, ITEM.contents[1]] };
    const { html, mode } = buildInfoMessage(item);
    expect(mode).toBe("disclosed");
    expect(html).toContain("正体");
    expect(html).not.toContain("裏付け");
  });

  it("1行に複数の技能があれば、その行の目標値でまとめて連結される", () => {
    const { html } = buildInfoMessage({
      title: "T",
      contents: [{ isDisclosed: false, text: "", skills: [{ names: ["〈医療〉", "〈射撃〉"], tn: 12 }] }],
    });
    expect(html).toContain("<strong>〈医療〉 / 〈射撃〉 &gt; 12</strong>");
  });

  it("送れる中身が無ければ mode=null", () => {
    const { mode } = buildInfoMessage({ title: "空", contents: [{ isDisclosed: false, text: "", skills: [{ names: [], tn: null }] }] });
    expect(mode).toBeNull();
  });
});

describe("infoSkillKeys() / resolveInfoSkillNames() / withResolvedInfoSkillNames()（情報技能の表示解決・14-7）", () => {
  const NAMES = new Map([["society:street", "社会：ストリート†"], ["medicine", "医療"]]);

  it("技能行の識別キーは配列で読む（1行＝技能の集合）", () => {
    expect(infoSkillKeys({ identificationKeys: ["medicine", "society:street"] }))
      .toEqual(["medicine", "society:street"]);
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

  it("識別キーは辞典逆引きの現在名を〈〉囲い・識別マーク省去で返す", () => {
    expect(resolveInfoSkillNames({ identificationKeys: ["society:street", "medicine"] }, NAMES))
      .toEqual(["〈社会：ストリート〉", "〈医療〉"]);
  });

  it("辞典から消えたキーは表示から落とす（生キーは出さない）", () => {
    expect(resolveInfoSkillNames({ identificationKeys: ["gone:key", "medicine"] }, NAMES))
      .toEqual(["〈医療〉"]);
  });

  it("解決できるキーが無いときだけ、旧い自由記述の name をフォールバックにする", () => {
    expect(resolveInfoSkillNames({ identificationKeys: [], name: "〈コネ：赤羽〉" }, NAMES))
      .toEqual(["〈コネ：赤羽〉"]);
    expect(resolveInfoSkillNames({ identificationKey: "gone:key", name: "旧名" }, NAMES)).toEqual(["旧名"]);
    expect(resolveInfoSkillNames({ identificationKeys: ["medicine"], name: "旧名" }, NAMES))
      .toEqual(["〈医療〉"]);
    expect(resolveInfoSkillNames({ identificationKey: "gone:key" }, NAMES)).toEqual([]);
  });

  it("withResolvedInfoSkillNames は複製に解決名を埋め、元データを書き換えない", () => {
    const item = { title: "T", contents: [{ skills: [{ identificationKeys: ["society:street"], tn: 10 }] }] };
    const resolved = withResolvedInfoSkillNames(item, NAMES);
    expect(resolved.contents[0].skills[0].names).toEqual(["〈社会：ストリート〉"]);
    expect(item.contents[0].skills[0].names).toBeUndefined();
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

describe("buildSceneSwitchMessage()（上演中のシーン番号・14-8）", () => {
  it("number を渡すと台本の行番号ではなくその値を SCENE n に出す", () => {
    const html = buildSceneSwitchMessage({ number: 2, name: "リサーチ" }, { number: 7 });
    expect(html).toContain("SCENE 7 : リサーチ");
  });

  it("number 未指定のときは従来どおり行の number（無ければ ??）", () => {
    expect(buildSceneSwitchMessage({ number: 2, name: "x" })).toContain("SCENE 2 : x");
    expect(buildSceneSwitchMessage({ name: "x" })).toContain("SCENE ?? : x");
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
