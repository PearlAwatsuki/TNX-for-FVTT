# Release Checklist

フェーズ完了時のリリース作業手順。MINOR バージョンアップ時に使用。

PATCH リリース時は項目 1〜5 と 7 のみ実施(GitHub Releases は省略)。

## 手順

1. **テスト・リントが緑であることを確認**

   ```
   npm test
   npm run lint
   ```

   いずれもエラー 0 件であること。

2. **CHANGELOG.md を更新**

   - `[Unreleased]` セクションの内容を `[X.Y.Z] - YYYY-MM-DD` に切り出す
   - 新しい `[Unreleased]` セクションを上部に追加(空の Added/Changed/Fixed 等)

3. **バージョン番号を 3 箇所で更新**

   - `package.json` の `"version"`
   - `system.json` の `"version"`
   - (オプション)`README.md` 等にバージョン表記があれば更新

4. **コミット**

   ```
   git add CHANGELOG.md package.json system.json
   git commit -m "chore: vX.Y.Z をリリース"
   ```

5. **git タグを作成**

   ```
   git tag vX.Y.Z
   git push origin main --tags
   ```

6. **GitHub Releases を作成(MINOR 以上のみ)**

   - GitHub のリポジトリページ → Releases → "Draft a new release"
   - タグを `vX.Y.Z` で選択
   - タイトル: `vX.Y.Z - <フェーズ名>`
   - 本文: CHANGELOG.md の該当バージョン部分をコピー
   - "Publish release" で公開

7. **CLAUDE.md の現在フェーズ表記を更新**

   - 2.2「現在のフェーズ」を次のフェーズに更新
   - 必要に応じてロードマップの進行マークを更新
