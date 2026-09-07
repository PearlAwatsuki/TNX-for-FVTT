/**
 * @fileoverview シーン開始ダイアログ(フェーズ14-8・2026-08-09 ユーザー指定)。
 *
 * 登場判定が「未設定」のシーン(＝巡回シーンは常にこれ)に入るとき、その場で決めるものを聞く。
 * 台本に書かれていないと**宣言された**値だけを扱うので、データ駆動原則(設定はアクトシートから
 * 読む・パネルで手入力しない)の適用範囲の外にある。
 *
 * 欄の並びと表示条件:
 *   シーンプレイヤー … 巡回シーンのみ(既定＝未消化の先頭・選び直せる)
 *   舞台             … 常時。「任意」＋対象キャラクターが所持している住宅施設
 *   エリア           … 舞台＝任意のときだけ
 *   登場判定目標値   … 舞台＝任意のときだけ(初期値 10・エリアを選ぶとその固定値へ)
 *   指定技能         … 常時(台本の指定を初期値に、追加・削除できる)
 *
 * 住宅施設を選んだ場合は、住宅施設が持っている登場判定目標値とエリアをそのまま読み取る
 * (residence-area.mjs)。決めた値は実行状態の上書きへ入り、台本は書き換えない。
 */

import { SCENE_AREA_OPTIONS } from "../rules/session.mjs";
import { DEFAULT_APPEARANCE_TARGET, areaTargetValue } from "../rules/appearance.mjs";
import { loadGroupedGeneralSkillChoices, loadGeneralSkillNameByKey } from "../dictionary/skill-dictionary.mjs";
import { formatSkillName } from "../core/identification.mjs";

const { DialogV2 } = foundry.applications.api;

/**
 * シーン開始ダイアログを開く。
 * @param {object} args
 * @param {object} args.row                    正規化済みシーン行
 * @param {boolean} args.rotation              巡回シーンか(シーンプレイヤー欄の有無)
 * @param {Array<{id:string,name:string}>} [args.playerChoices]   シーンプレイヤーの候補
 * @param {string} [args.defaultPlayerUserId]  既定のシーンプレイヤー(未消化の先頭)
 * @param {Array<object>} [args.stageCandidates] 舞台候補(listStageCandidates の結果)
 * @param {?Record<string,Array<string>>} [args.stageActorIdsByUser] シーンプレイヤーを選び直したときに
 *        舞台候補を絞り込むための「そのユーザーなら見えるキャラクター」表(巡回シーンのみ)
 * @returns {Promise<?{scenePlayerUserId:string, override:{area:string, appearanceValue:?number,
 *                     appearanceSkills:Array<string>}}>} キャンセルは null
 */
export async function promptSceneEntry({
    row, rotation = false, playerChoices = [], defaultPlayerUserId = "", stageCandidates = [],
    stageActorIdsByUser = null,
} = {}) {
    const esc = foundry.utils.escapeHTML;
    const skillGroups  = await loadGroupedGeneralSkillChoices();
    const skillNameByKey = await loadGeneralSkillNameByKey();
    const initialSkills = Array.isArray(row?.appearanceSkills) ? [...row.appearanceSkills] : [];

    const sceneName = row?.name || "無題のシーン";
    const playerField = rotation ? `
        <div class="form-group">
            <label>シーンプレイヤー</label>
            <div class="form-fields">
                <select name="scenePlayerUserId">
                    ${playerChoices.map(u => `<option value="${esc(u.id)}"${u.id === defaultPlayerUserId ? " selected" : ""}>${esc(u.name)}</option>`).join("")}
                </select>
            </div>
        </div>` : "";

    const areaOptions = SCENE_AREA_OPTIONS
        .map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    const skillOptions = (skillGroups ?? []).map(g => `
        <optgroup label="${esc(g.label)}">
            ${g.skills.map(s => `<option value="${esc(s.identificationKey)}">${esc(s.name)}</option>`).join("")}
        </optgroup>`).join("");

    const content = `
        <div class="tnx-scene-entry">
            ${playerField}
            <div class="form-group">
                <label>舞台</label>
                <div class="form-fields"><select name="stage"></select></div>
            </div>
            <div class="form-group" data-free-stage>
                <label>エリア</label>
                <div class="form-fields"><select name="area">${areaOptions}</select></div>
            </div>
            <div class="form-group" data-free-stage>
                <label>登場判定目標値</label>
                <div class="form-fields">
                    <div class="number-input-spinner">
                        <button type="button" class="tnx-btn" data-spin="-1" aria-label="減少">−</button>
                        <input type="number" name="appearanceValue" value="${DEFAULT_APPEARANCE_TARGET}" min="0" />
                        <button type="button" class="tnx-btn" data-spin="1" aria-label="増加">＋</button>
                    </div>
                </div>
            </div>
            <!-- 指定技能はシートと同じタグ入力の共通部品(.tnx-tag-field)に乗せる -->
            <div class="form-group">
                <label>指定技能</label>
                <div class="form-fields">
                    <div class="tnx-tag-field">
                        <div class="tnx-tag-list" data-skill-chips></div>
                        <select data-skill-add>
                            <option value="">＋ 技能を追加</option>
                            ${skillOptions}
                        </select>
                    </div>
                </div>
            </div>
        </div>`;

    return DialogV2.wait({
        window: { title: `シーンの開始：${sceneName}` },
        classes: ["tokyo-nova", "tnx-dialog"],
        position: { width: 420 },
        content,
        render: (_event, dialog) => _wireSceneEntry(dialog.element, {
            stageCandidates, stageActorIdsByUser, skills: initialSkills, skillNameByKey,
        }),
        buttons: [
            {
                action: "ok", icon: "fas fa-play", label: "開始", default: true,
                callback: (_event, _button, dialog) => _collect(dialog.element, {
                    rotation, stageCandidates, skills: initialSkills,
                }),
            },
            { action: "cancel", icon: "fas fa-times", label: "キャンセル", callback: () => false },
        ],
        close: () => null,
    });
}

/** ダイアログ内の連動(舞台による出し分け・エリア連動・指定技能のタグ入力)を配線する。 */
function _wireSceneEntry(root, { stageCandidates, stageActorIdsByUser, skills, skillNameByKey }) {
    const playerSelect = root.querySelector('[name="scenePlayerUserId"]');
    const stageSelect  = root.querySelector('[name="stage"]');
    const areaSelect   = root.querySelector('[name="area"]');
    const valueInput   = root.querySelector('[name="appearanceValue"]');
    const chips        = root.querySelector("[data-skill-chips]");
    const skillAdd     = root.querySelector("[data-skill-add]");

    // 舞台に住宅施設を選んだら、エリア・目標値の欄そのものを畳む(住宅施設が両方持っている)。
    // 表示制御はこのダイアログ限りなので、共通 CSS に汎用クラスを足さず直接 display を切る
    const syncStage = () => {
        const free = !stageSelect.value;
        for (const group of root.querySelectorAll("[data-free-stage]")) {
            group.style.display = free ? "" : "none";
        }
    };

    // 舞台候補はシーンプレイヤーに依存する(そのキャストと登場キャラクター、それらとチームを
    // 組んでいる面々の住宅施設)。巡回シーンでシーンプレイヤーを選び直したら候補も入れ替える
    const visibleCandidates = () => {
        if (!stageActorIdsByUser || !playerSelect) return stageCandidates;
        const allowed = new Set(stageActorIdsByUser[playerSelect.value] ?? []);
        return stageCandidates.filter(c => allowed.has(c.actorId));
    };
    const renderStageOptions = () => {
        const visible = visibleCandidates();
        const kept = stageSelect.value;
        stageSelect.replaceChildren();
        const free = document.createElement("option");
        free.value = "";
        free.textContent = "任意";
        stageSelect.append(free);
        for (const candidate of visible) {
            const option = document.createElement("option");
            option.value = candidate.value;
            option.textContent = candidate.label;
            stageSelect.append(option);
        }
        stageSelect.value = visible.some(c => c.value === kept) ? kept : "";
        // 候補が無いときはプルダウンを出しても選びようがない(「任意」だけ)ので隠す
        const group = stageSelect.closest(".form-group");
        if (group) group.style.display = visible.length ? "" : "none";
        syncStage();
    };

    stageSelect?.addEventListener("change", syncStage);
    playerSelect?.addEventListener("change", renderStageOptions);
    renderStageOptions();

    // エリアを選ぶと目標値をそのエリアの固定値へ(未設定に戻すと手入力の初期値へ)。
    // その後の手入力は上書きできる＝数値指定
    areaSelect?.addEventListener("change", () => {
        const tn = areaTargetValue(areaSelect.value);
        valueInput.value = String(tn ?? DEFAULT_APPEARANCE_TARGET);
    });

    for (const button of root.querySelectorAll("[data-spin]")) {
        button.addEventListener("click", () => {
            const next = (Number(valueInput.value) || 0) + Number(button.dataset.spin);
            valueInput.value = String(Math.max(0, next));
        });
    }

    // 指定技能のタグ入力(台本の指定を初期値に、その場で足し引きできる)
    const renderChips = () => {
        chips.replaceChildren();
        for (const key of skills) {
            const dictName = skillNameByKey?.get(key);
            const tag = document.createElement("span");
            tag.className = "tnx-tag";
            tag.textContent = dictName ? formatSkillName(dictName) : "（参照切れ）";
            const remove = document.createElement("a");
            remove.className = "tnx-tag-remove";
            remove.title = "指定を外す";
            remove.innerHTML = '<i class="fas fa-times"></i>';
            remove.addEventListener("click", () => {
                const at = skills.indexOf(key);
                if (at >= 0) skills.splice(at, 1);
                renderChips();
            });
            tag.append(remove);
            chips.append(tag);
        }
    };
    skillAdd?.addEventListener("change", () => {
        const key = skillAdd.value;
        skillAdd.value = "";
        if (key && !skills.includes(key)) {
            skills.push(key);
            renderChips();
        }
    });
    renderChips();
}

/** 入力値を実行状態の上書きの形へ集める。 */
function _collect(root, { rotation, stageCandidates, skills }) {
    const stageValue = root.querySelector('[name="stage"]')?.value ?? "";
    const hit = stageCandidates.find(c => c.value === stageValue) ?? null;
    const rawValue = root.querySelector('[name="appearanceValue"]')?.value ?? "";
    return {
        scenePlayerUserId: rotation
            ? (root.querySelector('[name="scenePlayerUserId"]')?.value ?? "") : "",
        override: {
            // 住宅施設を舞台にしたら、その住宅の登場判定目標値とエリアをそのまま適用する
            area:             hit ? hit.area : (root.querySelector('[name="area"]')?.value ?? ""),
            appearanceValue:  hit ? hit.targetValue : (rawValue === "" ? null : Number(rawValue)),
            appearanceSkills: [...skills],
        },
    };
}
