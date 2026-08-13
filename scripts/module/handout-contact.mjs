/**
 * @fileoverview ハンドアウトのアクトコネクション受け取り(2026-08-12 ユーザー指示)。
 *
 * HO 送信カードの最下部のボタンを押すと、**その HO の対象ユーザーのプレイヤーキャラクター**に
 * 「コネ：<相手の名前>」の一般技能を作る。プレイヤーキャラクターが未設定なら、HO の指定スタイルを
 * 持つキャストを新規作成し、対象ユーザーのプレイヤーキャラクターに登録してからコネを入れる
 * ——自動作成の目的は「アクトコネがインポートされたアクターを用意すること」(ユーザー明言)。
 *
 * **押せる人は絞らない**(2026-08-12 裁定)。他ユーザーが押すのは正規の手順ではないだけで、
 * ブロックする必要はない——権限が足りなければ Foundry 側が弾くので、その理由を警告に出す。
 *
 * アクト開始時の自動配布(旧 `_grantActConnections`)は本ボタンに置き換えて廃止した。
 */

import { TnxSocketHandler } from "./tnx-socket-handler.mjs";
import { HANDOUT_STYLE_COMMON, HANDOUT_STYLE_FREE } from "./session-logic.mjs";
import { STYLE_PACK, ONOMASTIC_TYPES, stripSkillCategory } from "./skill-dictionary.mjs";
import { calcSkillInsertSort } from "./identification.mjs";

const SCOPE = "tokyo-nova-axleration";
const FLAG = "handoutContact";

/**
 * ハンドアウトのコネ指定を、カードに載せる形へ解決する(2026-08-13)。
 * PC=相手のハンドアウトの担当キャストの現在名／NPC=辞典アイテムの現在名＋uuid／自由記述=入力値。
 * **名前は解決の時点で引き直す**(参照で保存し、キャッシュしない既存規約)。
 * @param {object} handout 正規化済みハンドアウト行
 * @param {Array<object>} handouts 同じアクトの正規化済みハンドアウト行(PC モードの相手を引く)
 * @returns {{type:string, contactName:string, itemUuid:string}} contactName が空なら受け取り口を出さない
 */
export function resolveHandoutContact(handout, handouts = []) {
    const type = handout?.actConnectionType ?? "free";
    if (type === "pc") {
        const target = handouts.find(h => h.id === handout.actConnectionHandoutId);
        const cast = target?.userId ? game.users.get(target.userId)?.character : null;
        return { type, contactName: cast?.name ?? "", itemUuid: "" };
    }
    if (type === "npc") {
        const uuid = handout?.actConnectionUuid ?? "";
        const doc = uuid ? fromUuidSync(uuid) : null;
        // 辞典のコネ技能の名前は「コネ：<相手>」なので、カードの「コネ」欄に出すときは
        // 接頭を落とす(落とさないと「コネ: コネ：キース」になる)。技能そのものの名前は変えない
        return { type, contactName: stripSkillCategory(doc?.name ?? "", ONOMASTIC_TYPES.contact), itemUuid: uuid };
    }
    return { type: "free", contactName: (handout?.actConnection ?? "").trim(), itemUuid: "" };
}

/**
 * 生成するコネ技能のデータ。固有名詞技能・アクション技能・報酬点使用可能に加えて、
 * **初期取得の社会・コネ**かつ**アクト限定**(2026-08-12 ユーザー指定)。
 * 識別キーは**名前と無関係な一意 ID**にする——名前から作るとコネ名の変更や重複で壊れるため。
 * `contact_` の接頭だけは付ける(コネ小分類の判定がこのプレフィックスに依存している)。
 * アクトを越えて残したいときはユーザーがキーを付け直す運用。
 * @param {string} contactName コネの相手の名前(「コネ：」を含まない素の名前)
 * @returns {object} Item の作成データ
 */
export function buildContactSkillData(contactName) {
    return {
        name: `コネ：${contactName}`,
        type: "generalSkill",
        system: {
            generalSkillCategory: "onomasticSkill",
            onomasticSkill: { isInitial: true },
            isAction: true,
            usesBounty: true,
            isActLimited: true,
            identificationKey: `contact_${foundry.utils.randomID()}`,
        },
    };
}

/** カードのフラグから受け取り済みか。 */
export function isContactGranted(flag) {
    return flag?.granted === true;
}

/**
 * HO 送信カードのライブ描画。コネが指定されていればボタン(または生成済み)を最下部に出す。
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery} html
 */
export function renderHandoutCard(message, html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    const flag = message.getFlag(SCOPE, FLAG);
    const slot = root?.querySelector(".ho-contact-action");
    if (!slot || !flag?.contactName) return;
    slot.innerHTML = "";

    if (isContactGranted(flag)) {
        const done = document.createElement("div");
        done.className = "cr-req-result";
        const owner = flag.actorName ? `（${flag.actorName}）` : "";
        done.innerHTML = `<span class="cr-inline-success"><i class="fas fa-check"></i> コネを取得済み${owner}</span>`;
        slot.appendChild(done);
        return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tnx-chat-btn";
    // 相手の名前はすぐ上のコネ行に出ているので、ボタンには載せない(長い名前で2行に折り返すため)
    btn.innerHTML = '<i class="fas fa-address-book"></i> コネを受け取る';
    btn.addEventListener("click", () => grantHandoutContact(message));
    slot.appendChild(btn);
}

/**
 * コネを受け取る。対象は**HO の対象ユーザーのプレイヤーキャラクター**(押した人ではない)。
 * @param {ChatMessage} message
 */
export async function grantHandoutContact(message) {
    const flag = message.getFlag(SCOPE, FLAG);
    if (!flag?.contactName || isContactGranted(flag)) return;

    const user = flag.userId ? game.users.get(flag.userId) : null;
    if (!user) {
        ui.notifications.warn("このハンドアウトには対象ユーザーが設定されていません。");
        return;
    }

    let actor = user.character ?? null;
    if (actor && actor.type !== "cast") actor = null;
    if (!actor) {
        actor = await createCastForUser(user, flag.styleKey);
        if (!actor) return;
    }

    // NPC は辞典のコネ技能を**そのまま複製**し、PC・自由記述は名前から**組み立てる**
    // (2026-08-13)。どちらもアクト限定は立てる(ユーザー指示「全て『アクト限定』を立てる」)
    let data;
    if (flag.type === "npc") {
        const doc = flag.itemUuid ? await fromUuid(flag.itemUuid).catch(() => null) : null;
        if (doc?.type !== "generalSkill") {
            ui.notifications.warn("指定されたコネ技能が見つかりません。");
            return;
        }
        data = doc.toObject();
        delete data._id;
        foundry.utils.setProperty(data, "system.isActLimited", true);
    } else {
        data = buildContactSkillData(flag.contactName);
    }

    // 同じ名前のコネを既に持っていたら作らない(カードを跨いだ重複も防ぐ)
    const name = data.name;
    if (!actor.items.some(i => i.type === "generalSkill" && i.name === name)) {
        // シートの一般技能リストは item.sort で並ぶ。sort を振らないと末尾に付いて正規順を
        // 無視するため、ドロップ・＋ボタンと同じ挿入位置の計算に揃える(2026-08-13 是正)
        data.sort = calcSkillInsertSort(
            actor.items.filter(i => i.type === "generalSkill"), data.system?.identificationKey ?? "");
        try {
            await actor.createEmbeddedDocuments("Item", [data]);
        } catch (err) {
            ui.notifications.warn(`${actor.name} にコネを作成できませんでした（${err.message}）。`);
            return;
        }
    }

    ui.notifications.info(`${actor.name} に「${name}」を追加しました。`);
    await TnxSocketHandler.applyMessagePatch(
        message, { granted: true, actorId: actor.id, actorName: actor.name }, FLAG);
}

/**
 * 対象ユーザーのキャストを新規作成し、プレイヤーキャラクターに登録する。
 * 指定スタイルがあれば辞典から取り込む(共通・自由記述はスタイルを指さないので入れない)。
 * **キースタイルには設定しない**(2026-08-12 裁定)。
 * @param {User} user 対象ユーザー
 * @param {string} styleKey HO の指定スタイル(スタイル辞典の識別キー・`@common`/`@free` は無指定)
 * @returns {Promise<?Actor>} 作成したキャスト(失敗時 null)
 */
async function createCastForUser(user, styleKey) {
    let actor;
    try {
        actor = await Actor.create({
            name: user.name,
            type: "cast",
            ownership: { default: 0, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        });
    } catch (err) {
        ui.notifications.warn(`キャストを作成できませんでした（${err.message}）。`);
        return null;
    }
    if (!actor) return null;

    const style = await loadStyleItem(styleKey);
    if (style) {
        const data = style.toObject();
        delete data._id;
        if (!data.system.level) data.system.level = 1;
        await actor.createEmbeddedDocuments("Item", [data]);
    }

    try {
        await user.update({ character: actor.id });
    } catch (err) {
        ui.notifications.warn(`${user.name} のプレイヤーキャラクターに登録できませんでした（${err.message}）。`);
    }
    return actor;
}

/** スタイル辞典から識別キーでスタイルアイテムを引く(指定なし・見つからなければ null)。 */
async function loadStyleItem(styleKey) {
    if (!styleKey || styleKey === HANDOUT_STYLE_COMMON || styleKey === HANDOUT_STYLE_FREE) return null;
    const pack = game.packs?.get(STYLE_PACK);
    if (!pack) return null;
    // 列挙は getIndex・単品は getDocument(キャッシュ優先・KI-026 の孤児化を起こさない)
    const index = await pack.getIndex({ fields: ["system.identificationKey"] });
    const hit = [...index].find(e => e.system?.identificationKey === styleKey);
    return hit ? await pack.getDocument(hit._id).catch(() => null) : null;
}
