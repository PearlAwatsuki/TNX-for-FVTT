// カードのスートを定義
const SUITS = {
    "hearts": "ハート",
    "diamonds": "ダイヤ",
    "clubs": "クラブ",
    "spades": "スペード"
};

// カードのランクを定義 (値と表示名)
const RANKS = {
    1: { value: 1, name: "A" },
    2: { value: 2, name: "2" },
    3: { value: 3, name: "3" },
    4: { value: 4, name: "4" },
    5: { value: 5, name: "5" },
    6: { value: 6, name: "6" },
    7: { value: 7, name: "7" },
    8: { value: 8, name: "8" },
    9: { value: 9, name: "9" },
    10: { value: 10, name: "10" },
    11: { value: 11, name: "J" },
    12: { value: 12, name: "Q" },
    13: { value: 13, name: "K" }
};

/**
 * デフォルトのカードデッキデータを生成する関数
 * @param {number} [deckCount=1] 作成するデッキの数
 * @returns {Array<object>} カードデータの配列
 */
export function createDefaultDeckData(deckCount = 1, createFaceDown = true) {
    const cards = [];
    const basePath = "systems/tokyo-nova-axleration/assets/cards/playing-cards/";

    // ★ 指定されたデッキ数だけループ
    for (let i = 0; i < deckCount; i++) {
        
        // 標準的な52枚のカードを生成
        for (const [suitKey, suitName] of Object.entries(SUITS)) {
            for (const [rankKey, rankInfo] of Object.entries(RANKS)) {
                const cardName = `${suitName}の${rankInfo.name}`;
                const cardImagePath = `${basePath}${suitKey}_${rankKey}.png`;

                cards.push({
                    name: cardName,
                    type: "playingCards",
                    suit: suitKey,
                    value: rankInfo.value,
                    face: createFaceDown ? null : 0,
                    width: 2,
                    height: 3,
                    faces: [{
                        name: cardName,
                        text: "",
                        img: cardImagePath
                    }],
                    system: {}
                });
            }
        }

        // ジョーカーを2枚追加
        cards.push({
            name: "ジョーカー",
            type: "playingCards",
            suit: "joker",
            value: 99,
            face: createFaceDown ? null : 0,
            width: 2,
            height: 3,
            faces: [{ 
                name: "ジョーカー",
                text: "",
                img: `${basePath}joker_1.png`
            }],
            system: {}
        });
        cards.push({
            name: "ジョーカー",
            type: "playingCards",
            suit: "joker",
            value: 99,
            face: createFaceDown ? null : 0,
            width: 2,
            height: 3,
            faces: [{ 
                name: "ジョーカー",
                text: "",
                img: `${basePath}joker_2.png`
            }],
            system: {}
        });
    }

    return cards;
}