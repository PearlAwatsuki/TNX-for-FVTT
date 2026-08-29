/**
 * @fileoverview 登場判定フロー(フェーズ14-5・正本 Appearance_Check.md)。
 *
 * 起動＝シナリオコントロールパネルの「登場判定」ボタン(2026-08-07 ユーザー裁定)。TN は現在
 * シーンのエリア(セキュリティ・ランク)から自動供給・手入力なし(データ駆動)。危険値ペナルティは
 * **達成値に加算**(2026-08-07 裁定・グリーン×1/ホワイト×2)。サンクチュアリは危険値ペナルティ
 * 装備の携帯で登場不可。ゴースト登場は判定前ダイアログの選択肢(2026-08-07 裁定)。
 *
 * 判定の起動は唯一の起動関数 `_activateItemCheck` に集約(extraOpen で TN・危険値行・完了継続を
 * 注入)。成功の帰結は完了継続 `appearance`(tnx-check-flow の CONTINUATIONS)が適用する。
 * 使用技能の既定候補は社会/コネ分類だが、**他の技能も選択できる**(可否の裁定は卓・システムは
 * 制限しない)。失敗しても登場しないだけで再試行は自由(手札入れ替えとしての登場判定)。
 *
 * **判定そのものはブロックしない**(2026-08-15 ユーザー裁定): どの参加者にも平等に「判定を
 * 失敗する権利」がある(それによって手札を入れ替えていく)。「登場：不可」やサンクチュアリの
 * 危険値装備携帯でも判定は行え、結果が必ず失敗になる(ctx.forcedFailure)。
 */

import { appearanceCheckParams, hasNegativeDangerOutfit, isAppearanceSkillKey } from "./appearance-logic.mjs";
import { hasIncapable } from "./time-boundary-logic.mjs";
import { loadSkillClassByKey } from "./skill-dictionary.mjs";
import { standInMatchesKey } from "./designation-response-logic.mjs";
import { getSessionState, getCurrentSceneAppearance } from "./session-state.mjs";
import { isAppearing, setAppearing, setGhost } from "./appearance-state.mjs";
import { SCENE_AREA_OPTIONS } from "./session-logic.mjs";
import { formatSkillName } from "./identification.mjs";

const { DialogV2 } = foundry.applications.api;

/** パネルの「登場判定」ボタンから起動する。 */
export async function startAppearanceCheck() {
    const st = getSessionState();
    if (!st.actStarted) return void ui.notifications.warn("アクトが開始されていません。");
    const actor = game.user.character;
    if (!actor) return void ui.notifications.warn("担当キャラクターが設定されていません。");
    if (isAppearing(actor)) return void ui.notifications.info("既にシーンに登場しています。");

    // シーンの登場設定は行＋実行時の上書き(14-8 シーン開始ダイアログ)の合成を通して読む。
    // 巡回シーンや「未設定」の行では、その場で決めたエリア・目標値・指定技能がここに乗る
    const scene = getCurrentSceneAppearance();
    const params = appearanceCheckParams({
        area:       scene.area,
        mode:       scene.mode,
        fixedValue: scene.fixedValue,
        appearanceModifier: actor.system.appearanceModifier ?? 0,
        hasNegativeDangerItem: hasNegativeDangerOutfit(
            actor.items.map(i => ({ type: i.type, system: i.system }))),
        // 行動不可(仮死/昏睡の治療後2シーン)は登場判定が自動失敗になる(15-5)
        incapable: hasIncapable(actor.effects?.contents ?? []),
    });
    // 強制失敗の理由の表示文字列(結果カードの成否バナーに出す)。判定は通常どおり走る
    const FORCED_FAILURE_LABELS = {
        none:      "登場：不可",
        sanctuary: "サンクチュアリ・危険値装備",
        incapable: "行動不可",
    };
    const forcedFailure = params.forcedFailure ? FORCED_FAILURE_LABELS[params.forcedFailure] : null;

    const choice = await promptAppearanceOptions(actor, scene.skills);
    if (!choice) return;
    const skill = actor.items.get(choice.skillId);
    if (!skill) return;

    const areaLabel = SCENE_AREA_OPTIONS.find(o => o.value === scene.area && o.value !== "")?.label ?? "";
    const { TnxCharacterSheetBase } = await import("../actor/tnx-character-sheet-base.mjs");
    await TnxCharacterSheetBase._activateItemCheck(actor, skill, {
        targetValue: params.targetValue,
        // areaLabel は専用チャットカードの表示用(未設定は ""=行を出さない・2026-08-16)
        appearance: { actorId: actor.id, ghost: choice.ghost, areaLabel },
        ...(forcedFailure ? { forcedFailure } : {}),
        ...(params.modifier !== 0
            ? { extraCheckBonuses: [{ formula: String(params.modifier), label: `危険値（${areaLabel}）` }] }
            : {}),
    });
}

/**
 * 使用技能とゴースト登場を選ぶ。候補の並び: シーン指定(あれば先頭・14-7)→社会/コネ(既定)→
 * その他。指定は候補の提示であって制限ではない(他の技能も選択できる)。
 * @param {Actor} actor
 * @param {Array<string>} [sceneSkillKeys] シーン行の指定技能(識別キー)
 * @returns {Promise<?{skillId: string, ghost: boolean}>}
 */
async function promptAppearanceOptions(actor, sceneSkillKeys = []) {
    const skills = actor.items.filter(i => i.type === "generalSkill");
    const sceneKeys = new Set(sceneSkillKeys ?? []);

    // スタイル技能の合流(2026-08-26 裁定): ①指定充足宣言(登場判定)を持つもの ②代用技能で
    // 代用元が該当するもの、を正規の候補としてグループへ並べる。登場判定は「指定は候補の
    // 提示であって制限ではない」(2026-08-07 裁定)のため、ダイアログは従来の全技能プルダウン
    // のまま=候補グループへの合流の形で効かせる(制限型の応答ダイアログには載せない)
    const classByKey = await loadSkillClassByKey();
    const styleScene = [];
    const stylePrimary = [];
    for (const item of actor.items.filter(i => i.type === "styleSkill")) {
        const sys = item.system;
        const subTargets = sys.isSubstitute === true ? (sys.substituteTarget ?? []).filter(Boolean) : [];
        const standIns = (sys.designationStandIn ?? [])
            .filter(d => (d?.kinds ?? []).includes("appearance"));
        const inScene = subTargets.some(t => sceneKeys.has(t))
            || standIns.some(d => [...sceneKeys].some(k => standInMatchesKey(d?.condition ?? "", k, classByKey)));
        if (inScene) { styleScene.push(item); continue; }
        // シーン指定に当たらなくても、社会として扱える宣言・社会/コネの代用元を持つなら既定候補
        if (standIns.length > 0 || subTargets.some(t => isAppearanceSkillKey(t))) stylePrimary.push(item);
    }

    if (!skills.length && !styleScene.length && !stylePrimary.length) {
        ui.notifications.warn("一般技能を持っていないため登場判定を行えません。");
        return null;
    }
    const esc = foundry.utils.escapeHTML;
    const toOptions = (list) => list
        .map(i => `<option value="${i.id}">${esc(formatSkillName(i.name))}</option>`)
        .join("");
    const scene   = [...skills.filter(i => sceneKeys.has(i.system.identificationKey)), ...styleScene];
    const rest    = skills.filter(i => !sceneKeys.has(i.system.identificationKey));
    const primary = [...rest.filter(i => isAppearanceSkillKey(i.system.identificationKey)), ...stylePrimary];
    const others  = rest.filter(i => !isAppearanceSkillKey(i.system.identificationKey));
    const groups = [
        scene.length   ? `<optgroup label="シーン指定">${toOptions(scene)}</optgroup>` : "",
        primary.length ? `<optgroup label="社会・コネ">${toOptions(primary)}</optgroup>` : "",
        others.length  ? `<optgroup label="その他">${toOptions(others)}</optgroup>` : "",
    ].join("");

    return DialogV2.wait({
        window: { title: "登場判定" },
        classes: ["tokyo-nova", "tnx-dialog"],
        position: { width: 420 },
        content: `
            <div class="form-group">
                <label>使用技能</label>
                <div class="form-fields"><select name="skillId">${groups}</select></div>
            </div>
            <div class="form-group">
                <label>ゴーストとして登場する</label>
                <div class="form-fields"><input type="checkbox" name="ghost" /></div>
            </div>`,
        buttons: [
            {
                action: "ok", icon: "fas fa-check", label: "判定へ", default: true,
                callback: (_event, _button, dialog) => ({
                    skillId: dialog.element.querySelector('[name="skillId"]')?.value ?? "",
                    ghost:   dialog.element.querySelector('[name="ghost"]')?.checked === true,
                }),
            },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => null },
        ],
        close: () => null,
    });
}

/**
 * 登場判定の完了継続(成功で登場・ゴースト選択時は isGhost も)。判定者クライアントで走る
 * (自分のアクター=所有者権限で更新可)。目標値なし(エリア未設定)は成否が出ないため自動登場
 * しない(卓裁定・RL が手動登場で切替)。setAppearing は冪等=再判定の再実行にも安全。
 * ゴーストは登場より先に立てる=盤面反映のトークンが最初から不可視で作られる(2026-08-23)。
 * @param {{actorId: string, ghost: boolean}} cc 継続文脈
 * @param {{success: ?boolean}} result 判定結果
 */
export async function resolveAppearanceFromCheck(cc, result) {
    if (result?.success !== true) return;
    const actor = game.actors.get(cc?.actorId);
    if (!actor) return;
    if (cc.ghost) await setGhost(actor, true);
    await setAppearing(actor, true);
    ui.notifications.info(`${actor.name} はシーンに登場した${cc.ghost ? "（ゴースト）" : ""}。`);
}
