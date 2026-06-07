import combineSelectors from 'postcss-combine-duplicated-selectors';

// postcss-merge-rules は除外: 無関係なセレクタの過剰マージ・コメント削除の副作用あり
// postcss-combine-duplicated-selectors のみ使用:
//   同一セレクタが複数箇所に分散している場合のみ、宣言を1ブロックに統合する
//
// 注意: このプラグインも :root 内のセクションコメントを削除する副作用がある。
//       bulk 実行後は必ず git diff で確認し、削除されたコメントを手動で復元すること。
export default {
  plugins: [
    combineSelectors({ removeDuplicatedProperties: true })
  ]
};
