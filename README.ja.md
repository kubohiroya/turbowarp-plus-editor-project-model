# TurboWarp Plus Editor Project Model

[English](README.md)

TurboWarp Plus Editor で、実行中の Scratch 作品を画面なしで読み取り、編集する。どの関数も VM と対象（スプライト・ステージ）を構造的な型で受け取るので、このパッケージは VM・GUI・React・Dockview を import しない。パネルと Editor の作品全体の検索が同じ関数を呼ぶため、作品の中身について両者の判断が食い違わない。

## 入口

| import | 内容 |
| --- | --- |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-messages` | どのブロックが各メッセージを送り、受け取るか（`scanProjectMessages`・`scanTargetMessages`・`projectMessageGraph`・`messageReference`）と、メッセージの名前を変えられるか（`checkMessageRename`） |
| `@kubohiroya/turbowarp-plus-editor-project-model/sprite-variable-edit` | 編集中のスプライトまたはステージの変数の作成・名前変更・削除（`editSpriteVariable`）。重複する名前を拒み、クラウド変数の接頭辞を保ち、ブロックが使っている変数は削除しない |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-search` | 作品全体の検索（`searchProject`・`searchYamlDocuments`・`countVariableAccesses`）。ブロック・変数・リスト・メッセージ・コメント・コスチューム・音を探し、変数ごとに読み書きの箇所を数える |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-search-replace` | 検索結果の置換（`applyProjectSearchReplacement`・`renameProjectMessage`・`replacementText`）。Blockly とワークスペースは構造的な型で受け取り、古くなった結果・不正な名前・重複を拒む |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-search-connections` | 検索と Editor のつなぎ（作品ごとの移動先・YAML 文書・置換を開く口、置換のショートカット） |
| `@kubohiroya/turbowarp-plus-editor-project-model` | 上のすべて |

## 検証

`npm test` でビルドし、単体テストを実行する。

## ライセンス

MPL-2.0。`project-messages`・`sprite-variable-edit` は `@kubohiroya/turbowarp-plus-editor-layout` から切り出したコードで、その履歴をこのリポジトリに残している。

`project-search`・`project-search-replace`・`project-search-connections` は、turbowarp-plus-editor の `packages/editor-ui` から移した。同じ作者が書いたもので、GPL-3.0 から MPL-2.0 にした。由来の監査は [turbowarp-plus-packages の移行計画](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md)の「由来の監査（7b）」にある。
