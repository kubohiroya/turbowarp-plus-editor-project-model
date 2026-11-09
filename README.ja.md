# TurboWarp Plus Editor Project Model

[English](README.md)

TurboWarp Plus Editor で、実行中の Scratch 作品を画面なしで読み取り、編集する。どの関数も VM と対象（スプライト・ステージ）を構造的な型で受け取るので、このパッケージは VM・GUI・React・Dockview を import しない。パネルと Editor の作品全体の検索が同じ関数を呼ぶため、作品の中身について両者の判断が食い違わない。

## 入口

| import | 内容 |
| --- | --- |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-messages` | どのブロックが各メッセージを送り、受け取るか（`scanProjectMessages`・`scanTargetMessages`・`projectMessageGraph`・`messageReference`）と、メッセージの名前を変えられるか（`checkMessageRename`） |
| `@kubohiroya/turbowarp-plus-editor-project-model/sprite-variable-edit` | 編集中のスプライトまたはステージの変数の作成・名前変更・削除（`editSpriteVariable`）。重複する名前を拒み、クラウド変数の接頭辞を保ち、ブロックが使っている変数は削除しない |
| `@kubohiroya/turbowarp-plus-editor-project-model` | 上の両方 |

## 検証

`npm test` でビルドし、単体テストを実行する。

## ライセンス

MPL-2.0。`@kubohiroya/turbowarp-plus-editor-layout` から切り出したコードで、その履歴をこのリポジトリに残している。
