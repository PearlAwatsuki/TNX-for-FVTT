/**
 * ニューロデッキのカードデータを生成する関数
 * @returns {Array<object>} カードデータの配列
 */
export function createNeuroDeckData() {
    const cards = [];
    const basePath = "systems/tokyo-nova-axleration/assets/cards/neuro-cards/";
    const neuroCardList = [
        { value: -18, name: '-18：アヤカシ / <span class="mirror-character">noom eht</span>', description: "停止。凪。自縄自縛。手がかりが消える。", img: "ayakashi.png", text: "「倦怠」" },
        { value: -17, name: '-17：エトランゼ / <span class="mirror-character">rats eht</span>', description: "不思議な出来事。白昼夢。夢か現か。曖昧になる虚構と現実。", img: "etranger.png", text: "「夢」" },
        { value: -9, name: '-9：カゲムシャ / <span class="mirror-character">timreh eht</span>', description: "懐疑。嫌疑。疑心暗鬼を生ず。不自然な行動。痛くもない腹を探られる。", img: "kagemusha.png", text: "「疑惑」" },
        { value: -7, name: '-7：アラシ / <span class="mirror-character">toirahc eht</span>', description: "危機的な状況からの脱出。改革、解放。即断即決を迫られる。", img: "arashi.png", text: "「離脱」" },
        { value: -6, name: '-6：シキガミ / <span class="mirror-character">srevol eht</span>', description: "約束が結ばれる。選択の時。和解、合一。信頼関係。", img: "shikigami.png", text: "「契約」" },
        { value: -4, name: '-4：イブキ / <span class="mirror-character">rorepme eht</span>', description: "積極的な決断。信頼、支持。意思表示。乗り越えることによる成功。", img: "ibuki.png", text: "「責任」" },
        { value: -2, name: '-2：クロガネ / <span class="mirror-character">ssetseirp eht</span>', description: "思わぬ場所からの助力。忠義、熱愛、敬意。救いの手は傍らにある。", img: "kurogane.png", text: "「献身」" },
        { value: -1, name: '-1：ヒルコ / <span class="mirror-character">sugam eht</span>', description: "停滞していた物事が進展する。突出。猪突猛進。", img: "hiruko.png", text: "「前進」" },
        { value: 0, name: '-：コモン / <span class="mirror-character">loof eht</span>', description: "ごく普通の日常。変化のない生活。平穏。陳腐で成り行き任せ。", img: "common.png", text: "「無垢」" },
        { value: 0, name: "-：カブキ / the fool", description: "完全なる偶然による現状の進展。善かれ悪しかれ。", img: "kabuki.png", text: "「門出」" },
        { value: 1, name: "1：バサラ / the magus", description: "まったく新しい情報や状況の判明。イマジネーション。", img: "vasara.png", text: "「意志」" },
        { value: 2, name: "2：タタラ / the priestess", description: "大局が見える。問題解決の糸口を発見。インスピレーション。", img: "tatara.png", text: "「智恵」" },
        { value: 3, name: "3：ミストレス / the empress", description: "母性。女性ゲストの協力。物質的な恩恵を被る。", img: "mistress.png", text: "「豊穣」" },
        { value: 4, name: "4：カブト / the emperor", description: "父性。男性ゲストの協力。精神的な恩恵を被る。", img: "kabuto.png", text: "「庇護」" },
        { value: 5, name: "5：カリスマ / the hierophant", description: "宗教、あるいは世俗的影響力の介入。権力。罪の恩赦。", img: "charisma.png", text: "「啓蒙」" },
        { value: 6, name: "6：マネキン / the lovers", description: "魅力的な異性との出会い。愛情が芽生える可能性アリ。", img: "mannequin.png", text: "「愛」" },
        { value: 7, name: "7：カゼ / the chariot", description: "正面きっての闘いの開始。敵対勢力同士が相互認知。", img: "kaze.png", text: "「勝利」" },
        { value: 8, name: "8：フェイト / adjustment", description: "正義の裁き。因果応報。ツケを払う。何らかの報いを受ける。", img: "fate.png", text: "「公正」" },
        { value: 9, name: "9：クロマク / the hermit", description: "事件の黒幕の協力。介入、妨害。賢者による的確な助言。", img: "kuromaku.png", text: "「深遠」" },
        { value: 10, name: "10：エグゼク / fortune", description: "状況の運命的な変化、進展。偶然の姿を借りた必然的なできごと。", img: "exec.png", text: "「運命」" },
        { value: 11, name: "11：カタナ / lust", description: "極めて不利で激しい戦闘の発生。決断を必要とする状況の到来。", img: "katana.png", text: "「力」" },
        { value: 12, name: "12：クグツ / the hanged man", description: "膠着状態。不安定。中途半端。味方ゲストの自己犠牲的な協力。", img: "kugutsu.png", text: "「維持」" },
        { value: 13, name: "13：カゲ / death", description: "これまで潜伏していた勢力が動き出す。刺客襲来。昇華。", img: "kage.png", text: "「死」" },
        { value: 14, name: "14：チャクラ / art", description: "双方互角。自然な安定。何らかの均衡。和解。相互協定。", img: "chakra.png", text: "「調和」" },
        { value: 15, name: "15：レッガー / the devil", description: "予期せぬ不運。苦渋。絶望。不本意な屈従を求められる。", img: "legger.png", text: "「災難」" },
        { value: 16, name: "16：カブトワリ / the tower", description: "作戦失敗。極めて危険な状況の発生。崩壊。根本からの破壊。", img: "kabuto-wari.png", text: "「挫折」" },
        { value: 17, name: "17：ハイランダー / the star", description: "予期せぬ幸運。状況の好転。失敗しかけた計画の奇跡的な進展。", img: "highlander.png", text: "「希望」" },
        { value: 18, name: "18：マヤカシ / the moon", description: "裏切りの露見。魔的な襲撃。毒。不実な人間の罠。不確かな夢。", img: "mayakashi.png", text: "「幻影」" },
        { value: 19, name: "19：トーキー / the sun", description: "敵の正体露見。思いがけぬ味方。状況が将棋倒し式に進展する。", img: "talkie.png", text: "「繁栄」" },
        { value: 20, name: "20：イヌ / the aeon", description: "事件の決着。逮捕。失われしものの再生、復活。蘇生。浄化。", img: "inu.png", text: "「審判」" },
        { value: 21, name: "21：ニューロ / the universe", description: "成功。集塵の耳目を集めるほどの完璧な結果。最終目標の達成。", img: "neuro.png", text: "「完成」" }
    ];

    for (const cardInfo of neuroCardList) {
        cards.push({
            name: cardInfo.name,
            type: "neuroCards",
            suit: null,
            value: cardInfo.value,
            description: cardInfo.description,
            face: null,
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