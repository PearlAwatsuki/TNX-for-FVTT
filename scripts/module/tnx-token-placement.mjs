/**
 * @fileoverview トークン配置(フェーズ11-6・NPC取得用途)。
 *
 * dnd5e の召喚配置(module/canvas/token-placement.mjs の TokenPlacement)を踏襲:
 * **トークンの半透明プレビューがカーソルに追従**し、左クリックで配置確定・右クリックでスキップ。
 * グリッドスナップあり(Shift 押下で解除)。クロスヘアは出ない(2026-07-04 実装確認済み)。
 * ※ ホイール回転は見送り(必要になったら追加)。
 *
 * 権限は D&D 同様: トークン作成権限が無ければ配置できない(警告のみ・権限委譲の仕組みは
 * 作らない=2026-07-04 確定)。エキストラは共有アクターのトークンを複数配置する運用
 * (リンクなしトークン前提・プロトタイプトークンの設定に従う)。
 */

/**
 * アクターのトークンをプレビュー追従+クリック確定で配置する。
 * @param {Actor} actor 配置するアクター
 * @param {number} count 配置数(1体ずつ位置を選ぶ。右クリックで残りをスキップ)
 * @returns {Promise<TokenDocument[]>} 作成されたトークン
 */
export async function placeActorTokens(actor, count = 1) {
    if (!actor) return [];
    if (!canvas?.ready || !canvas.scene) {
        ui.notifications.warn("トークンを配置するシーンがありません。");
        return [];
    }
    if (!game.user.can("TOKEN_CREATE")) {
        ui.notifications.warn("トークンを配置する権限がありません（D&D の召喚と同様、権限が無い場合は配置できません。RL に配置を依頼してください）。");
        return [];
    }

    const placed = [];
    for (let i = 0; i < count; i++) {
        const topLeft = await pickTokenPosition(actor);
        if (!topLeft) break; // 右クリック=スキップ(残りも中止)
        try {
            const tokenDoc = await actor.getTokenDocument(topLeft);
            const created = await canvas.scene.createEmbeddedDocuments("Token", [tokenDoc.toObject()]);
            if (created?.length) placed.push(created[0]);
        } catch (err) {
            console.error("TNX | トークン配置に失敗しました", err);
            ui.notifications.warn(`「${actor.name}」のトークンを配置できませんでした。`);
            break;
        }
    }
    return placed;
}

/**
 * プレビュー追従で配置位置(トークン左上座標)を選ばせる。
 * @param {Actor} actor
 * @returns {Promise<{x:number, y:number}|null>} null=スキップ(右クリック)
 */
async function pickTokenPosition(actor) {
    const proto = actor.prototypeToken;
    const w = (proto.width ?? 1) * canvas.grid.sizeX;
    const h = (proto.height ?? 1) * canvas.grid.sizeY;

    // 半透明プレビュー(トークン画像のゴースト。テクスチャが読めなければ枠のみ)
    let sprite;
    try {
        const load = foundry.canvas.loadTexture ?? loadTexture;
        const texture = await load(proto.texture?.src || actor.img);
        sprite = new PIXI.Sprite(texture);
    } catch {
        sprite = new PIXI.Graphics();
        sprite.lineStyle(2, 0x88ccee, 0.8).drawRect(0, 0, w, h);
    }
    sprite.width = w;
    sprite.height = h;
    sprite.alpha = 0.6;
    sprite.eventMode = "none";
    canvas.stage.addChild(sprite);

    const snapTopLeft = (pt, unsnapped) => {
        if (unsnapped || canvas.grid.isGridless) return { x: pt.x, y: pt.y };
        return canvas.grid.getSnappedPoint(pt, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX, resolution: 1 });
    };

    return new Promise((resolve) => {
        const stage = canvas.stage;
        const setPos = (p) => sprite.position.set(p.x - w / 2, p.y - h / 2);

        const onMove = (ev) => setPos(ev.getLocalPosition(stage));
        const onDown = (ev) => {
            if (ev.button !== 0 && ev.button !== 2) return;
            ev.stopPropagation();
            if (ev.button === 2) return finish(null);
            const p = ev.getLocalPosition(stage);
            const shift = ev.shiftKey ?? ev.nativeEvent?.shiftKey ?? false;
            finish(snapTopLeft({ x: p.x - w / 2, y: p.y - h / 2 }, shift));
        };
        const finish = (value) => {
            stage.off("pointermove", onMove);
            stage.off("pointerdown", onDown);
            sprite.destroy();
            resolve(value);
        };

        setPos(canvas.mousePosition ?? { x: 0, y: 0 });
        stage.on("pointermove", onMove);
        stage.on("pointerdown", onDown);
        ui.notifications.info(`「${actor.name}」のトークンを配置: クリックで確定・右クリックでスキップ（Shift でスナップ解除）`);
    });
}
