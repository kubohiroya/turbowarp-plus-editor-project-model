# TurboWarp Plus Editor Project Model

[日本語](README.ja.md)

Reads and edits a running Scratch project for TurboWarp Plus Editor, without any UI. Every function takes the VM and its targets through structural types, so this package never imports the VM, the GUI, React, or Dockview. Panels and the Editor's project search call the same functions, so they always agree on what a project contains.

## Entry points

| Import | Contents |
| --- | --- |
| `@kubohiroya/turbowarp-plus-editor-project-model/project-messages` | Which blocks send or receive each broadcast message (`scanProjectMessages`, `scanTargetMessages`, `projectMessageGraph`, `messageReference`), and whether a message can be renamed (`checkMessageRename`) |
| `@kubohiroya/turbowarp-plus-editor-project-model/sprite-variable-edit` | Creating, renaming and deleting a variable of the editing sprite or the stage (`editSpriteVariable`). It refuses duplicate names, keeps the cloud prefix, and refuses to delete a variable that a block uses |
| `@kubohiroya/turbowarp-plus-editor-project-model` | Both of the above |

## Verification

Run `npm test` to build the package and run the unit tests.

## License

MPL-2.0. This code was split out of `@kubohiroya/turbowarp-plus-editor-layout`, and its history is kept in this repository.
