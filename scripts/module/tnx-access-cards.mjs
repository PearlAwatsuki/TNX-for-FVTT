/**
 * GM専用の切り札カードのデータ配列を生成して返す
 * @returns {Array<object>} カードデータの配列
 */
export function createAccessCardsData() {
    const cards = [];
    const basePath = "systems/tokyo-nova-axleration/assets/cards/access-cards/";
    const CardList = [
        { name: "シーン・プレイヤー", description: "シーン・プレイヤー", img: "scene_player.png", text: "シーン・プレイヤー" },
        { name: "切り札", description: "切り札", img: "trump.png", text: "切り札" },
        { name: "YES", description: "YES", img: "yes.png", text: "YES" },
        { name: "NO", description: "NO", img: "no.png", text: "NO" },
        { name: "舞台裏", description: "舞台裏", img: "behind_the_scene.png", text: "舞台裏" },
        { name: "ゴースト", description: "ゴースト", img: "ghost.png", text: "ゴースト" },
        { name: "抹殺", description: "抹殺", img: "erasure.png", text: "抹殺" },
        { name: "SEALED", description: "SEALED", img: "sealed.png", text: "SEALED" }
    ];

    for (const cardInfo of CardList) {
        cards.push({
            name: cardInfo.name,
            type: "other",
            suit: null,
            value: cardInfo.value,
            description: cardInfo.description,
            face: 0,
            faces: [{
                name: cardInfo.name,
                text: cardInfo.text,
                img: `${basePath}${cardInfo.img}`
            }],
            system: {}
        });
    }

    return cards;
}