# TurboWarp Plus Editor Project Model

[日本語](README.ja.md)

Reads and edits a running Scratch project for TurboWarp Plus Editor, without any UI. Every function takes the VM and its targets through structural types, so this package never imports the VM, the GUI, React, or Dockview. Panels and the Editor's project search call the same functions, so they always agree on what a project contains.

## Entry points

| Import | Contents |
| --- | --- |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-messages` | Which blocks send or receive each broadcast message (`scanProjectMessages`, `scanTargetMessages`, `projectMessageGraph`, `messageReference`), and whether a message can be renamed (`checkMessageRename`) |
| `@kubohiroya/turbowarp-plus-editor-project-model/sprite-variable-edit` | Creating, renaming and deleting a variable of the editing sprite or the stage (`editSpriteVariable`). It refuses duplicate names, keeps the cloud prefix, and refuses to delete a variable that a block uses |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-search` | Search across the whole project (`searchProject`, `searchYamlDocuments`, `countVariableAccesses`): blocks, variables, lists, messages, comments, costumes and sounds, with the places each variable is read and written |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-search-replace` | Replace a search result (`applyProjectSearchReplacement`, `renameProjectMessage`, `replacementText`). Blockly and the workspace come in as structural types; stale results, invalid names and duplicates are refused |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-search-connections` | What joins the search to the Editor: per-project hooks for navigation, YAML documents and opening replace, and the replace shortcut |
| `@kubohiroya/turbowarp-plus-editor-project-model` | All of the above |

## Verification

Run `npm test` to build the package and run the unit tests.

## License

MPL-2.0. `project-messages` and `sprite-variable-edit` were split out of `@kubohiroya/turbowarp-plus-editor-layout`, and their history is kept in this repository.

`project-search`, `project-search-replace` and `project-search-connections` moved here from `packages/editor-ui` in turbowarp-plus-editor. The same author wrote them, and they changed from GPL-3.0 to MPL-2.0 in the move. The provenance audit is in the "由来の監査（7b）" section of the [migration plan in turbowarp-plus-packages](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md).
