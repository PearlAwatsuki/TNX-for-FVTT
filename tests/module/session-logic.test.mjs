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
  buildSceneSwitchMessage,
  buildTrailerMessage,
  buildHandoutMessage,
  buildInfoMessage,
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
    });
  });

  it("新フィールドが保存済みならそのまま保つ", () => {
    const row = normalizeSceneRow({ id: "s2", area: "white", stage: "scene:abc", playerUserId: "u1" });
    expect(row.area).toBe("white");
    expect(row.stage).toBe("scene:abc");
    expect(row.playerUserId).toBe("u1");
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

describe("buildSceneSwitchMessage()（シーン切替の見出しチャット・14-3）", () => {
  it("番号・名前・シーンプレイヤー・切替メッセージを既存書式で組む", () => {
    const html = buildSceneSwitchMessage(
      { number: 3, name: "追跡", isMasterScene: false, switchMessage: "▼ RESEARCH" },
      { playerLabel: "アキラ" },
    );
    expect(html).toBe("<h2>SCENE 3 : 追跡</h2><p><strong>シーンプレイヤー:</strong> アキラ</p><hr>▼ RESEARCH");
  });

  it("マスターシーンは「マスターシーン」表示（プレイヤーラベルより優先）", () => {
    const html = buildSceneSwitchMessage({ number: 1, name: "OP", isMasterScene: true }, { playerLabel: "誰か" });
    expect(html).toContain("<p>マスターシーン</p>");
    expect(html).not.toContain("シーンプレイヤー");
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

describe("buildHandoutMessage()（ハンドアウト送信・14-3）", () => {
  it("推奨欄・PS を条件付きで含める（既存書式）", () => {
    const html = buildHandoutMessage({
      title: "HO1", pcName: "PC1", connections: "父", recommendedSuit: "♠",
      recommendedStyle: "カブキ", content: "本文", ps: "目的",
    });
    expect(html).toBe(
      "<h3>HO1 (PC1)</h3>"
      + "<p><strong>コネ:</strong> 父</p>"
      + "<p><strong>推奨スート:</strong> ♠</p>"
      + "<p><strong>推奨スタイル:</strong> カブキ</p>"
      + "<hr>本文<hr><h4>PS</h4><p>目的</p>",
    );
  });

  it("空欄は行ごと省く", () => {
    expect(buildHandoutMessage({ title: "HO2", pcName: "PC2", content: "C" }))
      .toBe("<h3>HO2 (PC2)</h3><hr>C");
  });
});

describe("buildInfoMessage()（情報項目送信・14-3）", () => {
  const ITEM = {
    title: "黒幕の素性",
    contents: [
      { isDisclosed: false, text: "正体", skills: [{ name: "〈社会〉", tn: 12 }, { name: "〈コネ〉", tn: 12 }] },
      { isDisclosed: false, text: "裏付け", skills: [{ name: "〈捜査〉", tn: 15 }] },
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

  it("送れる中身が無ければ mode=null", () => {
    const { mode } = buildInfoMessage({ title: "空", contents: [{ isDisclosed: false, text: "", skills: [{ name: "", tn: null }] }] });
    expect(mode).toBeNull();
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
