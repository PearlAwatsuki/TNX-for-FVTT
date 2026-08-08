/**
 * GM専用の切り札カードのデータ配列を生成して返す
 * @returns {Array<object>} カードデータの配列
 */
export function createAccessCardsData() {
    const cards = [];
    const basePath = "systems/tokyo-nova-axleration/assets/cards/access-cards/";
    // 「シーンプレイヤー」「舞台裏」「ゴースト」「抹殺」の4枚は作成しない(14-7・2026-08-08
    // ユーザー裁定)——これらは提示式のカードでなく、対応する状態からの自動表示(HUD の
    // ステータスエリア)に移行した。既存ワールドの作成済みカードには触れない
    const CardList = [
        { name: "切り札", description: "切り札", img: "trump.png", text: "切り札" },
        { name: "YES", description: "YES", img: "yes.png", text: "YES" },
        { name: "NO", description: "NO", img: "no.png", text: "NO" },
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